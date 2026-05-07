// Physics + rendering entities. Uses global `ctx`, `canvas`, `totemPoints`, and `currentMode`.
// IMPORTANT: Do not declare TWO_PI here; it comes from config.js.
//
// Cedar Snag input: only `findTomahawkSnagHitIndex` + `tryShatterSnag` (engine) award ripples/harvest —
// no empty-screen fireworks.

function snagHitRadiusMax(snag) {
  return Math.max(44, snag.size * 2.85);
}

/**
 * Pointer collision radius for shatter (≥30px, never wider than silhouette bounds).
 */
function snagPointerHitRadiusPx(snag) {
  const floor =
    typeof CEDAR_SNAG_POINTER_HIT_RADIUS_PX === "number" ? CEDAR_SNAG_POINTER_HIT_RADIUS_PX : 40;
  const cap = snagHitRadiusMax(snag);
  const precise = Math.max(floor, snag.size * 2.35);
  return Math.min(cap, precise);
}

/** Strict contralateral: Salmon vent uses half-screen rules; other modes use snag side vs click side. */
function snagContralateralAllowsShatter(snag, canvasX, canvasY) {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  const halfW = w * 0.5;
  const halfH = h * 0.5;
  if (currentMode === MODE_SALMON_RUN) {
    const snagTop = snag.y < halfH;
    const clickedLeft = canvasX < halfW;
    return snagTop === clickedLeft;
  }
  if (snag.x < halfW && canvasX >= halfW) return false;
  if (snag.x >= halfW && canvasX < halfW) return false;
  return true;
}

/**
 * Index of nearest snag under pointer within `snagPointerHitRadiusPx`, or -1.
 * Snags on the wrong contralateral side are ignored (must hit correct snag + correct side).
 */
function findTomahawkSnagHitIndex(canvasX, canvasY) {
  if (!tomahawks?.length) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < tomahawks.length; i++) {
    const s = tomahawks[i];
    if (!snagContralateralAllowsShatter(s, canvasX, canvasY)) continue;
    const R = snagPointerHitRadiusPx(s);
    const d = Math.hypot(canvasX - s.x, canvasY - s.y);
    if (d <= R && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// —— Cedar Snag flow-state spawn: fixed timer (~900ms baseline, scales with streak), max 2 living; Spiral ½ orbit gate.

const CEDAR_SNAG_MAX_ACTIVE = 2;

let _cedarNextSpawnAtMs = 0;
let _cedarEmrdCellSeq = 0;
let _cedarSalmonAlternateTop = true;
let _cedarSpiralPhaseStep = 0;
let _cedarEdgeSpawnFlip = true;

function scheduleNextCedarSnagSpawn(nowMs) {
  const gap =
    typeof getCedarSnagSpawnIntervalMs === "function" ? getCedarSnagSpawnIntervalMs() : 900;
  _cedarNextSpawnAtMs = nowMs + Math.max(1, gap);
}

function countLivingTomahawks() {
  if (!tomahawks?.length) return 0;
  let n = 0;
  for (let i = 0; i < tomahawks.length; i++) {
    if (!tomahawks[i].isDead) n++;
  }
  return n;
}

/** Spiral mode: wait until each existing snag completes ≥½ orbit (ORBIT) before another KW’ÉTL’EN snag. */
function cedarSpiralSpawnGateClear() {
  if (typeof currentMode !== "number" || currentMode !== MODE_ORCA_WISDOM) return true;
  if (!tomahawks?.length) return true;
  for (let i = 0; i < tomahawks.length; i++) {
    const spiral = tomahawks[i];
    if (spiral.mode !== MODE_ORCA_WISDOM) continue;
    if (spiral.snagSink) continue;
    if (spiral.orcaSpiralStage === "IN") return false;
    if (spiral.orcaSpiralStage === "ORBIT" && spiral._orcaOrbitAccum < Math.PI) return false;
  }
  return true;
}

function shouldAttemptCedarSnagSpawn(nowMs) {
  if (typeof totemSnagSpawnSuppressedUntilMs === "number" && nowMs < totemSnagSpawnSuppressedUntilMs)
    return false;
  if (countLivingTomahawks() >= CEDAR_SNAG_MAX_ACTIVE) return false;
  if (!cedarSpiralSpawnGateClear()) return false;
  if (_cedarNextSpawnAtMs <= 0) scheduleNextCedarSnagSpawn(nowMs);
  return nowMs >= _cedarNextSpawnAtMs;
}

function onCedarSnagSpawnExecuted(nowMs) {
  scheduleNextCedarSnagSpawn(nowMs);
}

/** Miss / wrong-side: zero streak and restart spawn timer from now (flow-state reset). */
function resetCedarFlowAfterMiss(nowMs = performance.now()) {
  if (typeof resetCedarFlowDifficulty === "function") resetCedarFlowDifficulty();
  scheduleNextCedarSnagSpawn(nowMs);
}

function resetCedarSnagSpawnSchedule(nowMs = performance.now()) {
  const gap =
    typeof getCedarSnagSpawnIntervalMs === "function" ? getCedarSnagSpawnIntervalMs() : 900;
  _cedarNextSpawnAtMs = nowMs + Math.max(1, gap);
}

/** Reset deterministic bilateral / spiral sequencing (Escape + init). */
function resetCedarSnagSpawnPlanningState(nowMs = performance.now()) {
  _cedarEmrdCellSeq = 0;
  _cedarSalmonAlternateTop = true;
  _cedarSpiralPhaseStep = 0;
  _cedarEdgeSpawnFlip = true;
  if (typeof resetCedarFlowDifficulty === "function") resetCedarFlowDifficulty();
  resetCedarSnagSpawnSchedule(nowMs);
}

/** Sequential 3×3 cell (0–8): one predictable path for calm focus (engine spawnAutoSnag). */
function cedarConsumeEmrdGridCell() {
  const zi = _cedarEmrdCellSeq % 9;
  _cedarEmrdCellSeq++;
  return zi;
}

function cedarConsumeSalmonVentTop() {
  const fromTop = _cedarSalmonAlternateTop;
  _cedarSalmonAlternateTop = !_cedarSalmonAlternateTop;
  return fromTop;
}

function cedarNextSpiralAngleHint() {
  const a = (_cedarSpiralPhaseStep * (Math.PI * 0.47)) % TWO_PI;
  _cedarSpiralPhaseStep++;
  return a;
}

/** Alternate left/right screen edge for default snag travel. */
function cedarConsumeEdgeSpawnLeftFirst() {
  const leftFirst = _cedarEdgeSpawnFlip;
  _cedarEdgeSpawnFlip = !_cedarEdgeSpawnFlip;
  return leftFirst;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hash01(n) {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function nearestTotemPoint(x, y) {
  if (!totemPoints || totemPoints.length === 0) return null;
  let best = totemPoints[0];
  let bestD = dist2(x, y, best.x, best.y);
  for (let i = 1; i < totemPoints.length; i++) {
    const p = totemPoints[i];
    const d = dist2(x, y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function nearestTotemPointWithIndex(points, x, y) {
  if (!points || points.length === 0) return null;
  let bestIdx = 0;
  let best = points[0];
  let bestD = dist2(x, y, best.x, best.y);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const d = dist2(x, y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
      bestIdx = i;
    }
  }
  return { p: best, i: bestIdx, d2: bestD };
}

/** Level-1 Salmon: pull toward unfilled markings first (border rim → interior). */
function bestMagnetTarget(points, x, y, lockCounts) {
  if (!points || points.length === 0) return null;
  if (totemLevel !== 1 || points[0].fillOrder === undefined) return nearestTotemPointWithIndex(points, x, y);

  const act = totemActivatedByLevel[totemLevel];
  const BORDER_CAP = 2;

  const pickFrom = (pred) => {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < points.length; i++) {
      if (!pred(i)) continue;
      const p = points[i];
      const lc = lockCounts?.[i] ?? 0;
      const soul = typeof p.soulPriority === "number" ? p.soulPriority : 2;
      const d = dist2(x, y, p.x, p.y);
      const score = d + lc * 8500 + soul * 14500;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const p = points[bestIdx];
      return { p, i: bestIdx, d2: dist2(x, y, p.x, p.y) };
    }
    return null;
  };

  const isFilled = (i) => !!(act?.[i] || points[i]?.active);

  // 1) Unfilled border (outline “carves” first)
  let hit = pickFrom((i) => {
    const fo = points[i].fillOrder ?? 0;
    const lc = lockCounts?.[i] ?? 0;
    return fo === 0 && !isFilled(i) && lc < BORDER_CAP;
  });
  if (hit) return hit;

  // 2) Unfilled interior / markings bulk
  hit = pickFrom((i) => {
    const fo = points[i].fillOrder ?? 0;
    return fo === 1 && !isFilled(i);
  });
  if (hit) return hit;

  // 3) Any unfilled point (fallback)
  hit = pickFrom((i) => !isFilled(i));
  if (hit) return hit;

  return nearestTotemPointWithIndex(points, x, y);
}

function fragmentReleaseLock(f) {
  if (!f?.locked || typeof f.lockedIndex !== "number") return;
  if (f.lockedLevel !== 1) return;
  if (!totemLockCounts || f.lockedIndex < 0 || f.lockedIndex >= totemLockCounts.length) return;
  if (totemLockCounts[f.lockedIndex] > 0) totemLockCounts[f.lockedIndex]--;
}

/** Salmon Level 1: harvest tends to seat soul ovoids (eyes/joints) before body mass. */
function harvestOrderSoulFirst(unfilled, pts) {
  const b0 = [];
  const b1 = [];
  const b2 = [];
  for (const i of unfilled) {
    const sp = pts[i]?.soulPriority ?? 2;
    if (sp <= 0) b0.push(i);
    else if (sp === 1) b1.push(i);
    else b2.push(i);
  }
  shuffleIndexArray(b0);
  shuffleIndexArray(b1);
  shuffleIndexArray(b2);
  return b0.concat(b1, b2);
}

function pickHarvestDestinationIndices(level, want) {
  const arr = totemActivatedByLevel[level];
  if (!arr?.length || want <= 0) return [];
  const pts = totemPointsByLevel?.[level];
  const unfilled = [];
  for (let i = 0; i < arr.length; i++) if (!arr[i]) unfilled.push(i);
  if (unfilled.length === 0) return [];
  let order = unfilled;
  if (level === 1 && pts?.length && typeof pts[0]?.soulPriority === "number") {
    order = harvestOrderSoulFirst(unfilled, pts);
  } else {
    order = unfilled.slice();
    shuffleIndexArray(order);
  }
  const out = [];
  for (let i = 0; i < want; i++) out.push(order[i % order.length]);
  return out;
}

function shuffleIndexArray(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
}

/** Prefer planner index; else first unfilled marking on this level (matches totemPoints-style `!p.active`). */
function claimHarvestDestinationIndex(level, preferredIndex) {
  const pts = totemPointsByLevel?.[level] ?? totemPoints;
  const arr = totemActivatedByLevel?.[level];
  if (!pts?.length || !arr) return -1;
  const unfilled = (i) =>
    i >= 0 &&
    i < pts.length &&
    !arr[i] &&
    pts[i] &&
    pts[i].active !== true;
  const notReserved = (i) => !harvestDestReserved[level]?.[i];
  const unfilledAvail = (i) => unfilled(i) && notReserved(i);
  const pi = typeof preferredIndex === "number" && preferredIndex >= 0 ? preferredIndex : -1;
  if (pi >= 0 && unfilledAvail(pi)) return pi;
  for (let i = 0; i < pts.length; i++) if (unfilledAvail(i)) return i;
  return -1;
}

/** EMDR pendulum pacing: faster crossing the midline, slower at screen L/R edges (inverse bell). */
function emdrPendulumSpeedMul(x, w) {
  const edge01 = Math.abs(x / Math.max(1, w) - 0.5) * 2;
  return 0.5 + 0.5 * (1 - edge01 * edge01);
}

function totemXBounds(level) {
  const pts = totemPointsByLevel?.[level];
  if (!pts?.length) return null;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    mn = Math.min(mn, pts[i].x);
    mx = Math.max(mx, pts[i].x);
  }
  return { mn, mx };
}

/** Far-screen snag → opposite tertile on the animal formline (Salmon/Osprey). */
function pickHarvestFarOppositeIndices(level, want, snagX, screenW) {
  const bounds = totemXBounds(level);
  const arr = totemActivatedByLevel[level];
  const pts = totemPointsByLevel?.[level];
  if (!bounds || !arr?.length || !pts?.length || want <= 0) return pickHarvestDestinationIndices(level, want);
  const span = Math.max(bounds.mx - bounds.mn, 1);
  const t1 = bounds.mn + span / 3;
  const t2 = bounds.mn + (2 * span) / 3;

  const third = screenW / 3;
  const farLeftSnag = snagX < third;
  const farRightSnag = snagX > screenW - third;

  const poolFarRight = [];
  const poolFarLeft = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) continue;
    const p = pts[i];
    if (!p) continue;
    if (p.x >= t2) poolFarRight.push(i);
    if (p.x <= t1) poolFarLeft.push(i);
  }

  shuffleIndexArray(poolFarRight);
  shuffleIndexArray(poolFarLeft);

  let pool = [];
  if (farLeftSnag) pool = poolFarRight.slice();
  else if (farRightSnag) pool = poolFarLeft.slice();
  else return pickHarvestOppositeIndices(level, want, snagX, screenW);

  if (pool.length === 0) return pickHarvestOppositeIndices(level, want, snagX, screenW);
  const out = [];
  for (let i = 0; i < want; i++) out.push(pool[i % pool.length]);
  return out;
}

/**
 * Cross-midline harvest: opposite lateral half of the totem from the snag.
 * Falls back to any unfilled point if that side is full.
 */
function pickHarvestOppositeIndices(level, want, snagX, screenW) {
  const arr = totemActivatedByLevel[level];
  const pts = totemPointsByLevel?.[level];
  if (!arr?.length || !pts?.length || want <= 0) return [];
  const mid = screenW * 0.5;
  const band = Math.max(40, screenW * 0.06);
  const leftSnag = snagX < mid - band;
  const rightSnag = snagX > mid + band;

  const leftPool = [];
  const rightPool = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) continue;
    const p = pts[i];
    if (!p) continue;
    if (p.x < mid) leftPool.push(i);
    else rightPool.push(i);
  }

  shuffleIndexArray(leftPool);
  shuffleIndexArray(rightPool);

  if (!leftSnag && !rightSnag) {
    const lp = leftPool.slice();
    const rp = rightPool.slice();
    const out = [];
    for (let i = 0; i < want; i++) {
      const takeRight = i % 2 === 0;
      if (takeRight && rp.length) out.push(rp.shift());
      else if (!takeRight && lp.length) out.push(lp.shift());
      else if (rp.length) out.push(rp.shift());
      else if (lp.length) out.push(lp.shift());
      else break;
    }
    if (out.length < want) {
      const extra = pickHarvestDestinationIndices(level, want * 2);
      for (let k = 0; k < extra.length && out.length < want; k++) {
        if (!out.includes(extra[k])) out.push(extra[k]);
      }
    }
    return out.slice(0, want);
  }

  const pool = leftSnag ? rightPool.slice() : leftPool.slice();
  shuffleIndexArray(pool);
  if (pool.length === 0) return pickHarvestDestinationIndices(level, want);
  const out = [];
  for (let i = 0; i < want; i++) out.push(pool[i % pool.length]);
  return out;
}

