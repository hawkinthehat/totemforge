// Engine: canvas init, input, and animation loop.

let _lastNow = performance.now();
let _lastBreath = { phase: "EXHALE", breath01: 0, scaleMultiplier: 1 };
let _prevBreathPhase = "EXHALE";
let _breathHapticPrimed = false;
let _levelCooldown = 0;
/** Prevents double Potlatch when forge tier hits 100%. */
let _forgeTierCompleteGate = false;
/** Practice sandbox: one-shot reset when tier hits 100% (no Potlatch). */
let _practiceTierResetGate = false;
/** EMDR grid sequencing lives in physics.js (cedarConsumeEmrdGridCell). */
let lastZone = -1;

const FORGE_BILATERAL_WINDOW_MS = 100;
let _forgeBilateralAwait = Object.create(null);

function clearForgeBilateralAwait() {
  _forgeBilateralAwait = Object.create(null);
}

function tickForgeBilateralAwaitState(nowMs) {
  for (const id of Object.keys(_forgeBilateralAwait)) {
    const st = _forgeBilateralAwait[id];
    if (!st || (st.slots && st.slots.size >= 2)) continue;
    if (st.tFirst != null && nowMs - st.tFirst > FORGE_BILATERAL_WINDOW_MS) {
      delete _forgeBilateralAwait[id];
      if (typeof bumpContralateralWrongPulse === "function") bumpContralateralWrongPulse(nowMs);
      if (typeof registerForgeSnagMiss === "function") registerForgeSnagMiss(nowMs);
      if (typeof resetCedarFlowAfterMiss === "function") resetCedarFlowAfterMiss(nowMs);
    }
  }
}

/** Wall-clock Vagus breath (12s cycle) — used when Forge mesh is not stepping `generateTotem` (gallery / potlatch). */
function computeBreathEnvelopeFromTime(nowMs = performance.now()) {
  const cycleMs =
    typeof FLOW_VAGUS_CYCLE_MS === "number" ? FLOW_VAGUS_CYCLE_MS : 12000;
  const inhaleMs =
    typeof FLOW_VAGUS_INHALE_MS === "number" ? FLOW_VAGUS_INHALE_MS : 4000;
  const t = ((nowMs % cycleMs) + cycleMs) % cycleMs;
  let phase = "EXHALE";
  let breath01 = 0;
  if (t < inhaleMs) {
    phase = "INHALE";
    breath01 = t / inhaleMs;
  } else {
    phase = "EXHALE";
    breath01 = 1 - (t - inhaleMs) / (cycleMs - inhaleMs);
  }
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
  const scaleMultiplier = 0.88 + 0.22 * ease(breath01);
  return { phase, breath01, scaleMultiplier };
}

/** Salish-centered onboarding: snag-sequence tips + ST’ÉXEM reveal (localStorage). */
const SALISH_ONBOARDING_LS_KEY = "totemforge_salish_onboarding_complete";
const LEGACY_ONBOARDING_LS_KEY = "totemforge_onboarding_instructions_done";
const STEXEM_REVEAL_LS_KEY = "totemforge_stexem_reveal_shown";
const MENTOR_WELCOME_LS_KEY = "totemforge_mentor_welcome_dismissed";

let _stexemRevealGateDone = false;

function isMentorWelcomeDismissed() {
  try {
    return localStorage.getItem(MENTOR_WELCOME_LS_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function persistMentorWelcomeDismissed() {
  try {
    localStorage.setItem(MENTOR_WELCOME_LS_KEY, "1");
  } catch (_) {}
}

function isSalishOnboardingComplete() {
  try {
    if (localStorage.getItem(SALISH_ONBOARDING_LS_KEY) === "1") return true;
    if (localStorage.getItem(LEGACY_ONBOARDING_LS_KEY) === "1") return true;
    return false;
  } catch (_) {
    return false;
  }
}

function clearSalishTooltipRoot() {
  const root = document.getElementById("salish-tooltip-root");
  if (!root) return;
  root.classList.remove("salish-tip-visible");
  root.setAttribute("hidden", "");
  root.setAttribute("aria-hidden", "true");
  const inner = root.querySelector(".salish-tooltip-inner");
  if (inner) inner.innerHTML = "";
}

let _forgeConsecutiveMissCount = 0;

function resetForgeMissStreak() {
  _forgeConsecutiveMissCount = 0;
  clearSalishTooltipRoot();
}

function forgeMotorTierForHints() {
  if (
    typeof totemPracticeMode !== "undefined" &&
    totemPracticeMode &&
    typeof practiceMotorSkillTier === "number"
  ) {
    return practiceMotorSkillTier;
  }
  return typeof getForgeMotorTier === "function" ? getForgeMotorTier() : null;
}

function showForgeRhythmHintTooltip() {
  const root = document.getElementById("salish-tooltip-root");
  if (!root) return;
  const inner = root.querySelector(".salish-tooltip-inner");
  if (!inner) return;
  const tier = forgeMotorTierForHints();
  const ph =
    typeof SALISH_PHONETIC !== "undefined" && SALISH_PHONETIC?.STEXEM
      ? SALISH_PHONETIC.STEXEM
      : "stuh-AY-khuhm";
  let html = "";
  if (tier === 3) {
    html = `<p class="salish-tip-plain">Contralateral <strong>KW’ÉKW’E</strong> <span style="opacity:0.88;font-style:italic">(${typeof SALISH_PHONETIC !== "undefined" && SALISH_PHONETIC?.KW_EKWE ? SALISH_PHONETIC.KW_EKWE : "kwa-kwa"})</span>: <strong>Teal</strong> snags approach from the <strong>left</strong> — tap with your <strong>right</strong> hemifield. <strong>Red</strong> snags from the <strong>right</strong> — tap with your <strong>left</strong> hemifield. Dashed rings mark mirrored cross-taps.</p>`;
  } else if (tier === 2) {
    html = `<p class="salish-tip-plain">Bilateral <strong>KW’ÉTL’EN</strong> <span style="opacity:0.88;font-style:italic">(${typeof SALISH_PHONETIC !== "undefined" && SALISH_PHONETIC?.KW_ETLEN ? SALISH_PHONETIC.KW_ETLEN : "kw-et-lun"})</span>: two snags move together — tap <strong>both</strong> within a short window. Two simultaneous touches (one on each snag) work; otherwise tap each side in quick succession.</p>`;
  } else {
    html = `<p class="salish-tip-plain">Focus on the rhythm. For <strong>ST’ÉXEM</strong> <span style="opacity:0.9">(${ph})</span>, meet <strong>top</strong> snags from the <strong>left</strong> half of the screen and <strong>bottom</strong> snags from the <strong>right</strong> half.</p>`;
  }
  _forgeConsecutiveMissCount = 0;
  root.classList.remove("salish-tip-visible");
  inner.innerHTML = html;
  root.removeAttribute("hidden");
  root.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add("salish-tip-visible"));
  });
}

