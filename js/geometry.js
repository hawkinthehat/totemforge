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
/** Cedar plank vertical gradient (dark → warm lift). */
const MASTER_LOG_CEDAR_TOP = "#3e2723";
const MASTER_LOG_CEDAR_BOT = "#5d4037";

/**
 * Screen Y fraction of Master Log center — matches live layout when `totemLayout` is set (snag aim fallback in config).
 */
function totemMasterLogCenterYFrac() {
  const winH = typeof window !== "undefined" ? window.innerHeight || 1 : 1;
  if (totemLayout?.masterLogCy != null && typeof totemLayout.h === "number" && totemLayout.h > 0) {
    return totemLayout.masterLogCy / totemLayout.h;
  }
  return typeof CEDAR_SNAG_TRAVEL_TARGET_Y_FRAC === "number" ? CEDAR_SNAG_TRAVEL_TARGET_Y_FRAC : 0.78;
}

if (typeof window !== "undefined") window.totemMasterLogCenterYFrac = totemMasterLogCenterYFrac;

/**
 * High-performance Master Log: cedar gradient, vertical grain, drop shadow; breath = horizontal scale only.
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
  const logH = viewH * MASTER_LOG_HEIGHT_FRAC;
  const cy =
    totemLayout?.masterLogCy != null
      ? totemLayout.masterLogCy * (viewH / Math.max(1, totemLayout.h || viewH))
      : viewH * totemMasterLogCenterYFrac();
  const logW = MASTER_LOG_WIDTH_PX;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
  const amp = ease(typeof breath01 === "number" ? breath01 : 0);
  const scaleX = MASTER_LOG_SCALE_X_MIN + (MASTER_LOG_SCALE_X_MAX - MASTER_LOG_SCALE_X_MIN) * amp;

  const left = cx - logW * 0.5;
  const top = cy - logH * 0.5;
  const rad = 10;

  ctx2.save();
  ctx2.translate(cx, cy);
  ctx2.scale(scaleX, 1);
  ctx2.translate(-cx, -cy);

  ctx2.shadowColor = "rgba(0,0,0,0.5)";
  ctx2.shadowBlur = 36;
  ctx2.shadowOffsetY = 16;
  ctx2.shadowOffsetX = 0;

  const practiceLog =
    typeof totemPracticeMode !== "undefined" && totemPracticeMode;
  const logTop = practiceLog ? "#fef3c7" : MASTER_LOG_CEDAR_TOP;
  const logBot = practiceLog ? "#fde68a" : MASTER_LOG_CEDAR_BOT;

  const grad = ctx2.createLinearGradient(cx, top, cx, top + logH);
  grad.addColorStop(0, logTop);
  grad.addColorStop(1, logBot);
  ctx2.fillStyle = grad;
  ctx2.globalAlpha = 0.92;
  ctx2.beginPath();
  if (typeof ctx2.roundRect === "function") {
    ctx2.roundRect(left, top, logW, logH, rad);
  } else {
    ctx2.moveTo(left + rad, top);
    ctx2.lineTo(left + logW - rad, top);
    ctx2.quadraticCurveTo(left + logW, top, left + logW, top + rad);
    ctx2.lineTo(left + logW, top + logH - rad);
    ctx2.quadraticCurveTo(left + logW, top + logH, left + logW - rad, top + logH);
    ctx2.lineTo(left + rad, top + logH);
    ctx2.quadraticCurveTo(left, top + logH, left, top + logH - rad);
    ctx2.lineTo(left, top + rad);
    ctx2.quadraticCurveTo(left, top, left + rad, top);
    ctx2.closePath();
  }
  ctx2.fill();

  ctx2.shadowColor = "transparent";
  ctx2.shadowBlur = 0;
  ctx2.shadowOffsetY = 0;

  const grainCount = 13;
  const marginX = 12;
  const x0 = left + marginX;
  const x1 = left + logW - marginX;
  const span = Math.max(1, x1 - x0);
  const yTop = top + 8;
  const yBot = top + logH - 8;
  ctx2.lineCap = "butt";
  for (let i = 0; i < grainCount; i++) {
    const t = (i + 1) / (grainCount + 1);
    const gx = x0 + span * t;
    const jitter = Math.sin(i * 9.17 + 2.3) * 0.65;
    const gxJ = gx + jitter;
    const a = 0.08 + (i % 3) * 0.028;
    const grainRgb = practiceLog ? "120, 90, 40" : "28, 18, 14";
    ctx2.strokeStyle = `rgba(${grainRgb}, ${a})`;
    ctx2.lineWidth = i % 4 === 0 ? 1.15 : 0.75;
    ctx2.beginPath();
    ctx2.moveTo(gxJ, yTop);
    ctx2.lineTo(gxJ + Math.sin(i * 1.7) * 0.4, yBot);
    ctx2.stroke();
  }
  ctx2.strokeStyle = practiceLog ? "rgba(161, 98, 7, 0.16)" : "rgba(93, 64, 55, 0.14)";
  ctx2.lineWidth = 1;
  for (let r = 0; r < 3; r++) {
    const yy = top + logH * (0.22 + r * 0.28);
    ctx2.beginPath();
    ctx2.moveTo(left + 18, yy);
    ctx2.quadraticCurveTo(cx, yy + (r - 1) * 2.5, left + logW - 18, yy + 1);
    ctx2.stroke();
  }

  ctx2.globalAlpha = 1;

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

/** Live snag: not expired (`isDead`), valid position. */
function totemCedarSnagIsActive(t) {
  if (!t || t.isDead) return false;
  if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) return false;
  return true;
}

/**
 * Nearest active Cedar Snag in CSS px (Spirit Eye / KW’ÉKW’E).
 * When forging the apex tier, only snags tagged for tier 3 are considered so stray lower-tier echoes are ignored.
 */
function totemNearestSnagToPoint(px, py) {
  if (typeof tomahawks === "undefined" || !Array.isArray(tomahawks) || tomahawks.length === 0) return null;
  const apexOnly =
    typeof forgeTargetLevel === "number" &&
    forgeTargetLevel === 3 &&
    typeof getForgeMotorTier === "function" &&
    getForgeMotorTier() === 3 &&
    typeof normalizeSnagTotemLevel === "function";
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < tomahawks.length; i++) {
    const t = tomahawks[i];
    if (!totemCedarSnagIsActive(t)) continue;
    if (apexOnly && normalizeSnagTotemLevel(t.snagTotemLevel) !== 3) continue;
    const dx = t.x - px;
    const dy = t.y - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (best) return best;
  if (!apexOnly) return null;
  for (let j = 0; j < tomahawks.length; j++) {
    const t2 = tomahawks[j];
    if (!totemCedarSnagIsActive(t2)) continue;
    const dx = t2.x - px;
    const dy = t2.y - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = t2;
    }
  }
  return best;
}