/**
 * ST’ÉXEM Vertical Vent (Level 1 Salmon): Top snag → harvest fills lower half of fish;
 * Bottom snag → upper half (eye/gills). Uses centroid Y to split totem points.
 */
function pickHarvestVerticalVentIndices(level, want, vent) {
  const arr = totemActivatedByLevel[level];
  const pts = totemPointsByLevel?.[level];
  if (!arr?.length || !pts?.length || want <= 0) return pickHarvestDestinationIndices(level, want);

  let sumY = 0;
  for (let i = 0; i < pts.length; i++) sumY += pts[i].y;
  const midY = sumY / pts.length;

  const pool = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) continue;
    const py = pts[i]?.y ?? 0;
    const lower = py >= midY;
    if (vent === "TOP" && lower) pool.push(i);
    else if (vent === "BOTTOM" && !lower) pool.push(i);
  }
  shuffleIndexArray(pool);
  if (pool.length === 0) return pickHarvestDestinationIndices(level, want);
  const out = [];
  for (let i = 0; i < want; i++) out.push(pool[i % pool.length]);
  return out;
}

/**
 * Spiral mode on Orca tier: prefer dorsal fin + tail fluke markings (silhouette).
 */
function pickHarvestSpiralOrcaSilhouette(level, want) {
  const arr = totemActivatedByLevel[level];
  const pts = totemPointsByLevel?.[level];
  if (!arr?.length || !pts?.length || want <= 0) return pickHarvestDestinationIndices(level, want);
  const pool = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) continue;
    const m = pts[i]?.marking;
    if (m === "dorsal" || m === "tail") pool.push(i);
  }
  shuffleIndexArray(pool);
  if (pool.length === 0) return pickHarvestDestinationIndices(level, want);
  const out = [];
  for (let i = 0; i < want; i++) out.push(pool[i % pool.length]);
  return out;
}

