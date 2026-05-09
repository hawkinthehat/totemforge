// Totem geometry: static layout + offscreen cache (see generateTotem).

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Stable jitter so Salmon points don't flicker frame-to-frame (locks stay valid). */
function detJitter(i, sx, sy) {
  const j = Math.sin(i * 12.9898 + 77.1123) * 0.5 + Math.cos(i * 78.233 + 2.2) * 0.35;
  return { x: j * sx * 0.06, y: Math.cos(i * 31.41 + 1.7) * sy * 0.06 };
}

/**
 * Pulse marking clusters outward from origin (ox,oy) using Vagus-linked scaleMultiplier.
 * soulPriority: 0 = ovoid “soul” features (eyes / joints) fill first; 1 = secondary markings; 2 = body mass.
 */
function pushSalmonPoint(arr, x, y, fillOrder, idxRef, marking, ox, oy, pulseMul, soulPriority = 2) {
  const i = idxRef.i++;
  const j = detJitter(i, 1, 1);
  const px = ox + (x - ox) * pulseMul;
  const py = oy + (y - oy) * pulseMul;
  arr.push({
    x: px + j.x,
    y: py + j.y,
    fillOrder,
    marking,
    paintSection: marking,
    soulPriority,
    active: false,
  });
}

/** Frame timing for smooth camera (totemCameraY lives in config.js). */
let _totemPoleLastGenMs = 0;

function resetTotemPoleCamera() {
  if (typeof resetTotemCameraAll === "function") resetTotemCameraAll();
  else {
    totemCameraY = 0;
    globalCameraY = 0;
  }
  _totemPoleLastGenMs = 0;
}

if (typeof window !== "undefined") window.resetTotemPoleCamera = resetTotemPoleCamera;

/** Hard cap per animal tier (~1500–2000 band; matches config TOTEM_EXPECTED_POINTS_PER_TIER when present). */
const TOTEM_MAX_POINTS_PER_ANIMAL =
  typeof TOTEM_EXPECTED_POINTS_PER_TIER === "number" ? TOTEM_EXPECTED_POINTS_PER_TIER : 1750;

/** Built once per resize session; regenerated via invalidateTotemGeometry(). */
let totemPointsFrozen = false;
/** Frozen layout for stacked pole (matches computeTotemLayout). */
let totemLayout = null;
let totemOffscreen = null;
let totemOffscreenCtx = null;
let totemCacheDirty = true;

/** Single multiply when compositing the cached totem bitmap onto the main canvas (not per-dot alpha). */
const TOTEM_LAYER_COMPOSITE_ALPHA = 0.96;

/** Master Totem Log — fixed 240×70%vh plank; breath only scales scaleX (see drawMasterTotemLog). */
const MASTER_LOG_WIDTH_PX = 240;
const MASTER_LOG_HEIGHT_FRAC = 0.7;
const MASTER_LOG_SCALE_X_MIN = 0.94;
const MASTER_LOG_SCALE_X_MAX = 1.06;
const MASTER_LOG_FILL = "#5c4033";
const MASTER_LOG_GRAIN_COLOR = "#451a03";

/**
 * High-performance Master Log: single fillRect + a few grain strokes.
 * Vagus “breath” = horizontal scale only (no geometry rebuild).
 */
function drawMasterTotemLog(ctx2, w, h, breath01, nowMs = performance.now()) {
  if (!ctx2) return;
  let viewH = h;
  if (typeof canvas !== "undefined" && canvas?.height) {
    try {
      const m = ctx2.getTransform();
      const sy = Math.abs(m.d);
      if (sy > 1e-6) viewH = canvas.height / sy;
    } catch (_) {}
  }
  const cx = w * 0.5;
  const cy = viewH * 0.6;
  const logH = viewH * MASTER_LOG_HEIGHT_FRAC;
  const logW = MASTER_LOG_WIDTH_PX;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
  const amp = ease(typeof breath01 === "number" ? breath01 : 0);
  const scaleX = MASTER_LOG_SCALE_X_MIN + (MASTER_LOG_SCALE_X_MAX - MASTER_LOG_SCALE_X_MIN) * amp;

  ctx2.save();
  ctx2.globalAlpha = 0.8;
  ctx2.translate(cx, cy);
  ctx2.scale(scaleX, 1);
  ctx2.translate(-cx, -cy);

  ctx2.fillStyle = MASTER_LOG_FILL;
  ctx2.fillRect(cx - logW * 0.5, cy - logH * 0.5, logW, logH);

  ctx2.strokeStyle = MASTER_LOG_GRAIN_COLOR;
  ctx2.lineWidth = 1;
  ctx2.lineCap = "butt";
  const grainCount = 6;
  const marginX = 14;
  const x0 = cx - logW * 0.5 + marginX;
  const x1 = cx + logW * 0.5 - marginX;
  const span = Math.max(1, x1 - x0);
  const yTop = cy - logH * 0.5 + 6;
  const yBot = cy + logH * 0.5 - 6;
  for (let i = 0; i < grainCount; i++) {
    const gx = x0 + (span * (i + 1)) / (grainCount + 1);
    ctx2.beginPath();
    ctx2.moveTo(gx, yTop);
    ctx2.lineTo(gx, yBot);
    ctx2.stroke();
  }

  const flashUntil =
    typeof totemLogOutlineFlashUntilMs === "number" ? totemLogOutlineFlashUntilMs : 0;
  const flashColor =
    typeof totemLogOutlineFlashColor === "string" ? totemLogOutlineFlashColor : "#ffffff";
  if (nowMs < flashUntil) {
    const dur =
      typeof TOTEM_LOG_OUTLINE_FLASH_MS === "number" ? TOTEM_LOG_OUTLINE_FLASH_MS : 100;
    const u = Math.max(0, Math.min(1, (flashUntil - nowMs) / Math.max(1, dur)));
    ctx2.save();
    ctx2.strokeStyle = flashColor;
    ctx2.globalAlpha = 0.55 + 0.45 * u;
    ctx2.lineWidth = 2.75;
    ctx2.strokeRect(cx - logW * 0.5, cy - logH * 0.5, logW, logH);
    ctx2.restore();
  }

  /** Total stabilization finale: log rim breathes with the 4s/8s cycle (synced to totem mesh glow). */
  if (typeof totemRunComplete === "boolean" && totemRunComplete) {
    const pulse = 0.38 + 0.62 * amp;
    ctx2.save();
    ctx2.strokeStyle = `rgba(45, 212, 191, ${0.34 * pulse})`;
    ctx2.lineWidth = 3.1;
    ctx2.strokeRect(cx - logW * 0.5, cy - logH * 0.5, logW, logH);
    ctx2.strokeStyle = `rgba(248, 250, 252, ${0.2 * pulse})`;
    ctx2.lineWidth = 1.45;
    ctx2.strokeRect(cx - logW * 0.5 + 2, cy - logH * 0.5 + 2, logW - 4, logH - 4);
    ctx2.restore();
  }

  ctx2.restore();
}

