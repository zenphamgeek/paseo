import { describe, expect, it, vi } from "vitest";
import {
  getCleanChromeUserAgent,
  sanitizeUserAgentString,
  STEALTH_ANTIBOT_SCRIPT,
  installStealthSessionGuards,
} from "./stealth-antibot.js";

describe("Stealth Anti-Bot Engine", () => {
  describe("getCleanChromeUserAgent", () => {
    it("returns clean Chrome UA for macOS without Electron or Zencode tokens", () => {
      const ua = getCleanChromeUserAgent("darwin");
      expect(ua).toContain("Macintosh; Intel Mac OS X 10_15_7");
      expect(ua).toContain("Chrome/131");
      expect(ua).not.toContain("Electron");
      expect(ua).not.toContain("zencode");
      expect(ua).not.toContain("paseo");
    });

    it("returns clean Chrome UA for Windows without Electron or Zencode tokens", () => {
      const ua = getCleanChromeUserAgent("win32");
      expect(ua).toContain("Windows NT 10.0; Win64; x64");
      expect(ua).toContain("Chrome/131");
      expect(ua).not.toContain("Electron");
      expect(ua).not.toContain("zencode");
      expect(ua).not.toContain("paseo");
    });

    it("returns clean Chrome UA for Linux without Electron or Zencode tokens", () => {
      const ua = getCleanChromeUserAgent("linux");
      expect(ua).toContain("X11; Linux x86_64");
      expect(ua).toContain("Chrome/131");
      expect(ua).not.toContain("Electron");
      expect(ua).not.toContain("zencode");
      expect(ua).not.toContain("paseo");
    });
  });

  describe("sanitizeUserAgentString", () => {
    it("strips Electron, zencode, and paseo tokens from user agent", () => {
      const dirtyUa =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) zencode/0.11.0 Electron/33.2.1 Chrome/130.0.6723.137 Safari/537.36 paseo/0.11.0";
      const cleaned = sanitizeUserAgentString(dirtyUa, "linux");
      expect(cleaned).not.toContain("Electron");
      expect(cleaned).not.toContain("zencode");
      expect(cleaned).not.toContain("paseo");
      expect(cleaned).toContain("Chrome/130.0.6723.137");
    });

    it("falls back to clean Chrome user agent if Chrome token is absent", () => {
      const cleaned = sanitizeUserAgentString("CustomBot/1.0", "linux");
      expect(cleaned).toBe(getCleanChromeUserAgent("linux"));
    });
  });

  describe("STEALTH_ANTIBOT_SCRIPT", () => {
    it("defines cloaks for webdriver, window.chrome, plugins, and CDP markers", () => {
      expect(STEALTH_ANTIBOT_SCRIPT).toContain("navigator");
      expect(STEALTH_ANTIBOT_SCRIPT).toContain("webdriver");
      expect(STEALTH_ANTIBOT_SCRIPT).toContain("chrome.runtime");
      expect(STEALTH_ANTIBOT_SCRIPT).toContain("chrome.csi");
      expect(STEALTH_ANTIBOT_SCRIPT).toContain("chrome.loadTimes");
      expect(STEALTH_ANTIBOT_SCRIPT).toContain("plugins");
      expect(STEALTH_ANTIBOT_SCRIPT).toContain("languages");
      expect(STEALTH_ANTIBOT_SCRIPT).toContain("cdc_");
    });
  });

  describe("installStealthSessionGuards", () => {
    it("registers beforeSendHeaders listener to sanitize User-Agent and Sec-Ch-Ua", () => {
      let registeredListener: ((details: any, callback: any) => void) | null = null;
      let configuredUa: string | null = null;

      const mockSession = {
        setUserAgent: (ua: string) => {
          configuredUa = ua;
        },
        webRequest: {
          onBeforeSendHeaders: (_filter: any, listener: any) => {
            registeredListener = listener;
          },
        },
      };

      installStealthSessionGuards(mockSession as any);

      expect(configuredUa).toBeTruthy();
      expect(configuredUa).not.toContain("Electron");
      expect(registeredListener).toBeTypeOf("function");

      // Test header modification
      let resultHeaders: any = null;
      registeredListener!(
        {
          requestHeaders: {
            "User-Agent": "Mozilla/5.0 Electron/33.0 Chrome/130.0 Safari/537.36",
            "Sec-Ch-Ua": '"Chromium";v="130", "Electron";v="33"',
          },
        },
        (res: any) => {
          resultHeaders = res.requestHeaders;
        },
      );

      expect(resultHeaders["User-Agent"]).not.toContain("Electron");
      expect(resultHeaders["Sec-Ch-Ua"]).not.toContain("Electron");
      expect(resultHeaders["Sec-Ch-Ua"]).toContain('"Google Chrome";v="131"');
    });
  });
});