/** Faint silver silhouette of the active Salish tier on the cedar plank (ghost before carve reads). */
function drawTotemAnimalGhostOutline(ctx2, L, breath01, viewCamY = 0) {
  if (!ctx2 || !L || typeof totemLevel !== "number") return;
  const lv =
    typeof totemAppPhase === "string" &&
    typeof TOTEM_PHASE_FORGE !== "undefined" &&
    totemAppPhase === TOTEM_PHASE_FORGE &&
    typeof forgeTargetLevel === "number"
      ? forgeTargetLevel
      : totemLevel;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
  const amp = ease(typeof breath01 === "number" ? breath01 : 0);
  const S = L.S;
  const cx = L.cx;
  const salmonStackY = L.salmonStackY;
  const orcaStackY = L.orcaStackY;
  const ospreyStackY = L.ospreyStackY;

  const forgeEmphasis =
    typeof totemAppPhase === "string" &&
    typeof TOTEM_PHASE_FORGE !== "undefined" &&
    totemAppPhase === TOTEM_PHASE_FORGE;

  ctx2.save();
  const silAlpha = (forgeEmphasis ? 0.22 : 0.1) + (forgeEmphasis ? 0.12 : 0.07) * amp;
  ctx2.strokeStyle = `rgba(226, 232, 240, ${silAlpha})`;
  ctx2.fillStyle = `rgba(226, 232, 240, ${silAlpha * 0.35})`;
  ctx2.lineWidth = Math.max(forgeEmphasis ? 2.4 : 1.15, S * (forgeEmphasis ? 0.028 : 0.016));
  ctx2.lineJoin = "round";

  if (lv === 1) {
    const swell = 0.92 + 0.18 * L.amp;
    const s = S * swell;
    const fishCx = cx;
    const fishCy = salmonStackY - s * 0.06;
    ctx2.beginPath();
    ctx2.ellipse(fishCx, fishCy, s * 0.52, s * 0.21, 0, 0, TWO_PI);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.ellipse(fishCx + s * 0.33, fishCy - s * 0.06, s * 0.12, s * 0.08, 0, 0, TWO_PI);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.moveTo(fishCx - s * 0.55, fishCy + s * 0.04);
    ctx2.quadraticCurveTo(fishCx - s * 0.7, fishCy + s * 0.1, fishCx - s * 0.6, fishCy + s * 0.16);
    ctx2.stroke();
  } else if (lv === 2) {
    const swell = 0.93 + 0.17 * L.amp;
    const s = S * swell * 1.08;
    const ocCx = cx;
    const ocCy = orcaStackY;
    const img =
      typeof window !== "undefined" && window.totemTripleOrcaGhostImg && window.totemTripleOrcaGhostImg.complete
        ? window.totemTripleOrcaGhostImg
        : null;
    if (img && img.naturalWidth > 0) {
      const dw = s * 1.62;
      const dh = s * 1.08;
      ctx2.globalAlpha = Math.min(0.95, silAlpha * 3.2);
      ctx2.drawImage(img, ocCx - dw * 0.5, ocCy - dh * 0.5, dw, dh);
    } else {
      const bodyRx = s * 0.58;
      const bodyRy = s * 0.28;
      const drawRing = (rx, ry) => {
        ctx2.beginPath();
        ctx2.ellipse(ocCx, ocCy, rx, ry, 0, 0, TWO_PI);
        ctx2.stroke();
      };
      drawRing(bodyRx, bodyRy);
      drawRing(bodyRx * 0.62, bodyRy * 0.62);
      drawRing(bodyRx * 0.34, bodyRy * 0.34);
      const dCx = ocCx - s * 0.02;
      const dCy = ocCy - s * 0.48;
      const dR = s * 0.78;
      ctx2.beginPath();
      ctx2.arc(dCx, dCy, dR, Math.PI * 1.18, Math.PI * 1.18 + Math.PI * 0.62);
      ctx2.stroke();
    }
  } else {
    const swell = 0.9 + 0.2 * L.amp;
    const s = S * swell * 0.92;
    const birdCx = cx;
    const birdCy = ospreyStackY;
    const eyeCy = birdCy - s * 0.055;
    const eyeDx = s * 0.15;
    const erx = s * 0.11;
    const ery = s * 0.078;
    const spiritFrac =
      typeof TOTEM_SPIRIT_EYE_FILL_FRAC === "number" ? TOTEM_SPIRIT_EYE_FILL_FRAC : 0.9;
    const spiritEye =
      forgeEmphasis &&
      typeof forgeTargetLevel === "number" &&
      forgeTargetLevel === 3 &&
      typeof totemTierFillRatio === "function" &&
      totemTierFillRatio(3) >= spiritFrac;

    ctx2.beginPath();
    ctx2.ellipse(birdCx, birdCy, s * 0.2, s * 0.11, 0, 0, TWO_PI);
    ctx2.stroke();
    for (const side of [-1, 1]) {
      ctx2.beginPath();
      ctx2.ellipse(birdCx + side * s * 0.56, birdCy + s * 0.02, s * 0.58, s * 0.22, side * 0.12, 0, TWO_PI);
      ctx2.stroke();
    }

    for (const side of [-1, 1]) {
      const eyeCx = birdCx + side * eyeDx;
      let eyeRot = 0;
      if (spiritEye) {
        const snag = totemNearestSnagToPoint(eyeCx, eyeCy + viewCamY);
        if (snag) {
          eyeRot = Math.atan2(snag.y - (eyeCy + viewCamY), snag.x - eyeCx);
        }
      }
      ctx2.save();
      ctx2.translate(eyeCx, eyeCy);
      ctx2.rotate(eyeRot);
      ctx2.beginPath();
      ctx2.ellipse(0, 0, erx, ery, 0, 0, TWO_PI);
      ctx2.stroke();
      if (spiritEye) {
        ctx2.globalAlpha = Math.min(0.95, silAlpha * 2.8);
        ctx2.fillStyle = `rgba(248, 250, 252, ${silAlpha * 0.5})`;
        ctx2.beginPath();
        ctx2.ellipse(side * erx * 0.22, 0, erx * 0.12, ery * 0.35, 0, 0, TWO_PI);
        ctx2.fill();
      }
      ctx2.restore();
    }
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
  const poleFootY = h * 0.993;
  const blockH = S * 2.32;
  const groundY =
    typeof TOTEM_MOBILE_GROUND_OFFSET_FRAC === "number" ? h * TOTEM_MOBILE_GROUND_OFFSET_FRAC : 0;
  /** Tight to the virtual foot so the Salmon base sits low — pole reads as rising from the hand. */
  const salmonStackY = poleFootY - blockH * 0.11 + groundY;
  const orcaStackY = salmonStackY - blockH;
  const ospreyStackY = orcaStackY - blockH;
  const logH = h * MASTER_LOG_HEIGHT_FRAC;
  const logBottom = Math.min(h * 0.991, poleFootY + blockH * 0.05) + groundY * 0.35;
  const masterLogCy = logBottom - logH * 0.5;
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
    masterLogCy,
    logH,
  };
}

