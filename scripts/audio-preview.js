import { t, validatePath } from "./utils.js";

/** One HTMLAudioElement per client, shared by every archive window. Never broadcasts. */
export class AudioPreview {
  constructor() { this.audio = null; this.path = null; this.owner = null; this.sequence = 0; this.listeners = new Set(); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { for (const listener of this.listeners) listener(); }
  stop(owner) {
    if (owner && owner !== this.owner) return;
    this.sequence++;
    if (this.audio) {
      this.audio.onerror = this.audio.onended = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.audio = this.path = this.owner = null;
    this.notify();
  }
  async toggle(path, owner) {
    validatePath(path, true);
    if (path === this.path && owner === this.owner) { this.stop(); return; }
    this.stop();
    const sequence = this.sequence;
    const audio = new Audio(path);
    audio.preload = "none";
    audio.volume = 0.8;
    this.audio = audio;
    this.path = path;
    this.owner = owner;
    audio.onended = () => { if (this.audio === audio) this.stop(); };
    const fail = error => {
      if (this.sequence !== sequence) return;
      this.stop();
      console.error("dominion-sound-archive | Audio preview", path, error);
      ui.notifications.error(`${t("PlaybackFailed")} ${path}`);
    };
    audio.onerror = () => fail(audio.error);
    this.notify();
    try { await audio.play(); } catch (error) { fail(error); }
  }
}

export const preview = new AudioPreview();