function computeTotemLayout(w, h) {
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
  const amp = ease(0.5);
  const base = Math.min(w, h);
  const baseScale = base * 0.28;
  const scaleMultiplier = 0.88 + 0.22 * amp;
  const S = baseScale * scaleMultiplier;
  const poleFootY = h * 0.965;
  const blockH = S * 2.32;
  const salmonStackY = poleFootY - blockH * 0.42;
  const orcaStackY = salmonStackY - blockH;
  const ospreyStackY = orcaStackY - blockH;
  return {
    w,
    h,
    cx: w * 0.5,
    amp,
    scaleMultiplier,
    S,
    poleFootY,
    blockH,
    salmonStackY,
    orcaStackY,
    ospreyStackY,
  };
}

function capTotemLevelPoints(level, arr) {
  const maxN = TOTEM_MAX_POINTS_PER_ANIMAL;
  if (!arr || arr.length <= maxN) return arr;
  const step = arr.length / maxN;
  const out = [];
  const oldAct = totemActivatedByLevel[level] ? totemActivatedByLevel[level].slice() : [];
  const newAct = new Array(maxN).fill(false);
  for (let i = 0; i < maxN; i++) {
    const src = Math.min(arr.length - 1, Math.floor(i * step));
    out.push(arr[src]);
    newAct[i] = !!oldAct[src];
  }
  totemActivatedByLevel[level] = newAct;
  return out;
}

function ensureTotemOffscreen(w, h) {
  if (!totemOffscreen) {
    totemOffscreen = document.createElement("canvas");
    totemOffscreenCtx = totemOffscreen.getContext("2d", { alpha: true });
  }
  if (totemOffscreen.width !== w || totemOffscreen.height !== h) {
    totemOffscreen.width = w;
    totemOffscreen.height = h;
  }
}

function requestTotemCacheRedraw() {
  totemCacheDirty = true;
}

function invalidateTotemGeometry() {
  totemPointsFrozen = false;
  totemLayout = null;
  totemCacheDirty = true;
}

function totemFillRatio01(lv) {
  const act = totemActivatedByLevel[lv];
  if (!act?.length) return 0;
  let c = 0;
  for (let i = 0; i < act.length; i++) if (act[i]) c++;
  return c / act.length;
}

function totemTierReveal(lv) {
  const fr = totemFillRatio01(lv);
  if (lv < totemLevel) return 1;
  if (fr >= 0.997) return 1;
  return 0.34 + 0.66 * fr;
}

function syncTotemPointActiveFlags() {
  const ptsByLevel = totemPointsByLevel;
  if (!ptsByLevel || ptsByLevel.length < 4) return;
  for (let lv = 1; lv <= 3; lv++) {
    const pts = ptsByLevel[lv];
    const act = totemActivatedByLevel[lv];
    if (!pts?.length || !act?.length) continue;
    for (let i = 0; i < pts.length; i++) pts[i].active = !!act[i];
  }
  const salmonPts = ptsByLevel[1];
  if (totemLevel === 1) totemPoints = salmonPts;
  else if (totemLevel === 2) totemPoints = ptsByLevel[2] ?? salmonPts;
  else totemPoints = ptsByLevel[3] ?? ptsByLevel[2] ?? salmonPts;
}