function capTotemLevelPoints(level, arr) {
  let maxN = TOTEM_MAX_POINTS_PER_ANIMAL;
  if (level === 2 && typeof TOTEM_ORCA_MAX_TRIGGER_POINTS === "number") maxN = TOTEM_ORCA_MAX_TRIGGER_POINTS;
  if (level === 3 && typeof TOTEM_OSPREY_MAX_TRIGGER_POINTS === "number") maxN = TOTEM_OSPREY_MAX_TRIGGER_POINTS;
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

function _totemMixHex(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const A = p(a);
  const B = p(b);
  const L = (i) =>
    Math.max(0, Math.min(255, Math.round(A[i] + (B[i] - A[i]) * u)))
      .toString(16)
      .padStart(2, "0");
  return `#${L(0)}${L(1)}${L(2)}`;
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
    marking === "blowhole" ||
    marking === "ring" ||
    marking === "ringBridge" ||
    marking === "triggerZone" ||
    marking === "wingtip";

  const forgeSilverGhost =
    typeof totemAppPhase === "string" &&
    typeof TOTEM_PHASE_FORGE !== "undefined" &&
    totemAppPhase === TOTEM_PHASE_FORGE;
  const ghostRgb = forgeSilverGhost ? "226, 232, 240" : "170, 182, 195";

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

  let carveDeep = "#0c0a09";
  let carveMid = "#991b1b";
  let liftRgb = "185, 28, 28";
  let rimStrokeDeep = "12, 10, 9";
  let rimStrokeLift = "220, 38, 38";
  let ospreyFinaleGlow = false;

  if (level === 3 && typeof totemTierFillRatio === "function") {
    const fr = totemTierFillRatio(3);
    const CR = "#991b1b";
    const TL = "#14b8a6";
    const TL_D = "#0f766e";
    const TL_HI = "#5eead4";
    if (fr < 0.4) {
      carveMid = CR;
      carveDeep = "#1a0909";
      liftRgb = "185, 28, 28";
    } else if (fr < 0.9) {
      const k = 0.5 - 0.5 * Math.cos((Math.PI * (fr - 0.4)) / 0.5);
      carveMid = _totemMixHex(CR, TL, k);
      carveDeep = _totemMixHex("#2a0a0a", TL_D, k);
      const lr = Math.round(185 + (45 - 185) * k);
      const lg = Math.round(28 + (212 - 28) * k);
      const lb = Math.round(28 + (184 - 28) * k);
      liftRgb = `${lr}, ${lg}, ${lb}`;
      rimStrokeLift = `${Math.round(220 - 40 * k)}, ${Math.round(38 + 180 * k)}, ${Math.round(38 + 170 * k)}`;
    } else {
      const k = (fr - 0.9) / 0.1;
      const e = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));
      carveMid = _totemMixHex(TL, "#e2e8f0", e * 0.45);
      carveDeep = _totemMixHex(TL_D, "#0c4a44", e * 0.35);
      liftRgb = `${Math.round(20 + 235 * e)}, ${Math.round(184 + 68 * e)}, ${Math.round(166 + 86 * e)}`;
      rimStrokeDeep = `${Math.round(12 + 200 * e)}, ${Math.round(10 + 230 * e)}, ${Math.round(9 + 240 * e)}`;
      rimStrokeLift = `${Math.round(94 + 160 * e)}, ${Math.round(234 + 20 * e)}, ${Math.round(212 + 40 * e)}`;
      ospreyFinaleGlow = fr >= 0.9 && (marking === "eye" || marking === "wingtip");
    }
  }

  c.fillStyle = carveDeep;
  c.beginPath();
  c.arc(px + baseR * 0.11, py + baseR * 0.09, baseR * 0.93, 0, TWO_PI);
  c.fill();
  c.fillStyle = carveMid;
  c.beginPath();
  c.arc(px - baseR * 0.03, py - baseR * 0.02, baseR * 0.8, 0, TWO_PI);
  c.fill();
  const liftA = pa * (0.82 + glow * 0.18);
  c.fillStyle = `rgba(${liftRgb}, ${liftA})`;
  c.beginPath();
  c.arc(px - baseR * 0.2, py - baseR * 0.17, baseR * (rimLike ? 0.46 : 0.34), 0, TWO_PI);
  c.fill();
  if (rimLike) {
    c.strokeStyle = `rgba(${rimStrokeDeep}, ${pa * 0.94})`;
    c.lineWidth = Math.max(0.65, baseR * 0.22);
    c.beginPath();
    c.arc(px, py, baseR * 0.58, 0.52, TWO_PI - 0.52);
    c.stroke();
    c.strokeStyle = `rgba(${rimStrokeLift}, ${pa * 0.42})`;
    c.lineWidth = Math.max(0.35, baseR * 0.1);
    c.beginPath();
    c.arc(px - baseR * 0.06, py - baseR * 0.05, baseR * 0.42, 0.65, TWO_PI - 0.65);
    c.stroke();
  }
  if (level === 3 && ospreyFinaleGlow && on) {
    c.strokeStyle = `rgba(248, 250, 252, ${pa * 0.88})`;
    c.lineWidth = Math.max(0.5, baseR * 0.16);
    c.beginPath();
    c.arc(px + baseR * 0.02, py - baseR * 0.06, baseR * 0.52, 0.45, TWO_PI - 0.45);
    c.stroke();
    c.strokeStyle = `rgba(226, 232, 240, ${pa * 0.55})`;
    c.lineWidth = Math.max(0.35, baseR * 0.09);
    c.beginPath();
    c.arc(px - baseR * 0.12, py + baseR * 0.04, baseR * 0.28, 0.2, TWO_PI - 0.2);
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

  /**
   * Level 3 KW’ÉKW’E (Osprey) Master Finale mesh: Salish-forward silhouette, dense stacked U
   * trigger zones on wings + tail for granular harvest (capped via TOTEM_OSPREY_MAX_TRIGGER_POINTS).
   */
  function drawOsprey(offsetY = 0) {
    const a = [];
    const idxRef = { i: 0 };
    const anchorY = ospreyStackY + offsetY;
    const swell = 0.9 + 0.2 * amp;
    const s = S * swell * 0.94;
    const birdCx = cx;
    const birdCy = anchorY;
    const pulseMul = 0.94 + ((scaleMultiplier - 0.88) / 0.22) * 0.1;

    const insideWing = (px, py, side) => {
      const wx = birdCx + side * s * 0.5;
      const wy = birdCy + s * 0.02;
      const dx = (px - wx) / (s * 0.64);
      const dy = (py - wy) / (s * 0.25);
      return dx * dx + dy * dy <= 1.05;
    };

    const rhoO = Math.sqrt(5);
    const wingGrid = (s * 0.0165) / rhoO;

    const pushMiniU = (ux, uy, R, a0, span, markTip) => {
      const steps = 22;
      const radials = [1.0, 0.94, 0.87, 0.81, 0.74];
      for (let k = 0; k < steps; k++) {
        const u = steps <= 1 ? 0 : k / (steps - 1);
        const ang = a0 + u * span;
        const ox = Math.cos(ang);
        const oy = Math.sin(ang);
        for (let ri = 0; ri < radials.length; ri++) {
          const rr = radials[ri];
          const fo = ri === 0 ? 0 : 1;
          const tip = markTip && ri === 0 && (k === 0 || k === steps - 1);
          pushSalmonPoint(
            a,
            ux + ox * R * rr,
            uy + oy * R * rr,
            fo,
            idxRef,
            tip ? "wingtip" : "triggerZone",
            birdCx,
            birdCy,
            pulseMul,
            fo === 0 ? 1 : 2
          );
        }
      }
    };

    const bodySteps = 560;
    for (let ti = 0; ti < bodySteps; ti++) {
      const theta = (ti / bodySteps) * TWO_PI;
      const bx = birdCx + Math.cos(theta) * s * 0.21;
      const by = birdCy + Math.sin(theta) * s * 0.12;
      const vx = bx - birdCx;
      const vy = by - birdCy;
      for (let rf = 0.72; rf <= 1.001; rf += 0.016) {
        pushSalmonPoint(
          a,
          birdCx + vx * rf,
          birdCy + vy * rf,
          rf >= 0.97 ? 0 : 1,
          idxRef,
          "body",
          birdCx,
          birdCy,
          pulseMul,
          rf >= 0.97 ? 1 : 2
        );
      }
    }

    for (const side of [-1, 1]) {
      let gx = birdCx + side * s * 0.14;
      const xEnd = side < 0 ? birdCx - s * 0.86 : birdCx + s * 0.86;
      let col = 0;
      while ((side < 0 && gx > xEnd) || (side > 0 && gx < xEnd)) {
        let gy = birdCy - s * 0.38;
        let row = 0;
        while (gy < birdCy + s * 0.36) {
          if (insideWing(gx, gy, side)) {
            const distTip = Math.abs(gx - (birdCx + side * s * 0.82));
            const isTipBand = distTip < s * 0.12;
            const tilt = side * 0.11 * (1 - Math.abs(gy - birdCy) / (s * 0.42));
            const R = s * (0.054 + ((col * 17 + row * 31) % 5) * 0.0024);
            pushMiniU(gx, gy, R, Math.PI * 0.55 + tilt, Math.PI * 0.52, isTipBand);
          }
          gy += wingGrid * 0.92;
          row++;
        }
        gx += side * wingGrid * 1.02;
        col++;
      }
    }

    for (const side of [-1, 1]) {
      let gx = birdCx + side * s * 0.17;
      const xEnd2 = side < 0 ? birdCx - s * 0.82 : birdCx + s * 0.82;
      let col2 = 0;
      while ((side < 0 && gx > xEnd2) || (side > 0 && gx < xEnd2)) {
        let gy = birdCy - s * 0.35;
        let row2 = 0;
        while (gy < birdCy + s * 0.32) {
          if (insideWing(gx, gy, side)) {
            const distTip = Math.abs(gx - (birdCx + side * s * 0.82));
            const isTipBand = distTip < s * 0.14;
            const tilt = side * 0.08 * (1 - Math.abs(gy - birdCy) / (s * 0.44));
            const R = s * (0.036 + ((col2 * 13 + row2 * 29) % 4) * 0.0022);
            pushMiniU(gx, gy, R, Math.PI * 0.62 + tilt, Math.PI * 0.38, isTipBand);
          }
          gy += wingGrid * 0.88;
          row2++;
        }
        gx += side * wingGrid * 0.52;
        col2++;
      }
    }

    for (let ti = 0; ti < 11; ti++) {
      const u0 = ti / 10;
      const tx = birdCx + (u0 - 0.5) * s * 0.22;
      const ty = birdCy + s * 0.14 + u0 * s * 0.08;
      const span = Math.PI * 0.42 + u0 * 0.18;
      pushMiniU(tx, ty, s * (0.048 + u0 * 0.018), Math.PI * 0.52, span, ti === 0 || ti === 10);
    }

    for (let di = 0; di < 8; di++) {
      const u = di / 7;
      const sx = birdCx + (u - 0.5) * s * 0.08;
      const sy = birdCy - s * (0.08 + u * 0.22);
      pushMiniU(sx, sy, s * 0.06, Math.PI * 1.02, Math.PI * 0.55, false);
    }

    const eyeCx = birdCx + s * 0.15;
    const eyeCy = birdCy - s * 0.055;
    const erx = s * 0.12;
    const ery = s * 0.082;
    const eyeSteps = 380;
    for (let ei = 0; ei < eyeSteps; ei++) {
      const a0 = (ei / eyeSteps) * TWO_PI;
      for (let rr = 1.0; rr >= 0.56; rr -= 0.028) {
        pushSalmonPoint(a, eyeCx + Math.cos(a0) * erx * rr, eyeCy + Math.sin(a0) * ery * rr, 0, idxRef, "eye", birdCx, birdCy, pulseMul, 0);
      }
    }

    const beakCx = birdCx + s * 0.34;
    const beakCy = birdCy - s * 0.03;
    const beakSteps = 88;
    for (let bi = 0; bi < beakSteps; bi++) {
      const t = bi / Math.max(1, beakSteps - 1);
      const bx = beakCx + t * s * 0.26;
      const by = beakCy + (t * t * 0.32 - 0.14) * s * 0.2;
      for (let shell = 0; shell < 5; shell++) {
        const off = (shell - 2) * 0.0085 * s;
        pushSalmonPoint(a, bx, by + off, shell < 2 ? 0 : 1, idxRef, "beak", birdCx, birdCy, pulseMul, 1);
      }
    }

    const talSpecs = [
      { fx: birdCx - s * 0.07, fy: birdCy + s * 0.17, R: s * 0.068, a0: Math.PI * 0.14, span: Math.PI * 0.66 },
      { fx: birdCx + s * 0.03, fy: birdCy + s * 0.18, R: s * 0.06, a0: Math.PI * 0.11, span: Math.PI * 0.6 },
    ];
    for (const tal of talSpecs) {
      const ts = 110;
      for (let k = 0; k < ts; k++) {
        const u = k / (ts - 1);
        const ang = tal.a0 + u * tal.span;
        const ox = Math.cos(ang);
        const oy = Math.sin(ang);
        for (const rr of [1.0, 0.88, 0.76]) {
          pushSalmonPoint(
            a,
            tal.fx + ox * tal.R * rr,
            tal.fy + oy * tal.R * rr,
            rr >= 0.94 ? 0 : 1,
            idxRef,
            "talon",
            birdCx,
            birdCy,
            pulseMul
          );
        }
      }
    }

    return a;
  }

  /**
   * Level 2 Orca (KW’ÉTL’EN): Triple-Circle v1.3.0 — concentric ovoid rings, annulus trigger fills,
   * radial ring bridges, nested micro-ovoids / fin hooks (dense harvest mesh; capped via TOTEM_ORCA_MAX_TRIGGER_POINTS).
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
    const rMid = 0.62;
    const rInner = 0.34;
    const midRx = bodyRx * rMid;
    const midRy = bodyRy * rMid;
    const innRx = bodyRx * rInner;
    const innRy = bodyRy * rInner;

    const ellDist = (px, py, ecx, ecy, rx, ry) => {
      const dx = (px - ecx) / rx;
      const dy = (py - ecy) / ry;
      return dx * dx + dy * dy;
    };
    const insideEll = (px, py, rx, ry, cap = 1) => ellDist(px, py, ocCx, ocCy, rx, ry) <= cap;

    const rhoOr = Math.sqrt(5);
    const gridStep = (s * 0.0245) / rhoOr;
    const fineStep = (s * 0.021) / rhoOr;

    const pushRingRim = (rx, ry, thetaSteps, radials) => {
      for (let ti = 0; ti < thetaSteps; ti++) {
        const theta = (ti / thetaSteps) * TWO_PI;
        const vx = Math.cos(theta) * rx;
        const vy = Math.sin(theta) * ry;
        for (let ri = 0; ri < radials.length; ri++) {
          const rf = radials[ri];
          const fo = ri === 0 ? 0 : 1;
          const sp = fo === 0 ? 1 : 2;
          pushSalmonPoint(a, ocCx + vx * rf, ocCy + vy * rf, fo, idxRef, "ring", ocCx, ocCy, pulseMul, sp);
        }
      }
    };

    const ringRadials = [1.0, 0.988, 0.975, 0.962, 0.948, 0.934, 0.92];
    pushRingRim(bodyRx, bodyRy, 540, ringRadials);
    pushRingRim(midRx, midRy, 460, ringRadials.slice(0, 6));
    pushRingRim(innRx, innRy, 400, ringRadials.slice(0, 5));

    const gw = bodyRx * 2.1;
    const gh = bodyRy * 2.1;
    let gx = ocCx - gw * 0.5;
    while (gx < ocCx + gw * 0.52) {
      let gy = ocCy - gh * 0.52;
      while (gy < ocCy + gh * 0.52) {
        const dOut = ellDist(gx, gy, ocCx, ocCy, bodyRx, bodyRy);
        const dMidHole = ellDist(gx, gy, ocCx, ocCy, midRx * 0.992, midRy * 0.992);
        if (dOut <= 0.988 && dMidHole >= 1.018) {
          pushSalmonPoint(a, gx, gy, 1, idxRef, "triggerZone", ocCx, ocCy, pulseMul, 2);
        }
        gy += gridStep;
      }
      gx += gridStep;
    }

    gx = ocCx - gw * 0.48;
    while (gx < ocCx + gw * 0.48) {
      let gy = ocCy - gh * 0.48;
      while (gy < ocCy + gh * 0.48) {
        const dM = ellDist(gx, gy, ocCx, ocCy, midRx, midRy);
        const dInHole = ellDist(gx, gy, ocCx, ocCy, innRx * 0.985, innRy * 0.985);
        if (dM <= 0.992 && dInHole >= 1.028) {
          pushSalmonPoint(a, gx, gy, 1, idxRef, "triggerZone", ocCx, ocCy, pulseMul, 2);
        }
        gy += gridStep * 0.94;
      }
      gx += gridStep * 0.94;
    }

    gx = ocCx - innRx * 1.08;
    while (gx < ocCx + innRx * 1.08) {
      let gy = ocCy - innRy * 1.08;
      while (gy < ocCy + innRy * 1.08) {
        if (insideEll(gx, gy, innRx * 0.9, innRy * 0.9, 0.97)) {
          pushSalmonPoint(a, gx, gy, 1, idxRef, "body", ocCx, ocCy, pulseMul, 2);
        }
        gy += fineStep;
      }
      gx += fineStep;
    }

    const bridgeShells = [0.36, 0.48, 0.58, 0.68, 0.78, 0.88, 0.95, 1.0];
    const pushRadialBridges = (phi0, phi1, count) => {
      for (let j = 0; j < count; j++) {
        const u = count <= 1 ? 0.5 : j / (count - 1);
        const phi = phi0 + u * (phi1 - phi0);
        const ox = Math.cos(phi);
        const oy = Math.sin(phi);
        for (let si = 0; si < bridgeShells.length; si++) {
          const f = bridgeShells[si];
          const fo = si >= bridgeShells.length - 2 ? 0 : 1;
          const sp = fo === 0 ? 1 : 2;
          pushSalmonPoint(
            a,
            ocCx + ox * bodyRx * f,
            ocCy + oy * bodyRy * f,
            fo,
            idxRef,
            "ringBridge",
            ocCx,
            ocCy,
            pulseMul,
            sp
          );
        }
      }
    };
    pushRadialBridges(Math.PI * 1.02, Math.PI * 1.58, 22);
    pushRadialBridges(Math.PI * 0.12, Math.PI * 0.42, 14);
    pushRadialBridges(-Math.PI * 0.42, -Math.PI * 0.12, 12);

    const pushFormlineU = (uCx, uCy, R, a0, span, arcSteps, radials, marking, soulPriFn) => {
      for (let k = 0; k < arcSteps; k++) {
        const u = arcSteps <= 1 ? 0 : k / (arcSteps - 1);
        const ang = a0 + u * span;
        const ox = Math.cos(ang);
        const oy = Math.sin(ang);
        for (const rr of radials) {
          const fo = rr >= radials[0] * 0.94 ? 0 : 1;
          const sp = typeof soulPriFn === "function" ? soulPriFn(rr, fo) : 2;
          pushSalmonPoint(a, uCx + ox * R * rr, uCy + oy * R * rr, fo, idxRef, marking, ocCx, ocCy, pulseMul, sp);
        }
      }
    };

    const arcD = (n) => Math.max(24, Math.round(n * rhoOr));
    const dorsalRadials = [1.0, 0.98, 0.95, 0.92, 0.88, 0.84, 0.79, 0.74, 0.68, 0.62, 0.55];
    const dCx = ocCx - s * 0.02;
    const dCy = ocCy - s * 0.44;
    const dR = s * 0.58;
    pushFormlineU(dCx, dCy, dR, Math.PI * 1.14, Math.PI * 0.58, arcD(120), dorsalRadials, "dorsal", (rr, fo) => (fo === 0 ? 1 : 2));
    pushFormlineU(dCx - s * 0.015, dCy + s * 0.035, dR * 0.82, Math.PI * 1.18, Math.PI * 0.48, arcD(88), dorsalRadials.slice(0, 7), "dorsal", () => 2);

    const tailRadials = [1.0, 0.96, 0.91, 0.85, 0.78, 0.7, 0.62];
    const tCx = ocCx - s * 0.52;
    const tCy = ocCy + s * 0.08;
    const tR = s * 0.42;
    pushFormlineU(tCx, tCy, tR, Math.PI * 0.22, Math.PI * 0.82, arcD(112), tailRadials, "tail", (rr, fo) => (fo === 0 ? 1 : 2));

    const pecCx = ocCx + s * 0.1;
    const pecCy = ocCy + s * 0.14;
    const pecR = s * 0.18;
    pushFormlineU(pecCx, pecCy, pecR, Math.PI * 0.52, Math.PI * 0.55, arcD(48), [1.0, 0.92, 0.84, 0.76], "fin", () => 1);
    const pec2Cx = ocCx - s * 0.02;
    const pec2Cy = ocCy + s * 0.12;
    const pec2R = s * 0.14;
    pushFormlineU(pec2Cx, pec2Cy, pec2R, Math.PI * 0.62, Math.PI * 0.48, arcD(40), [1.0, 0.9, 0.8], "fin", () => 1);

    const seedCount = 26;
    for (let si = 0; si < seedCount; si++) {
      const baseAng = (si / seedCount) * TWO_PI + si * 0.19;
      const radF = 0.48 + 0.28 * Math.sin(si * 2.11) + 0.08 * Math.cos(si * 1.37);
      const ecx = ocCx + Math.cos(baseAng) * bodyRx * Math.min(0.94, Math.max(0.22, radF));
      const ecy = ocCy + Math.sin(baseAng) * bodyRy * Math.min(0.94, Math.max(0.22, radF));
      if (ellDist(ecx, ecy, ocCx, ocCy, innRx * 0.88, innRy * 0.88) < 1.0) continue;
      const erx = s * (0.038 + (si % 6) * 0.007);
      const ery = s * (0.024 + (si % 5) * 0.005);
      const es = 44;
      for (let ei = 0; ei < es; ei++) {
        const a0 = (ei / es) * TWO_PI;
        for (let wr = 1.0; wr >= 0.4; wr -= 0.12) {
          const fo = wr >= 0.92 ? 0 : 1;
          pushSalmonPoint(
            a,
            ecx + Math.cos(a0) * erx * wr,
            ecy + Math.sin(a0) * ery * wr,
            fo,
            idxRef,
            "triggerZone",
            ocCx,
            ocCy,
            pulseMul,
            fo === 0 ? 1 : 2
          );
        }
      }
    }

    const eyeCx = ocCx + s * 0.32;
    const eyeCy = ocCy - s * 0.04;
    const erx = s * 0.14;
    const ery = s * 0.1;
    const eyeSteps = 560;
    for (let ei = 0; ei < eyeSteps; ei++) {
      const a0 = (ei / eyeSteps) * TWO_PI;
      for (let rr = 1.0; rr >= 0.54; rr -= 0.02) {
        pushSalmonPoint(a, eyeCx + Math.cos(a0) * erx * rr, eyeCy + Math.sin(a0) * ery * rr, 0, idxRef, "eye", ocCx, ocCy, pulseMul, 0);
      }
    }

    const blowCx = ocCx + s * 0.07;
    const blowCy = ocCy - s * 0.3;
    const blowRx = s * 0.09;
    const blowRy = s * 0.07;
    const blowSteps = 240;
    for (let bi = 0; bi < blowSteps; bi++) {
      const ba = (bi / blowSteps) * TWO_PI;
      for (let br = 1.0; br >= 0.52; br -= 0.03) {
        pushSalmonPoint(a, blowCx + Math.cos(ba) * blowRx * br, blowCy + Math.sin(ba) * blowRy * br, 0, idxRef, "blowhole", ocCx, ocCy, pulseMul, 0);
      }
    }

    return a;
  }

  /** Full pole: all three carved blocks always generated (persistent harvest indices). */
    let salmonPts = capTotemLevelPoints(1, drawSalmon(0));
    ptsByLevel[1] = salmonPts;
    syncTotemLockCounts(salmonPts.length);
    syncTotemActivatedForLevel(1, salmonPts.length);

    const orcaPts = capTotemLevelPoints(2, drawOrca(0));
    ptsByLevel[2] = orcaPts;
    syncTotemActivatedForLevel(2, orcaPts.length);

    const ospreyPts = capTotemLevelPoints(3, drawOsprey(0));
    ptsByLevel[3] = ospreyPts;
    syncTotemActivatedForLevel(3, ospreyPts.length);

    if (typeof applyPendingTotemProgressHydration === "function") applyPendingTotemProgressHydration();

    const act1 = totemActivatedByLevel[1];
    for (let si = 0; si < salmonPts.length; si++) {
      salmonPts[si].active = !!act1[si];
    }

    const act2 = totemActivatedByLevel[2];
    for (let oi = 0; oi < orcaPts.length; oi++) {
      orcaPts[oi].active = !!act2[oi];
    }

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

  let forgeZoomLayer = false;
  if (
    typeof totemAppPhase === "string" &&
    typeof TOTEM_PHASE_FORGE !== "undefined" &&
    totemAppPhase === TOTEM_PHASE_FORGE &&
    typeof totemForgeEnterStartMs === "number" &&
    totemForgeEnterStartMs > 0
  ) {
    const zt = Math.min(1, (nowMs - totemForgeEnterStartMs) / 720);
    const ze = 0.5 - 0.5 * Math.cos(Math.PI * zt);
    const sc = 1 + 0.12 * (1 - ze);
    const fx = w * 0.5;
    const fy =
      h * (typeof totemMasterLogCenterYFrac === "function" ? totemMasterLogCenterYFrac() : 0.78);
    ctx.save();
    forgeZoomLayer = true;
    ctx.translate(fx, fy);
    ctx.scale(sc, sc);
    ctx.translate(-fx, -fy);
  }

  ctx.save();
  ctx.translate(0, viewCamY);
  drawMasterTotemLog(ctx, w, h, breath01, nowMs);
  drawTotemAnimalGhostOutline(ctx, L, breath01, viewCamY);
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

  if (forgeZoomLayer) ctx.restore();

  ctx.restore();

  if (typeof canvas !== "undefined" && canvas?.classList) {
    const spiritFrac =
      typeof TOTEM_SPIRIT_EYE_FILL_FRAC === "number" ? TOTEM_SPIRIT_EYE_FILL_FRAC : 0.9;
    const spirit =
      typeof totemAppPhase === "string" &&
      totemAppPhase === "forge" &&
      typeof forgeTargetLevel === "number" &&
      forgeTargetLevel === 3 &&
      typeof totemTierFillRatio === "function" &&
      totemTierFillRatio(3) >= spiritFrac;
    canvas.classList.toggle("totem-spirit-eye-active", spirit);
  }

  return { phase, breath01, scaleMultiplier: scaleMultiplierLive };
}

