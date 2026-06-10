// Small PWA-friendly vibration helpers for the carving canvas.
(() => {
  "use strict";

  let interactionUnlocked = false;
  let lastPulseMs = 0;
  let audioCtx = null;

  function canVibrate() {
    return interactionUnlocked && typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  function ensureAudioContext() {
    if (typeof window === "undefined") return null;
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try {
        audioCtx = new Ctor();
      } catch (_) {
        audioCtx = null;
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      try {
        audioCtx.resume();
      } catch (_) {
        // Resume can fail outside a user gesture; the next strike will try again.
      }
    }
    return audioCtx;
  }

  function vibrate(pattern, opts = {}) {
    if (!opts.force && !canVibrate()) return;
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate(pattern);
    } catch (_) {
      // Unsupported browsers simply ignore tactile feedback.
    }
  }

  function unlockHaptics() {
    interactionUnlocked = true;
    ensureAudioContext();
  }

  function chiselStrikeHaptic(nowMs = performance.now()) {
    if (nowMs - lastPulseMs < 42) return;
    lastPulseMs = nowMs;
    vibrate(18);
  }

  function chiselDrumPulse() {
    if (!interactionUnlocked) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = "sine";
    osc.frequency.setValueAtTime(92, t0);
    osc.frequency.exponentialRampToValueAtTime(46, t0 + 0.18);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(180, t0);
    filter.frequency.exponentialRampToValueAtTime(72, t0 + 0.18);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.24);
  }

  function sectionRevealHaptic() {
    vibrate([12, 32, 18]);
  }

  window.formlineHaptics = Object.freeze({
    unlock: unlockHaptics,
    vibrate,
    strike: chiselStrikeHaptic,
    drum: chiselDrumPulse,
    sectionReveal: sectionRevealHaptic,
  });
})();
