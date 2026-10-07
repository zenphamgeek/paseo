import { describe, expect, it, vi, beforeEach } from "vitest";
import { vibeAudio, playVibeSound, isVibeAudioEnabled, setVibeAudioEnabled } from "./vibe-audio";

describe("Vibe Audio Harmonic Synthesizer", () => {
  beforeEach(() => {
    setVibeAudioEnabled(true);
    vibeAudio.setVolume(0.5);
    vibeAudio.resetContext();
  });

  it("initializes with enabled state and correct volume", () => {
    expect(isVibeAudioEnabled()).toBe(true);
    expect(vibeAudio.getVolume()).toBe(0.5);
  });

  it("can toggle audio state on and off", () => {
    setVibeAudioEnabled(false);
    expect(isVibeAudioEnabled()).toBe(false);

    setVibeAudioEnabled(true);
    expect(isVibeAudioEnabled()).toBe(true);
  });

  it("clamps volume between 0 and 1", () => {
    vibeAudio.setVolume(1.5);
    expect(vibeAudio.getVolume()).toBe(1.0);

    vibeAudio.setVolume(-0.5);
    expect(vibeAudio.getVolume()).toBe(0.0);
  });

  it("safely handles play in headless environment without crashing", () => {
    expect(() => {
      playVibeSound("task_complete");
      playVibeSound("attention_needed");
      playVibeSound("error_alert");
      playVibeSound("vibe_start");
    }).not.toThrow();
  });

  it("synthesizes oscillators when AudioContext is provided", () => {
    const mockOscillator = {
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    const mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };

    const createdAudioContexts: any[] = [];
    class MockAudioContextClass {
      state = "running";
      currentTime = 10;
      destination = {};
      createOscillator = vi.fn(() => ({ ...mockOscillator }));
      createGain = vi.fn(() => ({ ...mockGain }));
      resume = vi.fn().mockResolvedValue(undefined);
      constructor() {
        createdAudioContexts.push(this);
      }
    }

    // Attach mock to global window
    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      AudioContext: MockAudioContextClass,
    };

    try {
      playVibeSound("task_complete");
      expect(createdAudioContexts.length).toBeGreaterThan(0);
      expect(createdAudioContexts[0].createGain).toHaveBeenCalled();
      expect(createdAudioContexts[0].createOscillator).toHaveBeenCalled();
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});
