// TotemForge Neural Suite globals (declared here, shared across modules)

/** Start overlay dismissed — enables gated `totemVibrate` calls (haptics.js). */
if (typeof window !== "undefined") window.totemSuiteInteractive = false;

// Canvas + context
let canvas = null;
let ctx = null;

// Simulation objects
let tomahawks = [];
let fragments = [];
/** Short-lived bark chips when a Cedar Snag shatters (physics.js). */
let logChips = [];

/** Hard cap on live fragments (engine trims oldest via shift). */
const FRAGMENTS_MAX_COUNT = 800;

// Totem field (updated by geometry)
let totemPoints = [];
let totemPointsByLevel = [];

/** Parallel to Level-1 Salmon totemPoints: fragment locks per index (border fills first). */
let totemLockCounts = [];

/** Per-level: each totem point “fills” when a fragment lands (ghost grey → solid cedar). */
const totemActivatedByLevel = { 1: [], 2: [], 3: [] };

/** Vertical camera pan (CSS px): centers the active carved block; updated by js/geometry.js */
let totemCameraY = 0;

/** Cinematic pan (CSS px): additive “scroll up” tween (+400 over 3s on level-up); updated by js/engine.js */
let globalCameraY = 0;

/** Highest animal tier that accepts harvest fragments (lags totemLevel until intro camera tween finishes). */
let totemHarvestTierUnlocked = 1;

/** Longhouse (gallery overview) → Forge (full-screen carve) → Potlatch (wrap ceremony). */
const TOTEM_PHASE_GALLERY = "gallery";
const TOTEM_PHASE_FORGE = "forge";
const TOTEM_PHASE_POTLATCH = "potlatch";

/** Gallery / Forge architecture (disables legacy auto ascension + 400-land tier jumps). */
const TOTEM_LONGHOUSE_FORGE = true;

let totemAppPhase = TOTEM_PHASE_GALLERY;
/** Tier currently being carved in Forge (synced to `totemLevel` while forging). */
let forgeTargetLevel = 1;

/** `{ startMs, durationMs, tier, maxWaitMs }` during Potlatch; otherwise `null`. */
let totemPotlatchCeremony = null;

/** Forge entrance: brief zoom-in from Longhouse (ms since epoch). */
let totemForgeEnterStartMs = 0;

/** Practice Forge: no persistence, no Potlatch; motor rules from `practiceMotorSkillTier`. */
let totemPracticeMode = false;
/** 1 = Standard (Salmon vent), 2 = Bilateral Orca pairs, 3 = Contralateral red/teal — practice only. */
let practiceMotorSkillTier = 1;
/** Snapshot of pole progress when entering practice; restored on exit. */
let _totemPracticeProgressBackup = null;

/** Full carve state (JSON). */
const TOTEM_PROGRESS_JSON_KEY = "totemforge_totem_progress_v1";
/** Spec / quick read: first incomplete tier (1–3) or `4` when pole is complete. */
const TOTEM_PROGRESS_LEVEL_KEY = "totem_progress";

/** Parsed from disk until first geometry freeze applies it to `totemActivatedByLevel`. */
let pendingTotemProgressJson = null;

let _totemProgressSaveTimer = null;

function getEffectiveHarvestLevel() {
  if (typeof TOTEM_LONGHOUSE_FORGE !== "undefined" && TOTEM_LONGHOUSE_FORGE) {
    if (totemAppPhase !== TOTEM_PHASE_FORGE) return 1;
    if (typeof totemPracticeMode !== "undefined" && totemPracticeMode) {
      const motor =
        typeof practiceMotorSkillTier === "number" ? practiceMotorSkillTier | 0 : 1;
      return Math.min(3, Math.max(1, motor));
    }
    const tl = typeof forgeTargetLevel === "number" ? forgeTargetLevel : totemLevel;
    const cap =
      typeof totemHarvestTierUnlocked === "number" ? totemHarvestTierUnlocked : 3;
    return Math.min(Math.max(1, tl), cap);
  }
  return Math.min(typeof totemLevel === "number" ? totemLevel : 1, totemHarvestTierUnlocked);
}

function totemGalleryTierIsLocked(level) {
  if (level <= 1) return false;
  return totemTierFillRatio(level - 1) < 0.996;
}

function totemGalleryTierCanEnterForge(level) {
  if (typeof totemRunComplete !== "undefined" && totemRunComplete) return false;
  if (level < 1 || level > 3) return false;
  if (totemGalleryTierIsLocked(level)) return false;
  if (typeof totemTierFillRatio === "function" && totemTierFillRatio(level) >= 0.995) return false;
  return true;
}

