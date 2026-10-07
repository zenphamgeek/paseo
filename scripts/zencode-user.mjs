#!/usr/bin/env node
import { getUserKeyLedger } from "../packages/server/dist/server/server/auth/user-key-ledger.js";
import path from "node:path";
import os from "node:os";

const storageDir = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
const ledger = getUserKeyLedger(storageDir);

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Zencode Sovereign User & Fleet Access Passkey Manager (Codex Tiers & Private Fleet Control)
Usage:
  node scripts/zencode-user.mjs create --username <name> [--tier <free|pro|team|enterprise>] [--role <admin|dev|guest>] [--fleets <llm,modal_gpu,cloudflare_clef>] [--tokens <num>] [--gpu <minutes>] [--opus] [--private-fleet]
  node scripts/zencode-user.mjs list
  node scripts/zencode-user.mjs reset <userId>
  node scripts/zencode-user.mjs adjust-service <userId> [--tts <min>] [--t2image <img>] [--img2img <edit>]
  node scripts/zencode-user.mjs private-fleet <userId> --enable|--disable
  node scripts/zencode-user.mjs revoke <userId>
  node scripts/zencode-user.mjs adjust <userId> --fleet <llm|modal_gpu|cloudflare_clef> --add-tokens <num>
  node scripts/zencode-user.mjs verify <passkey>