function registerForgeSnagMiss(nowMs = performance.now()) {
  if (typeof totemAppPhase !== "string" || totemAppPhase !== "forge") return;
  if (typeof window !== "undefined" && !window.totemSuiteInteractive) return;
  _forgeConsecutiveMissCount++;
  if (_forgeConsecutiveMissCount < 3) return;
  showForgeRhythmHintTooltip();
}

function showStexemRevealToast() {
  const el = document.getElementById("salish-reveal-toast");
  if (!el) return;
  el.textContent =
    typeof SALISH_PHONETIC !== "undefined" && SALISH_PHONETIC?.STEXEM
      ? `The ST’ÉXEM (${SALISH_PHONETIC.STEXEM}) is emerging from the wood.`
      : "The ST’ÉXEM is emerging from the wood.";
  el.removeAttribute("hidden");
  el.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => el.classList.add("salish-toast-visible"));
  window.setTimeout(() => {
    el.classList.remove("salish-toast-visible");
    window.setTimeout(() => {
      el.setAttribute("hidden", "");
      el.setAttribute("aria-hidden", "true");
    }, 450);
  }, 3800);
}

function showPotlatchCompletionDialogue() {
  if (typeof totemPracticeMode !== "undefined" && totemPracticeMode) return;
  const el = document.getElementById("potlatch-completion-dialogue");
  if (!el) return;
  el.hidden = false;
  el.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => el.classList.add("potlatch-completion-dialogue--visible"));
  window.setTimeout(() => {
    el.classList.remove("potlatch-completion-dialogue--visible");
    window.setTimeout(() => {
      el.setAttribute("hidden", "");
      el.setAttribute("aria-hidden", "true");
    }, 520);
  }, 10000);
}

function tickSalishStexemReveal() {
  if (typeof totemPracticeMode !== "undefined" && totemPracticeMode) return;
  if (_stexemRevealGateDone) return;
  if (
    typeof TOTEM_LONGHOUSE_FORGE !== "undefined" &&
    TOTEM_LONGHOUSE_FORGE &&
    typeof totemAppPhase === "string" &&
    totemAppPhase !== "forge"
  ) {
    return;
  }
  try {
    if (localStorage.getItem(STEXEM_REVEAL_LS_KEY) === "1") {
      _stexemRevealGateDone = true;
      return;
    }
  } catch (_) {
    _stexemRevealGateDone = true;
    return;
  }
  if (typeof totemLevel !== "number" || totemLevel !== 1) return;
  if (typeof totemTierFillRatio !== "function") return;
  if (totemTierFillRatio(1) < 0.5) return;
  _stexemRevealGateDone = true;
  try {
    localStorage.setItem(STEXEM_REVEAL_LS_KEY, "1");
  } catch (_) {}
  showStexemRevealToast();
}

function noteSalishOnboardingShatter() {
  // Progressive shatter-sequence tips removed; forge guidance uses three-miss rhythm hints instead.
}

function applySuiteStartPresentation() {
  const minimal = isMentorWelcomeDismissed() || isSalishOnboardingComplete();
  const card = document.querySelector(".suite-start-card");
  const sub = document.querySelector(".suite-start-sub");
  const tag = document.querySelector(".suite-start-tagline");
  const btn = document.getElementById("suite-start-btn");
  if (minimal) {
    card?.classList.add("suite-start-card--minimal");
    if (sub) sub.hidden = true;
    if (tag) tag.hidden = true;
    if (btn) btn.textContent = "Begin";
    clearSalishTooltipRoot();
  } else {
    card?.classList.remove("suite-start-card--minimal");
    if (sub) sub.hidden = false;
    if (tag) tag.hidden = false;
    if (btn) btn.textContent = "Begin the Forge";
  }
}

/** Impact ripples (logical canvas coords) */
let _ripples = [];

/** Brief camera shake after shattering a Cedar Snag (logical px). */
let _screenShakeUntilMs = 0;
let _screenShakeStartMs = 0;

function bumpScreenShake(nowMs = performance.now()) {
  _screenShakeUntilMs = nowMs + 170;
  _screenShakeStartMs = nowMs;
}

function screenShakeOffset(nowMs) {
  if (!_screenShakeUntilMs || nowMs >= _screenShakeUntilMs) return { x: 0, y: 0 };
  const dur = _screenShakeUntilMs - _screenShakeStartMs;
  const t = dur > 0 ? (nowMs - _screenShakeStartMs) / dur : 1;
  const decay = Math.max(0, 1 - t);
  const mag = 2.5 * decay;
  return {
    x: Math.sin(nowMs * 0.095) * mag,
    y: Math.cos(nowMs * 0.108) * mag * 0.82,
  };
}

/** Wrong-side click in contralateral modes — soft red veil (no shatter). */
let _contralateralWrongPulseUntilMs = 0;

function bumpContralateralWrongPulse(nowMs = performance.now()) {
  _contralateralWrongPulseUntilMs = nowMs + 380;
}

