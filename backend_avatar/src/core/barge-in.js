// @ts-check

export class BargeInController {
  /** @param {{ threshold: number, confirmMs: number }} options */
  constructor(options) {
    this.threshold = options.threshold;
    this.confirmMs = options.confirmMs;
    this.candidateSince = null;
  }

  /** Return true once speech is confirmed while the assistant is talking. @param {number} probability @param {boolean} assistantSpeaking @param {number} nowMs */
  update(probability, assistantSpeaking, nowMs = Date.now()) {
    if (!assistantSpeaking || probability < this.threshold) {
      this.candidateSince = null;
      return false;
    }
    this.candidateSince ??= nowMs;
    if (nowMs - this.candidateSince < this.confirmMs) return false;
    this.candidateSince = null;
    return true;
  }

  reset() {
    this.candidateSince = null;
  }
}