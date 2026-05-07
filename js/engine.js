// Engine: canvas init, input, and animation loop.

let _lastNow = performance.now();
let _lastBreath = { phase: "EXHALE", breath01: 0, scaleMultiplier: 1 };
let _prevBreathPhase = "EXHALE";
let _breathHapticPrimed = false;
let _levelCooldown = 0;
/** EMDR grid sequencing lives in physics.js (cedarConsumeEmrdGridCell). */
let lastZone = -1;

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
    label.textContent = _lastBreath.phase === "INHALE" ? "Inhale" : "Exhale";
  }

  label.dataset.mode = currentMode;

  // Match pacer clarity to breathing expansion
  const s = _lastBreath.scaleMultiplier ?? 1;
  const pulse = 0.92 + (s - 0.88) * 1.35;
  label.style.transform = `translate(-50%, -50%) scale(${pulse.toFixed(3)})`;
  label.style.opacity = `${Math.min(0.96, 0.55 + (_lastBreath.breath01 ?? 0) * 0.45)}`;
}

function playWoodSnapForMode(clientX, snagOrVent) {
  if (typeof playWoodSnap !== "function") return;
  const w = window.innerWidth || 1;
  if (currentMode === MODE_NEURAL_WEAVER || currentMode === MODE_OSPREY_SCOUT || currentMode === MODE_ORCA_WISDOM) {
    playWoodSnap(clientX, clientX < w * 0.5 ? 0 : 2);
  } else if (currentMode === MODE_SALMON_RUN) {
    let vent = snagOrVent?.verticalVent;
    if (!vent && typeof snagOrVent === "string") vent = snagOrVent;
    if (vent === "TOP" || vent === "BOTTOM") playWoodSnap(clientX, undefined, { verticalVent: vent });
    else playWoodSnap(clientX);
  } else playWoodSnap(clientX);
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

function tryShatterSnag(canvasX, canvasY) {
  const idx =
    typeof findTomahawkSnagHitIndex === "function" ? findTomahawkSnagHitIndex(canvasX, canvasY) : -1;
  if (idx < 0) return false;

  const snag = tomahawks[idx];
  const hue = snag.hue ?? modeHue(currentMode);
  const sx = snag.x;
  const sy = snag.y;
  tomahawks.splice(idx, 1);
  playWoodSnapForMode(canvasX, snag);
  addImpactRipple(sx, sy, performance.now());
  if (typeof spawnLogChips === "function") spawnLogChips(sx, sy, performance.now());
  if (typeof spawnHarvestFragments === "function")
    spawnHarvestFragments(sx, sy, hue, snag.verticalVent, snag.snagTotemLevel);
  else burstFragmentsFromSnag(sx, sy, hue, snag.snagTotemLevel);
  if (typeof recordCedarFlowSuccessfulShatter === "function") recordCedarFlowSuccessfulShatter();
  if (typeof bumpTotemLogOutlineFlash === "function") bumpTotemLogOutlineFlash(performance.now(), modeColor(currentMode));
  bumpScreenShake(performance.now());
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
    tomahawks.push(
      new Tomahawk({
        spiralAngleHint: hint,
        x: w * 0.5,
        y: h * 0.52,
        hue: modeHue(currentMode),
        mode: MODE_ORCA_WISDOM,
        maxLife: 3800,
      })
    );
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

  clearFrame();

  const sh = screenShakeOffset(nowMs);
  ctx.save();
  ctx.translate(sh.x, sh.y);

  // Totem mesh + Master Log (geometry.js): Log is a single scaled fillRect + ~6 grain lines (fast path).
  _lastBreath = generateTotem(nowMs) ?? _lastBreath;
  if (_breathHapticPrimed) {
    if (_lastBreath.phase === "INHALE" && _prevBreathPhase === "EXHALE") {
      if (typeof hapticBreathPacerInhale === "function") hapticBreathPacerInhale();
    } else if (_lastBreath.phase === "EXHALE" && _prevBreathPhase === "INHALE") {
      if (typeof hapticBreathPacerExhale === "function") hapticBreathPacerExhale();
    }
  } else {
    _breathHapticPrimed = true;
  }
  _prevBreathPhase = _lastBreath.phase;
  updatePacerLabel(nowMs);

  // Cedar Snag auto-spawn: ~900ms timer (scales +5% / 10 streak), max 2 living, spiral gate (physics.js).
  const snagAscensionBlocked =
    typeof totemSnagSpawnSuppressedUntilMs === "number" && nowMs < totemSnagSpawnSuppressedUntilMs;
  if (
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

  if (typeof updateTotemSoundscape === "function") {
    updateTotemSoundscape(nowMs, _lastBreath, tomahawks, currentMode);
  }

  if (typeof totemMidlineGlow === "number") totemMidlineGlow *= 0.905;

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

  // Ascension / tier-up: Salmon→Orca at 95%; Orca→Osprey at configured fill; camera + haptics on later tiers.
  _levelCooldown -= dtMs;
  if (_levelCooldown <= 0) {
    const maxTotem = (typeof TOTEM_LEVELS !== "undefined" ? TOTEM_LEVELS.length : 4) - 1;
    const ascFill =
      typeof TOTEM_ASCENSION_SALMON_FILL_RATIO === "number" ? TOTEM_ASCENSION_SALMON_FILL_RATIO : 0.95;
    const tierUpFill =
      typeof TOTEM_LEVEL_UP_FILL_RATIO === "number" ? TOTEM_LEVEL_UP_FILL_RATIO : 0.985;

    if (
      totemLevel === 1 &&
      typeof totemTierFillRatio === "function" &&
      totemTierFillRatio(1) >= ascFill &&
      typeof beginTotemSalmonAscension === "function"
    ) {
      beginTotemSalmonAscension(nowMs);
      _levelCooldown = 1400;
    } else if (
      totemLevel < maxTotem &&
      totemLevel >= 2 &&
      typeof totemTierFillRatio === "function" &&
      totemTierFillRatio(totemLevel) >= tierUpFill
    ) {
      if (levelUp(nowMs)) {
        _levelCooldown = 1400;
        startTotemLevelIntroPan(nowMs, totemLevel);
        if (navigator.vibrate) {
          try {
            navigator.vibrate([100, 50, 100]);
          } catch (_) {}
        }
      }
    }
  }

  requestAnimationFrame(animate);
}

function init() {
  canvas = document.getElementById("gameCanvas");
  if (!canvas) throw new Error('Missing <canvas id="gameCanvas">');
  ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) throw new Error("Unable to create 2D canvas context");

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  canvas.addEventListener("pointerdown", (e) => {
    if (typeof unlockTotemAudio === "function") unlockTotemAudio();
    const { x: cx, y: cy } = canvasPointFromEvent(e);
    if (typeof setTotemClickPan === "function") setTotemClickPan(cx, performance.now());
    // Neural Suite: ripples / harvest only when a Cedar Snag is hit within pointer radius + contralateral rules (physics.js).
    if (tryShatterSnag(cx, cy)) return;
    if (typeof resetCedarFlowAfterMiss === "function") resetCedarFlowAfterMiss(performance.now());
    if (navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch (_) {}
    }
  });

  // Useful reset shortcut
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
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
      if (typeof resetTotemPoleCamera === "function") resetTotemPoleCamera();
      else if (typeof resetTotemCameraAll === "function") resetTotemCameraAll();
      if (typeof totemMidlineGlow === "number") totemMidlineGlow = 0;
      _screenShakeUntilMs = 0;
      totemLevel = 1;
      levelTransition = { active: false, startMs: 0, durationMs: 900, fromLevel: 0, toLevel: 0 };
      lastZone = -1;
    }
  });

  if (typeof resetCedarSnagSpawnPlanningState === "function") resetCedarSnagSpawnPlanningState(performance.now());

  requestAnimationFrame((t) => {
    _lastNow = t;
    animate(t);
  });
}

window.addEventListener("DOMContentLoaded", init);