function drawContralateralWrongPulse(nowMs) {
  if (!_contralateralWrongPulseUntilMs || nowMs >= _contralateralWrongPulseUntilMs || !ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dur = 380;
  const u = Math.max(0, (_contralateralWrongPulseUntilMs - nowMs) / dur);
  const fade = u * u;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const g = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.52, Math.max(w, h) * 0.72);
  g.addColorStop(0, `rgba(185, 28, 28, ${0.22 * fade})`);
  g.addColorStop(1, `rgba(127, 29, 29, ${0.07 * fade})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function addImpactRipple(x, y, nowMs) {
  _ripples.push({ x, y, startMs: nowMs, durationMs: 520, maxR: 72 + Math.random() * 28 });
}

/** Smoothstep (ease): GSAP-like feel without external tween library. */
function smoothstep01(u) {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
}

function stepTotemGlobalCameraPan(nowMs) {
  const tw = totemGlobalCameraTween;
  if (!tw) return;
  const u = (nowMs - tw.startMs) / Math.max(1, tw.durationMs);
  const e = smoothstep01(u);
  globalCameraY = tw.fromY + tw.deltaY * e;
  if (u >= 1) {
    globalCameraY = tw.fromY + tw.deltaY;
    totemHarvestTierUnlocked = tw.targetUnlockLevel;
    totemGlobalCameraTween = null;
  }
}

/**
 * +400px vertical pan over 3s. By default harvest stays on the prior tier until the tween completes.
 * Ascension (Salmon→Orca) passes `{ unlockHarvestNow: true }` so Spiral/Orca fragments target immediately.
 */
function startTotemLevelIntroPan(nowMs, newTotemLevel, opts) {
  totemGlobalCameraTween = {
    startMs: nowMs,
    durationMs: 3000,
    fromY: globalCameraY,
    deltaY: 400,
    targetUnlockLevel: newTotemLevel,
  };
  if (opts?.unlockHarvestNow) {
    totemHarvestTierUnlocked = newTotemLevel;
  } else {
    totemHarvestTierUnlocked = Math.max(1, newTotemLevel - 1);
  }
}

if (typeof window !== "undefined") window.startTotemLevelIntroPan = startTotemLevelIntroPan;

function resizeCanvas() {
  if (!canvas) return;
  const dpr = Math.max(1, Math.min(2.25, window.devicePixelRatio || 1));
  const cssW = Math.max(1, window.innerWidth);
  const cssH = Math.max(1, window.innerHeight);
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (typeof invalidateTotemGeometry === "function") invalidateTotemGeometry();
}

function clearFrame() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  // Subtle vignette / depth
  const g = ctx.createRadialGradient(w * 0.5, h * 0.55, Math.min(w, h) * 0.05, w * 0.5, h * 0.55, Math.min(w, h) * 0.9);
  g.addColorStop(0, "rgba(0,0,0,0.00)");
  g.addColorStop(1, "rgba(0,0,0,0.40)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function updatePacerLabel(nowMs = performance.now()) {
  const label = document.getElementById("pacer-label");
  if (!label) return;

  if (
    typeof TOTEM_LONGHOUSE_FORGE !== "undefined" &&
    TOTEM_LONGHOUSE_FORGE &&
    typeof totemAppPhase === "string" &&
    totemAppPhase === "gallery"
  ) {
    label.textContent = "REFLECT";
    label.dataset.mode = currentMode;
    label.style.opacity = "0.62";
    label.style.transform = "translate(-50%, -50%) scale(0.96)";
    return;
  }

  if (
    typeof TOTEM_LONGHOUSE_FORGE !== "undefined" &&
    TOTEM_LONGHOUSE_FORGE &&
    typeof totemAppPhase === "string" &&
    (totemAppPhase === "forge" || totemAppPhase === "potlatch")
  ) {
    if (totemAppPhase === "potlatch") {
      label.textContent = "POTLATCH\n4s inhale · 8s exhale";
    } else if (currentMode === MODE_SALMON_RUN) {
      label.textContent = "↑ Left · Right ↓\n4s inhale · 8s exhale";
    } else {
      const p = _lastBreath.phase === "INHALE" ? "INHALE" : "EXHALE";
      label.textContent = `${p}\n4s inhale · 8s exhale`;
    }
    label.dataset.mode = currentMode;
    const s = _lastBreath.scaleMultiplier ?? 1;
    const pulse = 0.92 + (s - 0.88) * 1.35;
    label.style.transform = `translate(-50%, 0) scale(${pulse.toFixed(3)})`;
    label.style.opacity = `${Math.min(0.96, 0.58 + (_lastBreath.breath01 ?? 0) * 0.42)}`;
    return;
  }

  if (typeof _pacerStabilizedTextUntilMs === "number" && nowMs < _pacerStabilizedTextUntilMs && totemRunComplete) {
    label.textContent = "STABILIZED";
    label.dataset.mode = currentMode;
    const s = _lastBreath.scaleMultiplier ?? 1;
    const pulse = 0.92 + (s - 0.88) * 1.35;
    label.style.transform = `translate(-50%, -50%) scale(${pulse.toFixed(3)})`;
    label.style.opacity = `${Math.min(0.98, 0.68 + (_lastBreath.breath01 ?? 0) * 0.32)}`;
    return;
  }

  if (typeof _pacerGroundedTextUntilMs === "number" && nowMs < _pacerGroundedTextUntilMs) {
    label.textContent = "GROUNDED";
    label.dataset.mode = currentMode;
    const s = _lastBreath.scaleMultiplier ?? 1;
    const pulse = 0.92 + (s - 0.88) * 1.35;
    label.style.transform = `translate(-50%, -50%) scale(${pulse.toFixed(3)})`;
    label.style.opacity = `${Math.min(0.98, 0.62 + (_lastBreath.breath01 ?? 0) * 0.38)}`;
    return;
  }

  if (currentMode === MODE_SALMON_RUN) {
    label.textContent = "↑ Left · Right ↓";
  } else {
    label.textContent = _lastBreath.phase === "INHALE" ? "INHALE" : "EXHALE";
  }

  label.dataset.mode = currentMode;

  // Match pacer clarity to log / breath expansion (same envelope as generateTotem scaleMultiplierLive)
  const s = _lastBreath.scaleMultiplier ?? 1;
  const pulse = 0.92 + (s - 0.88) * 1.35;
  label.style.transform = `translate(-50%, -50%) scale(${pulse.toFixed(3)})`;
  label.style.opacity = `${Math.min(0.96, 0.55 + (_lastBreath.breath01 ?? 0) * 0.45)}`;
}

function playWoodSnapForMode(clientX, snag) {
  const tap =
    typeof playWoodTapStereo === "function"
      ? playWoodTapStereo
      : typeof playWoodSnap === "function"
        ? playWoodSnap
        : null;
  if (!tap) return;

  const w = window.innerWidth || 1;

  if (currentMode === MODE_SALMON_RUN) {
    let vent = snag?.verticalVent;
    if (vent === "TOP" || vent === "BOTTOM") {
      const pan = vent === "TOP" ? -1 : 1;
      tap(pan, { verticalVent: vent });
      return;
    }
  }

  const sx = typeof snag?.x === "number" ? snag.x : clientX;
  const pan = sx < w * 0.5 ? -1 : 1;
  if (tap === playWoodTapStereo) tap(pan, {});
  else playWoodSnap(undefined, sx < w * 0.5 ? 0 : 2, {});
}

/**
 * Map pointer to logical canvas/game coordinates (matches ctx user-space after DPR transform).
 * Uses bounding rect so clicks align when the canvas is scaled or offset.
 */
function canvasPointFromEvent(e) {
  if (!canvas) return { x: e.clientX, y: e.clientY };
  const rect = canvas.getBoundingClientRect();
  const rw = rect.width > 0 ? rect.width : 1;
  const rh = rect.height > 0 ? rect.height : 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = ((e.clientX - rect.left) / rw) * w;
  const y = ((e.clientY - rect.top) / rh) * h;
  return { x, y };
}

function burstFragmentsFromSnag(worldX, worldY, hue, snagTotemLevel) {
  const snagLv = typeof snagTotemLevel === "number" ? snagTotemLevel : totemLevel;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TWO_PI + (Math.random() - 0.5) * 0.35;
    const sp = 520 + Math.random() * 440;
    fragments.push(
      new Fragment({
        x: worldX,
        y: worldY,
        vx: Math.cos(a) * sp + (Math.random() - 0.5) * 90,
        vy: Math.sin(a) * sp + (Math.random() - 0.5) * 90,
        hue,
        snagTotemLevel: snagLv,
        burstMs: 210 + Math.random() * 120,
        maxLife: 2200 + Math.random() * 800,
        size: 1.2 + Math.random() * 2.4,
      })
    );
  }
}

function shatterTomahawkAtIndex(idx, canvasX, canvasY, opts) {
  if (!tomahawks?.length || idx < 0 || idx >= tomahawks.length) return;
  const snag = tomahawks[idx];
  const hue = snag.hue ?? modeHue(currentMode);
  const sx = snag.x;
  const sy = snag.y;
  tomahawks.splice(idx, 1);
  playWoodSnapForMode(canvasX, snag);
  if (!opts?.skipShatterHaptic && typeof cedarSnapShatterHaptic === "function") cedarSnapShatterHaptic();
  addImpactRipple(sx, sy, performance.now());
  if (typeof spawnLogChips === "function") spawnLogChips(sx, sy, performance.now());
  if (typeof spawnHarvestFragments === "function")
    spawnHarvestFragments(sx, sy, hue, snag.verticalVent, snag.snagTotemLevel);
  else burstFragmentsFromSnag(sx, sy, hue, snag.snagTotemLevel);
  if (!opts?.skipFlowRecord && typeof recordCedarFlowSuccessfulShatter === "function")
    recordCedarFlowSuccessfulShatter();
  if (typeof bumpTotemLogOutlineFlash === "function") bumpTotemLogOutlineFlash(performance.now(), modeColor(currentMode));
  bumpScreenShake(performance.now());
  noteSalishOnboardingShatter();
  if (!opts?.skipFlowRecord && typeof resetForgeMissStreak === "function") resetForgeMissStreak();
}

function tryForgeBilateralPairResponse(snag, canvasX, canvasY, nowMs) {
  const pid = snag.bilateralPairId;
  const slot = snag.bilateralSlot;
  if (!pid || (slot !== "L" && slot !== "R")) return false;
  if (
    typeof snagContralateralAllowsShatter === "function" &&
    !snagContralateralAllowsShatter(snag, canvasX, canvasY)
  ) {
    if (typeof bumpContralateralWrongPulse === "function") bumpContralateralWrongPulse(nowMs);
    if (typeof registerForgeSnagMiss === "function") registerForgeSnagMiss(nowMs);
    return true;
  }
  const st0 = _forgeBilateralAwait[pid];
  if (!st0) {
    _forgeBilateralAwait[pid] = { tFirst: nowMs, slots: new Set([slot]) };
    return true;
  }
  if (st0.slots.has(slot)) return true;
  if (nowMs - st0.tFirst > FORGE_BILATERAL_WINDOW_MS) {
    delete _forgeBilateralAwait[pid];
    if (typeof bumpContralateralWrongPulse === "function") bumpContralateralWrongPulse(nowMs);
    if (typeof registerForgeSnagMiss === "function") registerForgeSnagMiss(nowMs);
    if (typeof resetCedarFlowAfterMiss === "function") resetCedarFlowAfterMiss(nowMs);
    _forgeBilateralAwait[pid] = { tFirst: nowMs, slots: new Set([slot]) };
    return true;
  }
  st0.slots.add(slot);
  delete _forgeBilateralAwait[pid];
  const pairIdx = [];
  for (let i = 0; i < tomahawks.length; i++) {
    if (tomahawks[i]?.bilateralPairId === pid) pairIdx.push(i);
  }
  pairIdx.sort((a, b) => b - a);
  const hOpt = { skipShatterHaptic: true, skipFlowRecord: true };
  for (const ii of pairIdx) shatterTomahawkAtIndex(ii, canvasX, canvasY, hOpt);
  if (typeof recordCedarFlowSuccessfulShatter === "function") recordCedarFlowSuccessfulShatter();
  if (typeof hapticBilateralPulseSuccess === "function") hapticBilateralPulseSuccess();
  if (typeof resetForgeMissStreak === "function") resetForgeMissStreak();
  return true;
}

function tryShatterSnag(canvasX, canvasY) {
  const nowMs = performance.now();
  const rawIdx =
    typeof findTomahawkSnagHitIndexUnfiltered === "function"
      ? findTomahawkSnagHitIndexUnfiltered(canvasX, canvasY)
      : typeof findTomahawkSnagHitIndex === "function"
        ? findTomahawkSnagHitIndex(canvasX, canvasY)
        : -1;
  if (rawIdx < 0) return false;

  const snag = tomahawks[rawIdx];
  if (snag?.orcaBilateralPulse && snag?.bilateralPairId) {
    return tryForgeBilateralPairResponse(snag, canvasX, canvasY, nowMs);
  }
  if (
    typeof snagContralateralAllowsShatter === "function" &&
    !snagContralateralAllowsShatter(snag, canvasX, canvasY)
  ) {
    if (typeof bumpContralateralWrongPulse === "function") bumpContralateralWrongPulse(nowMs);
    if (typeof registerForgeSnagMiss === "function") registerForgeSnagMiss(nowMs);
    return true;
  }
  shatterTomahawkAtIndex(rawIdx, canvasX, canvasY, {});
  return true;
}

function spawnAutoSnag(nowMs) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  if (currentMode === MODE_NEURAL_WEAVER || currentMode === MODE_OSPREY_SCOUT) {
    const zi =
      typeof cedarConsumeEmrdGridCell === "function" ? cedarConsumeEmrdGridCell() : 0;
    lastZone = zi;
    const col = zi % 3;
    const row = (zi / 3) | 0;
    const pad = 26;
    const xMin = (col / 3) * w + pad;
    const xMax = ((col + 1) / 3) * w - pad;
    const yMin = (row / 3) * h + pad;
    const yMax = ((row + 1) / 3) * h - pad;
    const bandLo = h * 0.35;
    const bandHi = h * 0.65;
    let aimY = yMin + Math.random() * Math.max(12, yMax - yMin);
    if (Math.random() < 0.27 && (row === 0 || row === 2)) {
      aimY = row === 0 ? yMin + Math.random() * 22 : yMax - Math.random() * 22;
    }
    aimY = Math.max(bandLo, Math.min(bandHi, aimY));
    let aimX;
    if (col === 0) aimX = xMin + Math.random() * Math.max(8, xMax - xMin);
    else if (col === 2) aimX = xMin + Math.random() * Math.max(8, xMax - xMin);
    else aimX = Math.random() < 0.5 ? xMin + Math.random() * (w / 6.5) : xMax - Math.random() * (w / 6.5);

    tomahawks.push(
      new Tomahawk({
        x: aimX,
        y: aimY,
        hue: modeHue(currentMode),
        mode: currentMode,
        maxLife: 2400,
      })
    );
    return;
  }

  if (currentMode === MODE_SALMON_RUN) {
    const margin = 26;
    const fromTop =
      typeof cedarConsumeSalmonVentTop === "function" ? cedarConsumeSalmonVentTop() : true;
    const aimX = margin + Math.random() * Math.max(12, w - 2 * margin);
    tomahawks.push(
      new Tomahawk({
        x: aimX,
        y: fromTop ? -margin : h + margin,
        hue: modeHue(currentMode),
        mode: currentMode,
        maxLife: 2600,
        verticalVent: fromTop ? "TOP" : "BOTTOM",
      })
    );
    return;
  }

  if (currentMode === MODE_ORCA_WISDOM) {
    const hint =
      typeof cedarNextSpiralAngleHint === "function" ? cedarNextSpiralAngleHint() : 0;
    const ty =
      typeof window !== "undefined" && typeof window.totemMasterLogCenterYFrac === "function"
        ? window.totemMasterLogCenterYFrac()
        : typeof CEDAR_SNAG_TRAVEL_TARGET_Y_FRAC === "number"
          ? CEDAR_SNAG_TRAVEL_TARGET_Y_FRAC
          : 0.78;
    const motorTier =
      typeof getForgeMotorTier === "function" ? getForgeMotorTier() : null;

    if (motorTier === 3) {
      const hw = w * 0.5;
      const motorHand = Math.random() < 0.5 ? "LEFT" : "RIGHT";
      const doCross = true;
      let aimX;
      if (motorHand === "RIGHT") {
        aimX = doCross
          ? hw + w * (0.15 + Math.random() * 0.26)
          : hw - w * (0.15 + Math.random() * 0.26);
      } else {
        aimX = doCross
          ? hw - w * (0.15 + Math.random() * 0.26)
          : hw + w * (0.15 + Math.random() * 0.26);
      }
      const startY = -28 - Math.random() * h * 0.28;
      tomahawks.push(
        new Tomahawk({
          mode: MODE_ORCA_WISDOM,
          snagTotemLevel: 3,
          x: aimX,
          y: startY,
          motorHand,
          contraMirrorTap: doCross,
          hue: modeHue(currentMode),
          maxLife: 5200,
        })
      );
      return;
    }

    const bilateral =
      motorTier === 2 &&
      typeof peekForgeOrcaBilateralPulseNext === "function" &&
      peekForgeOrcaBilateralPulseNext();
    if (
      bilateral &&
      typeof countLivingTomahawks === "function" &&
      countLivingTomahawks() === 0
    ) {
      const pairId = `bp_${nowMs}_${((Math.random() * 1e9) | 0).toString(36)}`;
      const sharedY = h * ty + (Math.random() - 0.5) * h * 0.05;
      const hue = modeHue(currentMode);
      const maxLife = 4200;
      tomahawks.push(
        new Tomahawk({
          mode: MODE_ORCA_WISDOM,
          snagTotemLevel: 2,
          orcaBilateralPulse: true,
          bilateralPairId: pairId,
          bilateralSlot: "L",
          y: sharedY,
          hue,
          maxLife,
        })
      );
      tomahawks.push(
        new Tomahawk({
          mode: MODE_ORCA_WISDOM,
          snagTotemLevel: 2,
          orcaBilateralPulse: true,
          bilateralPairId: pairId,
          bilateralSlot: "R",
          y: sharedY,
          hue,
          maxLife,
        })
      );
      if (typeof incrementForgeMotorOrcaSpawnCount === "function") incrementForgeMotorOrcaSpawnCount();
      return;
    }

    tomahawks.push(
      new Tomahawk({
        spiralAngleHint: hint,
        x: w * 0.5,
        y: h * ty,
        hue: modeHue(currentMode),
        mode: MODE_ORCA_WISDOM,
        maxLife: 3800,
      })
    );
    if (typeof incrementForgeMotorOrcaSpawnCount === "function") incrementForgeMotorOrcaSpawnCount();
    return;
  }

  const leftFirst =
    typeof cedarConsumeEdgeSpawnLeftFirst === "function" ? cedarConsumeEdgeSpawnLeftFirst() : true;
  const x = leftFirst ? 0 : w;
  const y = 40 + Math.random() * (h - 80);
  tomahawks.push(
    new Tomahawk({
      x,
      y,
      hue: modeHue(currentMode),
      mode: currentMode,
      maxLife: 2400,
    })
  );
}

function trimFragmentsToMaxCap() {
  const cap = typeof FRAGMENTS_MAX_COUNT === "number" ? FRAGMENTS_MAX_COUNT : 800;
  while (fragments.length > cap) {
    let victimIdx = -1;
    for (let i = 0; i < fragments.length; i++) {
      if (!fragments[i]?.harvestPainted) {
        victimIdx = i;
        break;
      }
    }
    if (victimIdx < 0) victimIdx = 0;
    const f = fragments.splice(victimIdx, 1)[0];
    if (!f) break;
    if (f.harvest && typeof f.destIndex === "number" && f.destIndex >= 0) {
      if (typeof releaseHarvestDest === "function") releaseHarvestDest(f.harvestLevel, f.destIndex);
    }
    if (typeof fragmentReleaseLock === "function") fragmentReleaseLock(f);
  }
}

/**
 * Main loop: single continuation via requestAnimationFrame(animate) at the end.
 * No synchronous recursion or busy loops here.
 */
function animate(nowMs) {
  // Reset frame in backing-store pixels (then DPR user transform applies for the rest of the frame).
  if (canvas && ctx) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  const dtMs = Math.min(40, Math.max(0.5, nowMs - _lastNow));
  _lastNow = nowMs;

  stepTotemGlobalCameraPan(nowMs);

  if (typeof document !== "undefined" && document.body) {
    const ph = typeof totemAppPhase === "string" ? totemAppPhase : "forge";
    document.body.dataset.totemPhase = ph;
    document.body.dataset.practiceMode =
      typeof totemPracticeMode !== "undefined" && totemPracticeMode ? "true" : "false";
    document.body.dataset.totemRunComplete =
      typeof totemRunComplete !== "undefined" && totemRunComplete ? "true" : "false";
  }

  if (typeof TOTEM_LONGHOUSE_FORGE !== "undefined" && TOTEM_LONGHOUSE_FORGE) {
    if (typeof totemAppPhase === "string" && totemAppPhase === "potlatch") {
      clearFrame();
      if (typeof canvas !== "undefined" && canvas?.classList) {
        canvas.classList.remove("totem-spirit-eye-active");
      }
      const gw = window.innerWidth;
      const gh = window.innerHeight;
      _lastBreath = computeBreathEnvelopeFromTime(nowMs);
      if (typeof drawTotemPotlatchCeremony === "function") {
        drawTotemPotlatchCeremony(ctx, gw, gh, nowMs);
      }
      const pc = typeof totemPotlatchCeremony !== "undefined" ? totemPotlatchCeremony : null;
      const minWait = pc?.durationMs ?? 4200;
      const elapsed = pc?.startMs ? nowMs - pc.startMs : 0;
      const audioDone =
        typeof window.isPotlatchCeremonyAudioComplete === "function"
          ? window.isPotlatchCeremonyAudioComplete()
          : true;
      const maxWait = pc?.maxWaitMs ?? 180000;
      if (
        pc?.startMs &&
        elapsed >= minWait &&
        (audioDone || elapsed >= maxWait) &&
        typeof completeTotemPotlatchCeremony === "function"
      ) {
        completeTotemPotlatchCeremony(nowMs);
        _forgeTierCompleteGate = false;
      }
      if (typeof updateTotemSoundscape === "function") {
        updateTotemSoundscape(nowMs, _lastBreath, [], currentMode);
      }
      updatePacerLabel(nowMs);
      requestAnimationFrame(animate);
      return;
    }

    if (typeof totemAppPhase === "string" && totemAppPhase === "gallery") {
      clearFrame();
      if (typeof canvas !== "undefined" && canvas?.classList) {
        canvas.classList.remove("totem-spirit-eye-active");
      }
      const gw = window.innerWidth;
      const gh = window.innerHeight;
      _lastBreath = computeBreathEnvelopeFromTime(nowMs);
      if (typeof drawLonghouseGallery === "function") {
        drawLonghouseGallery(ctx, gw, gh, nowMs);
      }
      updatePacerLabel(nowMs);
      if (typeof updateTotemSoundscape === "function") {
        updateTotemSoundscape(nowMs, _lastBreath, [], currentMode);
      }
      updateMentorWelcomeOverlay();
      requestAnimationFrame(animate);
      return;
    }
  }

  clearFrame();

  const sh = screenShakeOffset(nowMs);
  ctx.save();
  ctx.translate(sh.x, sh.y);

  // Totem mesh + Master Log (geometry.js): Log is a single scaled fillRect + ~6 grain lines (fast path).
  _lastBreath = generateTotem(nowMs) ?? _lastBreath;
  if (typeof window !== "undefined" && window.totemSuiteInteractive && _breathHapticPrimed) {
    if (_lastBreath.phase === "EXHALE" && _prevBreathPhase === "INHALE") {
      if (typeof hapticBreathInhalePeak === "function") hapticBreathInhalePeak();
    }
  } else if (!_breathHapticPrimed) {
    _breathHapticPrimed = true;
  }
  _prevBreathPhase = _lastBreath.phase;
  updatePacerLabel(nowMs);

  // Cedar Snag auto-spawn: 1500ms baseline gap (+5% speed per 10 streak when scaling enabled), max 2 living, spiral gate (physics.js).
  const snagAscensionBlocked =
    typeof totemSnagSpawnSuppressedUntilMs === "number" && nowMs < totemSnagSpawnSuppressedUntilMs;
  if (
    typeof window !== "undefined" &&
    window.totemSuiteInteractive &&
    !snagAscensionBlocked &&
    typeof shouldAttemptCedarSnagSpawn === "function" &&
    shouldAttemptCedarSnagSpawn(nowMs)
  ) {
    spawnAutoSnag(nowMs);
    if (typeof onCedarSnagSpawnExecuted === "function") onCedarSnagSpawnExecuted(nowMs);
  }

  // Update/draw tomahawks
  for (let i = tomahawks.length - 1; i >= 0; i--) {
    const t = tomahawks[i];
    t.update(dtMs, nowMs);
    t.draw(nowMs);
    if (t.isDead) tomahawks.splice(i, 1);
  }

  tickForgeBilateralAwaitState(nowMs);

  if (typeof updateTotemSoundscape === "function") {
    updateTotemSoundscape(nowMs, _lastBreath, tomahawks, currentMode);
  }

  if (typeof totemRunComplete !== "undefined" && totemRunComplete) {
    totemMidlineGlow = Math.max(typeof totemMidlineGlow === "number" ? totemMidlineGlow : 0, 3.5);
  } else if (typeof totemMidlineGlow === "number") totemMidlineGlow *= 0.905;

  trimFragmentsToMaxCap();

  // Bark chips off the Master Log (after snags read clear)
  if (Array.isArray(logChips) && logChips.length && ctx) {
    for (let j = logChips.length - 1; j >= 0; j--) {
      const ch = logChips[j];
      ch.update(dtMs);
      ch.draw(nowMs);
      if (ch.isDead) logChips.splice(j, 1);
    }
  }

  // Update/draw fragments (dead pruned immediately)
  for (let i = fragments.length - 1; i >= 0; i--) {
    const f = fragments[i];
    f.update(dtMs, nowMs);
    if (f.isDead) {
      if (f.harvest && typeof f.destIndex === "number" && f.destIndex >= 0) {
        if (typeof releaseHarvestDest === "function") releaseHarvestDest(f.harvestLevel, f.destIndex);
      }
      fragmentReleaseLock(f);
      fragments.splice(i, 1);
      continue;
    }
    f.draw();
  }

  // Impact ripples (after fragments so they read on top)
  if (_ripples.length && ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let r = _ripples.length - 1; r >= 0; r--) {
      const rip = _ripples[r];
      const u = (nowMs - rip.startMs) / Math.max(1, rip.durationMs);
      if (u >= 1) {
        _ripples.splice(r, 1);
        continue;
      }
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * u);
      const radius = rip.maxR * ease;
      const fade = (1 - u) * (1 - u);
      ctx.strokeStyle = `rgba(252, 211, 77, ${0.45 * fade})`;
      ctx.lineWidth = 2.2 * (1 - u * 0.85);
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, Math.max(2, radius), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 250, 235, ${0.22 * fade})`;
      ctx.lineWidth = 1.1 * (1 - u);
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, Math.max(2, radius * 0.62), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();

  drawContralateralWrongPulse(nowMs);

  tickSalishStexemReveal();

  if (
    typeof TOTEM_LONGHOUSE_FORGE !== "undefined" &&
    TOTEM_LONGHOUSE_FORGE &&
    typeof totemPracticeMode !== "undefined" &&
    totemPracticeMode &&
    typeof totemAppPhase === "string" &&
    totemAppPhase === "forge" &&
    typeof totemTierFillRatio === "function" &&
    typeof forgeTargetLevel === "number"
  ) {
    const fr = totemTierFillRatio(forgeTargetLevel);
    if (fr >= 0.997) {
      if (!_practiceTierResetGate) {
        _practiceTierResetGate = true;
        if (typeof resetTotemPracticeTierCarving === "function") resetTotemPracticeTierCarving();
        tomahawks.length = 0;
        fragments.length = 0;
        if (typeof clearForgeBilateralAwait === "function") clearForgeBilateralAwait();
        if (typeof resetForgeMissStreak === "function") resetForgeMissStreak();
      }
    } else {
      _practiceTierResetGate = false;
    }
  }

  if (
    typeof totemPracticeMode !== "undefined" &&
    totemPracticeMode &&
    typeof totemAppPhase === "string" &&
    totemAppPhase === "forge"
  ) {
    syncPracticeMotorControlsUi();
  }

  if (
    typeof TOTEM_LONGHOUSE_FORGE !== "undefined" &&
    TOTEM_LONGHOUSE_FORGE &&
    typeof totemAppPhase === "string" &&
    totemAppPhase === "forge" &&
    !(typeof totemPracticeMode !== "undefined" && totemPracticeMode) &&
    !_forgeTierCompleteGate &&
    typeof totemTierFillRatio === "function" &&
    typeof forgeTargetLevel === "number" &&
    typeof finalizeForgeTierForCeremony === "function" &&
    typeof beginTotemPotlatchCeremony === "function"
  ) {
    const fr = totemTierFillRatio(forgeTargetLevel);
    if (fr >= 0.997) {
      _forgeTierCompleteGate = true;
      finalizeForgeTierForCeremony(forgeTargetLevel);
      tomahawks.length = 0;
      fragments.length = 0;
      beginTotemPotlatchCeremony(nowMs, forgeTargetLevel);
    }
  }

  // Ascension / tier-up (legacy path — disabled in Longhouse / Forge mode).
  _levelCooldown -= dtMs;
  if (
    _levelCooldown <= 0 &&
    !(typeof totemRunComplete !== "undefined" && totemRunComplete) &&
    !(typeof TOTEM_LONGHOUSE_FORGE !== "undefined" && TOTEM_LONGHOUSE_FORGE)
  ) {
    const ascFill =
      typeof TOTEM_ASCENSION_SALMON_FILL_RATIO === "number" ? TOTEM_ASCENSION_SALMON_FILL_RATIO : 0.95;

    if (
      totemLevel === 1 &&
      typeof totemTierFillRatio === "function" &&
      totemTierFillRatio(1) >= ascFill &&
      typeof beginTotemSalmonAscension === "function"
    ) {
      beginTotemSalmonAscension(nowMs);
      _levelCooldown = 1400;
    }
  }

  requestAnimationFrame(animate);
}

function updateMentorWelcomeOverlay() {
  const ov = document.getElementById("mentor-welcome-overlay");
  if (!ov) return;
  const show =
    typeof window !== "undefined" &&
    window.totemSuiteInteractive &&
    typeof isMentorWelcomeDismissed === "function" &&
    !isMentorWelcomeDismissed() &&
    typeof totemAppPhase === "string" &&
    totemAppPhase === "gallery" &&
    !(typeof totemRunComplete !== "undefined" && totemRunComplete);
  if (show) {
    ov.removeAttribute("hidden");
    ov.setAttribute("aria-hidden", "false");
    if (!ov.classList.contains("mentor-welcome-overlay--visible")) {
      requestAnimationFrame(() => ov.classList.add("mentor-welcome-overlay--visible"));
    }
  } else {
    ov.classList.remove("mentor-welcome-overlay--visible");
    ov.setAttribute("hidden", "");
    ov.setAttribute("aria-hidden", "true");
  }
}

function syncPracticeMotorControlsUi() {
  document.querySelectorAll("[data-practice-tier]").forEach((b) => {
    const t = parseInt(b.getAttribute("data-practice-tier"), 10);
    const on =
      typeof practiceMotorSkillTier === "number" && practiceMotorSkillTier === t ? "true" : "false";
    b.setAttribute("aria-pressed", on);
  });
}

function wireGalleryPracticeButton() {
  const btn = document.getElementById("gallery-practice-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof totemRunComplete !== "undefined" && totemRunComplete) return;
    if (typeof enterTotemPracticeForgeFromGallery === "function") {
      enterTotemPracticeForgeFromGallery(performance.now());
      _forgeTierCompleteGate = false;
      _practiceTierResetGate = false;
      if (typeof totemVibrate === "function") totemVibrate(18);
    }
  });
}