/** Offscreen totem cache: rgba in fillStyle only (no per-dot ctx.globalAlpha churn). */
function paintTotemDotToCache(
  c,
  level,
  px,
  py,
  baseR,
  on,
  tierRev,
  emMul,
  p,
  glow,
  eyeGlowMul,
  emdrSalmonGhost,
  dotIndex = -1
) {
  const fo = p.fillOrder ?? 0;
  const marking = p.marking;
  const sec = p.paintSection ?? marking;
  const secPaint = typeof getTotemSectionPaint === "function" ? getTotemSectionPaint(level, sec) : 0;
  const land =
    dotIndex >= 0 && typeof getTotemLandingBlend === "function" ? getTotemLandingBlend(level, dotIndex) : 0;
  const carveStrength = Math.min(1, Math.max(secPaint, land, on ? 1 : 0));
  const rimLike =
    fo === 0 ||
    marking === "eye" ||
    marking === "joint" ||
    marking === "gill" ||
    marking === "fin" ||
    marking === "dorsal" ||
    marking === "tail" ||
    marking === "talon" ||
    marking === "wing" ||
    marking === "beak" ||
    marking === "blowhole";

  const ghostRgb = "170, 182, 195";

  if (!on && carveStrength < 0.02) {
    const ga = tierRev * emMul * (rimLike ? 0.17 : 0.11) * emdrSalmonGhost;
    c.fillStyle = `rgba(${ghostRgb}, ${ga})`;
    c.beginPath();
    c.arc(px, py, baseR * (rimLike ? 1.06 : 0.92), 0, TWO_PI);
    c.fill();
    return;
  }

  const pa = tierRev * emMul * (0.14 + 0.86 * carveStrength);

  c.fillStyle = `rgba(${ghostRgb}, ${pa * (1 - carveStrength * 0.55)})`;
  c.beginPath();
  c.arc(px, py, baseR * (rimLike ? 1.02 : 0.94), 0, TWO_PI);
  c.fill();

  const carveDeep = "#3f1810";
  const carveMid = "#7f1d1d";
  const carveLift = "#dc2626";
  const carveSheen = "#fde68a";

  c.fillStyle = carveDeep;
  c.beginPath();
  c.arc(px + baseR * 0.11, py + baseR * 0.09, baseR * 0.93, 0, TWO_PI);
  c.fill();
  c.fillStyle = carveMid;
  c.beginPath();
  c.arc(px - baseR * 0.03, py - baseR * 0.02, baseR * 0.8, 0, TWO_PI);
  c.fill();
  const liftA = pa * (0.82 + glow * 0.18);
  c.fillStyle = `rgba(220, 38, 38, ${liftA})`;
  c.beginPath();
  c.arc(px - baseR * 0.2, py - baseR * 0.17, baseR * (rimLike ? 0.46 : 0.34), 0, TWO_PI);
  c.fill();
  if (rimLike) {
    c.strokeStyle = `rgba(253, 230, 138, ${pa * 0.92})`;
    c.lineWidth = Math.max(0.5, baseR * 0.2);
    c.beginPath();
    c.arc(px, py, baseR * 0.58, 0.55, TWO_PI - 0.55);
    c.stroke();
  }
}

function redrawTotemCache(L, nowMs = performance.now()) {
  const c = totemOffscreenCtx;
  if (!c || !L) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, L.w, L.h);
  c.globalCompositeOperation = "source-over";

  const amp = L.amp;
  const cycleMs = 12000;
  const inhaleMs = 4000;
  const ti = ((nowMs % cycleMs) + cycleMs) % cycleMs;
  const breath01Stab = ti < inhaleMs ? ti / inhaleMs : 1 - (ti - inhaleMs) / (cycleMs - inhaleMs);
  const stabEase = 0.5 - 0.5 * Math.cos(Math.PI * breath01Stab);
  const totemRunDone = typeof totemRunComplete === "boolean" && totemRunComplete;
  const stabPulse = totemRunDone ? 0.42 + 0.58 * stabEase : 0;
  const glow = (0.11 + 0.12 * amp) * (1 + stabPulse * 2.25);
  const dot = Math.max(1.2, L.S * 0.0065);
  const mg = typeof totemMidlineGlow === "number" ? totemMidlineGlow : 0;
  const stabilizedBoost = totemRunDone ? 2.6 + stabPulse * 1.45 : 0;
  const eyeGlowMul = 1 + (mg + stabilizedBoost) * 0.72;
  const salmonCompletionGlow =
    typeof totemSalmonCompletionGlowUntilMs === "number" &&
    nowMs < totemSalmonCompletionGlowUntilMs;
  const salmonMarkingGlowBoost = salmonCompletionGlow ? 1.38 : 1;
  const emdrSalmonGhost = currentMode === MODE_NEURAL_WEAVER ? 1.55 : 1;

  const salmonReveal = totemTierReveal(1);
  const ghostRamp =
    typeof totemOrcaAscensionGhostRamp === "function" ? totemOrcaAscensionGhostRamp(nowMs) : 1;
  let orcaReveal = totemTierReveal(2) * ghostRamp;
  let ospreyReveal = totemTierReveal(3);
  const transFin = levelTransition?.active ? levelTransition : null;
  if (transFin?.active && transFin.fromLevel === 1 && transFin.toLevel === 2) {
    const pf = Math.min(1, Math.max(0, (nowMs - transFin.startMs) / Math.max(1, transFin.durationMs)));
    const easeGhost = 0.5 - 0.5 * Math.cos(Math.PI * pf);
    orcaReveal *= 0.35 + 0.65 * easeGhost;
  }
  if (transFin?.active && transFin.fromLevel === 2 && transFin.toLevel === 3) {
    const pf = Math.min(1, Math.max(0, (nowMs - transFin.startMs) / Math.max(1, transFin.durationMs)));
    const easeGhost = 0.5 - 0.5 * Math.cos(Math.PI * pf);
    ospreyReveal *= 0.35 + 0.65 * easeGhost;
  }

  const salmonPts = totemPointsByLevel[1] ?? [];
  const orcaPts = totemPointsByLevel[2] ?? [];
  const ospreyPts = totemPointsByLevel[3] ?? [];

  const bh = typeof L.blockH === "number" ? L.blockH : L.S * 2.32;
  const slide1 =
    typeof totemCompletedTierSlidePx === "function" ? totemCompletedTierSlidePx(1, bh, nowMs) : 0;
  const slide2 =
    typeof totemCompletedTierSlidePx === "function" ? totemCompletedTierSlidePx(2, bh, nowMs) : 0;
  const slide3 =
    typeof totemCompletedTierSlidePx === "function" ? totemCompletedTierSlidePx(3, bh, nowMs) : 0;

  const yAtLayout = (p, tierSlide) => (p._y0 !== undefined ? p._y0 : p.y) + tierSlide;

  for (let i = 0; i < salmonPts.length; i++) {
    const p = salmonPts[i];
    const fo = p.fillOrder ?? 0;
    const on = p.active === true;
    const em =
      (p.marking === "eye" || p.marking === "joint" ? eyeGlowMul : 1) * salmonMarkingGlowBoost;
    const br =
      dot * (fo === 0 ? 1.08 : 0.98) * (p.marking === "eye" || p.marking === "joint" ? 1.08 : 1);
    paintTotemDotToCache(
      c,
      1,
      p.x,
      yAtLayout(p, slide1),
      br,
      on,
      salmonReveal,
      em,
      p,
      glow,
      eyeGlowMul,
      emdrSalmonGhost,
      i
    );
  }

  for (let i = 0; i < orcaPts.length; i++) {
    const p = orcaPts[i];
    const fo = p.fillOrder ?? 0;
    const on = p.active === true;
    const em = p.marking === "eye" ? eyeGlowMul : 1;
    const silhouetteBoost =
      p.marking === "dorsal" || p.marking === "tail"
        ? currentMode === MODE_ORCA_WISDOM
          ? 1.12
          : 1.08
        : 1;
    const br =
      dot *
      (fo === 0 ? 1.06 : 0.98) *
      (p.marking === "eye" ? 1.08 : 1) *
      silhouetteBoost;
    paintTotemDotToCache(c, 2, p.x, yAtLayout(p, slide2), br, on, orcaReveal, em, p, glow, eyeGlowMul, emdrSalmonGhost, i);
  }

  for (let i = 0; i < ospreyPts.length; i++) {
    const p = ospreyPts[i];
    const fo = p.fillOrder ?? 0;
    const on = p.active === true;
    const em = p.marking === "eye" ? eyeGlowMul : 1;
    const br = dot * (fo === 0 ? 1.06 : 0.98) * (p.marking === "eye" ? 1.08 : 1);
    paintTotemDotToCache(c, 3, p.x, yAtLayout(p, slide3), br, on, ospreyReveal, em, p, glow, eyeGlowMul, emdrSalmonGhost, i);
  }
}

