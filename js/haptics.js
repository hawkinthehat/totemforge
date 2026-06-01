// Small PWA-friendly vibration helpers for the carving canvas.
(() => {
  "use strict";

  let interactionUnlocked = false;
  let lastPulseMs = 0;

  function canVibrate() {
    return interactionUnlocked && typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
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
  }

  function chiselStrikeHaptic(nowMs = performance.now()) {
    if (nowMs - lastPulseMs < 42) return;
    lastPulseMs = nowMs;
    vibrate(18);
  }

  function sectionRevealHaptic() {
    vibrate([12, 32, 18]);
  }

  window.formlineHaptics = Object.freeze({
    unlock: unlockHaptics,
    vibrate,
    strike: chiselStrikeHaptic,
    sectionReveal: sectionRevealHaptic,
  });
})();