/** Totem tier visual for Cedar Snags + shatter fragments (1 Salmon / 2 Orca / 3 Osprey). */
function normalizeSnagTotemLevel(lv) {
  const n = typeof lv === "number" ? lv : 1;
  return Math.min(3, Math.max(1, n));
}

/** Paint colors inherited by harvest + trail fragments when a snag releases particles. */
function fragmentPaletteFromSnagLevel(lv) {
  const L = normalizeSnagTotemLevel(lv);
  if (L === 1) {
    return {
      harvestTrail: "rgba(231, 229, 228, 0.68)",
      harvestEdge: "#57534e",
      harvestCore: "#78716c",
      harvestMid: "#a8a29e",
      harvestGlow: "rgba(120, 113, 108, 0.42)",
      harvestHi: "rgba(245, 245, 244, 0.9)",
      splinterInk: "#57534e",
      splinterAlt: "#44403c",
      splinterGhost: "rgba(214, 211, 209, 0.58)",
      splinterHi: "rgba(231, 229, 228, 0.5)",
    };
  }
  if (L === 2) {
    return {
      harvestTrail: "rgba(254, 243, 199, 0.72)",
      harvestEdge: "#92400e",
      harvestCore: "#b45309",
      harvestMid: "#f59e0b",
      harvestGlow: "rgba(251, 146, 60, 0.52)",
      harvestHi: "rgba(255, 251, 235, 0.92)",
      splinterInk: "#b45309",
      splinterAlt: "#78350f",
      splinterGhost: "rgba(251, 191, 36, 0.58)",
      splinterHi: "rgba(253, 224, 171, 0.62)",
    };
  }
  return {
    harvestTrail: "rgba(253, 186, 116, 0.78)",
    harvestEdge: "#0c0a09",
    harvestCore: "#292524",
    harvestMid: "#ea580c",
    harvestGlow: "rgba(249, 115, 22, 0.58)",
    harvestHi: "rgba(253, 186, 116, 0.95)",
    splinterInk: "#1c1917",
    splinterAlt: "#292524",
    splinterGhost: "rgba(251, 146, 60, 0.42)",
    splinterHi: "rgba(251, 146, 60, 0.55)",
  };
}

/** Harvest stick paint: avoid rebuilding full totem offscreen cache every frame (~60Hz → costly). */
const TOTEM_STICK_CACHE_REDRAW_MIN_MS = 52;

/** Harvest & Fill: 15–20 fragments per snag (see config TOTEM_FRAGMENTS_*), each bound to an unfilled totem point. */
function spawnHarvestFragments(originX, originY, hue, verticalVent, snagTotemLevel) {
  const snagLv = normalizeSnagTotemLevel(
    typeof snagTotemLevel === "number" ? snagTotemLevel : totemLevel
  );
  const lv = typeof getEffectiveHarvestLevel === "function" ? getEffectiveHarvestLevel() : totemLevel;
  const lo = typeof TOTEM_FRAGMENTS_PER_SNAG_MIN === "number" ? TOTEM_FRAGMENTS_PER_SNAG_MIN : 15;
  const hi = typeof TOTEM_FRAGMENTS_PER_SNAG_MAX === "number" ? TOTEM_FRAGMENTS_PER_SNAG_MAX : 20;
  const count = lo + ((Math.random() * (hi - lo + 1)) | 0);
  const screenW = window.innerWidth || 1;
  let indices;
  if (
    currentMode === MODE_SALMON_RUN &&
    lv === 1 &&
    (verticalVent === "TOP" || verticalVent === "BOTTOM")
  ) {
    indices = pickHarvestVerticalVentIndices(lv, count, verticalVent);
  } else if (currentMode === MODE_NEURAL_WEAVER) {
    indices = pickHarvestFarOppositeIndices(lv, count, originX, screenW);
  } else if (currentMode === MODE_ORCA_WISDOM && lv === 2) {
    indices = pickHarvestSpiralOrcaSilhouette(lv, count);
  } else {
    indices = pickHarvestDestinationIndices(lv, count);
  }
  const ventSweep =
    currentMode === MODE_SALMON_RUN && lv === 1 && (verticalVent === "TOP" || verticalVent === "BOTTOM");
  const spiralSweep = currentMode === MODE_ORCA_WISDOM;
  const fragmentHarvestSweep =
    currentMode === MODE_NEURAL_WEAVER || ventSweep || spiralSweep;
  const harvestCentripetal = spiralSweep;
  const vKick = ventSweep ? (verticalVent === "TOP" ? 1 : -1) : 0;

  const ptsLv = totemPointsByLevel?.[lv] ?? totemPoints;
  for (let k = 0; k < indices.length; k++) {
    const destIndex = claimHarvestDestinationIndex(lv, indices[k]);
    if (destIndex < 0 || !ptsLv?.[destIndex]) continue;
    const a = (k / Math.max(1, indices.length)) * TWO_PI + Math.random() * 0.9;
    const sp = 360 + Math.random() * 280;
    let vx = Math.cos(a) * sp * (ventSweep ? 0.72 : 1);
    let vy = Math.sin(a) * sp + vKick * (220 + Math.random() * 160);
    fragments.push(
      new Fragment({
        harvest: true,
        harvestLevel: lv,
        destIndex,
        harvestSweep: fragmentHarvestSweep,
        harvestCentripetal,
        x: originX,
        y: originY,
        vx,
        vy,
        hue,
        snagTotemLevel: snagLv,
        burstMs: 270 + Math.random() * 150,
        maxLife: 9500,
        size: 1.3 + Math.random() * 2.2,
      })
    );
  }
}

class Tomahawk {
  constructor(opts) {
    const w = canvas?.width ?? 1;
    const h = canvas?.height ?? 1;

    this.mode = opts?.mode ?? currentMode;
    this.hue = opts?.hue ?? modeHue(currentMode);
    this.snagTotemLevel = normalizeSnagTotemLevel(opts?.snagTotemLevel ?? totemLevel);

    // Inbound Physics Fix:
    // Spawn on screen edges and move TOWARD center using (target - origin).
    const cssW = window?.innerWidth ?? w;
    const cssH = window?.innerHeight ?? h;
    const cx = cssW * 0.5;
    const cy = cssH * 0.52;

    const margin = 24;
    const lvl = typeof totemLevel === "number" ? totemLevel : 0;
    const flowBoost = 1 + lvl * 0.12;

    this.seed = Math.random() * 9999;
    this.speedVar = 0.8 + Math.random() * 0.4;
    this.travelTargetSec =
      typeof randomCedarSnagTravelSeconds === "function" ? randomCedarSnagTravelSeconds() : 3;
    this._travelTargetPxPerSec = null;

    /** ST’ÉXEM Vertical Vent: spawn only off top or bottom; swim toward center (vertical emphasis). */
    if (this.mode === MODE_SALMON_RUN && (opts?.verticalVent === "TOP" || opts?.verticalVent === "BOTTOM")) {
      this.verticalVent = opts.verticalVent;
      const aimX = clamp(opts?.x ?? cx + (Math.random() - 0.5) * cssW * 0.38, margin, cssW - margin);
      this.x = aimX;
      this.y = opts.verticalVent === "TOP" ? -margin : cssH + margin;
      const dx = cx - this.x;
      const dy = cy - this.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const speed = (d / Math.max(0.5, this.travelTargetSec)) * flowBoost * this.speedVar;
      this.vx = (dx / d) * speed * 0.42;
      this.vy = (dy / d) * speed;
      this._travelTargetPxPerSec = speed;
    } else if (this.mode === MODE_ORCA_WISDOM) {
      /** KW’ÉTL’EN: logarithmic-style orbit — start at full canvas width, spiral inward. */
      this.spiralCx = cx;
      this.spiralCy = cy;
      const canvasCssW =
        typeof canvas !== "undefined" && canvas?.clientWidth > 0 ? canvas.clientWidth : cssW;
      this.spiralRadius = Math.max(canvasCssW, cssW * 0.92);
      this.spiralAngle =
        typeof opts?.spiralAngleHint === "number"
          ? opts.spiralAngleHint
          : Math.random() * TWO_PI;
      this.x = this.spiralCx + Math.cos(this.spiralAngle) * this.spiralRadius;
      this.y = this.spiralCy + Math.sin(this.spiralAngle) * this.spiralRadius;
      this.vx = 0;
      this.vy = 0;
    } else {
      const clickX = opts?.x ?? cx;
      let clickY = opts?.y ?? cy;
      const side = clickX < cx ? "LEFT" : "RIGHT";

      const emdrBandLo = cssH * 0.35;
      const emdrBandHi = cssH * 0.65;
      if (this.mode === MODE_NEURAL_WEAVER || this.mode === MODE_OSPREY_SCOUT) {
        clickY = clamp(clickY, emdrBandLo, emdrBandHi);
      }

      this.x = side === "LEFT" ? -margin : cssW + margin;
      this.y =
        this.mode === MODE_NEURAL_WEAVER || this.mode === MODE_OSPREY_SCOUT
          ? clickY
          : clamp(clickY, margin, cssH - margin);

      const tx = cx;
      const ty = cy;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = Math.max(1, Math.hypot(dx, dy));

      if (this.mode === MODE_NEURAL_WEAVER || this.mode === MODE_OSPREY_SCOUT) {
        this.emdrDir = clickX < cx ? 1 : -1;
        this.emdrPathPhase = this.seed * 0.45;
        const horizNominal = Math.max(
          220,
          Math.min(
            540,
            (cssW * 2.55) / Math.max(0.6, this.travelTargetSec) * this.speedVar
          )
        );
        const horiz = horizNominal * emdrPendulumSpeedMul(this.x, cssW);
        this.vx = this.emdrDir * horiz;
        this.vy = 0;
      } else {
        const spd = (d / Math.max(0.5, this.travelTargetSec)) * flowBoost * this.speedVar;
        this.vx = (dx / d) * spd;
        this.vy = (dy / d) * spd;
        this._travelTargetPxPerSec = spd;
      }
    }

    this.life = 0;
    // Spiral mode needs long life for multiple orbits + sink; minimum enforced here even if caller passes a shorter maxLife.
    this.maxLife = opts?.maxLife ?? 2200;
    if (this.mode === MODE_ORCA_WISDOM) this.maxLife = Math.max(this.maxLife, 14000);

    /** When set, snag is lerping into the totem (subtle pulse in draw); never “pop” off from lifetime fade. */
    this.snagSink = null;

    /** KW’ÉTL’EN: spiral inward → hold inner orbit (smooth pursuit) → sink */
    this.orcaSpiralStage = this.mode === MODE_ORCA_WISDOM ? "IN" : null;
    this._orcaOrbitAccum = 0;

    this.size = opts?.size ?? Math.max(18, Math.min(cssW, cssH) * 0.02);

    this.spin = (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 1.1);

    // Deterministic silhouette + grain so it doesn't flicker frame-to-frame.
    const sides = 5 + Math.floor(hash01(this.seed * 1.77) * 3); // 5..7
    this.poly = [];
    const w0 = this.size * (1.55 + 0.25 * Math.sin(this.seed));
    const h0 = this.size * (0.95 + 0.22 * Math.cos(this.seed * 1.7));
    const baseR = Math.max(w0, h0) * 0.55;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TWO_PI + hash01(this.seed + i * 19.3) * 0.28;
      const rr = baseR * (0.72 + 0.38 * hash01(this.seed * 3.1 + i * 7.9));
      const sx = Math.cos(a) * rr * (w0 / (baseR * 2));
      const sy = Math.sin(a) * rr * (h0 / (baseR * 2));
      this.poly.push({ x: sx, y: sy });
    }