function totemLonghouseTierBands(w, h) {
  const poleTop = h * 0.08;
  const poleBot = h * 0.93;
  const cx = w * 0.5;
  const segH = (poleBot - poleTop) / 3;
  /** Crown → base: Osprey (3), Orca (2), Salmon (1) — same screen order as the Forge pole. */
  return [
    { level: 3, top: poleTop, bottom: poleTop + segH, centerY: poleTop + segH * 0.5, cx },
    { level: 2, top: poleTop + segH, bottom: poleTop + 2 * segH, centerY: poleTop + segH * 1.5, cx },
    { level: 1, top: poleTop + 2 * segH, bottom: poleBot, centerY: poleTop + segH * 2.5, cx },
  ];
}

function galleryHitTestTier(canvasY, w, h) {
  const bands = totemLonghouseTierBands(w, h);
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (canvasY >= b.top && canvasY <= b.bottom) return b.level;
  }
  return 0;
}

/** Silver wireframe for Longhouse tier ghost (scaled to band). Optional `lineAlpha` overrides stroke opacity. */
function drawLonghouseTierGhostOutline(ctx2, level, cx, cy, sBand, lineAlpha) {
  const s = sBand;
  const lineA = typeof lineAlpha === "number" ? lineAlpha : 0.26;
  ctx2.save();
  ctx2.strokeStyle = `rgba(226, 232, 240, ${lineA})`;
  ctx2.lineWidth = Math.max(1.2, s * 0.04);
  ctx2.lineJoin = "round";
  if (level === 1) {
    const fishCy = cy - s * 0.06;
    ctx2.beginPath();
    ctx2.ellipse(cx, fishCy, s * 0.52, s * 0.21, 0, 0, TWO_PI);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.ellipse(cx + s * 0.33, fishCy - s * 0.06, s * 0.12, s * 0.08, 0, 0, TWO_PI);
    ctx2.stroke();
  } else if (level === 2) {
    const ocCy = cy;
    const rx0 = s * 0.58;
    const ry0 = s * 0.28;
    const drawRing = (rx, ry) => {
      ctx2.beginPath();
      ctx2.ellipse(cx, ocCy, rx, ry, 0, 0, TWO_PI);
      ctx2.stroke();
    };
    drawRing(rx0, ry0);
    drawRing(rx0 * 0.62, ry0 * 0.62);
    drawRing(rx0 * 0.34, ry0 * 0.34);
    const dCx = cx - s * 0.02;
    const dCy = ocCy - s * 0.42;
    const dR = s * 0.52;
    ctx2.beginPath();
    ctx2.arc(dCx, dCy, dR, Math.PI * 1.12, Math.PI * 1.12 + Math.PI * 0.58);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.ellipse(cx + s * 0.32, ocCy - s * 0.04, s * 0.14, s * 0.1, 0, 0, TWO_PI);
    ctx2.stroke();
  } else {
    const birdCy = cy;
    ctx2.beginPath();
    ctx2.ellipse(cx, birdCy, s * 0.2, s * 0.11, 0, 0, TWO_PI);
    ctx2.stroke();
    for (const side of [-1, 1]) {
      ctx2.beginPath();
      ctx2.ellipse(cx + side * s * 0.52, birdCy + s * 0.02, s * 0.52, s * 0.2, side * 0.12, 0, TWO_PI);
      ctx2.stroke();
    }
    ctx2.beginPath();
    ctx2.ellipse(cx + s * 0.14, birdCy - s * 0.05, s * 0.1, s * 0.07, 0, 0, TWO_PI);
    ctx2.stroke();
  }
  ctx2.restore();
}

