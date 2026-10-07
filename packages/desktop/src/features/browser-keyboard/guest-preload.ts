import { ipcRenderer } from "electron";
import type { BrowserKeyboardPolicy, BrowserShortcutPrefix } from "./policy.js";

// --- Anti-Bot Stealth Cloak ---
try {
  // 1. Cloak navigator.webdriver
  Object.defineProperty(navigator, "webdriver", {
    get: () => undefined,
    configurable: true,
  });
  if (Navigator.prototype && "webdriver" in Navigator.prototype) {
    delete (Navigator.prototype as { webdriver?: boolean }).webdriver;
  }

  // 2. Emulate realistic window.chrome
  const win = window as unknown as { chrome?: Record<string, unknown> };
  if (!win.chrome) {
    win.chrome = {};
  }
  if (!win.chrome.runtime) {
    win.chrome.runtime = {
      connect: () => {},
      sendMessage: () => {},
      id: undefined,
    };
  }
  if (!win.chrome.csi) {
    win.chrome.csi = () => ({
      startE: Date.now(),
      onloadT: Date.now() + 120,
      pageT: 120,
      tran: 15,
    });
  }
  if (!win.chrome.loadTimes) {
    win.chrome.loadTimes = () => ({
      requestTime: Date.now() / 1000,
      startLoadTime: Date.now() / 1000,
      commitLoadTime: Date.now() / 1000 + 0.1,
      finishDocumentLoadTime: Date.now() / 1000 + 0.2,
      firstPaintTime: Date.now() / 1000 + 0.15,
      firstPaintAfterLoadTime: 0,
      navigationType: "Other",
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: "h2",
      wasAlternateProtocolAvailable: false,
      connectionInfo: "h2",
    });
  }

  // 3. Cloak navigator.languages
  Object.defineProperty(navigator, "languages", {
    get: () => ["en-US", "en"],
    configurable: true,
  });

  // 4. Scrub automation variables
  for (const key of Object.keys(window)) {
    if (key.startsWith("cdc_") || key.includes("selenium") || key.includes("webdriver")) {
      delete (window as unknown as Record<string, unknown>)[key];
    }
  }
} catch {
  // Silent fallback
}

const POLICY_CHANNEL = "paseo:browser-keyboard-policy";
const POLICY_REQUEST_CHANNEL = "paseo:browser-keyboard-policy-request";
const SHORTCUT_INPUT_CHANNEL = "paseo:browser-shortcut-input";

let browserId: string | null = null;
let policy: BrowserShortcutPrefix[] = [];

interface BrowserKeyboardPolicyPayload extends BrowserKeyboardPolicy {
  browserId: string;
}

function matchesPolicy(event: KeyboardEvent): boolean {
  const editable = isEditableTarget(event.target);
  return policy.some((prefix) => {
    if (
      prefix.alt !== event.altKey ||
      prefix.control !== event.ctrlKey ||
      prefix.meta !== event.metaKey ||
      prefix.shift !== event.shiftKey ||
      (prefix.editable === false && editable) ||
      (prefix.repeat === false && event.repeat)
    ) {
      return false;
    }
    if (prefix.key === undefined) {
      return matchesCode(prefix.code, event.code);
    }
    const eventKey = event.key.toLowerCase();
    if (eventKey === prefix.key) {
      return true;
    }
    if (prefix.shift && prefix.shiftedKey !== undefined && eventKey === prefix.shiftedKey) {
      return true;
    }
    return (prefix.alt || prefix.codeFallback === true) && matchesCode(prefix.code, event.code);
  });
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const element = target as HTMLElement;
  if (element.isContentEditable) {
    return true;
  }
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function matchesCode(prefixCode: string, eventCode: string): boolean {
  if (prefixCode !== "Digit") {
    return prefixCode === eventCode;
  }
  return /^(?:Digit|Numpad)[1-9]$/.test(eventCode);
}

function stageShortcutForward(event: KeyboardEvent): void {
  if (!event.isTrusted || event.defaultPrevented || !browserId || !matchesPolicy(event)) {
    return;
  }

  const shortcutBrowserId = browserId;
  window.addEventListener(
    "keydown",
    (completedEvent) => {
      if (completedEvent !== event || completedEvent.defaultPrevented) {
        return;
      }
      completedEvent.preventDefault();
      ipcRenderer.send(SHORTCUT_INPUT_CHANNEL, {
        alt: completedEvent.altKey,
        browserId: shortcutBrowserId,
        code: completedEvent.code,
        control: completedEvent.ctrlKey,
        key: completedEvent.key,
        meta: completedEvent.metaKey,
        repeat: completedEvent.repeat,
        shift: completedEvent.shiftKey,
      });
    },
    { once: true },
  );
}

window.addEventListener("keydown", stageShortcutForward, { capture: true });

ipcRenderer.on(POLICY_CHANNEL, (_event, value: BrowserKeyboardPolicyPayload) => {
  if (!value || typeof value.browserId !== "string" || !Array.isArray(value.prefixes)) {
    return;
  }
  browserId = value.browserId;
  policy = value.prefixes;
});

ipcRenderer.send(POLICY_REQUEST_CHANNEL);
