/**
 * Stealth Anti-Bot & Fingerprint Sanitization Engine for Zencode Browser Webviews.
 *
 * Prevents detection by Cloudflare Turnstile, DataDome, Akamai, PerimeterX,
 * and reCAPTCHA by cloaking:
 * 1. navigator.webdriver (completely removed / undefined)
 * 2. User-Agent & Client Hints (strips Electron/* and zencode/* tokens)
 * 3. window.chrome object (emulates authentic Chrome runtime, csi, loadTimes, app)
 * 4. navigator.plugins & navigator.languages (realistic Chrome plugins and language arrays)
 * 5. navigator.permissions.query (consistent with standard desktop Chrome)
 * 6. CDP automation artifacts (cleans cdc_* and driver variables)
 */

export function getCleanChromeUserAgent(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  if (platform === "win32") {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

export function sanitizeUserAgentString(
  ua: string,
  platform: NodeJS.Platform = process.platform,
): string {
  // Strip Electron, Zencode, Paseo tokens
  let cleaned = ua
    .replace(/Electron\/[0-9.]+\s?/g, "")
    .replace(/zencode\/[0-9.]+(-[a-zA-Z0-9.]+)?\s?/gi, "")
    .replace(/paseo\/[0-9.]+(-[a-zA-Z0-9.]+)?\s?/gi, "")
    .trim();

  if (!cleaned.includes("Chrome/")) {
    return getCleanChromeUserAgent(platform);
  }
  return cleaned;
}

export const STEALTH_ANTIBOT_SCRIPT = `
(function() {
  if (window.__zencode_stealth_injected) return;
  window.__zencode_stealth_injected = true;

  // 1. Cloak navigator.webdriver
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true
    });
    if (Navigator.prototype && 'webdriver' in Navigator.prototype) {
      delete Navigator.prototype.webdriver;
    }
  } catch (e) {}

  // 2. Emulate realistic window.chrome
  try {
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function() {},
        sendMessage: function() {},
        id: undefined
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          startE: Date.now(),
          onloadT: Date.now() + 120,
          pageT: 120,
          tran: 15
        };
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          requestTime: Date.now() / 1000,
          startLoadTime: Date.now() / 1000,
          commitLoadTime: Date.now() / 1000 + 0.1,
          finishDocumentLoadTime: Date.now() / 1000 + 0.2,
          firstPaintTime: Date.now() / 1000 + 0.15,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2'
        };
      };
    }
  } catch (e) {}

  // 3. Cloak navigator.plugins and mimeTypes
  try {
    const pluginData = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = Object.create(PluginArray.prototype);
        pluginData.forEach((p, i) => {
          const plugin = Object.create(Plugin.prototype);
          Object.assign(plugin, p);
          plugins[i] = plugin;
          plugins[p.name] = plugin;
        });
        Object.defineProperty(plugins, 'length', { value: pluginData.length });
        return plugins;
      },
      configurable: true
    });
  } catch (e) {}

  // 4. Cloak navigator.languages
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true
    });
  } catch (e) {}

  // 5. Emulate permissions.query for notifications
  try {
    const originalQuery = navigator.permissions && navigator.permissions.query;
    if (originalQuery) {
      navigator.permissions.query = function(parameters) {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({
            state: typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'denied' : 'prompt',
            onchange: null
          });
        }
        return originalQuery.apply(this, arguments);
      };
    }
  } catch (e) {}

  // 6. Scrub automation CDP artifacts
  try {
    for (const key of Object.keys(window)) {
      if (key.startsWith('cdc_') || key.includes('selenium') || key.includes('webdriver')) {
        delete window[key];
      }
    }
  } catch (e) {}
})();
`;

interface SessionWithWebRequest {
  setUserAgent(userAgent: string): void;
  webRequest: {
    onBeforeSendHeaders(
      filter: { urls: string[] },
      listener: (
        details: { requestHeaders: Record<string, string> },
        callback: (response: { requestHeaders: Record<string, string> }) => void,
      ) => void,
    ): void;
  };
}

export function installStealthSessionGuards(session: SessionWithWebRequest): void {
  const cleanUa = getCleanChromeUserAgent();
  session.setUserAgent(cleanUa);

  session.webRequest.onBeforeSendHeaders(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };

      // Sanitize User-Agent header
      if (headers["User-Agent"]) {
        headers["User-Agent"] = sanitizeUserAgentString(headers["User-Agent"]);
      }
      if (headers["user-agent"]) {
        headers["user-agent"] = sanitizeUserAgentString(headers["user-agent"]);
      }

      // Ensure Sec-Ch-Ua does not expose Electron
      if (headers["Sec-Ch-Ua"] && headers["Sec-Ch-Ua"].includes("Electron")) {
        headers["Sec-Ch-Ua"] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
      }
      if (headers["sec-ch-ua"] && headers["sec-ch-ua"].includes("Electron")) {
        headers["sec-ch-ua"] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
      }

      callback({ requestHeaders: headers });
    },
  );
}