function wireMentorWelcomeOverlay() {
  const btn = document.getElementById("mentor-welcome-continue");
  if (!btn || btn.dataset.mentorWired === "1") return;
  btn.dataset.mentorWired = "1";
  btn.addEventListener("click", () => {
    persistMentorWelcomeDismissed();
    updateMentorWelcomeOverlay();
    applySuiteStartPresentation();
  });
}

let _practiceMotorControlsWired = false;

function wirePracticeMotorControls() {
  if (_practiceMotorControlsWired) return;
  _practiceMotorControlsWired = true;
  document.querySelectorAll("[data-practice-tier]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (typeof totemPracticeMode === "undefined" || !totemPracticeMode) return;
      const t = parseInt(btn.getAttribute("data-practice-tier"), 10);
      if (!Number.isFinite(t) || t < 1 || t > 3) return;
      practiceMotorSkillTier = t;
      syncPracticeMotorControlsUi();
      if (typeof setMode === "function") setMode(t <= 1 ? MODE_SALMON_RUN : MODE_ORCA_WISDOM);
      if (typeof tomahawks !== "undefined" && Array.isArray(tomahawks)) tomahawks.length = 0;
      if (typeof clearForgeBilateralAwait === "function") clearForgeBilateralAwait();
      if (typeof resetCedarSnagSpawnPlanningState === "function")
        resetCedarSnagSpawnPlanningState(performance.now());
      if (typeof resetForgeMissStreak === "function") resetForgeMissStreak();
    });
  });
}

