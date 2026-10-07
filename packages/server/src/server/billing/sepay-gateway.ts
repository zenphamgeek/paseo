import type { Logger } from "pino";
import type { BillingTransactionEntity, ZencodeDatabase } from "../db/database.js";
import { getZencodeDatabase } from "../db/database.js";

export interface SepayWebhookPayload {
  id: number | string;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  code?: string | null;
  content: string;
  transferType: "in" | "out";
  transferAmount: number;
  accumulated?: number;
  subAccount?: string | null;
  referenceCode?: string | null;
  description?: string;
}

export interface PlanPricing {
  code: string;
  name: string;
  amountVnd: number;
  description: string;
  periodDays?: number;
  bonusCredits?: number;
}

export const ZENCODE_PLANS: Record<string, PlanPricing> = {
  pro_monthly: {
    code: "pro_monthly",
    name: "Zencode Pro Monthly",
    amountVnd: 199_000,
    description:
      "20M daily tokens, Claude Haiku/Pro/Terra, Omni Voice 15m/ngày, Qwen 2.1 20 ảnh/ngày",
    periodDays: 30,
    bonusCredits: 500,
  },
  pro_yearly: {
    code: "pro_yearly",
    name: "Zencode Pro Yearly",
    amountVnd: 1_990_000,
    description: "Tiết kiệm 2 tháng + Tặng 5,000 Z-Credits đặc quyền",
    periodDays: 365,
    bonusCredits: 5000,
  },
  credits_pack_50: {
    code: "credits_pack_50",
    name: "Gói 50.000 Z-Credits",
    amountVnd: 50_000,
    description: "Nạp 50k VND = 50.000 Z-Credits",
    bonusCredits: 50_000,
  },
  credits_pack_100: {
    code: "credits_pack_100",
    name: "Gói 100.000 Z-Credits (+20% Bonus)",
    amountVnd: 100_000,
    description: "Nạp 100k VND = 120.000 Z-Credits",
    bonusCredits: 120_000,
  },
  credits_pack_500: {
    code: "credits_pack_500",
    name: "Gói 500.000 Z-Credits (+40% Bonus)",
    amountVnd: 500_000,
    description: "Nạp 500k VND = 700.000 Z-Credits",
    bonusCredits: 700_000,
  },
};

export class SepayGateway {
  private readonly db: ZencodeDatabase;
  private readonly apiKey: string;
  private readonly bankAccount: string;
  private readonly bankName: string;
  private readonly accountHolder: string;
  private readonly logger?: Logger;

  constructor(options?: {
    db?: ZencodeDatabase;
    apiKey?: string;
    bankAccount?: string;
    bankName?: string;
    accountHolder?: string;
    logger?: Logger;
  }) {
    this.db = options?.db || getZencodeDatabase();
    this.apiKey = options?.apiKey || process.env.SEPAY_API_KEY || "zen_sepay_live_secret_key";
    this.bankAccount = options?.bankAccount || process.env.SEPAY_BANK_ACCOUNT || "0988776655";
    this.bankName = options?.bankName || process.env.SEPAY_BANK_NAME || "MBBank";
    this.accountHolder =
      options?.accountHolder || process.env.SEPAY_ACCOUNT_HOLDER || "CONG TY ZENCODE";
    this.logger = options?.logger?.child({ module: "sepay-gateway" });
  }

  public createPaymentOrder(params: { userId: string; planCode: string; customAmount?: number }): {
    order: BillingTransactionEntity;
    qrUrl: string;
    bankInfo: {
      bankName: string;
      accountNumber: string;
      accountHolder: string;
      amount: number;
      transferSyntax: string;
    };
    expiresAt: number;
  } {
    if (
      params.customAmount !== undefined &&
      (typeof params.customAmount !== "number" ||
        !Number.isFinite(params.customAmount) ||
        params.customAmount <= 0)
    ) {
      throw new Error("customAmount must be a positive number");
    }
    const plan = ZENCODE_PLANS[params.planCode];
    const amount = params.customAmount || (plan ? plan.amountVnd : 199_000);

    // Generate readable, unique VietQR syntax e.g. ZC948271
    const randomSuffix = Math.floor(100000 + Math.random() * 900000).toString();
    const orderCode = `ZC${randomSuffix}`;

    const order = this.db.createBillingOrder({
      userId: params.userId,
      orderCode,
      amount,
      planCode: params.planCode,
      provider: "sepay",
      currency: "VND",
    });

    const qrUrl = `https://qr.sepay.vn/img?acc=${encodeURIComponent(this.bankAccount)}&bank=${encodeURIComponent(this.bankName)}&amount=${amount}&des=${encodeURIComponent(orderCode)}`;
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes TTL

    return {
      order,
      qrUrl,
      bankInfo: {
        bankName: this.bankName,
        accountNumber: this.bankAccount,
        accountHolder: this.accountHolder,
        amount,
        transferSyntax: orderCode,
      },
      expiresAt,
    };
  }