if (typeof window !== "undefined") {
  window.invalidateTotemGeometry = invalidateTotemGeometry;
  window.requestTotemCacheRedraw = requestTotemCacheRedraw;
}

function generateTotem(nowMs) {
  if (!ctx || !canvas) return;

  // Use CSS pixels (engine sets a dpr transform)
  const w = window.innerWidth;
  const h = window.innerHeight;

  // 12s Vagus Breath: 4s inhale, 8s exhale
  const cycleMs = 12000;
  const inhaleMs = 4000;
  const t = ((nowMs ?? performance.now()) % cycleMs + cycleMs) % cycleMs;

  let phase = "EXHALE";
  let breath01 = 0; // 0..1
  if (t < inhaleMs) {
    phase = "INHALE";
    breath01 = t / inhaleMs;
  } else {
    phase = "EXHALE";
    breath01 = 1 - (t - inhaleMs) / (cycleMs - inhaleMs);
  }

  // Pacer copy + timing: engine.js updatePacerLabel() owns visible text (syncs with breath01 / scale).

  // Scale envelope (ease in/out for smooth vagal pacing)
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
  const amp = ease(breath01);

  const base = Math.min(w, h);
  const baseScale = base * 0.28;
  const scaleMultiplierLive = 0.88 + 0.22 * amp;

  const dtGenMs = Math.min(72, Math.max(0, nowMs - (_totemPoleLastGenMs || nowMs)));
  _totemPoleLastGenMs = nowMs;

  if (!totemPointsFrozen) {
    totemLayout = computeTotemLayout(w, h);
    const cx = totemLayout.cx;
    const S = totemLayout.S;
    const amp = totemLayout.amp;
    const scaleMultiplier = totemLayout.scaleMultiplier;
    const salmonStackY = totemLayout.salmonStackY;
    const orcaStackY = totemLayout.orcaStackY;
    const ospreyStackY = totemLayout.ospreyStackY;

  // Level 1: Salmon points must be the active `totemPoints` when totemLevel === 1.
  // We keep `totemPointsByLevel` updated so locked fragments can persist across transitions.
  const ptsByLevel = [];

  /**
   * Stacked Formline Salmon (Level 1): dense almond body + tribal marking clusters (eye, gills, fins).
   * fillOrder 0 = rim/outline first; 1 = interior fill. Activation color driven by totemActivatedByLevel[1].
   */
  function drawSalmon(offsetY = 0) {
    const a = [];
    const idxRef = { i: 0 };
    const anchorY = salmonStackY + offsetY;
    const swell = 0.92 + 0.18 * amp;
    const s = S * swell;

    const fishCx = cx;
    const fishCy = anchorY - s * 0.06;
    // Breath pulse: expand clusters from salmon center (ties to scaleMultiplier / Vagus cycle)
    const pulseMul = 0.94 + ((scaleMultiplier - 0.88) / 0.22) * 0.11;

    const almondBoundary = (theta) => {
      const rx = s * 0.52;
      const ry = s * 0.21;
      const squash = 1 + 0.1 * Math.cos(2 * theta);
      return {
        x: fishCx + Math.cos(theta) * rx * squash,
        y: fishCy + Math.sin(theta) * ry,
      };
    };

    const insideBody = (px, py) => {
      const dx = (px - fishCx) / (s * 0.52);
      const dy = (py - fishCy) / (s * 0.21);
      return dx * dx + dy * dy <= 0.98;
    };

    const rho = Math.sqrt(5);
    const gStep = (s * 0.03) / rho;

    // —— Body: thick solid formline bands (cluster dots), ~5× density (angular × grid × shells)
    const thetaSteps = 640;
    for (let ti = 0; ti < thetaSteps; ti++) {
      const theta = (ti / thetaSteps) * TWO_PI;
      const B = almondBoundary(theta);
      const vx = B.x - fishCx;
      const vy = B.y - fishCy;
      for (let rf = 0.62; rf <= 1.001; rf += 0.016) {
        pushSalmonPoint(a, fishCx + vx * rf, fishCy + vy * rf, 0, idxRef, "body", fishCx, fishCy, pulseMul);
      }
      for (let rf = 0.05; rf <= 0.76; rf += 0.03) {
        pushSalmonPoint(a, fishCx + vx * rf, fishCy + vy * rf, 1, idxRef, "body", fishCx, fishCy, pulseMul);
      }
    }

    const gw = s * 1.06;
    const gh = s * 0.46;
    let gx = fishCx - gw * 0.46;
    while (gx < fishCx + gw * 0.5) {
      let gy = fishCy - gh * 0.52;
      while (gy < fishCy + gh * 0.5) {
        if (insideBody(gx, gy)) {
          pushSalmonPoint(a, gx, gy, 1, idxRef, "body", fishCx, fishCy, pulseMul);
        }
        gy += gStep;
      }
      gx += gStep;
    }

    // —— Large ovoid eye — solid cluster mass (not a thin outline)
    const eyeCx = fishCx + s * 0.33;
    const eyeCy = fishCy - s * 0.06;
    const erx = s * 0.145;
    const ery = s * 0.098;
    const eyeSteps = 560;
    const eyeRings = [];
    for (let r = 1.0; r >= 0.54; r -= 0.022) eyeRings.push(r);
    for (let ei = 0; ei < eyeSteps; ei++) {
      const a0 = (ei / eyeSteps) * TWO_PI;
      for (const rr of eyeRings) {
        pushSalmonPoint(
          a,
          eyeCx + Math.cos(a0) * erx * rr,
          eyeCy + Math.sin(a0) * ery * rr,
          0,
          idxRef,
          "eye",
          fishCx,
          fishCy,
          pulseMul,
          0
        );
      }
    }

    // —— Pectoral joint ovoids — solid filled clusters
    for (const side of [-1, 1]) {
      const jx = fishCx + side * s * 0.385;
      const jy = fishCy + s * 0.072;
      const jrx = s * 0.072;
      const jry = s * 0.054;
      const jSteps = 280;
      for (let ji = 0; ji < jSteps; ji++) {
        const aj = (ji / jSteps) * TWO_PI;
        for (const jr of [1.0, 0.94, 0.87, 0.8, 0.72]) {
          pushSalmonPoint(
            a,
            jx + Math.cos(aj) * jrx * jr,
            jy + Math.sin(aj) * jry * jr,
            0,
            idxRef,
            "joint",
            fishCx,
            fishCy,
            pulseMul,
            0
          );
        }
      }
    }

    // —— Stacked gills — thick U-band clusters
    const numGills = 6;
    for (let gi = 0; gi < numGills; gi++) {
      const gCx = fishCx - s * 0.12;
      const gCy = fishCy + s * (-0.075 + gi * 0.042);
      const R = s * (0.074 - gi * 0.002);
      const arcSteps = 160;
      for (let k = 0; k < arcSteps; k++) {
        const u = k / (arcSteps - 1);
        const ang = Math.PI * 0.46 + u * Math.PI * 1.04;
        const ox = Math.cos(ang);
        const oy = Math.sin(ang);
        for (const rr of [1.0, 0.93, 0.86, 0.78, 0.7]) {
          pushSalmonPoint(
            a,
            gCx + ox * R * rr,
            gCy + oy * R * rr,
            rr >= 0.9 ? 0 : 1,
            idxRef,
            "gill",
            fishCx,
            fishCy,
            pulseMul,
            rr >= 0.9 ? 0 : 1
          );
        }
      }
    }

    // —— Fin U-shapes — thick bands
    const finSpecs = [
      { fx: fishCx - s * 0.34, fy: fishCy + s * 0.12, R: s * 0.11, a0: Math.PI * 0.35, span: Math.PI * 0.55 },
      { fx: fishCx - s * 0.08, fy: fishCy - s * 0.34, R: s * 0.09, a0: Math.PI * 1.05, span: Math.PI * 0.5 },
      { fx: fishCx - s * 0.48, fy: fishCy + s * 0.02, R: s * 0.085, a0: Math.PI * 0.75, span: Math.PI * 0.45 },
    ];
    for (const fin of finSpecs) {
      const fs = 130;
      for (let k = 0; k < fs; k++) {
        const u = k / (fs - 1);
        const ang = fin.a0 + u * fin.span;
        const ox = Math.cos(ang);
        const oy = Math.sin(ang);
        for (const rr of [1.0, 0.9, 0.8, 0.72]) {
          pushSalmonPoint(
            a,
            fin.fx + ox * fin.R * rr,
            fin.fy + oy * fin.R * rr,
            rr >= 0.88 ? 0 : 1,
            idxRef,
            "fin",
            fishCx,
            fishCy,
            pulseMul,
            rr >= 0.88 ? 0 : 1
          );
        }
      }
    }

    return a;
  }

  /** Level 3 Osprey: dense clusters for eye, wing arcs, and talon hooks (formline fill). */
  function drawOsprey(offsetY = 0) {
    const a = [];
    const idxRef = { i: 0 };
    const anchorY = ospreyStackY + offsetY;
    const swell = 0.9 + 0.2 * amp;
    const s = S * swell * 0.92;
    const birdCx = cx;
    const birdCy = anchorY;
    const pulseMul = 0.94 + ((scaleMultiplier - 0.88) / 0.22) * 0.1;

    const insideWing = (px, py, side) => {
      const wx = birdCx + side * s * 0.48;
      const wy = birdCy + s * 0.02;
      const dx = (px - wx) / (s * 0.62);
      const dy = (py - wy) / (s * 0.24);
      return dx * dx + dy * dy <= 1.06;
    };

    const rhoO = Math.sqrt(5);
    const wingStep = (s * 0.027) / rhoO;

    // Body core — thick solid almond band clusters
    const bodySteps = 520;
    for (let ti = 0; ti < bodySteps; ti++) {
      const theta = (ti / bodySteps) * TWO_PI;
      const bx = birdCx + Math.cos(theta) * s * 0.2;
      const by = birdCy + Math.sin(theta) * s * 0.11;
      const vx = bx - birdCx;
      const vy = by - birdCy;
      for (let rf = 0.74; rf <= 1.001; rf += 0.018) {
        pushSalmonPoint(a, birdCx + vx * rf, birdCy + vy * rf, 1, idxRef, "body", birdCx, birdCy, pulseMul);
      }
    }

    // Wing grids (left / right) — wide osprey wingspan
    for (const side of [-1, 1]) {
      const gw = s * 0.62;
      const gh = s * 0.4;
      let gx = birdCx + side * s * 0.1;
      while ((side < 0 && gx > birdCx - s * 0.84) || (side > 0 && gx < birdCx + s * 0.84)) {
        let gy = birdCy - gh * 0.45;
        while (gy < birdCy + gh * 0.48) {
          if (insideWing(gx, gy, side)) {
            pushSalmonPoint(a, gx, gy, 1, idxRef, "wing", birdCx, birdCy, pulseMul);
          }
          gy += wingStep;
        }
        gx += side * wingStep * 0.95;
      }
    }

    // Eye — solid ovoid cluster
    const eyeCx = birdCx + s * 0.14;
    const eyeCy = birdCy - s * 0.05;
    const erx = s * 0.11;
    const ery = s * 0.075;
    const eyeSteps = 320;
    for (let ei = 0; ei < eyeSteps; ei++) {
      const a0 = (ei / eyeSteps) * TWO_PI;
      for (let rr = 1.0; rr >= 0.58; rr -= 0.035) {
        pushSalmonPoint(a, eyeCx + Math.cos(a0) * erx * rr, eyeCy + Math.sin(a0) * ery * rr, 0, idxRef, "eye", birdCx, birdCy, pulseMul);
      }
    }

    // Beak — narrow hooked profile (sharp silhouette forward of the eye)
    const beakCx = birdCx + s * 0.32;
    const beakCy = birdCy - s * 0.025;
    const beakSteps = 72;
    for (let bi = 0; bi < beakSteps; bi++) {
      const u = bi / Math.max(1, beakSteps - 1);
      const bx = beakCx + u * s * 0.24;
      const by = beakCy + (u * u * 0.28 - 0.12) * s * 0.2;
      for (let shell = 0; shell < 5; shell++) {
        const off = (shell - 2) * 0.009 * s;
        pushSalmonPoint(
          a,
          bx,
          by + off,
          shell < 2 ? 0 : 1,
          idxRef,
          "beak",
          birdCx,
          birdCy,
          pulseMul,
          1
        );
      }
    }

    // Talon hooks (small U clusters)
    const talSpecs = [
      { fx: birdCx - s * 0.06, fy: birdCy + s * 0.16, R: s * 0.065, a0: Math.PI * 0.15, span: Math.PI * 0.65 },
      { fx: birdCx + s * 0.02, fy: birdCy + s * 0.17, R: s * 0.058, a0: Math.PI * 0.12, span: Math.PI * 0.58 },
    ];
    for (const tal of talSpecs) {
      const ts = 120;
      for (let k = 0; k < ts; k++) {
        const u = k / (ts - 1);
        const ang = tal.a0 + u * tal.span;
        const ox = Math.cos(ang);
        const oy = Math.sin(ang);
        for (const rr of [1.0, 0.88, 0.76]) {
          pushSalmonPoint(a, tal.fx + ox * tal.R * rr, tal.fy + oy * tal.R * rr, rr >= 0.95 ? 0 : 1, idxRef, "talon", birdCx, birdCy, pulseMul);
        }
      }
    }

    return a;
  }

  /**
   * Level 2 Orca (KW’ÉTL’EN): high-density formline U clusters — massive dorsal, ovoid eye,
   * broad tail fluke — on a torpedo body (same point schema as Salmon for harvest / activation).
   */
  function drawOrca(offsetY = 0) {
    const a = [];
    const idxRef = { i: 0 };
    const ocCx = cx;
    const ocCy = orcaStackY + offsetY;
    const swell = 0.93 + 0.17 * amp;
    const s = S * swell * 1.08;
    const pulseMul = 0.94 + ((scaleMultiplier - 0.88) / 0.22) * 0.11;

    const bodyRx = s * 0.58;
    const bodyRy = s * 0.28;
    const insideBody = (px, py) => {
      const dx = (px - ocCx) / bodyRx;
      const dy = (py - ocCy) / bodyRy;
      return dx * dx + dy * dy <= 0.98;
    };

    const rhoOr = Math.sqrt(5);
    const orGrid = (s * 0.026) / rhoOr;

    // —— Body: thick solid torpedo bands + interior mass (~5× density)
    const thetaSteps = 720;
    for (let ti = 0; ti < thetaSteps; ti++) {
      const theta = (ti / thetaSteps) * TWO_PI;
      const vx = Math.cos(theta) * bodyRx;
      const vy = Math.sin(theta) * bodyRy;
      for (let rf = 0.65; rf <= 1.001; rf += 0.014) {
        pushSalmonPoint(a, ocCx + vx * rf, ocCy + vy * rf, 0, idxRef, "body", ocCx, ocCy, pulseMul, 2);
      }
      for (let rf = 0.05; rf <= 0.69; rf += 0.026) {
        pushSalmonPoint(a, ocCx + vx * rf, ocCy + vy * rf, 1, idxRef, "body", ocCx, ocCy, pulseMul, 2);
      }
    }

    const gw = bodyRx * 2.05;
    const gh = bodyRy * 2.05;
    let gx = ocCx - gw * 0.5;
    while (gx < ocCx + gw * 0.52) {
      let gy = ocCy - gh * 0.52;
      while (gy < ocCy + gh * 0.52) {
        if (insideBody(gx, gy)) {
          pushSalmonPoint(a, gx, gy, 1, idxRef, "body", ocCx, ocCy, pulseMul, 2);
        }
        gy += orGrid;
      }
      gx += orGrid;
    }

    /** Trace a formline U: arc samples × radial shells × lateral thickness (NW Coast stacked U). */
    const pushFormlineU = (uCx, uCy, R, a0, span, arcSteps, radials, marking, soulPriFn) => {
      for (let k = 0; k < arcSteps; k++) {
        const u = arcSteps <= 1 ? 0 : k / (arcSteps - 1);
        const ang = a0 + u * span;
        const ox = Math.cos(ang);
        const oy = Math.sin(ang);
        for (const rr of radials) {
          const fo = rr >= radials[0] * 0.94 ? 0 : 1;
          const sp = typeof soulPriFn === "function" ? soulPriFn(rr, fo) : 2;
          pushSalmonPoint(
            a,
            uCx + ox * R * rr,
            uCy + oy * R * rr,
            fo,
            idxRef,
            marking,
            ocCx,
            ocCy,
            pulseMul,
            sp
          );
        }
      }
    };

    // —— Massive dorsal fin: tall nested U-shapes (primary Orca silhouette — boosted for Spiral targeting)
    const dorsalRadials = [
      1.0, 0.99, 0.97, 0.95, 0.93, 0.9, 0.87, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.59, 0.54, 0.49, 0.44,
    ];
    const dCx = ocCx - s * 0.02;
    const dCy = ocCy - s * 0.48;
    const dR = s * 0.78;
    const arcD = (n) => Math.max(28, Math.round(n * rhoOr));
    pushFormlineU(dCx, dCy, dR, Math.PI * 1.18, Math.PI * 0.62, arcD(150), dorsalRadials, "dorsal", (rr, fo) =>
      fo === 0 ? 1 : 2
    );
    pushFormlineU(dCx - s * 0.02, dCy + s * 0.04, dR * 0.88, Math.PI * 1.2, Math.PI * 0.55, arcD(120), dorsalRadials.slice(0, 11), "dorsal", () => 2);

    // Inner spine ridge U (tighter, reinforces fin silhouette)
    const d2Cx = ocCx + s * 0.02;
    const d2Cy = ocCy - s * 0.12;
    const d2R = s * 0.36;
    pushFormlineU(d2Cx, d2Cy, d2R, Math.PI * 1.08, Math.PI * 0.48, arcD(96), [1.0, 0.94, 0.88, 0.82, 0.75, 0.68], "dorsal", (rr) => (rr >= 0.94 ? 1 : 2));

    // —— Broad tail fluke: wide posterior U + secondary lower lobe U (spiral silhouette anchors)
    const tailRadials = [1.0, 0.97, 0.94, 0.9, 0.85, 0.8, 0.74, 0.68, 0.62, 0.55];
    const tCx = ocCx - s * 0.58;
    const tCy = ocCy + s * 0.06;
    const tR = s * 0.55;
    pushFormlineU(tCx, tCy, tR, Math.PI * 0.22, Math.PI * 0.92, arcD(168), tailRadials, "tail", (rr, fo) =>
      fo === 0 ? 1 : 2
    );
    const t2Cx = ocCx - s * 0.52;
    const t2Cy = ocCy + s * 0.14;
    const t2R = s * 0.36;
    pushFormlineU(t2Cx, t2Cy, t2R, Math.PI * 0.38, Math.PI * 0.62, arcD(128), tailRadials.slice(0, 8), "tail", () => 2);
    const t3Cx = ocCx - s * 0.55;
    const t3Cy = ocCy + s * 0.2;
    const t3R = s * 0.22;
    pushFormlineU(t3Cx, t3Cy, t3R, Math.PI * 0.35, Math.PI * 0.45, arcD(72), [1.0, 0.9, 0.82, 0.74], "tail", () => 2);

    // —— Ovoid eye — solid cluster
    const eyeCx = ocCx + s * 0.34;
    const eyeCy = ocCy - s * 0.04;
    const erx = s * 0.15;
    const ery = s * 0.11;
    const eyeSteps = 640;
    for (let ei = 0; ei < eyeSteps; ei++) {
      const a0 = (ei / eyeSteps) * TWO_PI;
      for (let rr = 1.0; rr >= 0.54; rr -= 0.018) {
        pushSalmonPoint(
          a,
          eyeCx + Math.cos(a0) * erx * rr,
          eyeCy + Math.sin(a0) * ery * rr,
          0,
          idxRef,
          "eye",
          ocCx,
          ocCy,
          pulseMul,
          0
        );
      }
    }

    // —— Blowhole: dense formline ovoid (spirit vent)
    const blowCx = ocCx + s * 0.08;
    const blowCy = ocCy - s * 0.33;
    const blowRx = s * 0.1;
    const blowRy = s * 0.076;
    const blowSteps = 280;
    for (let bi = 0; bi < blowSteps; bi++) {
      const ba = (bi / blowSteps) * TWO_PI;
      for (let br = 1.0; br >= 0.5; br -= 0.028) {
        pushSalmonPoint(
          a,
          blowCx + Math.cos(ba) * blowRx * br,
          blowCy + Math.sin(ba) * blowRy * br,
          0,
          idxRef,
          "blowhole",
          ocCx,
          ocCy,
          pulseMul,
          0
        );
      }
    }

    // —— Pectoral flipper U (single broad marking)
    const pecCx = ocCx + s * 0.08;
    const pecCy = ocCy + s * 0.16;
    const pecR = s * 0.2;
    pushFormlineU(pecCx, pecCy, pecR, Math.PI * 0.55, Math.PI * 0.62, arcD(56), [1.0, 0.92, 0.84, 0.76, 0.68], "body", () => 1);

    return a;
  }

  /** Full pole: all three carved blocks always generated (persistent harvest indices). */
    let salmonPts = capTotemLevelPoints(1, drawSalmon(0));
    ptsByLevel[1] = salmonPts;
    syncTotemLockCounts(salmonPts.length);
    syncTotemActivatedForLevel(1, salmonPts.length);
    const act1 = totemActivatedByLevel[1];
    for (let si = 0; si < salmonPts.length; si++) {
      salmonPts[si].active = !!act1[si];
    }

    const orcaPts = capTotemLevelPoints(2, drawOrca(0));
    ptsByLevel[2] = orcaPts;
    syncTotemActivatedForLevel(2, orcaPts.length);
    const act2 = totemActivatedByLevel[2];
    for (let oi = 0; oi < orcaPts.length; oi++) {
      orcaPts[oi].active = !!act2[oi];
    }

    const ospreyPts = capTotemLevelPoints(3, drawOsprey(0));
    ptsByLevel[3] = ospreyPts;
    syncTotemActivatedForLevel(3, ospreyPts.length);
    const act3 = totemActivatedByLevel[3];
    for (let oi = 0; oi < ospreyPts.length; oi++) {
      ospreyPts[oi].active = !!act3[oi];
    }

    totemPointsByLevel = ptsByLevel;
    if (totemLevel === 1) totemPoints = salmonPts;
    else if (totemLevel === 2) totemPoints = ptsByLevel[2] ?? salmonPts;
    else totemPoints = ptsByLevel[3] ?? ptsByLevel[2] ?? salmonPts;

    for (let lv = 1; lv <= 3; lv++) {
      const arr = totemPointsByLevel[lv];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p._y0 = p.y;
      }
    }

    totemPointsFrozen = true;
    totemCacheDirty = true;
  }

  const L = totemLayout;
  if (!L) return { phase, breath01, scaleMultiplier: scaleMultiplierLive };

  const poleFootY = L.poleFootY;
  const blockH = L.blockH;
  const S = L.S;
  const salmonStackY = L.salmonStackY;
  const orcaStackY = L.orcaStackY;
  const ospreyStackY = L.ospreyStackY;
  const cx = L.cx;

  const trans = levelTransition?.active ? levelTransition : null;
  const prog = trans ? Math.min(1, Math.max(0, (nowMs - trans.startMs) / Math.max(1, trans.durationMs))) : 1;
  const easeT = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
  const kTrans = easeT(prog);

  const camTargetForLevel = (lv) => {
    const fy =
      lv <= 1 ? salmonStackY - S * 0.06 : lv === 2 ? orcaStackY : ospreyStackY;
    return h * 0.5 - fy;
  };

  let camTarget = camTargetForLevel(totemLevel);
  if (trans?.active && trans.fromLevel === 1 && trans.toLevel === 2) {
    camTarget = lerp(camTargetForLevel(1), camTargetForLevel(2), kTrans);
  } else if (trans?.active && trans.fromLevel === 2 && trans.toLevel === 3) {
    camTarget = lerp(camTargetForLevel(2), camTargetForLevel(3), kTrans);
  }

  const camLerp = dtGenMs < 1 ? 1 : 1 - Math.exp(-dtGenMs * 0.0035);
  if (dtGenMs < 1) totemCameraY = camTarget;
  else totemCameraY += (camTarget - totemCameraY) * camLerp;

  if (trans?.active && prog >= 1) {
    levelTransition.active = false;
  }

  const viewCamY = totemCameraY + (typeof globalCameraY === "number" ? globalCameraY : 0);

  syncTotemPointActiveFlags();

  if (typeof totemOrcaAscensionGhostRamp === "function") {
    const gr = totemOrcaAscensionGhostRamp(nowMs);
    if (typeof totemLevel === "number" && totemLevel >= 2 && gr < 0.998) totemCacheDirty = true;
  }

  if (trans?.active && prog < 1) totemCacheDirty = true;

  if (totemCacheDirty) {
    ensureTotemOffscreen(w, h);
    redrawTotemCache(L, nowMs);
    totemCacheDirty = false;
  }

  for (let lv = 1; lv <= 3; lv++) {
    const arr = totemPointsByLevel[lv];
    if (!arr) continue;
    const slide =
      typeof totemCompletedTierSlidePx === "function"
        ? totemCompletedTierSlidePx(lv, blockH, nowMs)
        : 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (p._y0 !== undefined) p.y = p._y0 + viewCamY + slide;
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.translate(0, viewCamY);
  drawMasterTotemLog(ctx, w, h, breath01, nowMs);
  ctx.restore();

  ctx.strokeStyle = "rgba(28, 25, 23, 0.42)";
  ctx.lineWidth = 2;
  for (let b = 1; b <= 2; b++) {
    const seamY = poleFootY - blockH * b + viewCamY;
    ctx.beginPath();
    ctx.moveTo(cx - Math.min(w, h) * 0.44, seamY);
    ctx.quadraticCurveTo(cx, seamY + 5, cx + Math.min(w, h) * 0.44, seamY);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(0, viewCamY);
  ctx.globalAlpha = TOTEM_LAYER_COMPOSITE_ALPHA;
  ctx.drawImage(totemOffscreen, 0, 0);
  ctx.restore();

  ctx.restore();

  return { phase, breath01, scaleMultiplier: scaleMultiplierLive };
}

