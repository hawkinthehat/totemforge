// Vibration patterns (Vibration API). Mobile / PWA-friendly; no-ops on unsupported desktops.
// Snag shatter + fragment land pair with Master Log paint cues in physics.js / engine.js.

const HAPTIC = Object.freeze({
  FRAGMENT_LAND_MS: 5,
  FRAGMENT_LAND_MIN_GAP_MS: 48,
  /** Contralateral / wrong-side error — double pulse (vibrate, gap, vibrate). */
  WRONG_SIDE: Object.freeze([40, 60, 40]),
  /** End of inhale — log at max expansion (micro tick). */
  INHALE_PEAK_MS: 6,
  /** Breath pacer: soft thrum at inhale phase boundary (eyes can stay on sweep). */
  PACER_INHALE_THRUM: Object.freeze([26, 80, 26]),
  /** Breath pacer: softer settling thrum at exhale boundary. */
  PACER_EXHALE_THRUM: Object.freeze([20, 100, 20]),
});

let _lastFragmentLandMs = 0;

/**
 * Central gate: avoids throwing on browsers without vibrate.
 * Short durations (5 ms) read as subtle ticks on motors that support crisp pulses.
 */
function totemSuiteHapticsEnabled() {
  return typeof window !== "undefined" && window.totemSuiteInteractive === true;
}

/**
 * @param {number|number[]} pattern
 * @param {{ force?: boolean }} [opts] — `force` bypasses suite gate (internal / boot only).
 */
function totemVibrate(pattern, opts) {
  if (!opts?.force && !totemSuiteHapticsEnabled()) return;
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch (_) {
    /* ignore */
  }
}

/** Map snag silhouette size → shatter pulse length (“heavy cedar” = longer through max 25 ms). */
function snagShatterPulseMs(size) {
  const s = typeof size === "number" ? size : 18;
  const lo = 18;
  const hi = Math.max(44, Math.min(96, (typeof window !== "undefined" ? window.innerWidth : 800) * 0.028));
  const t = Math.max(0, Math.min(1, (s - lo) / Math.max(1e-6, hi - lo)));
  return Math.round(15 + t * 10);
}

/**
 * Successful snag clear — base 15 ms; scales toward 25 ms for larger snags.
 * Per request: successful click uses navigator.vibrate(15) at minimum.
 */
function hapticSuccessfulClick(snag) {
  const ms = snag && typeof snag.size === "number" ? snagShatterPulseMs(snag.size) : 15;
  totemVibrate(ms);
}

/** Harvest / magnet lock: very subtle seat tick (5 ms). */
function hapticFragmentLand(nowMs = performance.now()) {
  if (nowMs - _lastFragmentLandMs < HAPTIC.FRAGMENT_LAND_MIN_GAP_MS) return;
  _lastFragmentLandMs = nowMs;
  totemVibrate(HAPTIC.FRAGMENT_LAND_MS);
}

function hapticBreathPacerInhale() {
  totemVibrate(HAPTIC.PACER_INHALE_THRUM);
}

function hapticBreathPacerExhale() {
  totemVibrate(HAPTIC.PACER_EXHALE_THRUM);
}

/** Master Log at peak inhale expansion (inhale → exhale boundary). */
function hapticBreathInhalePeak() {
  totemVibrate(HAPTIC.INHALE_PEAK_MS);
}

/** Wrong-side / contralateral miss — navigator.vibrate([50, 30, 50]). */
function hapticWrongSideClick() {
  totemVibrate(HAPTIC.WRONG_SIDE);
}