    this.grain = [];
    const grains = 2 + Math.floor(hash01(this.seed * 8.13) * 2); // 2..3
    for (let i = 0; i < grains; i++) {
      const gx0 = lerp(-w0 * 0.45, w0 * 0.45, hash01(this.seed * 11.9 + i * 13.2));
      const gy0 = -h0 * 0.45 + hash01(this.seed * 5.9 + i * 3.3) * h0 * 0.12;
      const gx1 = gx0 + (hash01(this.seed * 4.2 + i * 9.4) - 0.5) * (w0 * 0.12);
      const gy1 = h0 * 0.45 - hash01(this.seed * 6.2 + i * 6.6) * h0 * 0.12;
      this.grain.push({ gx0, gy0, gx1, gy1 });
    }

    // Deep grain cracks (3–4 segments, deterministic; drawn in dark #451a03)
    this.deepCracks = [];
    const nCracks = 3 + Math.floor(hash01(this.seed * 91.17) * 2); // 3..4
    for (let i = 0; i < nCracks; i++) {
      const gx0 = lerp(-w0 * 0.38, w0 * 0.38, hash01(this.seed * 61.9 + i * 17));
      const gy0 = lerp(-h0 * 0.38, h0 * 0.38, hash01(this.seed * 71.7 + i * 19));
      const gx1 =
        gx0 + (hash01(this.seed * 82.5 + i * 11) - 0.48) * w0 * (0.16 + hash01(i * 41.9) * 0.26);
      const gy1 =
        gy0 + (hash01(this.seed * 73.9 + i * 31) - 0.52) * h0 * (0.2 + hash01(i * 51.9) * 0.34);
      this.deepCracks.push({ gx0, gy0, gx1, gy1 });
    }

    // Pale highlight along first edge (weathered facet)
    const p0 = this.poly[0];
    const p1 = this.poly[1 % sides];
    const mx = (p0.x + p1.x) * 0.5;
    const my = (p0.y + p1.y) * 0.5;
    let cxp = 0;
    let cyp = 0;
    for (const v of this.poly) {
      cxp += v.x;
      cyp += v.y;
    }
    cxp /= sides;
    cyp /= sides;
    const edx = p1.x - p0.x;
    const edy = p1.y - p0.y;
    const elen = Math.max(1e-6, Math.hypot(edx, edy));
    let nx = -edy / elen;
    let ny = edx / elen;
    if ((cxp - mx) * nx + (cyp - my) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const inset = this.size * 0.09;
    this.highlight = {
      x0: lerp(p0.x, p1.x, 0.12) + nx * inset,
      y0: lerp(p0.y, p1.y, 0.12) + ny * inset,
      x1: lerp(p0.x, p1.x, 0.88) + nx * inset,
      y1: lerp(p0.y, p1.y, 0.88) + ny * inset,
    };
  }