function drawLonghouseUncarvedCedarGrain(ctx2, cx, bwTop, bwBot, top, bottom, pulse) {
  const n = 6;
  ctx2.save();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const yy = top + 8 + t * (bottom - top - 16);
    const gx0 = cx - bwTop * 0.42 - t * (bwBot - bwTop) * 0.08;
    const gx1 = cx + bwBot * 0.42 + (1 - t) * (bwBot - bwTop) * 0.06;
    ctx2.strokeStyle = `rgba(62, 48, 38, ${0.06 + 0.04 * pulse * (i % 2)})`;
    ctx2.lineWidth = 0.85;
    ctx2.beginPath();
    ctx2.moveTo(gx0, yy);
    ctx2.lineTo(gx1, yy + Math.sin(i * 1.7 + pulse) * 1.2);
    ctx2.stroke();
  }
  ctx2.restore();
}

function galleryHitTestPracticeTap(canvasX, canvasY, w, h) {
  if (typeof totemRunComplete !== "undefined" && totemRunComplete) return false;
  const cx = w * 0.5;
  const poleBot = h * 0.93;
  const px = cx + w * 0.2;
  const py = poleBot - h * 0.055;
  const rr = Math.max(30, Math.min(48, w * 0.072));
  const dx = canvasX - px;
  const dy = canvasY - py;
  return dx * dx + dy * dy <= rr * rr;
}

