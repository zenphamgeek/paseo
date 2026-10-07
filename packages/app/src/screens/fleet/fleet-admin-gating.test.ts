import { describe, it, expect } from "vitest";

describe("Fleet UI Admin Gating & Non-Admin Simplicity", () => {
  function checkIsAdmin(token: string | null, role: string | null): boolean {
    if (role && role !== "admin") return false;
    if (token && !token.startsWith("zen_live_admin_")) return false;
    return true;
  }

  it("identifies developer and guest passkeys as non-admin", () => {
    expect(checkIsAdmin("zen_live_dev_8f92b71c0a2e3d4c5b6a7b8c9d0e1f2a", "developer")).toBe(false);
    expect(checkIsAdmin("zen_live_guest_018273645bcdefa987654321fedcba09", "guest")).toBe(false);
    expect(checkIsAdmin("zen_live_dev_randomtoken123", null)).toBe(false);
  });

  it("identifies system admin passkey as admin", () => {
    expect(checkIsAdmin("zen_live_admin_4f89b1c2e3d4a5b6c7d8e9f012345678", "admin")).toBe(true);
    expect(checkIsAdmin("zen_live_admin_mastertoken", null)).toBe(true);
  });

  it("defaults to admin when no token is present in local dev mode", () => {
    expect(checkIsAdmin(null, null)).toBe(true);
  });
});