  update(dtMs, nowMs) {
    const freezeOrcaTravel =
      this.mode === MODE_ORCA_WISDOM &&
      !this.snagSink &&
      (this.orcaSpiralStage === "IN" || this.orcaSpiralStage === "ORBIT");
    if (!freezeOrcaTravel) this.life += dtMs;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w * 0.5;
    const cy = h * 0.52;
    const dtSec = dtMs / 1000;

    const sinkDurMs = 900;
    const sinkEase = (u) => u * u * (3 - 2 * u);

    /** Shared center sink: pulse handled in draw(); opacity stays 1.0 */
    const runSnagSink = () => {
      const start = this.snagSink.startMs;
      const ox = this.snagSink.ox;
      const oy = this.snagSink.oy;
      const u = clamp((nowMs - start) / sinkDurMs, 0, 1);
      const e = sinkEase(u);
      this.x = lerp(ox, cx, e);
      this.y = lerp(oy, cy, e);
      this.vx = 0;
      this.vy = 0;
      if (u >= 1) this.life = this.maxLife + 1;
    };

    if (this.snagSink) {
      runSnagSink();
      return;
    }

    // —— EMDR: middle 30% vertical band + horizontal lazy-8 / infinity sweep (sinusoidal pursuit)
    if (this.mode === MODE_NEURAL_WEAVER || this.mode === MODE_OSPREY_SCOUT) {
      const vBreath =
        typeof getVagusSnagVelocityMultiplier === "function" ? getVagusSnagVelocityMultiplier(nowMs) : 1;
      if (this.emdrDir === undefined) this.emdrDir = this.x < cx ? 1 : -1;
      const bandLo = h * 0.35;
      const bandHi = h * 0.65;
      const bandMid = h * 0.5;
      const bandR = (bandHi - bandLo) * 0.5;

      const wasLeft = this._emdrWasLeft;
      const ts = Math.max(0.6, this.travelTargetSec || 3);
      const horizNominal = Math.max(
        220,
        Math.min(540, ((w * 2.55) / ts) * (this.speedVar ?? 1))
      );
      const horiz = horizNominal * emdrPendulumSpeedMul(this.x, w) * vBreath;

      this.x += this.emdrDir * horiz * dtSec;

      const horizOut = horizNominal * emdrPendulumSpeedMul(this.x, w) * vBreath;

      const xNorm = this.x / Math.max(1, w);
      this.emdrPathPhase = (this.emdrPathPhase ?? this.seed * 0.4) + dtSec * 1.65;
      let ty =
        bandMid +
        bandR *
          0.95 *
          Math.sin(xNorm * Math.PI * 2.65 + this.seed * 0.38) *
          Math.cos(this.emdrPathPhase * 0.82 + this.seed * 0.17);
      ty = clamp(ty, bandLo, bandHi);
      this.y += (ty - this.y) * Math.min(1, 13 * dtSec);
      this.y = clamp(this.y, bandLo, bandHi);

      this.vx = this.emdrDir * horizOut;
      this.vy = (ty - this.y) / Math.max(dtSec, 1e-4);

      const nowLeft = this.x < cx;
      if (wasLeft !== undefined && wasLeft !== nowLeft && typeof bumpTotemMidlineGlow === "function") {
        bumpTotemMidlineGlow();
      }
      this._emdrWasLeft = nowLeft;

      if (Math.random() < 0.22) {
        fragments.push(
          new Fragment({
            x: this.x,
            y: this.y,
            vx: this.vx * 0.1 + (Math.random() - 0.5) * 80,
            vy: this.vy * 0.1 + (Math.random() - 0.5) * 80,
            hue: this.hue,
            snagTotemLevel: this.snagTotemLevel,
          })
        );
      }

      if (this.x < -220 || this.x > w + 220 || this.y < bandLo - 120 || this.y > bandHi + 120) {
        this.life = this.maxLife + 1;
      }
      return;
    }

    // —— KW’ÉTL’EN (mode 3): slow spiral in → multiple inner orbits (smooth pursuit) → sink into totem
    if (this.mode === MODE_ORCA_WISDOM) {
      const vFlow =
        (typeof getVagusSnagVelocityMultiplier === "function" ? getVagusSnagVelocityMultiplier(nowMs) : 1) *
        (this.speedVar ?? 1);
      const scx = this.spiralCx ?? cx;
      const scy = this.spiralCy ?? cy;
      const ox = this.x;
      const oy = this.y;
      const frame60 = (dtMs * 60) / 1000;
      const omega = 0.015 * frame60 * vFlow;
      const rMin = 30;
      const radialDecay = 0.38 * frame60 * vFlow;
      const innerOrbitsBeforeSink = 3;

      if (this.orcaSpiralStage === "IN") {
        this.spiralAngle += omega;
        this.spiralRadius = Math.max(rMin, (this.spiralRadius ?? w) - radialDecay);
        this.x = scx + Math.cos(this.spiralAngle) * this.spiralRadius;
        this.y = scy + Math.sin(this.spiralAngle) * this.spiralRadius;
        if (this.spiralRadius <= rMin + 0.01) {
          this.orcaSpiralStage = "ORBIT";
          this._orcaOrbitAccum = 0;
          this.spiralRadius = rMin;
        }
      } else if (this.orcaSpiralStage === "ORBIT") {
        this.spiralAngle += omega;
        this.spiralRadius = rMin;
        this._orcaOrbitAccum += omega;
        this.x = scx + Math.cos(this.spiralAngle) * this.spiralRadius;
        this.y = scy + Math.sin(this.spiralAngle) * this.spiralRadius;
        if (this._orcaOrbitAccum >= TWO_PI * innerOrbitsBeforeSink) {
          this.orcaSpiralStage = "SINK";
          this.snagSink = { startMs: nowMs, ox: this.x, oy: this.y };
        }
      }

      const ds = Math.max(dtSec, 1e-4);
      this.vx = (this.x - ox) / ds;
      this.vy = (this.y - oy) / ds;

      if (Math.random() < 0.22) {
        fragments.push(
          new Fragment({
            x: this.x,
            y: this.y,
            vx: this.vx * 0.1 + (Math.random() - 0.5) * 80,
            vy: this.vy * 0.1 + (Math.random() - 0.5) * 80,
            hue: this.hue,
            snagTotemLevel: this.snagTotemLevel,
          })
        );
      }

      return;
    }

    // Soft drag
    const drag = Math.pow(0.9982, dtMs);
    this.vx *= drag;
    this.vy *= drag;

    const speed = Math.max(0.001, Math.hypot(this.vx, this.vy));
    const vBreath =
      typeof getVagusSnagVelocityMultiplier === "function" ? getVagusSnagVelocityMultiplier(nowMs) : 1;
    const targetBase =
      typeof this._travelTargetPxPerSec === "number"
        ? this._travelTargetPxPerSec
        : Math.max(240, Math.min(w, h) * 0.42);
    const targetSpeed = targetBase * vBreath;
    const accel = (targetSpeed - speed) * 0.00045;

    if (this.mode === MODE_SALMON_RUN && this.verticalVent) {
      // ST’ÉXEM: descend/ascend toward center — minimal lateral drift (vertical venting)
      const dx = cx - this.x;
      const dy = cy - this.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const inv = 1 / dist;
      const pull = accel * 1.85;
      this.vx += dx * inv * pull * dtMs;
      this.vy += dy * inv * pull * dtMs;
      const stray = Math.sin((nowMs + this.seed * 13) * 0.0022) * (w * 0.021);
      this.vx += stray * dtSec * 42;
    } else if (this.mode === MODE_SALMON_RUN) {
      // Vertical sweep: up/down through the totem (non–vent spawns)
      const sweep = Math.sin((nowMs + this.seed * 19) * 0.0018);
      const tx = cx + Math.sin((nowMs + this.seed) * 0.001) * (w * 0.09);
      const ty = cy + sweep * (h * 0.34);
      const dx = tx - this.x;
      const dy = ty - this.y;
      const inv = 1 / Math.max(1, Math.hypot(dx, dy));
      this.vx += dx * inv * accel * dtMs;
      this.vy += dy * inv * accel * dtMs;
    } else {
      // CONTRA (and any unknown): mild attraction to center line
      const dx = cx - this.x;
      const dy = cy - this.y;
      const inv = 1 / Math.max(1, Math.hypot(dx, dy));
      this.vx += dx * inv * accel * 0.55 * dtMs;
      this.vy += dy * inv * accel * 0.55 * dtMs;
    }

    // Level 2 Orca rhythm: orbit slightly before settling inward.
    if (typeof totemLevel === "number" && totemLevel === 2) {
      const dx = cx - this.x;
      const dy = cy - this.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const tx = -dy / d; // perpendicular (tangential)
      const ty = dx / d;
      const orbit = 0.00022 * dtMs * Math.max(220, speed);
      this.vx += tx * orbit * 220;
      this.vy += ty * orbit * 220;
    }

    this.x += this.vx * dtSec;
    this.y += this.vy * dtSec;

    // Reach totem core without a hit: sink inward (ST’ÉXEM / default inbound — not EMDR grid)
    const dCore = Math.hypot(this.x - cx, this.y - cy);
    if (dCore < 52) {
      this.snagSink = { startMs: nowMs, ox: this.x, oy: this.y };
      return;
    }

    // Spawn fragments along the path
    if (Math.random() < 0.22) {
      fragments.push(
        new Fragment({
          x: this.x,
          y: this.y,
          vx: this.vx * 0.1 + (Math.random() - 0.5) * 80,
          vy: this.vy * 0.1 + (Math.random() - 0.5) * 80,
          hue: this.hue,
          snagTotemLevel: this.snagTotemLevel,
        })
      );
    }

    // Cull offscreen
    if (this.x < -200 || this.x > w + 200 || this.y < -200 || this.y > h + 200) {
      this.life = this.maxLife + 1;
    }
  }