function wireSuiteStartOverlay() {
  const ov = document.getElementById("suite-start-overlay");
  const btn = document.getElementById("suite-start-btn");
  if (!ov || !btn) return;
  applySuiteStartPresentation();
  const finalizeClose = () => {
    ov.setAttribute("hidden", "");
    ov.setAttribute("aria-hidden", "true");
    ov.classList.remove("suite-start-overlay--exiting");
  };
  const dismiss = (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    if (typeof window !== "undefined") window.totemSuiteInteractive = true;
    if (typeof TOTEM_PHASE_GALLERY !== "undefined") totemAppPhase = TOTEM_PHASE_GALLERY;
    if (typeof unlockTotemAudio === "function") unlockTotemAudio();
    if (typeof totemVibrate === "function") totemVibrate([30, 50, 30]);
    ov.classList.add("suite-start-overlay--exiting");
    window.setTimeout(() => {
      if (typeof updateMentorWelcomeOverlay === "function") updateMentorWelcomeOverlay();
    }, 0);
    const safety = window.setTimeout(finalizeClose, 520);
    ov.addEventListener(
      "transitionend",
      (ev) => {
        if (ev.target !== ov || ev.propertyName !== "opacity") return;
        window.clearTimeout(safety);
        finalizeClose();
      },
      { once: true }
    );
  };
  btn.addEventListener("click", dismiss);
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") dismiss(e);
  });
}