function drawLonghouseGallery(ctx2, w, h, nowMs) {
  const deep = ctx2.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.95);
  deep.addColorStop(0, "rgba(22, 32, 48, 0.55)");
  deep.addColorStop(1, "rgba(4, 5, 8, 0.98)");
  ctx2.fillStyle = deep;
  ctx2.fillRect(0, 0, w, h);

  const cx = w * 0.5;
  const poleTop = h * 0.08;
  const poleBot = h * 0.93;
  const pillarWTop = w * 0.34;
  const pillarWBot = w * 0.42;
  const skew = 0.04;

  ctx2.save();
  ctx2.shadowColor = "rgba(0,0,0,0.65)";
  ctx2.shadowBlur = 42;
  ctx2.shadowOffsetY = 18;
  ctx2.beginPath();
  ctx2.moveTo(cx - pillarWTop * 0.5, poleTop);
  ctx2.lineTo(cx + pillarWTop * 0.5, poleTop);
  ctx2.lineTo(cx + pillarWBot * 0.5 + skew * w, poleBot);
  ctx2.lineTo(cx - pillarWBot * 0.5 - skew * w, poleBot);
  ctx2.closePath();
  const pillarGrad = ctx2.createLinearGradient(cx - pillarWBot * 0.55, poleTop, cx + pillarWBot * 0.55, poleBot);
  pillarGrad.addColorStop(0, "#1a1410");
  pillarGrad.addColorStop(0.45, "#3e2723");
  pillarGrad.addColorStop(0.55, "#4a342c");
  pillarGrad.addColorStop(1, "#2d1f1a");
  ctx2.fillStyle = pillarGrad;
  ctx2.fill();
  ctx2.shadowBlur = 0;
  ctx2.shadowOffsetY = 0;

  const grainN = 11;
  for (let gi = 0; gi < grainN; gi++) {
    const t = (gi + 1) / (grainN + 1);
    const x = cx - pillarWBot * 0.35 + t * pillarWBot * 0.7;
    const jx = Math.sin(gi * 7.1 + 1.2) * 1.8;
    ctx2.strokeStyle = `rgba(0,0,0,${0.07 + (gi % 3) * 0.02})`;
    ctx2.lineWidth = gi % 4 === 0 ? 1.1 : 0.65;
    ctx2.beginPath();
    ctx2.moveTo(x + jx, poleTop + 10);
    ctx2.lineTo(x + jx * 0.9, poleBot - 10);
    ctx2.stroke();
  }
  ctx2.restore();

  const bands = totemLonghouseTierBands(w, h);
  const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0018);

  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const midY = (b.top + b.bottom) * 0.5;
    const segH = b.bottom - b.top;
    const inset = 10 + i * 3;
    const bwTop = pillarWTop * (0.92 - i * 0.04) - inset * 0.5;
    const bwBot = pillarWBot * (0.92 - i * 0.035) - inset * 0.45;

    const fr = typeof totemTierFillRatio === "function" ? totemTierFillRatio(b.level) : 0;
    const solid = fr >= 0.995;
    const locked = b.level > 1 && typeof totemTierFillRatio === "function" && totemTierFillRatio(b.level - 1) < 0.995;
    const nextTier =
      typeof totemFirstIncompleteTier === "function" ? totemFirstIncompleteTier() : 1;
    const isNext = !solid && !locked && nextTier === b.level;
    const tierStarted = fr >= 0.008;

    ctx2.save();
    ctx2.beginPath();
    ctx2.moveTo(cx - bwTop * 0.5, b.top + 4);
    ctx2.lineTo(cx + bwTop * 0.5, b.top + 4);
    ctx2.lineTo(cx + bwBot * 0.5, b.bottom - 4);
    ctx2.lineTo(cx - bwBot * 0.5, b.bottom - 4);
    ctx2.closePath();

    if (solid) {
      const cg = ctx2.createLinearGradient(cx - 70, b.top, cx + 80, b.bottom);
      cg.addColorStop(0, `rgba(185, 28, 28, ${0.72 + 0.08 * pulse})`);
      cg.addColorStop(0.45, `rgba(20, 184, 166, ${0.78})`);
      cg.addColorStop(1, `rgba(153, 27, 27, ${0.68 + 0.06 * pulse})`);
      ctx2.fillStyle = cg;
      ctx2.shadowColor = "rgba(45, 212, 191, 0.35)";
      ctx2.shadowBlur = 22;
    } else if (locked) {
      const ug = ctx2.createLinearGradient(cx, b.top, cx, b.bottom);
      ug.addColorStop(0, "#2a221c");
      ug.addColorStop(0.48, "#4f4034");
      ug.addColorStop(1, "#362b25");
      ctx2.fillStyle = ug;
    } else if (!tierStarted) {
      const ug = ctx2.createLinearGradient(cx - bwTop * 0.25, b.top, cx + bwBot * 0.35, b.bottom);
      ug.addColorStop(0, "#9a8770");
      ug.addColorStop(0.42, "#c9b89c");
      ug.addColorStop(0.78, "#a69078");
      ug.addColorStop(1, "#7d6b58");
      ctx2.fillStyle = ug;
      if (isNext) {
        ctx2.shadowColor = "rgba(186, 230, 253, 0.32)";
        ctx2.shadowBlur = 16 + 10 * pulse;
      }
    } else {
      const ug = ctx2.createLinearGradient(cx, b.top, cx, b.bottom);
      ug.addColorStop(0, "#6e5a4b");
      ug.addColorStop(0.5, "#9d8269");
      ug.addColorStop(1, "#554438");
      ctx2.fillStyle = ug;
    }

    ctx2.fill();
    ctx2.shadowBlur = 0;

    if (locked) {
      for (let k = 0; k < 7; k++) {
        const gx = cx - bwBot * 0.4 + (k / 6) * bwBot * 0.8;
        ctx2.strokeStyle = "rgba(0,0,0,0.12)";
        ctx2.lineWidth = 0.8;
        ctx2.beginPath();
        ctx2.moveTo(gx, b.top + 6);
        ctx2.lineTo(gx + 1, b.bottom - 6);
        ctx2.stroke();
      }
    } else if (!solid && !tierStarted) {
      drawLonghouseUncarvedCedarGrain(ctx2, cx, bwTop, bwBot, b.top, b.bottom, pulse);
    } else if (!solid && tierStarted) {
      drawLonghouseUncarvedCedarGrain(ctx2, cx, bwTop, bwBot, b.top, b.bottom, pulse * 0.55);
    }

    if (isNext && !tierStarted) {
      ctx2.strokeStyle = "rgba(203, 213, 225, 0.28)";
      ctx2.lineWidth = 1.5;
      ctx2.stroke();
    }

    let ghostS = 0;
    let ghostLineA = 0.26;
    if (solid) {
      ghostS = Math.min(segH * 0.31, w * 0.108);
      ghostLineA = 0.11;
    } else if (!locked && tierStarted) {
      ghostS = Math.min(segH * 0.36, w * 0.12);
      ghostLineA = 0.29;
    } else if (isNext && !tierStarted) {
      ghostS = Math.min(segH * 0.38, w * 0.13);
      ghostLineA = 0.26;
    }
    if (ghostS > 0) {
      drawLonghouseTierGhostOutline(ctx2, b.level, cx, midY, ghostS, ghostLineA);
    }

    const P =
      typeof SALISH_PHONETIC !== "undefined" && SALISH_PHONETIC
        ? SALISH_PHONETIC
        : {
            STEXEM: "stuh-ay-khuhm",
            KW_ETLEN: "kw-et-lun",
            KW_EKWE: "kwa-kwa",
            SXT_EKW: "suh-kh-t-ay-kw",
          };
    const labels = {
      3: { name: "KW’ÉKW’E", ph: P.KW_EKWE, en: "Osprey" },
      2: { name: "KW’ÉTL’EN", ph: P.KW_ETLEN, en: "Orca" },
      1: { name: "ST’ÉXEM", ph: P.STEXEM, en: "Salmon" },
    };
    const L = labels[b.level];
    ctx2.fillStyle = solid ? "rgba(255, 251, 235, 0.95)" : "rgba(226, 232, 240, 0.78)";
    ctx2.font = "600 13px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.fillText(`${L.name} — ${L.en}`, cx, midY - 10);
    ctx2.font = "italic 500 10px Inter, system-ui, sans-serif";
    ctx2.fillStyle = solid ? "rgba(254, 243, 199, 0.88)" : "rgba(186, 230, 253, 0.72)";
    ctx2.fillText(`(${L.ph})`, cx, midY + 8);

    if (!locked && !solid) {
      ctx2.font = "500 11px Inter, system-ui, sans-serif";
      if (isNext) {
        ctx2.fillStyle = "rgba(186, 230, 253, 0.9)";
        ctx2.fillText("Tap the ghost — enter the Forge", cx, midY + 28);
      } else if (tierStarted) {
        ctx2.fillStyle = "rgba(148, 163, 184, 0.78)";
        ctx2.fillText("Carving in progress — return to the Forge", cx, midY + 28);
      } else {
        ctx2.fillStyle = "rgba(148, 163, 184, 0.75)";
        ctx2.fillText("Await the elders", cx, midY + 28);
      }
    } else if (solid) {
      ctx2.font = "500 10px Inter, system-ui, sans-serif";
      ctx2.fillStyle = "rgba(204, 251, 241, 0.82)";
      ctx2.fillText("Carved into the pole", cx, midY + 28);
    }

    ctx2.restore();
  }

  ctx2.fillStyle = "rgba(248, 250, 252, 0.82)";
  ctx2.font = "600 13px Inter, system-ui, sans-serif";
  ctx2.textAlign = "center";
  ctx2.fillText("The Longhouse — Cedar Pillar", cx, h * 0.042);

  if (!(typeof totemRunComplete !== "undefined" && totemRunComplete)) {
    const cx2 = w * 0.5;
    const poleBot = h * 0.93;
    const px = cx2 + w * 0.2;
    const py = poleBot - h * 0.055;
    const rr = Math.max(30, Math.min(48, w * 0.072));
    const pulse = 0.65 + 0.35 * Math.sin(nowMs * 0.003);
    ctx2.save();
    ctx2.shadowColor = "rgba(110, 231, 255, 0.45)";
    ctx2.shadowBlur = 14 * pulse;
    ctx2.beginPath();
    ctx2.arc(px, py, rr, 0, TWO_PI);
    const g = ctx2.createRadialGradient(px - rr * 0.3, py - rr * 0.3, 2, px, py, rr);
    g.addColorStop(0, `rgba(255, 251, 235, ${0.22 + 0.08 * pulse})`);
    g.addColorStop(0.55, "rgba(30, 41, 59, 0.88)");
    g.addColorStop(1, "rgba(15, 23, 42, 0.95)");
    ctx2.fillStyle = g;
    ctx2.fill();
    ctx2.shadowBlur = 0;
    ctx2.strokeStyle = `rgba(110, 231, 255, ${0.35 + 0.2 * pulse})`;
    ctx2.lineWidth = 2;
    ctx2.stroke();
    ctx2.fillStyle = "rgba(248, 250, 252, 0.95)";
    ctx2.font = "700 11px Inter, system-ui, sans-serif";
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText("PRACTICE", px, py - 5);
    ctx2.font = "600 9px Inter, system-ui, sans-serif";
    ctx2.fillStyle = "rgba(186, 230, 253, 0.9)";
    ctx2.fillText("tap", px, py + 9);
    ctx2.restore();
  }

  ctx2.save();
  ctx2.textAlign = "center";
  ctx2.textBaseline = "middle";
  ctx2.font = "500 10px Inter, system-ui, sans-serif";
  ctx2.fillStyle = "rgba(148, 163, 184, 0.34)";
  ctx2.fillText("Private & Sovereign — nothing you carve here leaves your device", cx, h * 0.968);
  ctx2.restore();
}

