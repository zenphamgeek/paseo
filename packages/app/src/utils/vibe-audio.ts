/**
 * Vibe Coding Harmonic Audio Synthesizer
 *
 * Generates pristine, zero-dependency harmonic notification sound effects directly
 * via the Web Audio API without requiring any external audio files or network fetches.
 *
 * Sound Profiles:
 * - task_complete: Pentatonic ascending chime (C5 -> E5 -> G5 -> C6)
 * - attention_needed: Pleasant two-tone marimba chime (F5 -> A5)
 * - error_alert: Gentle minor descent (E4 -> C4)
 * - vibe_start: Subtle tactile micro-blip (988Hz)
 */

export type VibeSoundEffect = "task_complete" | "attention_needed" | "error_alert" | "vibe_start";

interface NoteDescriptor {
  freq: number;
  offset: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

const SOUND_PROFILES: Record<VibeSoundEffect, NoteDescriptor[]> = {
  // C5 (523.25Hz), E5 (659.25Hz), G5 (783.99Hz), C6 (1046.50Hz)
  task_complete: [
    { freq: 523.25, offset: 0.0, duration: 0.22, type: "sine", gain: 0.35 },
    { freq: 659.25, offset: 0.08, duration: 0.24, type: "sine", gain: 0.38 },
    { freq: 783.99, offset: 0.16, duration: 0.28, type: "sine", gain: 0.42 },
    { freq: 1046.5, offset: 0.24, duration: 0.45, type: "triangle", gain: 0.45 },
  ],
  // F5 (698.46Hz), A5 (880.00Hz)
  attention_needed: [
    { freq: 698.46, offset: 0.0, duration: 0.18, type: "sine", gain: 0.4 },
    { freq: 880.0, offset: 0.12, duration: 0.36, type: "triangle", gain: 0.45 },
  ],
  // E4 (329.63Hz), C4 (261.63Hz)
  error_alert: [
    { freq: 329.63, offset: 0.0, duration: 0.22, type: "sine", gain: 0.35 },
    { freq: 261.63, offset: 0.1, duration: 0.32, type: "sine", gain: 0.38 },
  ],
  // B5 (987.77Hz)
  vibe_start: [{ freq: 987.77, offset: 0.0, duration: 0.06, type: "sine", gain: 0.25 }],
};

class VibeAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;
  private volume: number = 0.5;
  private lastTriggerTime: Map<VibeSoundEffect, number> = new Map();

  private getContext(): AudioContext | null {
    const win =
      typeof window !== "undefined"
        ? window
        : (globalThis as unknown as { window?: typeof window }).window;
    if (!win) {
      return null;
    }
    if (!this.ctx) {
      const AudioCtx =
        win.AudioContext ||
        (win as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
        } catch {
          this.ctx = null;
        }
      }
    }
    return this.ctx;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  public resetDebounce(): void {
    this.lastTriggerTime.clear();
  }

  public resetContext(): void {
    this.ctx = null;
    this.lastTriggerTime.clear();
  }

  public play(effect: VibeSoundEffect): void {
    if (!this.enabled) {
      return;
    }

    // Debounce identical sound triggers within 300ms
    const now = Date.now();
    const last = this.lastTriggerTime.get(effect) ?? 0;
    if (now - last < 300) {
      return;
    }
    this.lastTriggerTime.set(effect, now);

    const ctx = this.getContext();
    if (!ctx) {
      return;
    }

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        // AudioContext resume can fail if user hasn't interacted with page yet
      });
    }

    const notes = SOUND_PROFILES[effect];
    if (!notes || notes.length === 0) {
      return;
    }

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume, ctx.currentTime);
    masterGain.connect(ctx.destination);

    const startTime = ctx.currentTime;

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();

      osc.type = note.type ?? "sine";
      osc.frequency.setValueAtTime(note.freq, startTime + note.offset);

      const noteStart = startTime + note.offset;
      const noteDuration = note.duration;
      const peakGain = note.gain ?? 0.3;

      // ADSR envelope: quick 8ms ramp up to prevent click, then exponential decay
      noteGain.gain.setValueAtTime(0.0001, noteStart);
      noteGain.gain.exponentialRampToValueAtTime(peakGain, noteStart + 0.008);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + noteDuration);

      osc.connect(noteGain);
      noteGain.connect(masterGain);

      try {
        osc.start(noteStart);
        osc.stop(noteStart + noteDuration + 0.02);
      } catch {
        // Guard against any timestamp scheduling race
      }
    }
  }
}

export const vibeAudio = new VibeAudioEngine();

export function playVibeSound(effect: VibeSoundEffect): void {
  vibeAudio.play(effect);
}

export function isVibeAudioEnabled(): boolean {
  return vibeAudio.isEnabled();
}

export function setVibeAudioEnabled(enabled: boolean): void {
  vibeAudio.setEnabled(enabled);
}