function init() {
  canvas = document.getElementById("gameCanvas");
  if (!canvas) throw new Error('Missing <canvas id="gameCanvas">');
  ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) throw new Error("Unable to create 2D canvas context");

  if (typeof window !== "undefined" && !window.totemTripleOrcaGhostImg) {
    const oimg = new Image();
    oimg.decoding = "async";
    oimg.onload = () => {
      if (typeof invalidateTotemGeometry === "function") invalidateTotemGeometry();
      if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
    };
    oimg.onerror = () => {};
    oimg.src = new URL("assets/TripleOrca.svg", window.location.href).href;
    window.totemTripleOrcaGhostImg = oimg;
  }

  wireSuiteStartOverlay();
  wireMentorWelcomeOverlay();
  wireGalleryPracticeButton();
  wirePracticeMotorControls();

  if (typeof tryLoadTotemProgressPending === "function") {
    pendingTotemProgressJson = tryLoadTotemProgressPending();
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  canvas.addEventListener("pointerdown", (e) => {
    if (typeof window !== "undefined" && !window.totemSuiteInteractive) return;
    const { x: cx, y: cy } = canvasPointFromEvent(e);
    if (
      typeof TOTEM_LONGHOUSE_FORGE !== "undefined" &&
      TOTEM_LONGHOUSE_FORGE &&
      typeof totemAppPhase === "string" &&
      totemAppPhase === "gallery"
    ) {
      const gw = window.innerWidth;
      const gh = window.innerHeight;
      if (
        typeof galleryHitTestPracticeTap === "function" &&
        galleryHitTestPracticeTap(cx, cy, gw, gh) &&
        typeof enterTotemPracticeForgeFromGallery === "function"
      ) {
        enterTotemPracticeForgeFromGallery(performance.now());
        _forgeTierCompleteGate = false;
        _practiceTierResetGate = false;
        if (typeof resetForgeMissStreak === "function") resetForgeMissStreak();
        if (typeof syncPracticeMotorControlsUi === "function") syncPracticeMotorControlsUi();
        if (typeof totemVibrate === "function") totemVibrate(18);
        return;
      }
      if (typeof galleryHitTestTier === "function") {
        const tier = galleryHitTestTier(cy, gw, gh);
        const nextTier =
          typeof totemFirstIncompleteTier === "function" ? totemFirstIncompleteTier() : 1;
        if (
          tier > 0 &&
          tier === nextTier &&
          typeof totemGalleryTierCanEnterForge === "function" &&
          totemGalleryTierCanEnterForge(tier) &&
          typeof enterTotemForgeFromGallery === "function"
        ) {
          enterTotemForgeFromGallery(tier, performance.now());
          _forgeTierCompleteGate = false;
          if (typeof totemVibrate === "function") totemVibrate(22);
        }
      }
      return;
    }
    if (typeof setTotemClickPan === "function") setTotemClickPan(cx, performance.now());
    // Neural Suite: ripples / harvest only when a Cedar Snag is hit within pointer radius + contralateral rules (physics.js).
    if (tryShatterSnag(cx, cy)) return;
    if (
      typeof totemAppPhase === "string" &&
      totemAppPhase === "forge" &&
      typeof registerForgeSnagMiss === "function"
    ) {
      registerForgeSnagMiss(performance.now());
    }
    if (typeof resetCedarFlowAfterMiss === "function") resetCedarFlowAfterMiss(performance.now());
    if (typeof totemVibrate === "function") totemVibrate(10);
  });

  // Useful reset shortcut
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (typeof totemPracticeMode !== "undefined" && totemPracticeMode) {
        if (typeof exitTotemPracticeForgeToGallery === "function") exitTotemPracticeForgeToGallery();
        _forgeTierCompleteGate = false;
        _practiceTierResetGate = false;
        if (typeof totemVibrate === "function") totemVibrate(12);
        return;
      }
      for (let i = fragments.length - 1; i >= 0; i--) fragmentReleaseLock(fragments[i]);
      tomahawks.length = 0;
      fragments.length = 0;
      if (Array.isArray(logChips)) logChips.length = 0;
      _ripples.length = 0;
      if (Array.isArray(totemLockCounts)) totemLockCounts.fill(0);
      if (typeof clearAllTotemActivated === "function") clearAllTotemActivated();
      if (typeof resetTotemTierClock === "function") resetTotemTierClock(performance.now());
      if (typeof resetTotemAscensionState === "function") resetTotemAscensionState();
      if (typeof resetCedarSnagSpawnPlanningState === "function") resetCedarSnagSpawnPlanningState(performance.now());
      clearForgeBilateralAwait();
      if (typeof resetTotemPoleCamera === "function") resetTotemPoleCamera();
      else if (typeof resetTotemCameraAll === "function") resetTotemCameraAll();
      if (typeof totemMidlineGlow === "number") totemMidlineGlow = 0;
      _screenShakeUntilMs = 0;
      _contralateralWrongPulseUntilMs = 0;
      if (typeof resetTotemRunCompletionState === "function") resetTotemRunCompletionState();
      totemLevel = 1;
      levelTransition = { active: false, startMs: 0, durationMs: 900, fromLevel: 0, toLevel: 0 };
      lastZone = -1;
      _forgeTierCompleteGate = false;
      if (typeof TOTEM_PHASE_GALLERY !== "undefined") totemAppPhase = TOTEM_PHASE_GALLERY;
      if (typeof totemPotlatchCeremony !== "undefined") totemPotlatchCeremony = null;
    }
  });

  if (typeof resetCedarSnagSpawnPlanningState === "function") resetCedarSnagSpawnPlanningState(performance.now());
  clearForgeBilateralAwait();

  requestAnimationFrame((t) => {
    _lastNow = t;
    animate(t);
  });
}

window.addEventListener("DOMContentLoaded", init);