`);
}

function parseArg(flag, defaultValue = undefined) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}

function hasFlag(flag) {
  return args.includes(flag);
}

switch (command) {
  case "create": {
    const username = parseArg("--username");
    if (!username) {
      console.error("Error: --username is required");
      process.exit(1);
    }
    const role = parseArg("--role", "developer");
    const tier = parseArg(
      "--tier",
      role === "admin" ? "enterprise" : role === "developer" ? "pro" : "free",
    );
    const canUsePrivateFleet = hasFlag("--private-fleet") || role === "admin";
    const fleetsRaw = parseArg("--fleets", "llm,cloudflare_clef,modal_gpu");
    const allowedFleets = fleetsRaw.split(",").map((s) => s.trim());
    const dailyTokenBudget = parseArg("--tokens") ? Number(parseArg("--tokens")) : undefined;
    const dailyGpuMinutes = parseArg("--gpu") ? Number(parseArg("--gpu")) : undefined;
    const dailyTtsMinutes = parseArg("--tts") ? Number(parseArg("--tts")) : undefined;
    const dailyT2Images = parseArg("--t2image") ? Number(parseArg("--t2image")) : undefined;
    const dailyImg2ImgEdits = parseArg("--img2img") ? Number(parseArg("--img2img")) : undefined;

    const { user, rawKey } = ledger.createUser({
      username,
      displayName: parseArg("--name", username),
      role,
      tier,
      canUsePrivateFleet,
      allowedFleets,
      dailyTokenBudget,
      dailyGpuMinutes,
      dailyTtsMinutes,
      dailyT2Images,
      dailyImg2ImgEdits,
      allowClaudeOpus,
    });

    console.log("==================================================================");
    console.log("🎉 User Passkey Created Successfully!");
    console.log("==================================================================");
    console.log(`  User ID:         ${user.id}`);
    console.log(`  Username:        ${user.username} (${user.role.toUpperCase()})`);
    console.log(`  Codex Tier:      ${user.tier.toUpperCase()}`);
    console.log(
      `  Private Fleet:   ${user.canUsePrivateFleet ? "✅ ALLOWED (Manual Grant)" : "🔒 LOCKED (Central Fleet Only)"}`,
    );
    console.log(`  Access Key:      ${rawKey}`);
    console.log(`  Fleets:          [${user.allowedFleets.join(", ")}]`);
    console.log(
      `  LLM Budget:      ${user.quotas.llm.dailyTokenBudget.toLocaleString()} tokens/day (Opus: ${user.quotas.llm.allowClaudeOpus ? "YES" : "NO"})`,
    );
    console.log(
      `  Clef Limit:      ${user.quotas.cloudflare_clef.dailyRequests.toLocaleString()} req/day`,
    );
    console.log("  ----------------------------------------------------------------");
    console.log("  Creative & Multimodal Services:");
    console.log(
      `    🎙️  TTS (Omni Voice):     ${user.quotas.services?.tts?.dailyMinutes || 0} min/day`,
    );
    console.log(
      `    🎨  t2Image (Qwen 2.1):    ${user.quotas.services?.t2image?.dailyImages || 0} images/day`,
    );
    console.log(
      `    🖌️  Img2Img (Qwen Edit):   ${user.quotas.services?.img2img?.dailyEdits || 0} edits/day`,
    );
    console.log(`    🎬  App Video:             🚫 UNSUPPORTED (Chưa hỗ trợ)`);
    console.log("==================================================================");
    console.log("⚠️  Keep this key safe! The raw key will never be shown again.");
    break;
  }

  case "private-fleet": {
    const userId = args[1];
    if (!userId) {
      console.error("Error: userId is required");
      process.exit(1);
    }
    const enable = hasFlag("--enable");
    const disable = hasFlag("--disable");
    if (!enable && !disable) {
      console.error("Error: specify either --enable or --disable");
      process.exit(1);
    }
    const ok = ledger.setPrivateFleetAccess(userId, enable);
    if (ok) {
      console.log(
        `✅ User '${userId}' Private Fleet access is now: ${enable ? "ENABLED" : "DISABLED"}`,
      );
    } else {
      console.error(`❌ User '${userId}' not found.`);
    }
    break;
  }

  case "adjust-service": {
    const userId = args[1];
    if (!userId) {
      console.error("Error: userId is required");
      process.exit(1);
    }
    const addTts = parseArg("--tts") ? Number(parseArg("--tts")) : undefined;
    const addT2Image = parseArg("--t2image") ? Number(parseArg("--t2image")) : undefined;
    const addImg2Img = parseArg("--img2img") ? Number(parseArg("--img2img")) : undefined;

    const ok = ledger.adjustServiceQuota(userId, {
      addTtsMinutes: addTts,
      addT2Images: addT2Image,
      addImg2ImgEdits: addImg2Img,
    });
    if (ok) {
      console.log(`✅ User '${userId}' service quotas updated!`);
      const u = ledger.getUser(userId);
      console.log(`  TTS:     ${u.quotas.services.tts.dailyMinutes}m`);
      console.log(`  t2Image: ${u.quotas.services.t2image.dailyImages} images`);
      console.log(`  Img2Img: ${u.quotas.services.img2img.dailyEdits} edits`);
    } else {
      console.error(`❌ User '${userId}' not found.`);
    }
    break;
  }

  case "list": {
    const users = ledger.listUsers();
    console.log(`\nFound ${users.length} registered user passkey(s):\n`);
    console.table(
      users.map((u) => ({
        ID: u.id,
        Username: u.username,
        Tier: (u.tier || "pro").toUpperCase(),
        Role: u.role,
        "Private Fleet": u.canUsePrivateFleet ? "YES" : "NO",
        "LLM Budget": `${u.quotas.llm.usedTodayTokens.toLocaleString()} / ${u.quotas.llm.dailyTokenBudget.toLocaleString()}`,
        "TTS (Omni Voice)": `${u.quotas.services?.tts?.usedTodayMinutes || 0}/${u.quotas.services?.tts?.dailyMinutes || 0}m`,
        "t2Image (Qwen)": `${u.quotas.services?.t2image?.usedTodayImages || 0}/${u.quotas.services?.t2image?.dailyImages || 0}`,
        "Img2Img (Edit)": `${u.quotas.services?.img2img?.usedTodayEdits || 0}/${u.quotas.services?.img2img?.dailyEdits || 0}`,
        "App Video": "UNSUPPORTED",
      })),
    );
    break;
  }

  case "reset": {
    const userId = args[1];
    if (!userId) {
      console.error("Error: userId is required");
      process.exit(1);
    }
    const ok = ledger.resetUserUsage(userId);
    if (ok) {
      console.log(
        `✅ User '${userId}' daily usage reset to 0 across all services (LLM, Clef, GPU, TTS, t2Image, Img2Img)!`,
      );
      const u = ledger.getUser(userId);
      console.log(`  Last Reset Date: ${u.lastResetDate}`);
      console.log(`  LLM Used Today:  ${u.quotas.llm.usedTodayTokens}`);
    } else {
      console.error(`❌ User '${userId}' not found.`);
    }
    break;
  }

  case "revoke": {
    const userId = args[1];
    if (!userId) {
      console.error("Error: userId is required");
      process.exit(1);
    }
    const ok = ledger.revokeUser(userId);
    if (ok) {
      console.log(`✅ User '${userId}' passkey has been REVOKED.`);
    } else {
      console.error(`❌ User '${userId}' not found.`);
    }
    break;
  }

  case "verify": {
    const key = args[1];
    if (!key) {
      console.error("Error: passkey is required");
      process.exit(1);
    }
    const result = ledger.verifyKey(key);
    if (result.valid) {
      console.log("✅ Key is VALID!");
      console.log(JSON.stringify(result.user, null, 2));
    } else {
      console.log(`❌ Key is INVALID: ${result.error}`);
    }
    break;
  }

  default:
    printHelp();
    break;
}