function enterTotemForgeFromGallery(level, nowMs = performance.now()) {
  if (!TOTEM_LONGHOUSE_FORGE) return;
  if (totemAppPhase !== TOTEM_PHASE_GALLERY) return;
  if (!totemGalleryTierCanEnterForge(level)) return;
  totemPracticeMode = false;
  _totemPracticeProgressBackup = null;
  totemAppPhase = TOTEM_PHASE_FORGE;
  forgeTargetLevel = level;
  totemLevel = level;
  totemHarvestTierUnlocked = level;
  totemForgeEnterStartMs = nowMs;
  globalCameraY = 0;
  totemGlobalCameraTween = null;
  totemSnagSpawnSuppressedUntilMs = 0;
  levelTransition = { active: false, startMs: 0, durationMs: 900, fromLevel: 0, toLevel: 0 };
  if (typeof setMode === "function") {
    setMode(level <= 1 ? MODE_SALMON_RUN : MODE_ORCA_WISDOM);
  }
  if (typeof invalidateTotemGeometry === "function") invalidateTotemGeometry();
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

function snapshotTotemProgressForPracticeBackup() {
  const clone = (lv) => (totemActivatedByLevel[lv] ? totemActivatedByLevel[lv].slice() : []);
  return {
    1: clone(1),
    2: clone(2),
    3: clone(3),
    totemLevel: typeof totemLevel === "number" ? totemLevel : 1,
    forgeTargetLevel: typeof forgeTargetLevel === "number" ? forgeTargetLevel : 1,
    totemHarvestTierUnlocked:
      typeof totemHarvestTierUnlocked === "number" ? totemHarvestTierUnlocked : 1,
    totemRunComplete: !!totemRunComplete,
  };
}

function restoreTotemProgressFromPracticeBackup() {
  const b = _totemPracticeProgressBackup;
  if (!b) return;
  for (let lv = 1; lv <= 3; lv++) {
    const src = b[lv];
    const dst = totemActivatedByLevel[lv];
    if (!src?.length || !dst?.length) continue;
    const n = Math.min(src.length, dst.length);
    for (let i = 0; i < n; i++) dst[i] = !!src[i];
  }
  totemLevel = b.totemLevel;
  forgeTargetLevel = b.forgeTargetLevel;
  totemHarvestTierUnlocked = b.totemHarvestTierUnlocked;
  totemRunComplete = b.totemRunComplete;
  _totemPracticeProgressBackup = null;
  if (typeof syncTotemPointActiveFlags === "function") syncTotemPointActiveFlags();
  if (typeof invalidateTotemGeometry === "function") invalidateTotemGeometry();
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

/**
 * Practice sandbox: same Forge loop without saving or Potlatch. Motor skill tier is toggled manually.
 */
function enterTotemPracticeForgeFromGallery(nowMs = performance.now()) {
  if (!TOTEM_LONGHOUSE_FORGE) return;
  if (totemAppPhase !== TOTEM_PHASE_GALLERY) return;
  if (typeof totemRunComplete !== "undefined" && totemRunComplete) return;
  _totemPracticeProgressBackup = snapshotTotemProgressForPracticeBackup();
  totemPracticeMode = true;
  practiceMotorSkillTier = 1;
  totemAppPhase = TOTEM_PHASE_FORGE;
  forgeTargetLevel = 1;
  totemLevel = 1;
  totemHarvestTierUnlocked = 3;
  totemForgeEnterStartMs = nowMs;
  globalCameraY = 0;
  totemGlobalCameraTween = null;
  totemSnagSpawnSuppressedUntilMs = 0;
  levelTransition = { active: false, startMs: 0, durationMs: 900, fromLevel: 0, toLevel: 0 };
  if (typeof setMode === "function") setMode(MODE_SALMON_RUN);
  if (typeof tomahawks !== "undefined" && Array.isArray(tomahawks)) tomahawks.length = 0;
  if (typeof fragments !== "undefined" && Array.isArray(fragments)) fragments.length = 0;
  if (typeof resetCedarSnagSpawnPlanningState === "function") resetCedarSnagSpawnPlanningState(nowMs);
  if (typeof invalidateTotemGeometry === "function") invalidateTotemGeometry();
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

function exitTotemPracticeForgeToGallery() {
  if (!totemPracticeMode) return;
  totemPracticeMode = false;
  practiceMotorSkillTier = 1;
  restoreTotemProgressFromPracticeBackup();
  totemAppPhase = TOTEM_PHASE_GALLERY;
  totemForgeEnterStartMs = 0;
  globalCameraY = 0;
  totemSnagSpawnSuppressedUntilMs = 0;
  if (typeof tomahawks !== "undefined" && Array.isArray(tomahawks)) tomahawks.length = 0;
  if (typeof fragments !== "undefined" && Array.isArray(fragments)) fragments.length = 0;
  if (typeof resetCedarSnagSpawnPlanningState === "function")
    resetCedarSnagSpawnPlanningState(performance.now());
  if (typeof clearForgeBilateralAwait === "function") clearForgeBilateralAwait();
  if (typeof resetForgeMissStreak === "function") resetForgeMissStreak();
}

/** Clear in-memory carve for tier 1 (practice sandbox loop at 100%). */
function resetTotemPracticeTierCarving() {
  const act = totemActivatedByLevel[1];
  if (act) for (let i = 0; i < act.length; i++) act[i] = false;
  if (typeof totemLockCounts !== "undefined" && Array.isArray(totemLockCounts)) totemLockCounts.fill(0);
  if (typeof clearHarvestDestReserved === "function") clearHarvestDestReserved();
  if (typeof syncTotemPointActiveFlags === "function") syncTotemPointActiveFlags();
  if (typeof invalidateTotemGeometry === "function") invalidateTotemGeometry();
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

function beginTotemPotlatchCeremony(nowMs, completedTier) {
  totemAppPhase = TOTEM_PHASE_POTLATCH;
  totemPotlatchCeremony = {
    startMs: nowMs,
    /** Minimum time for wrap visual; exit also waits on ceremony audio when present. */
    durationMs: 4200,
    maxWaitMs: 180000,
    tier: completedTier,
  };
  totemSnagSpawnSuppressedUntilMs = Number.MAX_SAFE_INTEGER;
  if (typeof tomahawks !== "undefined" && Array.isArray(tomahawks)) tomahawks.length = 0;
  if (typeof suspendTotemSoundscapeForPotlatch === "function") suspendTotemSoundscapeForPotlatch();
  if (typeof playTotemPotlatchCeremonyAudio === "function") playTotemPotlatchCeremonyAudio();
  if (completedTier >= 3) {
    if (typeof playTotemOspreyFinaleFluteCrescendo === "function") playTotemOspreyFinaleFluteCrescendo();
    if (typeof totemVibrate === "function") totemVibrate([400, 100, 400], { force: true });
  } else {
    /** Drum-aligned Potlatch haptics: 100, pause 50, 100, pause 50, 200 (ms). */
    if (typeof totemVibrate === "function") totemVibrate([100, 50, 100, 50, 200], { force: true });
  }
}

function completeTotemPotlatchCeremony(nowMs = performance.now()) {
  const tier = totemPotlatchCeremony?.tier ?? 1;
  totemPotlatchCeremony = null;
  totemAppPhase = TOTEM_PHASE_GALLERY;
  totemForgeEnterStartMs = 0;
  globalCameraY = 0;
  totemSnagSpawnSuppressedUntilMs = 0;

  const nextIncomplete =
    typeof totemFirstIncompleteTier === "function" ? totemFirstIncompleteTier() : null;
  totemHarvestTierUnlocked = Math.min(
    3,
    Math.max(typeof totemHarvestTierUnlocked === "number" ? totemHarvestTierUnlocked : 1, tier + 1)
  );
  forgeTargetLevel = nextIncomplete ?? 3;
  totemLevel = forgeTargetLevel;

  if (tier >= 3) {
    totemRunComplete = true;
    totemSnagSpawnSuppressedUntilMs = Number.MAX_SAFE_INTEGER;
    totemMidlineGlow = Math.max(typeof totemMidlineGlow === "number" ? totemMidlineGlow : 0, 4.2);
    _pacerStabilizedTextUntilMs = nowMs + 600000;
  } else {
    totemRunComplete = false;
  }

  if (typeof stopTotemPotlatchCeremonyAudio === "function") stopTotemPotlatchCeremonyAudio();
  if (typeof resumeTotemSoundscapeAfterPotlatch === "function") resumeTotemSoundscapeAfterPotlatch();

  if (typeof invalidateTotemGeometry === "function") invalidateTotemGeometry();
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
  if (typeof saveTotemProgressToStorage === "function") saveTotemProgressToStorage();
  if (typeof showPotlatchCompletionDialogue === "function") showPotlatchCompletionDialogue();
}

/** Fill ratio for the active totem tier (0..1). */
function totemTierFillRatio(level) {
  const act = totemActivatedByLevel[level];
  if (!act?.length) return 0;
  let c = 0;
  for (let i = 0; i < act.length; i++) if (act[i]) c++;
  return c / act.length;
}

/** First tier that is not fully carved (for Longhouse “next” highlight), or `null` if all complete. */
function totemFirstIncompleteTier() {
  for (let l = 1; l <= 3; l++) {
    if (totemTierFillRatio(l) < 0.995) return l;
  }
  return null;
}

/** Wall-clock target for completing one animal tier at steady snag + fragment rates (~4 minutes). */
const TOTEM_TARGET_TIER_DURATION_MS = 4 * 60 * 1000;

/** Midpoint of the 1500–2000 carved-point band per animal (geometry caps subsampled meshes to this). */
const TOTEM_EXPECTED_POINTS_PER_TIER = 1750;

/** TotemForge suite semver (UI + service worker generation). */
const TOTEM_SUITE_VERSION = "1.4.0";

/** KW’ÉKW’E Spirit Eye: ghost gaze + canvas shimmer from this carve ratio onward (final 10%). */
const TOTEM_SPIRIT_EYE_FILL_FRAC = 0.9;

/**
 * v1.3 KW’ÉTL’EN mobile grounding: shifts the stacked pole + Salmon anchor toward the bottom of the viewport
 * (fraction of window height, added to tier stack Y in `computeTotemLayout`).
 */
const TOTEM_MOBILE_GROUND_OFFSET_FRAC = 0.045;

/** KW’ÉTL’EN triple-circle tier may retain slightly more harvest indices before `capTotemLevelPoints` subsampling. */
const TOTEM_ORCA_MAX_TRIGGER_POINTS = 2200;

/** KW’ÉKW’E apex tier: ~2× Salmon point budget so the crown carve requires proportionally more lands. */
const TOTEM_OSPREY_MAX_TRIGGER_POINTS =
  typeof TOTEM_EXPECTED_POINTS_PER_TIER === "number" ? TOTEM_EXPECTED_POINTS_PER_TIER * 2 : 3500;

/** Cedar Snag harvest burst size (spawnHarvestFragments in physics.js). */
const TOTEM_FRAGMENTS_PER_SNAG_MIN = 15;
const TOTEM_FRAGMENTS_PER_SNAG_MAX = 20;

/** Harvest fragment “stick & paint” duration on Master Log (geometry + physics). */
const TOTEM_HARVEST_STICK_DURATION_MS = 1100;

// —— Flow-state Cedar pacing (spawn timer + snag motion; physics.js + engine.js)

/** Vagus cycle mirrors geometry.js breath pacer (12s → 4s inhale / 8s exhale). */
const FLOW_VAGUS_CYCLE_MS = 12000;
const FLOW_VAGUS_INHALE_MS = 4000;

/** Brisk Zen: steady rhythmic spawn cadence (1.5s between attempts when scaling is flat). */
const CEDAR_FLOW_SPAWN_INTERVAL_BASE_MS = 1500;
const CEDAR_FLOW_SPAWN_INTERVAL_MIN_MS = 1500;
const CEDAR_FLOW_SPAWN_INTERVAL_MAX_MS = 1500;

/** Streak scaling disabled for v1.0 predictable pacing (interval stays at BASE when rate is 1). */
const CEDAR_FLOW_SCALING_STEP_SHATTERS = 10;
const CEDAR_FLOW_SCALING_RATE_PER_STEP = 1;

/**
 * Brisk Zen: nominal edge→Master Log transit time (straight-line & Salmon vent initialization).
 * EMDR / Orca wave / dive use distinct paths; cruise speeds still scale from this nominal duration.
 */
const CEDAR_SNAG_TRAVEL_SEC_MIN = 4;
const CEDAR_SNAG_TRAVEL_SEC_MAX = 4;

/**
 * Within this distance (px) of the log aim point, snag speed eases down toward MIN_SPEED_MUL.
 */
const CEDAR_SNAG_APPROACH_EASE_START_PX = 340;

/** Speed multiplier at the aim point when fully inside the ease radius (smoothstep). */
const CEDAR_SNAG_APPROACH_EASE_MIN_SPEED_MUL = 0.5;

/** Snag motion targets this screen Y fraction — aligned with v1.3 grounded log (`geometry.js` + `totemMasterLogCenterYFrac`). */
const CEDAR_SNAG_TRAVEL_TARGET_Y_FRAC = 0.84;

/** Generous pointer radius for shattering (sweep-friendly, not FPS-style aiming). */
const CEDAR_SNAG_POINTER_HIT_RADIUS_PX = 40;

let cedarFlowSuccessStreakCount = 0;

function cedarFlowScalingSteps() {
  return Math.floor(cedarFlowSuccessStreakCount / CEDAR_FLOW_SCALING_STEP_SHATTERS);
}

/** Next spawn gap (ms): faster as streak climbs; clamped so UI stays playable. */
function getCedarSnagSpawnIntervalMs() {
  const steps = cedarFlowScalingSteps();
  let ms = CEDAR_FLOW_SPAWN_INTERVAL_BASE_MS / Math.pow(CEDAR_FLOW_SCALING_RATE_PER_STEP, Math.max(0, steps));
  return Math.max(
    CEDAR_FLOW_SPAWN_INTERVAL_MIN_MS,
    Math.min(CEDAR_FLOW_SPAWN_INTERVAL_MAX_MS, ms)
  );
}

function recordCedarFlowSuccessfulShatter() {
  cedarFlowSuccessStreakCount++;
}

/** Miss / wrong contralateral (no snag hit): resets difficulty scaling streak. */
function resetCedarFlowDifficulty() {
  cedarFlowSuccessStreakCount = 0;
}

/**
 * Inhale (4s): baseline snag speed multiplier. Exhale stays exactly 25% slower than inhale;
 * inhale is chosen so exhale lands at 1.0 — a calm “floating” floor (never sluggish crawl).
 */
const FLOW_VAGUS_INHALE_VELOCITY_MUL = 4 / 3;

/** Exhale (8s): inhale × 0.75 ⇒ exactly 1.0 with inhale = 4/3 (25% reduction, brisk zen floor). */
const FLOW_VAGUS_EXHALE_VELOCITY_MUL = FLOW_VAGUS_INHALE_VELOCITY_MUL * 0.75;

function getVagusSnagVelocityMultiplier(nowMs = performance.now()) {
  const t = ((nowMs % FLOW_VAGUS_CYCLE_MS) + FLOW_VAGUS_CYCLE_MS) % FLOW_VAGUS_CYCLE_MS;
  return t < FLOW_VAGUS_INHALE_MS ? FLOW_VAGUS_INHALE_VELOCITY_MUL : FLOW_VAGUS_EXHALE_VELOCITY_MUL;
}

/** Orca / Osprey tiers: +5% snag cruise speed per step above Salmon (1.0 → 1.05 → 1.10). */
function getTotemTierSnagVelocityMultiplier(snagTotemLevel) {
  const lv =
    typeof snagTotemLevel === "number" ? Math.min(3, Math.max(1, snagTotemLevel | 0)) : 1;
  return 1 + 0.05 * (lv - 1);
}

/** Random ∈ [min,max] seconds for travel pacing (called from Tomahawk). */
function randomCedarSnagTravelSeconds() {
  return (
    CEDAR_SNAG_TRAVEL_SEC_MIN +
    Math.random() * Math.max(0.01, CEDAR_SNAG_TRAVEL_SEC_MAX - CEDAR_SNAG_TRAVEL_SEC_MIN)
  );
}

/**
 * Orca / Osprey tier-up when carved fill reaches this fraction on the active tier.
 */
const TOTEM_LEVEL_UP_FILL_RATIO = 0.985;

/**
 * Salmon → Orca ascension: when Level 1 reachability hits this fill, begin camera scroll + Orca reveal.
 */
const TOTEM_ASCENSION_SALMON_FILL_RATIO = 0.95;

/** Ghost silhouette ramp duration after Salmon ascension (Orca fades in while camera scrolls). */
const TOTEM_ORCA_GHOST_REVEAL_MS = 3200;

let totemAscensionRevealStartMs = null;

/** Auto-snag spawn suppressed until this time (e.g. during Salmon ascension). */
let totemSnagSpawnSuppressedUntilMs = 0;

let _totemTierStartedMs = performance.now();

function resetTotemTierClock(nowMs = performance.now()) {
  _totemTierStartedMs = nowMs;
}

function resetTotemAscensionState() {
  totemAscensionRevealStartMs = null;
  totemSnagSpawnSuppressedUntilMs = 0;
}

/** Force Salmon tier fully carved so the base stays solid cedar when Orca is active. */
function finalizeSalmonTierSolid() {
  const pts = totemPointsByLevel?.[1];
  const act = totemActivatedByLevel[1];
  if (!pts?.length || !act?.length) return;
  for (let i = 0; i < act.length; i++) {
    act[i] = true;
    if (pts[i]) pts[i].active = true;
  }
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

/** Force Orca tier fully carved before Osprey ghost ascension. */
function finalizeOrcaTierSolid() {
  const pts = totemPointsByLevel?.[2];
  const act = totemActivatedByLevel[2];
  if (!pts?.length || !act?.length) return;
  for (let i = 0; i < act.length; i++) {
    act[i] = true;
    if (pts[i]) pts[i].active = true;
  }
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

/** Force Osprey tier fully carved at run finale (solid crown + stabilization read). */
function finalizeOspreyTierSolid() {
  const pts = totemPointsByLevel?.[3];
  const act = totemActivatedByLevel[3];
  if (!pts?.length || !act?.length) return;
  for (let i = 0; i < act.length; i++) {
    act[i] = true;
    if (pts[i]) pts[i].active = true;
  }
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

/** Solid-fill tier mesh before Potlatch (Longhouse flow). */
function finalizeForgeTierForCeremony(tier) {
  if (typeof totemPracticeMode !== "undefined" && totemPracticeMode) return;
  if (tier === 1 && typeof finalizeSalmonTierSolid === "function") finalizeSalmonTierSolid();
  else if (tier === 2 && typeof finalizeOrcaTierSolid === "function") finalizeOrcaTierSolid();
  else if (tier === 3 && typeof finalizeOspreyTierSolid === "function") finalizeOspreyTierSolid();
  if (typeof saveTotemProgressToStorage === "function") saveTotemProgressToStorage();
}

/**
 * 0→1 ease during ghost reveal after Salmon→Orca or Orca→Osprey ascension; 1 otherwise.
 * Cache should redraw while this is &lt; 1 for a smooth silhouette fade-in.
 */
function totemOrcaAscensionGhostRamp(nowMs = performance.now()) {
  const start = totemAscensionRevealStartMs;
  if (start == null || typeof totemLevel !== "number" || totemLevel < 2) return 1;
  const u = Math.min(1, Math.max(0, (nowMs - start) / TOTEM_ORCA_GHOST_REVEAL_MS));
  return 0.5 - 0.5 * Math.cos(Math.PI * u);
}

/**
 * Salmon → Orca: snag pause, haptics, solid Salmon base, camera scroll, Orca ghost ramp clock.
 * Caller must run only when totemLevel === 1.
 */
function beginTotemSalmonAscension(nowMs = performance.now()) {
  if (totemLevel !== 1) return;
  totemSnagSpawnSuppressedUntilMs = nowMs + 3000;
  finalizeSalmonTierSolid();
  totemAscensionRevealStartMs = nowMs;
  /** Salmon tier complete — long steady pulse (see haptics suite). */
  if (typeof totemVibrate === "function") totemVibrate(200);
  levelUp(nowMs);
  const pan =
    typeof window !== "undefined" && typeof window.startTotemLevelIntroPan === "function"
      ? window.startTotemLevelIntroPan
      : null;
  if (pan) pan(nowMs, totemLevel, { unlockHarvestNow: true });
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

/** 0–100: completion percentage for the given tier (activated points / total carved points). */
function totemTierCompletionPercent(level = totemLevel) {
  return Math.round(100 * Math.min(1, totemTierFillRatio(level)));
}

/** 0–1: wall-clock progress through the intended ~4 minute tier window (for pacing feedback). */
function totemTierPacingProgress(nowMs = performance.now()) {
  return Math.min(1, Math.max(0, (nowMs - _totemTierStartedMs) / TOTEM_TARGET_TIER_DURATION_MS));
}

/** Auto-snag interval (ms) derived so average snag yield × duration ≈ TOTEM_EXPECTED_POINTS_PER_TIER per tier. */
function totemAutoSpawnIntervalMs() {
  const avgFrag = (TOTEM_FRAGMENTS_PER_SNAG_MIN + TOTEM_FRAGMENTS_PER_SNAG_MAX) / 2;
  const snagsNeeded = Math.max(1, Math.ceil(TOTEM_EXPECTED_POINTS_PER_TIER / avgFrag));
  return TOTEM_TARGET_TIER_DURATION_MS / snagsNeeded;
}

/** GSAP-style global camera tween state (engine-owned lifecycle). */
let totemGlobalCameraTween = null;

function resetTotemCameraAll() {
  totemCameraY = 0;
  globalCameraY = 0;
  totemHarvestTierUnlocked = 1;
  totemGlobalCameraTween = null;
  resetTotemAscensionState();
}

/**
 * Per-level, per carving section: 0 = ghost, 1 = heavy opaque cedar (fragment lands add “paint” to whole section).
 * Keys match point.paintSection / marking (body, eye, joint, …).
 */
const totemSectionPaint = { 1: Object.create(null), 2: Object.create(null), 3: Object.create(null) };
const TOTEM_SECTION_PAINT_BUMP = 0.014;
const TOTEM_SECTION_PAINT_CAP = 1;

function bumpTotemSectionPaint(level, sectionKey, delta = TOTEM_SECTION_PAINT_BUMP) {
  if (level < 1 || level > 3 || sectionKey == null || sectionKey === "") return;
  const k = String(sectionKey);
  const m = totemSectionPaint[level];
  m[k] = Math.min(TOTEM_SECTION_PAINT_CAP, (m[k] ?? 0) + delta);
}

function getTotemSectionPaint(level, sectionKey) {
  if (level < 1 || level > 3 || sectionKey == null) return 0;
  return totemSectionPaint[level][String(sectionKey)] ?? 0;
}

function clearTotemSectionPaint() {
  for (let lv = 1; lv <= 3; lv++) totemSectionPaint[lv] = Object.create(null);
}

function syncTotemLockCounts(newLen) {
  if (newLen <= 0) {
    totemLockCounts = [];
    return;
  }
  if (totemLockCounts.length === newLen) return;
  const next = new Array(newLen).fill(0);
  const keep = Math.min(totemLockCounts.length, newLen);
  for (let i = 0; i < keep; i++) next[i] = totemLockCounts[i];
  totemLockCounts = next;
}

function syncTotemActivatedForLevel(level, newLen) {
  if (level < 1 || level > 3 || newLen <= 0) {
    totemActivatedByLevel[level] = [];
    return;
  }
  const cur = totemActivatedByLevel[level];
  if (cur.length === newLen) return;
  const next = new Array(newLen).fill(false);
  const keep = Math.min(cur.length, newLen);
  for (let i = 0; i < keep; i++) next[i] = cur[i];
  totemActivatedByLevel[level] = next;
}

function isTotemActive(level, index) {
  return !!(totemActivatedByLevel[level]?.[index]);
}

/**
 * Harvest fragments “paint” gradually: idx → 0..1 ease while stuck to log (geometry cache reads this).
 */
const totemLandingBlend = { 1: {}, 2: {}, 3: {} };

function getTotemLandingBlend(level, index) {
  const o = totemLandingBlend[level];
  if (!o || index < 0) return 0;
  const v = o[index];
  return typeof v === "number" ? v : 0;
}

function setTotemLandingBlend(level, index, t) {
  if (level < 1 || level > 3 || index < 0) return;
  const o = totemLandingBlend[level];
  if (t == null || t <= 0.001) {
    delete o[index];
    return;
  }
  o[index] = Math.min(1, Math.max(0, t));
}

function clearTotemLandingBlend() {
  for (let lv = 1; lv <= 3; lv++) totemLandingBlend[lv] = {};
}

const harvestDestReserved = { 1: {}, 2: {}, 3: {} };

function reserveHarvestDest(level, index) {
  if (level < 1 || level > 3 || index < 0) return;
  harvestDestReserved[level][index] = true;
}

function releaseHarvestDest(level, index) {
  if (level < 1 || level > 3 || index < 0) return;
  delete harvestDestReserved[level][index];
}

function clearHarvestDestReserved() {
  for (let lv = 1; lv <= 3; lv++) harvestDestReserved[lv] = {};
}

function activateTotemPoint(level, index) {
  const arr = totemActivatedByLevel[level];
  if (!arr || index < 0 || index >= arr.length) return;
  arr[index] = true;
  const pts = totemPointsByLevel?.[level];
  if (pts?.[index]) pts[index].active = true;
  if (totemLevel === level && totemPoints?.[index]) totemPoints[index].active = true;

  const p = pts?.[index];
  const sec = p?.paintSection ?? p?.marking ?? "body";
  bumpTotemSectionPaint(level, sec, TOTEM_SECTION_PAINT_BUMP);

  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
  if (typeof scheduleTotemProgressSave === "function") scheduleTotemProgressSave();
}

function packTotemActivationBits(level) {
  const arr = totemActivatedByLevel[level];
  if (!arr?.length) return "";
  let s = "";
  for (let i = 0; i < arr.length; i++) s += arr[i] ? "1" : "0";
  return s;
}

function saveTotemProgressToStorage() {
  if (typeof totemPracticeMode !== "undefined" && totemPracticeMode) return;
  try {
    const currentLevel =
      typeof totemFirstIncompleteTier === "function" ? totemFirstIncompleteTier() ?? 4 : 1;
    const payload = {
      v: 1,
      currentLevel,
      a1: packTotemActivationBits(1),
      a2: packTotemActivationBits(2),
      a3: packTotemActivationBits(3),
      runComplete: !!totemRunComplete,
    };
    localStorage.setItem(TOTEM_PROGRESS_JSON_KEY, JSON.stringify(payload));
    localStorage.setItem(TOTEM_PROGRESS_LEVEL_KEY, String(currentLevel));
  } catch (_) {}
}

function scheduleTotemProgressSave() {
  if (typeof totemPracticeMode !== "undefined" && totemPracticeMode) return;
  if (_totemProgressSaveTimer != null) window.clearTimeout(_totemProgressSaveTimer);
  _totemProgressSaveTimer = window.setTimeout(() => {
    _totemProgressSaveTimer = null;
    saveTotemProgressToStorage();
  }, 400);
}

function tryLoadTotemProgressPending() {
  try {
    const raw = localStorage.getItem(TOTEM_PROGRESS_JSON_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && o.v === 1 ? o : null;
  } catch (_) {
    return null;
  }
}

/**
 * Called from `geometry.js` once carved point arrays exist — merges disk bits into `totemActivatedByLevel`.
 */
function applyPendingTotemProgressHydration() {
  const p = pendingTotemProgressJson;
  if (!p || p.v !== 1) return;
  for (let lv = 1; lv <= 3; lv++) {
    const str = p["a" + lv];
    const arr = totemActivatedByLevel[lv];
    if (!str || !arr?.length) continue;
    const n = Math.min(arr.length, str.length);
    for (let i = 0; i < n; i++) arr[i] = str.charAt(i) === "1";
  }
  if (typeof totemRunComplete === "boolean") totemRunComplete = !!p.runComplete;
  const cl = typeof p.currentLevel === "number" ? p.currentLevel : 1;
  if (cl >= 1 && cl <= 3) {
    totemLevel = cl;
    totemHarvestTierUnlocked = Math.max(
      typeof totemHarvestTierUnlocked === "number" ? totemHarvestTierUnlocked : 1,
      cl
    );
    forgeTargetLevel = cl;
  } else if (cl === 4) {
    totemLevel = 3;
    forgeTargetLevel = 3;
    totemHarvestTierUnlocked = 3;
    totemRunComplete = true;
  }
  pendingTotemProgressJson = null;
}

function salmonFillRatio() {
  const a = totemActivatedByLevel[1];
  if (!a?.length) return 0;
  let c = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) c++;
  return c / a.length;
}

function clearAllTotemActivated() {
  for (let lv = 1; lv <= 3; lv++) totemActivatedByLevel[lv] = [];
  clearTotemSectionPaint();
  clearTotemLandingBlend();
  clearHarvestDestReserved();
  resetTotemAscensionState();
  resetSalmonHarvestPresentationState();
  resetTotemRunCompletionState();
  if (typeof TOTEM_LONGHOUSE_FORGE !== "undefined" && TOTEM_LONGHOUSE_FORGE) {
    totemAppPhase = TOTEM_PHASE_GALLERY;
    forgeTargetLevel = 1;
    totemPotlatchCeremony = null;
    totemLevel = 1;
    totemHarvestTierUnlocked = 1;
  }
  totemPracticeMode = false;
  practiceMotorSkillTier = 1;
  _totemPracticeProgressBackup = null;
  try {
    localStorage.removeItem(TOTEM_PROGRESS_JSON_KEY);
    localStorage.removeItem(TOTEM_PROGRESS_LEVEL_KEY);
  } catch (_) {}
}

/** Foveal anchoring: spike when an EMDR snag crosses the vertical midline (engine decays). */
let totemMidlineGlow = 0;

function bumpTotemMidlineGlow() {
  totemMidlineGlow = 1;
}

/** Master Log outline flash after shattering a Cedar Snag — geometry.js reads these globals. */
let totemLogOutlineFlashUntilMs = 0;
let totemLogOutlineFlashColor = "#ffffff";
const TOTEM_LOG_OUTLINE_FLASH_MS = 100;

function bumpTotemLogOutlineFlash(nowMs = performance.now(), colorHex = "#ffffff") {
  totemLogOutlineFlashUntilMs = nowMs + TOTEM_LOG_OUTLINE_FLASH_MS;
  totemLogOutlineFlashColor = String(colorHex || "#ffffff");
}

/**
 * Completed animals slide down the log by ~this fraction of one tier block per step above them,
 * so Salmon settles toward the log foot while the active ghost tier stays centered in view.
 */
const TOTEM_STACK_SLIDE_BLOCK_FRAC = 0.92;

/** Cumulative salmon-tier harvest paints completed while on Level 1 (see physics Fragment harvest). */
let salmonHarvestPaintLandCount = 0;
const SALMON_PAINT_COMPLETION_THRESHOLD = 400;

/** Orca (middle tier) — same 400 lands → slide tier + Osprey ghost (mirrors Salmon milestone). */
let orcaHarvestPaintLandCount = 0;
const ORCA_PAINT_COMPLETION_THRESHOLD = 400;

/** Presentation windows after “Salmon Completion” paint milestone. */
let totemSalmonCompletionGlowUntilMs = 0;
let _pacerGroundedTextUntilMs = 0;

function maybeSalmonPaintCompletionAfterHarvestLand(nowMs = performance.now(), harvestLevel) {
  if (typeof TOTEM_LONGHOUSE_FORGE !== "undefined" && TOTEM_LONGHOUSE_FORGE) return;
  if (typeof totemLevel !== "number" || totemLevel !== 1) return;
  if (harvestLevel !== 1) return;
  salmonHarvestPaintLandCount++;
  if (salmonHarvestPaintLandCount < SALMON_PAINT_COMPLETION_THRESHOLD) return;
  salmonHarvestPaintLandCount = 0;
  if (typeof fragments !== "undefined" && Array.isArray(fragments)) {
    for (let i = fragments.length - 1; i >= 0; i--) {
      const f = fragments[i];
      if (f?.harvestPainted && f.harvestLevel === 1) fragments.splice(i, 1);
    }
  }
  totemMidlineGlow = Math.max(typeof totemMidlineGlow === "number" ? totemMidlineGlow : 0, 3.5);
  totemSalmonCompletionGlowUntilMs = nowMs + 2800;
  _pacerGroundedTextUntilMs = nowMs + 4000;
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
  beginTotemSalmonAscension(nowMs);
}

/**
 * Orca → Osprey: 400 harvest paints on tier 2 — solid Orca block, camera pan, Osprey ghost ramp.
 * Caller must run only when `totemLevel === 2`.
 */
function beginTotemOrcaAscension(nowMs = performance.now()) {
  if (typeof totemLevel !== "number" || totemLevel !== 2) return;
  totemSnagSpawnSuppressedUntilMs = nowMs + 3000;
  finalizeOrcaTierSolid();
  totemAscensionRevealStartMs = nowMs;
  if (typeof totemVibrate === "function") totemVibrate(200);
  levelUp(nowMs);
  const pan =
    typeof window !== "undefined" && typeof window.startTotemLevelIntroPan === "function"
      ? window.startTotemLevelIntroPan
      : null;
  if (pan) pan(nowMs, totemLevel, { unlockHarvestNow: true });
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

function maybeOrcaPaintCompletionAfterHarvestLand(nowMs = performance.now(), harvestLevel) {
  if (typeof TOTEM_LONGHOUSE_FORGE !== "undefined" && TOTEM_LONGHOUSE_FORGE) return;
  if (typeof totemLevel !== "number" || totemLevel !== 2) return;
  if (harvestLevel !== 2) return;
  orcaHarvestPaintLandCount++;
  if (orcaHarvestPaintLandCount < ORCA_PAINT_COMPLETION_THRESHOLD) return;
  orcaHarvestPaintLandCount = 0;
  if (typeof fragments !== "undefined" && Array.isArray(fragments)) {
    for (let i = fragments.length - 1; i >= 0; i--) {
      const f = fragments[i];
      if (f?.harvestPainted && f.harvestLevel === 2) fragments.splice(i, 1);
    }
  }
  totemMidlineGlow = Math.max(typeof totemMidlineGlow === "number" ? totemMidlineGlow : 0, 3.5);
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
  beginTotemOrcaAscension(nowMs);
}

function resetSalmonHarvestPresentationState() {
  salmonHarvestPaintLandCount = 0;
  orcaHarvestPaintLandCount = 0;
  totemSalmonCompletionGlowUntilMs = 0;
  _pacerGroundedTextUntilMs = 0;
  totemLogOutlineFlashUntilMs = 0;
}

/** Osprey (crown tier) paint completion — 2× Salmon stick milestone (legacy non-Longhouse path). */
let ospreyHarvestPaintLandCount = 0;
const OSPREY_PAINT_COMPLETION_THRESHOLD =
  typeof SALMON_PAINT_COMPLETION_THRESHOLD === "number" ? SALMON_PAINT_COMPLETION_THRESHOLD * 2 : 800;

/** Run finale: stop snags until Escape reset; full-pole glow + STABILIZED pacer. */
let totemRunComplete = false;
let _pacerStabilizedTextUntilMs = 0;

function maybeOspreyPaintCompletionAfterHarvestLand(nowMs = performance.now(), harvestLevel) {
  if (typeof TOTEM_LONGHOUSE_FORGE !== "undefined" && TOTEM_LONGHOUSE_FORGE) return;
  if (totemRunComplete) return;
  if (typeof totemLevel !== "number" || totemLevel !== 3) return;
  if (harvestLevel !== 3) return;
  ospreyHarvestPaintLandCount++;
  if (ospreyHarvestPaintLandCount < OSPREY_PAINT_COMPLETION_THRESHOLD) return;
  ospreyHarvestPaintLandCount = 0;
  if (typeof fragments !== "undefined" && Array.isArray(fragments)) {
    for (let i = fragments.length - 1; i >= 0; i--) {
      const f = fragments[i];
      if (f?.harvestPainted && f.harvestLevel === 3) fragments.splice(i, 1);
    }
  }
  finalizeOspreyTierSolid();
  totemRunComplete = true;
  totemSnagSpawnSuppressedUntilMs = Number.MAX_SAFE_INTEGER;
  totemMidlineGlow = Math.max(typeof totemMidlineGlow === "number" ? totemMidlineGlow : 0, 4.2);
  _pacerStabilizedTextUntilMs = nowMs + 600000;
  if (typeof totemVibrate === "function") totemVibrate([120, 80, 160]);
  if (typeof requestTotemCacheRedraw === "function") requestTotemCacheRedraw();
}

function resetTotemRunCompletionState() {
  totemRunComplete = false;
  ospreyHarvestPaintLandCount = 0;
  _pacerStabilizedTextUntilMs = 0;
  if (typeof totemSnagSpawnSuppressedUntilMs === "number" && totemSnagSpawnSuppressedUntilMs > 1e15) {
    totemSnagSpawnSuppressedUntilMs = 0;
  }
}

/**
 * Vertical offset (px): slide finished tiers toward the log foot while the new ghost tier centers in view.
 * Eases from 0 → target during `levelTransition` (Salmon→Orca / Orca→Osprey).
 */
function totemCompletedTierSlidePx(level, blockH, nowMs = performance.now()) {
  if (typeof totemLevel !== "number" || level >= totemLevel) return 0;
  const gap =
    typeof TOTEM_STACK_SLIDE_BLOCK_FRAC === "number" ? TOTEM_STACK_SLIDE_BLOCK_FRAC : 0.92;
  const target = blockH * gap * (totemLevel - level);

  const trans =
    typeof levelTransition !== "undefined" && levelTransition?.active ? levelTransition : null;
  if (!trans?.active) return target;

  const prog = Math.min(1, Math.max(0, (nowMs - trans.startMs) / Math.max(1, trans.durationMs)));
  const easeT = 0.5 - 0.5 * Math.cos(Math.PI * prog);

  if (trans.fromLevel === 1 && trans.toLevel === 2 && level === 1) return target * easeT;
  if (trans.fromLevel === 2 && trans.toLevel === 3 && level <= 2) return target * easeT;

  return target;
}

// Modes + constants
const TWO_PI = Math.PI * 2;

/** Indexed remedy modes — UI / physics use these integers (0–3). */
const MODE_NEURAL_WEAVER = 0; // SXT’EKW — horizontal EMDR
const MODE_OSPREY_SCOUT = 1; // KW’ÉKW’E — saccadic grid
const MODE_SALMON_RUN = 2; // ST’ÉXEM — vertical vent
const MODE_ORCA_WISDOM = 3; // KW’ÉTL’EN — orbiting / spiral

let currentMode = MODE_NEURAL_WEAVER;

/**
 * Coast Salish animal names — permanent phonetic guides (lowercase syllable hints).
 * Used in HUD, gallery canvas, mentor copy, and tooltips.
 */
const SALISH_PHONETIC = Object.freeze({
  SXT_EKW: "suh-kh-t-ay-kw",
  KW_EKWE: "kwa-kwa",
  STEXEM: "stuh-ay-khuhm",
  KW_ETLEN: "kw-et-lun",
});

const MODE_REGISTRY = Object.freeze([
  {
    id: "NEURAL_WEAVER",
    label: "SXT’EKW",
    phonetic: SALISH_PHONETIC.SXT_EKW,
    subtitle: "Neural Weaver",
    movement: "Horizontal EMDR",
    hue: 195,
    color: "#38bdf8",
  },
  {
    id: "OSPREY_SCOUT",
    label: "KW’ÉKW’E",
    phonetic: SALISH_PHONETIC.KW_EKWE,
    subtitle: "Osprey Scout",
    movement: "Saccadic grid",
    hue: 205,
    color: "#22d3ee",
  },
  {
    id: "SALMON_RUN",
    label: "ST’ÉXEM",
    phonetic: SALISH_PHONETIC.STEXEM,
    subtitle: "Salmon Run",
    movement: "Vertical vent",
    hue: 290,
    color: "#c084fc",
  },
  {
    id: "ORCA_WISDOM",
    label: "KW’ÉTL’EN",
    phonetic: SALISH_PHONETIC.KW_ETLEN,
    subtitle: "Orca Wisdom",
    movement: "Orbiting / spiral",
    hue: 40,
    color: "#fbbf24",
  },
]);

function modeHue(modeIndex) {
  const m = MODE_REGISTRY[modeIndex];
  return m?.hue ?? 195;
}

function modeColor(modeIndex) {
  const m = MODE_REGISTRY[modeIndex];
  return m?.color ?? "#38bdf8";
}

function normalizeModeId(modeId) {
  const n = typeof modeId === "string" ? parseInt(modeId, 10) : Number(modeId);
  if (Number.isInteger(n) && n >= 0 && n < MODE_REGISTRY.length) return n;
  return MODE_NEURAL_WEAVER;
}

/**
 * Totem pole hierarchy: Base → Middle → Crown (three carved animals on one log).
 * Indexed by totemLevel 1..3 — see TOTEM_LEVELS.
 */
const TOTEM_LEVEL_REGISTRY = Object.freeze({
  1: {
    key: "SALMON",
    role: "base",
    label: "Salmon",
    salish: "ST’ÉXEM",
    phonetic: SALISH_PHONETIC.STEXEM,
    anchor: "Groundedness",
  },
  2: {
    key: "ORCA",
    role: "middle",
    label: "Orca",
    salish: "KW’ÉTL’EN",
    phonetic: SALISH_PHONETIC.KW_ETLEN,
    anchor: "Community & rhythm",
  },
  3: {
    key: "OSPREY",
    role: "crown",
    label: "Osprey",
    salish: "KW’ÉKW’E",
    phonetic: SALISH_PHONETIC.KW_EKWE,
    anchor: "Vision & focus",
  },
});

// Totem Pole progression (Salmon base → Orca middle → Osprey crown)
let totemLevel = 1; // 1..3
const TOTEM_LEVELS = Object.freeze([
  null,
  {
    id: "SALMON",
    tierRole: "base",
    label: "ST’ÉXEM",
    phonetic: SALISH_PHONETIC.STEXEM,
    focus: "Groundedness",
    threshold: TOTEM_EXPECTED_POINTS_PER_TIER,
  },
  {
    id: "ORCA",
    tierRole: "middle",
    label: "KW’ÉTL’EN",
    phonetic: SALISH_PHONETIC.KW_ETLEN,
    focus: "Community & Rhythm",
    threshold: TOTEM_EXPECTED_POINTS_PER_TIER,
  },
  {
    id: "OSPREY",
    tierRole: "crown",
    label: "KW’ÉKW’E",
    phonetic: SALISH_PHONETIC.KW_EKWE,
    focus: "Vision & Focus",
    threshold: TOTEM_EXPECTED_POINTS_PER_TIER,
  },
]);

let levelTransition = {
  active: false,
  startMs: 0,
  durationMs: 900,
  fromLevel: 0,
  toLevel: 0,
};

function levelUp(nowMs = performance.now()) {
  if (totemLevel >= TOTEM_LEVELS.length - 1) return false;
  const next = totemLevel + 1;
  const prev = totemLevel;
  /** Aligns with globalCameraY +400px / 3s intro pan in engine.js */
  const durationMs = prev === 1 && next === 2 ? 3000 : prev === 2 && next === 3 ? 3000 : 950;
  levelTransition = {
    active: true,
    startMs: nowMs,
    durationMs,
    fromLevel: prev,
    toLevel: next,
  };
  totemLevel = next;
  resetTotemTierClock(nowMs);
  return true;
}

/** Hue/color lookup by mode index (same order as MODE_REGISTRY). */
const MODES = MODE_REGISTRY;

function setMode(modeId) {
  currentMode = normalizeModeId(modeId);

  const buttons = document.querySelectorAll(".modes button[data-mode]");
  for (const b of buttons) {
    b.setAttribute("aria-pressed", normalizeModeId(b.dataset.mode) === currentMode ? "true" : "false");
    const idx = parseInt(b.dataset.mode, 10);
    const m = MODE_REGISTRY[idx];
    if (m?.label && m?.phonetic) {
      b.title = m.subtitle ? `${m.label} (${m.phonetic}) — ${m.subtitle}` : `${m.label} (${m.phonetic})`;
    }
  }
}

// Wire up mode buttons early (canvas init happens in engine.js)
window.addEventListener("DOMContentLoaded", () => {
  const buttons = document.querySelectorAll(".modes button[data-mode]");
  for (const b of buttons) {
    b.addEventListener("click", () => {
      if (typeof unlockTotemAudio === "function") unlockTotemAudio();
      setMode(b.dataset.mode);
    });
  }
  setMode(currentMode);

  const muteBtn = document.getElementById("audio-mute-toggle");
  if (muteBtn) {
    muteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof toggleTotemAudioMuted === "function") toggleTotemAudioMuted();
    });
  }
  if (typeof refreshTotemMuteButtonUi === "function") refreshTotemMuteButtonUi();
});