  public verifyAuthentication(authHeader?: string, tokenQuery?: string): boolean {
    if (!this.apiKey) return true; // dev mode open

    if (tokenQuery && tokenQuery.trim() === this.apiKey.trim()) {
      return true;
    }

    if (authHeader) {
      const parts = authHeader.trim().split(" ");
      if (
        parts.length === 2 &&
        (parts[0].toLowerCase() === "apikey" || parts[0].toLowerCase() === "bearer")
      ) {
        return parts[1] === this.apiKey;
      }
      if (authHeader.trim() === this.apiKey) {
        return true;
      }
    }

    return false;
  }

  public handleWebhook(
    payload: SepayWebhookPayload,
    authHeader?: string,
    tokenQuery?: string,
  ): {
    success: boolean;
    status: number;
    message: string;
    order?: BillingTransactionEntity;
  } {
    if (!this.verifyAuthentication(authHeader, tokenQuery)) {
      this.logger?.warn({ authHeader }, "Unauthorized SePay webhook callback attempt");
      return { success: false, status: 401, message: "Unauthorized: Invalid SePay API key" };
    }

    if (payload.transferType !== "in") {
      return { success: true, status: 200, message: "Ignored: transferType is not incoming" };
    }

    // Extract Order Code from transaction description or content (e.g. ZC948271)
    const content = `${payload.content || ""} ${payload.description || ""}`;
    const match = content.match(/\b(ZC[0-9A-Za-z]{4,10})\b/i);

    if (!match) {
      this.logger?.info({ content }, "No Zencode order code found in transaction content");
      return { success: true, status: 200, message: "Ignored: No order code recognized" };
    }

    const orderCode = match[1].toUpperCase();
    const order = this.db.getBillingOrderByCode(orderCode);

    if (!order) {
      this.logger?.warn({ orderCode }, "Received payment for non-existent order code");
      return { success: false, status: 404, message: `Order not found for code: ${orderCode}` };
    }

    if (order.status === "COMPLETED") {
      return { success: true, status: 200, message: "Order already completed", order };
    }

    // Verify received amount matches or exceeds order
    const receivedAmount = Number(payload.transferAmount);
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      this.logger?.warn(
        { orderCode, receivedAmount: payload.transferAmount },
        "Invalid transfer amount in webhook payload",
      );
      return { success: false, status: 400, message: "Invalid transfer amount in webhook payload" };
    }
    if (receivedAmount < order.amount) {
      this.logger?.warn(
        { orderCode, expected: order.amount, received: receivedAmount },
        "Insufficient transfer amount received",
      );
      return {
        success: false,
        status: 400,
        message: `Insufficient transfer amount: received ${receivedAmount}, expected ${order.amount}`,
      };
    }

    // Complete order in SQLite database
    const completion = this.db.completeBillingOrder({
      orderCode,
      rawWebhook: payload,
      bankAccount: payload.accountNumber,
      transferContent: content,
    });

    if (!completion.success) {
      return {
        success: false,
        status: 500,
        message: completion.error || "Failed to complete order",
      };
    }

    this.logger?.info(
      { orderCode, userId: order.userId, amount: receivedAmount, plan: order.planCode },
      "Successfully fulfilled VietQR SePay order and upgraded customer tier/credits",
    );

    return {
      success: true,
      status: 200,
      message: "Order completed and benefits applied successfully",
      order: completion.order,
    };
  }

  public getOrderStatus(orderCode: string): BillingTransactionEntity | null {
    return this.db.getBillingOrderByCode(orderCode);
  }
}

let defaultSepayGateway: SepayGateway | null = null;

export function getSepayGateway(options?: {
  db?: ZencodeDatabase;
  apiKey?: string;
  logger?: Logger;
}): SepayGateway {
  if (!defaultSepayGateway) {
    defaultSepayGateway = new SepayGateway(options);
  }
  return defaultSepayGateway;
}