  draw(nowMs) {
    if (!ctx) return;
    const ang = (nowMs * 0.0012 + this.seed) * this.spin;

    const sinkDurMs = 900;
    let sinkU = 0;
    if (this.snagSink) sinkU = clamp((nowMs - this.snagSink.startMs) / sinkDurMs, 0, 1);
    const sinkPulse = 1 + (this.snagSink ? 0.065 : 0) * Math.sin(nowMs * 0.014);
    const drawScale = (1 - sinkU * 0.88) * sinkPulse;

    const lv = normalizeSnagTotemLevel(this.snagTotemLevel);
    const modeCfg = MODE_REGISTRY[this.mode];
    const energyHex =
      modeCfg?.color ?? `hsl(${modeCfg?.hue ?? this.hue}, 85%, 60%)`;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(drawScale, drawScale);
    ctx.rotate(ang);

    const s = this.size;
    const fade = 1;

    const pathSnag = () => {
      ctx.beginPath();
      for (let i = 0; i < this.poly.length; i++) {
        const p = this.poly[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    };

    if (lv === 1) {
      // Weathered cedar — grey-brown, rough chipped silhouette
      ctx.lineJoin = "bevel";
      ctx.lineCap = "square";

      ctx.globalAlpha = fade * 0.38;
      ctx.shadowBlur = Math.max(6, s * 0.35);
      ctx.shadowColor = "rgba(68, 64, 60, 0.55)";
      pathSnag();
      ctx.fillStyle = "#44403c";
      ctx.fill();
      ctx.shadowBlur = 0;

      pathSnag();
      const wg = ctx.createRadialGradient(-s * 0.22, -s * 0.18, 0, 0, 0, s * 2.45);
      wg.addColorStop(0, "#a8a29e");
      wg.addColorStop(0.48, "#78716c");
      wg.addColorStop(1, "#57534e");
      ctx.globalAlpha = fade;
      ctx.fillStyle = wg;
      ctx.fill();

      pathSnag();
      ctx.strokeStyle = "#44403c";
      ctx.lineWidth = 2.35;
      ctx.stroke();

      pathSnag();
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = "rgba(87, 83, 78, 0.88)";
      ctx.lineWidth = 1.05;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = fade * 0.92;
      ctx.strokeStyle = "#57534e";
      ctx.lineWidth = 0.95;
      const sides = this.poly.length;
      for (let i = 0; i < sides; i++) {
        const p = this.poly[i];
        const p2 = this.poly[(i + 1) % sides];
        const mx = (p.x + p2.x) * 0.5;
        const my = (p.y + p2.y) * 0.5;
        const nx = -(p2.y - p.y);
        const ny = p2.x - p.x;
        const nl = Math.max(1e-6, Math.hypot(nx, ny));
        const j = (hash01(this.seed * 3.7 + i * 19.1) - 0.5) * s * 0.42;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + (nx / nl) * j, my + (ny / nl) * j);
        ctx.stroke();
      }

      if (this.highlight) {
        ctx.globalAlpha = fade * 0.48;
        ctx.strokeStyle = "#d6d3d1";
        ctx.lineWidth = 0.85;
        ctx.beginPath();
        ctx.moveTo(this.highlight.x0, this.highlight.y0);
        ctx.lineTo(this.highlight.x1, this.highlight.y1);
        ctx.stroke();
      }

      ctx.globalAlpha = fade * 0.88;
      ctx.strokeStyle = "#44403c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const c of this.deepCracks) {
        ctx.moveTo(c.gx0, c.gy0);
        ctx.lineTo(c.gx1, c.gy1);
      }
      ctx.stroke();

      ctx.globalAlpha = fade * 0.36;
      ctx.strokeStyle = "#57534e";
      ctx.lineWidth = 0.78;
      ctx.beginPath();
      for (const g of this.grain) {
        ctx.moveTo(g.gx0, g.gy0);
        ctx.lineTo(g.gx1, g.gy1);
      }
      ctx.stroke();

      pathSnag();
      ctx.globalAlpha = fade * 0.07;
      ctx.strokeStyle = energyHex;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (lv === 2) {
      // Heartwood — saturated amber + inner warmth
      ctx.globalAlpha = fade * 0.42;
      ctx.shadowBlur = Math.max(18, s * 0.92);
      ctx.shadowColor = "rgba(251, 191, 36, 0.48)";
      pathSnag();
      ctx.fillStyle = "#b45309";
      ctx.fill();

      ctx.shadowBlur = Math.max(12, s * 0.52);
      ctx.shadowColor = "rgba(245, 158, 11, 0.38)";
      ctx.globalAlpha = fade * 0.48;
      pathSnag();
      ctx.fillStyle = "#ea580c";
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = fade;
      pathSnag();
      const hg = ctx.createRadialGradient(s * 0.18, -s * 0.14, 0, 0, 0, s * 2.35);
      hg.addColorStop(0, "#fcd34d");
      hg.addColorStop(0.32, "#f59e0b");
      hg.addColorStop(0.68, "#b45309");
      hg.addColorStop(1, "#78350f");
      ctx.fillStyle = hg;
      ctx.fill();

      pathSnag();
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 1.52;
      ctx.stroke();

      if (this.highlight) {
        ctx.globalAlpha = fade * 0.92;
        ctx.strokeStyle = "#fffbeb";
        ctx.lineWidth = 1.12;
        ctx.beginPath();
        ctx.moveTo(this.highlight.x0, this.highlight.y0);
        ctx.lineTo(this.highlight.x1, this.highlight.y1);
        ctx.stroke();
      }

      ctx.globalAlpha = fade * 0.86;
      ctx.strokeStyle = "#92400e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const c of this.deepCracks) {
        ctx.moveTo(c.gx0, c.gy0);
        ctx.lineTo(c.gx1, c.gy1);
      }
      ctx.stroke();

      ctx.globalAlpha = fade * 0.38;
      ctx.strokeStyle = "#78350f";
      ctx.lineWidth = 0.82;
      ctx.beginPath();
      for (const g of this.grain) {
        ctx.moveTo(g.gx0, g.gy0);
        ctx.lineTo(g.gx1, g.gy1);
      }
      ctx.stroke();

      pathSnag();
      ctx.globalAlpha = fade * 0.11;
      ctx.strokeStyle = energyHex;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // Charred ember — matte black + glowing crack heat
      ctx.globalAlpha = fade * 0.48;
      ctx.shadowBlur = Math.max(8, s * 0.4);
      ctx.shadowColor = "rgba(249, 115, 22, 0.28)";
      pathSnag();
      ctx.fillStyle = "#1c1917";
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.globalAlpha = fade;
      pathSnag();
      const eg = ctx.createRadialGradient(-s * 0.1, s * 0.06, 0, 0, 0, s * 2.05);
      eg.addColorStop(0, "#292524");
      eg.addColorStop(0.62, "#1c1917");
      eg.addColorStop(1, "#0c0a09");
      ctx.fillStyle = eg;
      ctx.fill();

      pathSnag();
      ctx.strokeStyle = "#292524";
      ctx.lineWidth = 1.28;
      ctx.stroke();

      ctx.globalAlpha = fade;
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 1.32;
      ctx.shadowBlur = Math.max(7, s * 0.36);
      ctx.shadowColor = "rgba(251, 146, 60, 0.82)";
      ctx.beginPath();
      for (const c of this.deepCracks) {
        ctx.moveTo(c.gx0, c.gy0);
        ctx.lineTo(c.gx1, c.gy1);
      }
      ctx.stroke();

      ctx.shadowBlur = Math.max(5, s * 0.26);
      ctx.shadowColor = "rgba(253, 186, 116, 0.62)";
      ctx.strokeStyle = "#fb923c";
      ctx.lineWidth = 0.82;
      ctx.beginPath();
      for (const g of this.grain) {
        ctx.moveTo(g.gx0, g.gy0);
        ctx.lineTo(g.gx1, g.gy1);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (this.highlight) {
        ctx.globalAlpha = fade * 0.42;
        ctx.strokeStyle = "rgba(253, 186, 116, 0.52)";
        ctx.lineWidth = 0.72;
        ctx.shadowBlur = 5;
        ctx.shadowColor = "rgba(251, 146, 60, 0.45)";
        ctx.beginPath();
        ctx.moveTo(this.highlight.x0, this.highlight.y0);
        ctx.lineTo(this.highlight.x1, this.highlight.y1);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      pathSnag();
      ctx.globalAlpha = fade * 0.07;
      ctx.strokeStyle = energyHex;
      ctx.lineWidth = 1.45;
      ctx.stroke();
    }

    ctx.restore();
  }

  get isDead() {
    return this.life > this.maxLife;
  }
}

/** Drop fragments that fly far outside the viewport (keeps the simulation lean). */
function killFragmentIfOffscreen(f) {
  if (f.harvestPainted || f.harvestSticking) return;
  const margin = 480;
  const W = window.innerWidth || 1;
  const H = window.innerHeight || 1;
  if (f.x < -margin || f.x > W + margin || f.y < -margin || f.y > H + margin) {
    f.life = f.maxLife + 1;
  }
}

/** Bark “chips” when a Cedar Snag shatters — reveals lighter wood beneath momentarily. */
function spawnLogChips(worldX, worldY, nowMs) {
  if (!Array.isArray(logChips)) return;
  const n = 5 + ((Math.random() * 5) | 0);
  for (let i = 0; i < n; i++) logChips.push(new LogChip(worldX, worldY, nowMs, i));
}

class LogChip {
  constructor(x, y, nowMs, i) {
    this.x = x;
    this.y = y;
    this.life = 0;
    const a = (i / 6) * TWO_PI + Math.random() * 0.95;
    const sp = 110 + Math.random() * 210;
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp - 130;
    this.rot = Math.random() * TWO_PI;
    this.vr = (Math.random() - 0.5) * 9;
    this.size = 2.8 + Math.random() * 5;
    this.maxLife = 480 + Math.random() * 320;
  }

  update(dtMs) {
    this.life += dtMs;
    this.vy += 380 * (dtMs / 1000);
    const k = dtMs / 1000;
    this.x += this.vx * k;
    this.y += this.vy * k;
    this.vx *= Math.pow(0.984, dtMs);
    this.rot += this.vr * k;
  }

  draw(nowMs) {
    if (!ctx) return;
    const u = this.life / this.maxLife;
    if (u >= 1) return;
    const fade = (1 - u) * (1 - u);
    ctx.save();
    ctx.globalAlpha = fade * 0.88;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.fillStyle = "#2c1810";
    ctx.strokeStyle = "rgba(253, 224, 180, 0.42)";
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.moveTo(-this.size, this.size * 0.35);
    ctx.lineTo(this.size * 0.65, -this.size * 0.48);
    ctx.lineTo(this.size * 0.25, this.size * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = fade * 0.5;
    ctx.fillStyle = "rgba(214, 162, 112, 0.75)";
    ctx.beginPath();
    ctx.arc(this.size * 0.08, -this.size * 0.08, this.size * 0.22, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  get isDead() {
    return this.life > this.maxLife;
  }
}

class Fragment {
  constructor(opts) {
    this.x = opts?.x ?? 0;
    this.y = opts?.y ?? 0;
    this.vx = opts?.vx ?? (Math.random() - 0.5) * 120;
    this.vy = opts?.vy ?? (Math.random() - 0.5) * 120;

    this.life = 0;
    this.maxLife = opts?.maxLife ?? 2600;
    this.size = opts?.size ?? 1.6 + Math.random() * 2.2;
    this.hue = opts?.hue ?? modeHue(currentMode);
    this.seed = Math.random() * 9999;
    this.snagTotemLevel = normalizeSnagTotemLevel(opts?.snagTotemLevel ?? totemLevel);

    /** Harvest & Fill: snag burst → graceful arc to assigned totem point */
    this.harvest = opts?.harvest === true;
    this.harvestLevel = opts?.harvestLevel ?? totemLevel;
    this.destIndex = typeof opts?.destIndex === "number" ? opts.destIndex : -1;
    /** Resolved each frame from totemPointsByLevel[harvestLevel][destIndex] (like totemPoints.find). */
    this.targetPoint = null;
    /** Short motion tail for harvest direction read */
    this.harvestTrail = this.harvest ? [] : null;
    /** EMDR / vent / spiral: subtle lateral shimmer on top of seek */
    this.harvestSweep = opts?.harvestSweep === true;
    /** Orca spiral harvest: light curl layered on seek */
    this.harvestCentripetal = opts?.harvestCentripetal === true;

    // Wood-splinter burst before magnetism takes over
    this.burstMs = opts?.burstMs ?? 220;
    this.burstDrag = 0.955;

    // Persistent Spirit: once locked, a fragment stays bound to a specific animal's marking point
    this.locked = false;
    this.lockedLevel = null;
    this.lockedIndex = null;
    this.lockedAtMs = null;
    this.lockAngle = (Math.random() - 0.5) * 0.9;
    this.ink = Math.random() < 0.72 ? "CEDAR" : "RAVEN";
    /** Master Log: stick in place while tribal paint opacity eases in (geometry cache). */
    this.harvestSticking = false;
    /** After landing blend completes: pinned paint blob on log (does not decay). */
    this.harvestPainted = false;
    this.harvestLandAccum = 0;
    this.harvestPaintAngle = 0;

    /** Non-harvest magnet: single totem point index per tier (no full-array scan each frame). */
    this._pullMagnetTier = null;
    this._pullMagnetIndex = null;
    /** Throttle cache redraw while sticking to the log. */
    this._stickRedrawGateMs = 0;
  }

  syncMagnetPullTier() {
    const tl = typeof totemLevel === "number" ? totemLevel : 1;
    if (this._pullMagnetTier !== tl) {
      this._pullMagnetTier = tl;
      this._pullMagnetIndex = null;
    }
  }

  assignMagnetPullIndexOnce() {
    if (this._pullMagnetIndex != null) return;
    const tl = this._pullMagnetTier ?? (typeof totemLevel === "number" ? totemLevel : 1);
    const levelPts = totemPointsByLevel?.[tl] ?? totemPoints;
    if (!levelPts?.length) return;
    const hit =
      tl === 1 && levelPts[0]?.fillOrder !== undefined
        ? bestMagnetTarget(levelPts, this.x, this.y, totemLockCounts)
        : nearestTotemPointWithIndex(levelPts, this.x, this.y);
    this._pullMagnetTier = tl;
    this._pullMagnetIndex = hit ? hit.i : null;
  }

  requestTotemStickRedrawThrottled(nowMs) {
    const gap =
      typeof TOTEM_STICK_CACHE_REDRAW_MIN_MS === "number" ? TOTEM_STICK_CACHE_REDRAW_MIN_MS : 52;
    if (nowMs - this._stickRedrawGateMs < gap) return;
    this._stickRedrawGateMs = nowMs;
    if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
  }

  update(dtMs, nowMs) {
    this.life += dtMs;
    const t = clamp(this.life / this.maxLife, 0, 1);

    // —— Harvest journey: radial burst → smooth curved approach → land & fill point
    if (this.harvest && this.destIndex >= 0) {
      const lv = this.harvestLevel;

      if (this.harvestPainted) {
        const ptsP = totemPointsByLevel?.[lv];
        if (!ptsP?.length || this.destIndex >= ptsP.length) {
          if (typeof releaseHarvestDest === "function") releaseHarvestDest(lv, this.destIndex);
          this.life = this.maxLife + 1;
          return;
        }
        const destP = ptsP[this.destIndex];
        this.x = destP.x;
        this.y = destP.y;
        this.vx = this.vy = 0;
        return;
      }

      const pts = totemPointsByLevel?.[lv];
      if (!pts?.length || this.destIndex >= pts.length) {
        if (typeof releaseHarvestDest === "function") releaseHarvestDest(lv, this.destIndex);
        this.life = this.maxLife + 1;
        return;
      }
      if (isTotemActive(lv, this.destIndex) && !this.harvestSticking) {
        if (typeof releaseHarvestDest === "function") releaseHarvestDest(lv, this.destIndex);
        this.life = this.maxLife + 1;
        return;
      }

      const dest = pts[this.destIndex];
      this.targetPoint = dest;

      if (this.harvestSticking) {
        this.harvestLandAccum += dtMs;
        const dur =
          typeof TOTEM_HARVEST_STICK_DURATION_MS === "number" ? TOTEM_HARVEST_STICK_DURATION_MS : 1100;
        const u = clamp(this.harvestLandAccum / dur, 0, 1);
        const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
        this.x = dest.x;
        this.y = dest.y;
        this.vx = this.vy = 0;
        if (typeof setTotemLandingBlend === "function") setTotemLandingBlend(lv, this.destIndex, e);
        this.requestTotemStickRedrawThrottled(nowMs);
        if (u >= 1) {
          if (typeof releaseHarvestDest === "function") releaseHarvestDest(lv, this.destIndex);
          activateTotemPoint(lv, this.destIndex);
          if (dest) dest.active = true;
          if (typeof setTotemLandingBlend === "function") setTotemLandingBlend(lv, this.destIndex, null);
          if (typeof hapticFragmentLand === "function") hapticFragmentLand(nowMs);
          else if (navigator.vibrate) {
            try {
              navigator.vibrate(5);
            } catch (_) {}
          }
          this.harvestSticking = false;
          this.harvestPainted = true;
          if (typeof maybeSalmonPaintCompletionAfterHarvestLand === "function")
            maybeSalmonPaintCompletionAfterHarvestLand(nowMs, lv);
        }
        return;
      }

      if (this.life < this.burstMs) {
        const bd = Math.pow(0.982, dtMs);
        this.vx *= bd;
        this.vy *= bd;
        const px = -this.vy;
        const py = this.vx;
        const pl = Math.max(1e-3, Math.hypot(px, py));
        const curve = Math.sin((nowMs + this.seed) * 0.004) * 95 * (dtMs / 1000);
        this.vx += (px / pl) * curve;
        this.vy += (py / pl) * curve;
        this.x += this.vx * (dtMs / 1000);
        this.y += this.vy * (dtMs / 1000);
      } else {
        const dx = dest.x - this.x;
        const dy = dest.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d < 5) {
          this.harvestPaintAngle = Math.atan2(this.vy, this.vx);
          this.x = dest.x;
          this.y = dest.y;
          this.vx = this.vy = 0;
          this.harvestSticking = true;
          this.harvestLandAccum = 0;
          return;
        }
        const dtSec = dtMs * 0.001;
        const invd = 1 / Math.max(1e-3, d);
        const ux = dx * invd;
        const uy = dy * invd;

        const maxSeek = this.harvestSweep || this.harvestCentripetal ? 540 : 480;
        const desiredVx = ux * maxSeek;
        const desiredVy = uy * maxSeek;
        let steerPerSec = d < 90 ? 13.5 : 8.2;
        const k = 1 - Math.exp(-steerPerSec * dtSec);
        this.vx += (desiredVx - this.vx) * k;
        this.vy += (desiredVy - this.vy) * k;

        if (this.harvestSweep) {
          const px = -uy;
          const py = ux;
          const sweep = Math.sin((nowMs + this.seed) * 0.003) * 0.08;
          this.vx += px * sweep * 420 * dtSec;
          this.vy += py * sweep * 420 * dtSec;
        }
        if (this.harvestCentripetal) {
          const curl = 0.55 * dtSec;
          const c = Math.cos(curl);
          const s = Math.sin(curl);
          const tx = this.vx * c - this.vy * s;
          const ty = this.vx * s + this.vy * c;
          this.vx = tx;
          this.vy = ty;
          this.vx += ux * 120 * dtSec;
          this.vy += uy * 120 * dtSec;
        }

        const maxSp = this.harvestSweep || this.harvestCentripetal ? 560 : 500;
        let sp = Math.hypot(this.vx, this.vy);
        if (sp > maxSp) {
          const r = maxSp / sp;
          this.vx *= r;
          this.vy *= r;
        }
        this.x += this.vx * dtSec;
        this.y += this.vy * dtSec;
      }

      killFragmentIfOffscreen(this);
      if (this.life > this.maxLife) return;

      if (this.harvestTrail) {
        this.harvestTrail.push({ x: this.x, y: this.y });
        const maxTrail = 6;
        while (this.harvestTrail.length > maxTrail) this.harvestTrail.shift();
      }

      return;
    }

    // Mild drift + drag
    const drag = Math.pow(0.992, dtMs);
    this.vx *= drag;
    this.vy *= drag;

    // Splinter phase (burst outward), then magnetize into the totem formline
    if (this.life < this.burstMs) {
      const bd = Math.pow(this.burstDrag, dtMs);
      this.vx *= bd;
      this.vy *= bd;
    } else {
      // Magnet phase: one assigned totem index per tier; refresh only when totemLevel changes.
      this.syncMagnetPullTier();
      this.assignMagnetPullIndexOnce();

      if (!this.locked) {
        const idx = this._pullMagnetIndex;
        const tl = this._pullMagnetTier ?? (typeof totemLevel === "number" ? totemLevel : 1);
        const near = idx != null ? totemPointsByLevel?.[tl]?.[idx] : null;
        if (near) {
          const dHit = Math.hypot(this.x - near.x, this.y - near.y);
          if (dHit < 2) {
            const lvl = tl;
            this.locked = true;
            this.lockedLevel = lvl;
            this.lockedIndex = idx;
            this.lockedAtMs = nowMs;
            this.lockAngle = Math.atan2(this.vy, this.vx);
            if (typeof hapticFragmentLand === "function") hapticFragmentLand(nowMs);
            else if (navigator.vibrate) {
              try {
                navigator.vibrate(5);
              } catch (_) {}
            }
            if (lvl === 1 && Array.isArray(totemLockCounts) && idx >= 0 && idx < totemLockCounts.length) {
              totemLockCounts[idx]++;
              activateTotemPoint(lvl, idx);
              if (near) near.active = true;
            }
          }
        } else if (idx != null) {
          this._pullMagnetIndex = null;
        }
      }

      const targetPts = this.locked
        ? totemPointsByLevel?.[this.lockedLevel] ?? totemPoints
        : totemPointsByLevel?.[totemLevel] ?? totemPoints;

      let target = null;
      if (this.locked && targetPts?.[this.lockedIndex]) {
        target = targetPts[this.lockedIndex];
      } else if (!this.locked) {
        const mt = this._pullMagnetTier ?? (typeof totemLevel === "number" ? totemLevel : 1);
        const mi = this._pullMagnetIndex;
        if (mi != null && totemPointsByLevel?.[mt]?.[mi]) {
          target = totemPointsByLevel[mt][mi];
        }
      }

      if (target) {
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const d = Math.max(10, Math.hypot(dx, dy));
        const strength = (1 - t) * 0.95 + 0.18;
        const pull = (strength * 760) / d;
        this.vx += (dx / d) * pull * (dtMs / 1000);
        this.vy += (dy / d) * pull * (dtMs / 1000);
      }
    }

    // Small orbit noise
    const wob = 18 * (1 - t);
    this.vx += Math.sin((nowMs + this.seed) * 0.006) * wob * (dtMs / 1000);
    this.vy += Math.cos((nowMs + this.seed) * 0.006) * wob * (dtMs / 1000);

    this.x += this.vx * (dtMs / 1000);
    this.y += this.vy * (dtMs / 1000);

    killFragmentIfOffscreen(this);
  }

  draw() {
    if (!ctx) return;
    const t = clamp(this.life / this.maxLife, 0, 1);
    const fade = 1 - Math.pow(t, 1.6);

    if (this.harvest) {
      if (this.harvestPainted) {
        ctx.save();
        const pal = fragmentPaletteFromSnagLevel(this.snagTotemLevel);
        const ang = this.harvestPaintAngle;
        ctx.globalAlpha = 1;
        ctx.translate(this.x, this.y);
        ctx.rotate(ang);
        const g = ctx.createLinearGradient(-this.size * 2, 0, this.size * 2, 0);
        g.addColorStop(0, pal.harvestEdge);
        g.addColorStop(0.48, pal.harvestCore);
        g.addColorStop(1, pal.harvestMid);
        ctx.fillStyle = g;
        ctx.shadowBlur = 12;
        ctx.shadowColor = pal.harvestGlow;
        ctx.fillRect(-this.size * 1.95, -this.size * 0.62, this.size * 3.9, this.size * 1.22);
        ctx.shadowBlur = 0;
        ctx.fillStyle = pal.harvestHi;
        ctx.fillRect(-this.size * 1.1, -this.size * 0.28, this.size * 2.05, this.size * 0.52);
        ctx.restore();
        return;
      }

      ctx.save();
      const pal = fragmentPaletteFromSnagLevel(this.snagTotemLevel);
      const tr = this.harvestTrail;
      const ang = this.harvestSticking ? this.harvestPaintAngle : Math.atan2(this.vy, this.vx);
      if (tr && tr.length > 1 && !this.harvestSticking && !this.harvestPainted) {
        const wid = Math.max(0.55, this.size * 0.48);
        const len = this.size * 2.35;
        for (let i = 0; i < tr.length - 1; i++) {
          const u = i / Math.max(1, tr.length - 1);
          const a = fade * 0.52 * u * u;
          if (a < 0.02) continue;
          ctx.globalAlpha = a;
          ctx.fillStyle = pal.harvestTrail;
          ctx.setTransform(1, 0, 0, 1, tr[i].x, tr[i].y);
          ctx.rotate(ang);
          ctx.fillRect(-len * 0.5, -wid * 0.5, len, wid);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      const stickProgress = this.harvestSticking
        ? clamp(
            this.harvestLandAccum /
              (typeof TOTEM_HARVEST_STICK_DURATION_MS === "number"
                ? TOTEM_HARVEST_STICK_DURATION_MS
                : 1100),
            0,
            1
          )
        : 0;
      const localFade = this.harvestSticking ? 1 - stickProgress * 0.55 : fade;
      ctx.globalAlpha = localFade * 0.96;
      ctx.translate(this.x, this.y);
      ctx.rotate(ang);
      const g = ctx.createLinearGradient(-this.size * 2, 0, this.size * 2, 0);
      g.addColorStop(0, pal.harvestEdge);
      g.addColorStop(0.48, pal.harvestCore);
      g.addColorStop(1, pal.harvestMid);
      ctx.fillStyle = g;
      ctx.shadowBlur = 14;
      ctx.shadowColor = pal.harvestGlow;
      ctx.fillRect(-this.size * 1.95, -this.size * 0.62, this.size * 3.9, this.size * 1.22);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = localFade * 0.42;
      ctx.fillStyle = pal.harvestHi;
      ctx.fillRect(-this.size * 1.1, -this.size * 0.28, this.size * 2.05, this.size * 0.52);
      ctx.restore();
      return;
    }

    ctx.save();
    // Cedar-splinter fragment: elongated rectangle, rotates with motion, "inks in" after lock.
    const pal = fragmentPaletteFromSnagLevel(this.snagTotemLevel);
    const lockT = this.lockedAtMs ? clamp((performance.now() - this.lockedAtMs) / 1200, 0, 1) : 0;
    const alpha = (0.18 + 0.62 * lockT) * fade;
    ctx.globalAlpha = alpha;

    const inkColor = this.ink === "CEDAR" ? pal.splinterInk : pal.splinterAlt;
    const preColor = pal.splinterGhost;
    ctx.fillStyle = lockT > 0 ? inkColor : preColor;

    const ang = this.locked ? this.lockAngle : Math.atan2(this.vy, this.vx);
    const len = this.size * (2.3 + 2.0 * (1 - lockT));
    const wid = Math.max(0.9, this.size * 0.75);

    ctx.translate(this.x, this.y);
    ctx.rotate(ang);
    ctx.fillRect(-len * 0.5, -wid * 0.5, len, wid);

    // subtle highlight
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = pal.splinterHi;
    ctx.fillRect(-len * 0.45, -wid * 0.35, len * 0.9, Math.max(0.6, wid * 0.18));
    ctx.restore();
  }

  get isDead() {
    if (this.harvestPainted) return false;
    return this.life > this.maxLife;
  }
}