function drawTotemPotlatchCeremony(ctx2, w, h, nowMs) {
  const c = typeof totemPotlatchCeremony !== "undefined" ? totemPotlatchCeremony : null;
  if (!c?.startMs) return;
  const dur = Math.max(1, c.durationMs || 4200);
  const uVis = Math.min(1, Math.max(0, (nowMs - c.startMs) / dur));
  const ease = uVis * uVis * (3 - 2 * uVis);

  drawLonghouseGallery(ctx2, w, h, nowMs);

  ctx2.save();
  ctx2.globalCompositeOperation = "lighter";
  const wash = ctx2.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.52, Math.max(w, h) * 0.62);
  const pulse = Math.sin(uVis * Math.PI);
  wash.addColorStop(0, `rgba(255, 255, 255, ${0.22 * pulse})`);
  wash.addColorStop(0.35, `rgba(204, 251, 241, ${0.38 * pulse})`);
  wash.addColorStop(0.55, `rgba(45, 212, 191, ${0.44 * pulse})`);
  wash.addColorStop(1, "rgba(0,0,0,0)");
  ctx2.fillStyle = wash;
  ctx2.fillRect(0, 0, w, h);
  ctx2.restore();

  const cx = w * 0.5;
  const bands = totemLonghouseTierBands(w, h);
  const tier = typeof c.tier === "number" ? c.tier : 1;
  const tierIdx = 3 - tier;
  const slot = bands[tierIdx] ?? bands[1];
  const sx = slot.cx;
  const sy = (slot.top + slot.bottom) * 0.5;
  const startX = w * 0.5;
  const startY = h * 0.46;
  const tx = startX + (sx - startX) * ease;
  const ty = startY + (sy - startY) * ease;
  const sc = 1 - 0.74 * ease;

  ctx2.save();
  ctx2.globalCompositeOperation = "lighter";
  const ribbon = ctx2.createLinearGradient(startX, startY, tx, ty);
  ribbon.addColorStop(0, `rgba(255,255,255,${0.35 * (1 - ease)})`);
  ribbon.addColorStop(0.5, `rgba(240, 253, 250,${0.45 * ease})`);
  ribbon.addColorStop(1, `rgba(45, 212, 191, ${0.55 * ease})`);
  ctx2.strokeStyle = ribbon;
  ctx2.lineWidth = 4 + 5 * ease;
  ctx2.lineCap = "round";
  ctx2.beginPath();
  ctx2.moveTo(startX, startY);
  ctx2.quadraticCurveTo(startX + (tx - startX) * 0.5, startY - h * 0.08 * ease, tx, ty);
  ctx2.stroke();
  ctx2.restore();

  ctx2.save();
  ctx2.translate(tx, ty);
  ctx2.scale(sc, sc);
  ctx2.globalAlpha = 0.88 * (1 - uVis * 0.22);
  const ring = ctx2.createRadialGradient(0, 0, 6, 0, 0, 130);
  ring.addColorStop(0, `rgba(255, 255, 255, ${0.5 + 0.45 * ease})`);
  ring.addColorStop(0.42, `rgba(240, 253, 250, ${0.42 + 0.2 * ease})`);
  ring.addColorStop(0.72, `rgba(45, 212, 191, ${0.38 + 0.35 * ease})`);
  ring.addColorStop(1, "rgba(15, 118, 110, 0.12)");
  ctx2.fillStyle = ring;
  ctx2.beginPath();
  ctx2.ellipse(0, 0, 115, 82, 0, 0, Math.PI * 2);
  ctx2.fill();
  ctx2.strokeStyle = `rgba(${248 + (45 - 248) * ease}, ${250 + (212 - 250) * ease}, ${252 + (191 - 252) * ease}, ${0.55 + 0.4 * ease})`;
  ctx2.lineWidth = 2.4 + 2 * ease;
  ctx2.stroke();
  ctx2.strokeStyle = `rgba(45, 212, 191, ${0.35 * ease})`;
  ctx2.lineWidth = 1.2;
  ctx2.beginPath();
  ctx2.ellipse(0, 0, 122, 88, 0, 0, Math.PI * 2);
  ctx2.stroke();
  ctx2.restore();

  const sBand = Math.min((slot.bottom - slot.top) * 0.38, w * 0.13);
  drawLonghouseTierGhostOutline(ctx2, tier, sx, (slot.top + slot.bottom) * 0.5, sBand * (0.4 + 0.6 * ease));

  ctx2.fillStyle = "rgba(248, 250, 252, 0.92)";
  ctx2.font = "600 14px Cormorant Garamond, Georgia, serif";
  ctx2.textAlign = "center";
  ctx2.fillText("Potlatch — the gift returns to the pole", cx, h * 0.11);
}

