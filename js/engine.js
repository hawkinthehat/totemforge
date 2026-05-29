(() => {
  "use strict";

  const SWEEP_CYCLE_MS = 10000;
  const SHATTER_DURATION_MS = 1500;
  const SHATTER_MIN_PARTICLES = 35;
  const SHATTER_MAX_PARTICLES = 45;
  const SECTOR_COUNT = 10;
  const COMPANION_CYCLE_MS = 19000;
  const COMPANION_INHALE_MS = 4000;
  const COMPANION_HOLD_MS = 7000;
  const COMPANION_EXHALE_MS = 8000;
  const COMPANION_SCALE_MIN = 1;
  const COMPANION_SCALE_MAX = 1.15;
  const SNAG_HIT_RADIUS_PX = 45;
  const PARTICLE_COLORS = ["#231b15", "#ba5536", "#f8f1df"];

  const state = {
    root: null,
    sectors: [],
    nextSectorIndex: 0,
    snag: null,
    snagHitZone: null,
    snagVisible: true,
    snagHiddenUntilMs: 0,
    snagY: 0,
    particleCanvas: null,
    particleCtx: null,
    particles: [],
    companion: null,
    rafId: 0,
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep01(v) {
    const x = clamp(v, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function hideLegacyUi() {
    const canvas = document.getElementById("gameCanvas");
    if (canvas) canvas.style.display = "none";
    document
      .querySelectorAll(
        ".hud, #gallery-practice-btn, #practice-motor-panel, #mentor-welcome-overlay, #potlatch-completion-dialogue, #suite-start-overlay, #salish-tooltip-root, #salish-reveal-toast"
      )
      .forEach((el) => {
        el.style.display = "none";
      });
  }

  function ensureStyles() {
    if (document.getElementById("layered-sweep-engine-style")) return;
    const style = document.createElement("style");
    style.id = "layered-sweep-engine-style";
    style.textContent = `
      #layered-sweep-engine {
        position: fixed;
        inset: 0;
        overflow: hidden;
        touch-action: none;
        z-index: 120;
        user-select: none;
        -webkit-user-select: none;
      }

      .layered-sweep-base {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(130% 110% at 50% 38%, rgba(255, 238, 176, 0.65) 0%, rgba(211, 170, 90, 0.54) 42%, rgba(148, 102, 47, 0.52) 100%),
          repeating-linear-gradient(
            8deg,
            rgba(118, 75, 32, 0.24) 0px,
            rgba(118, 75, 32, 0.24) 1px,
            rgba(242, 214, 145, 0.1) 2px,
            rgba(242, 214, 145, 0.1) 6px
          ),
          repeating-linear-gradient(
            96deg,
            rgba(89, 52, 21, 0.22) 0px,
            rgba(89, 52, 21, 0.22) 2px,
            rgba(227, 186, 111, 0.08) 3px,
            rgba(227, 186, 111, 0.08) 11px
          ),
          #cfa45d;
      }

      .layered-sweep-art {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        pointer-events: none;
      }

      .layered-sweep-art img {
        width: min(82vw, 920px);
        max-height: 80vh;
        object-fit: contain;
        filter: saturate(1.08) contrast(1.02);
      }

      .layered-sweep-mask {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: repeat(${SECTOR_COUNT}, 1fr);
        pointer-events: none;
      }

      .layered-sweep-sector {
        background: rgba(18, 14, 12, 0.86);
        border-right: 1px solid rgba(255, 255, 255, 0.02);
        transition: opacity 280ms linear;
      }

      .layered-sweep-sector.revealed {
        opacity: 0;
      }

      .layered-sweep-particles {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      .layered-sweep-snag {
        position: absolute;
        width: 64px;
        height: 64px;
        margin-left: -32px;
        margin-top: -32px;
        border-radius: 50%;
        background: radial-gradient(circle at 46% 42%, #8b3a1e 0%, #8b3a1e 45%, #6f2f17 75%, #4f2412 100%);
        border: 3px solid #4a2211;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.22) inset, 0 8px 24px rgba(0, 0, 0, 0.34);
        opacity: 1;
        transition: opacity 260ms ease;
        will-change: transform;
      }

      .layered-sweep-snag.hidden {
        opacity: 0;
      }

      .layered-sweep-snag-core {
        position: absolute;
        inset: 16px;
        border-radius: 50%;
        background: radial-gradient(circle at 38% 34%, rgba(255, 231, 214, 0.85), rgba(207, 104, 74, 0.8) 64%, rgba(139, 58, 30, 0.95) 100%);
        pointer-events: none;
      }

      .layered-sweep-snag-hit-zone {
        position: absolute;
        left: 50%;
        top: 50%;
        width: ${SNAG_HIT_RADIUS_PX * 2}px;
        height: ${SNAG_HIT_RADIUS_PX * 2}px;
        margin-left: -${SNAG_HIT_RADIUS_PX}px;
        margin-top: -${SNAG_HIT_RADIUS_PX}px;
        border-radius: 50%;
        background: transparent;
        border: none;
        padding: 0;
        outline: none;
        cursor: pointer;
        touch-action: none;
      }

      .layered-sweep-companion {
        position: absolute;
        right: max(18px, env(safe-area-inset-right, 0px));
        bottom: max(18px, env(safe-area-inset-bottom, 0px));
        width: min(24vw, 180px);
        height: min(24vw, 180px);
        display: grid;
        place-items: center;
        pointer-events: none;
        transform-origin: center center;
      }

      .layered-sweep-companion img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        filter: grayscale(1) contrast(1.4) brightness(0.15);
        opacity: 0.95;
      }

      .layered-sweep-companion::after {
        content: "";
        position: absolute;
        inset: 8%;
        border-radius: 50%;
        box-shadow: 0 0 24px 8px var(--companion-glow, #008080);
        opacity: var(--companion-glow-alpha, 0.5);
      }
    `;
    document.head.appendChild(style);
  }

  function createRoot() {
    const prior = document.getElementById("layered-sweep-engine");
    if (prior) prior.remove();

    const root = document.createElement("div");
    root.id = "layered-sweep-engine";
    root.setAttribute("role", "application");
    root.setAttribute("aria-label", "Layered Sweep Engine");

    const base = document.createElement("div");
    base.className = "layered-sweep-base";

    const art = document.createElement("div");
    art.className = "layered-sweep-art";
    const artImg = document.createElement("img");
    artImg.src = "totemforge-logo-icon.png";
    artImg.alt = "Salmon illustration";
    artImg.decoding = "async";
    art.appendChild(artImg);

    const mask = document.createElement("div");
    mask.className = "layered-sweep-mask";

    const sectors = [];
    for (let i = 0; i < SECTOR_COUNT; i++) {
      const sector = document.createElement("div");
      sector.className = "layered-sweep-sector";
      mask.appendChild(sector);
      sectors.push(sector);
    }

    const particleCanvas = document.createElement("canvas");
    particleCanvas.className = "layered-sweep-particles";
    particleCanvas.setAttribute("aria-hidden", "true");

    const snag = document.createElement("div");
    snag.className = "layered-sweep-snag";
    snag.setAttribute("aria-label", "Red cedar snag target");
    const snagCore = document.createElement("div");
    snagCore.className = "layered-sweep-snag-core";
    const snagHitZone = document.createElement("button");
    snagHitZone.type = "button";
    snagHitZone.className = "layered-sweep-snag-hit-zone";
    snagHitZone.setAttribute("aria-label", "Catch moving snag");
    snagHitZone.style.setProperty("pointer-events", "auto", "important");
    snag.append(snagCore, snagHitZone);

    const companion = document.createElement("div");
    companion.className = "layered-sweep-companion";
    companion.setAttribute("aria-hidden", "true");
    const companionImg = document.createElement("img");
    companionImg.src = "totemforge-logo-icon.png";
    companionImg.alt = "";
    companionImg.decoding = "async";
    companion.appendChild(companionImg);

    root.append(base, art, mask, particleCanvas, snag, companion);
    document.body.appendChild(root);

    state.root = root;
    state.sectors = sectors;
    state.snag = snag;
    state.snagHitZone = snagHitZone;
    state.particleCanvas = particleCanvas;
    state.particleCtx = particleCanvas.getContext("2d");
    state.companion = companion;
    state.nextSectorIndex = 0;
    state.particles.length = 0;
    state.snagVisible = true;
    state.snagHiddenUntilMs = 0;
  }

  function resizeCanvas() {
    if (!state.root || !state.particleCanvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = state.root.clientWidth;
    const h = state.root.clientHeight;
    state.particleCanvas.width = Math.max(1, Math.floor(w * dpr));
    state.particleCanvas.height = Math.max(1, Math.floor(h * dpr));
    if (state.particleCtx) state.particleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.snagY = h * 0.56;
  }

  function currentSweepState(nowMs) {
    if (!state.root) return { x: 0, direction: 1 };
    const w = state.root.clientWidth;
    const margin = Math.max(70, Math.min(120, w * 0.1));
    const span = Math.max(1, w - margin * 2);
    const p = ((nowMs % SWEEP_CYCLE_MS) + SWEEP_CYCLE_MS) % SWEEP_CYCLE_MS / SWEEP_CYCLE_MS;
    const triangle = p <= 0.5 ? p * 2 : (1 - p) * 2;
    const direction = p <= 0.5 ? 1 : -1;
    return {
      x: margin + span * triangle,
      direction,
    };
  }

  function updateSnag(nowMs) {
    if (!state.snag) return;
    const sweep = currentSweepState(nowMs);
    const angle = sweep.direction >= 0 ? 10 : -10;
    state.snag.style.transform = `translate3d(${sweep.x.toFixed(2)}px, ${state.snagY.toFixed(2)}px, 0) rotate(${angle}deg)`;

    const shouldBeVisible = nowMs >= state.snagHiddenUntilMs;
    if (shouldBeVisible !== state.snagVisible) {
      state.snagVisible = shouldBeVisible;
      state.snag.classList.toggle("hidden", !shouldBeVisible);
      state.snagHitZone?.style.setProperty("pointer-events", shouldBeVisible ? "auto" : "none", "important");
    }
  }

  function revealNextSector() {
    const i = state.nextSectorIndex;
    const sector = state.sectors[i];
    if (!sector) return null;
    sector.classList.add("revealed");
    state.nextSectorIndex++;
    return sector;
  }

  function spawnShatterParticles(x, y, sectorRect, nowMs) {
    const count =
      SHATTER_MIN_PARTICLES +
      Math.floor(Math.random() * (SHATTER_MAX_PARTICLES - SHATTER_MIN_PARTICLES + 1));

    for (let i = 0; i < count; i++) {
      const angle = randomBetween(0, Math.PI * 2);
      const dist = randomBetween(28, Math.max(sectorRect.width, sectorRect.height) * 0.72);
      const tx = clamp(x + Math.cos(angle) * dist, sectorRect.left + 8, sectorRect.right - 8);
      const ty = clamp(y + Math.sin(angle) * dist, sectorRect.top + 8, sectorRect.bottom - 8);
      state.particles.push({
        x0: x,
        y0: y,
        x1: tx,
        y1: ty,
        color: PARTICLE_COLORS[(Math.random() * PARTICLE_COLORS.length) | 0],
        size0: randomBetween(1.8, 4.2),
        startMs: nowMs,
      });
    }
  }

  function drawParticles(nowMs) {
    const ctx = state.particleCtx;
    if (!ctx || !state.particleCanvas) return;
    ctx.clearRect(0, 0, state.particleCanvas.width, state.particleCanvas.height);

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      const t = (nowMs - p.startMs) / SHATTER_DURATION_MS;
      if (t >= 1) {
        state.particles.splice(i, 1);
        continue;
      }

      const motion = smoothstep01(t);
      const x = lerp(p.x0, p.x1, motion);
      const y = lerp(p.y0, p.y1, motion);
      const alpha = 1 - motion;
      const r = lerp(p.size0, p.size0 * 0.25, motion);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function mixColor(a, b, t) {
    const u = clamp(t, 0, 1);
    const ra = parseInt(a.slice(1, 3), 16);
    const ga = parseInt(a.slice(3, 5), 16);
    const ba = parseInt(a.slice(5, 7), 16);
    const rb = parseInt(b.slice(1, 3), 16);
    const gb = parseInt(b.slice(3, 5), 16);
    const bb = parseInt(b.slice(5, 7), 16);
    const r = Math.round(lerp(ra, rb, u));
    const g = Math.round(lerp(ga, gb, u));
    const bCh = Math.round(lerp(ba, bb, u));
    return `rgb(${r}, ${g}, ${bCh})`;
  }

  function updateCompanion(nowMs) {
    if (!state.companion) return;
    const phaseMs = ((nowMs % COMPANION_CYCLE_MS) + COMPANION_CYCLE_MS) % COMPANION_CYCLE_MS;
    let scale = COMPANION_SCALE_MIN;
    let glowColor = "#008080";
    let glowAlpha = 0.5;

    if (phaseMs < COMPANION_INHALE_MS) {
      const t = smoothstep01(phaseMs / COMPANION_INHALE_MS);
      scale = lerp(COMPANION_SCALE_MIN, COMPANION_SCALE_MAX, t);
      glowColor = "#008080";
      glowAlpha = lerp(0.4, 0.8, t);
    } else if (phaseMs < COMPANION_INHALE_MS + COMPANION_HOLD_MS) {
      const holdT = (phaseMs - COMPANION_INHALE_MS) / COMPANION_HOLD_MS;
      const pulse = Math.sin(holdT * Math.PI * 2) * 0.005;
      scale = COMPANION_SCALE_MAX + pulse;
      glowColor = "#008080";
      glowAlpha = 0.55;
    } else {
      const exhaleT = smoothstep01(
        (phaseMs - COMPANION_INHALE_MS - COMPANION_HOLD_MS) / COMPANION_EXHALE_MS
      );
      scale = lerp(COMPANION_SCALE_MAX, COMPANION_SCALE_MIN, exhaleT);
      glowColor = mixColor("#008080", "#cc2929", exhaleT);
      glowAlpha = lerp(0.55, 0.88, exhaleT);
    }

    state.companion.style.transform = `scale(${scale.toFixed(4)})`;
    state.companion.style.setProperty("--companion-glow", glowColor);
    state.companion.style.setProperty("--companion-glow-alpha", glowAlpha.toFixed(4));
  }

  function onSnagCaught(event) {
    event.preventDefault();
    const nowMs = performance.now();
    if (nowMs < state.snagHiddenUntilMs || state.nextSectorIndex >= state.sectors.length) return;

    const hitX = event.clientX;
    const hitY = event.clientY;
    const revealed = revealNextSector();
    const sectorRect = revealed?.getBoundingClientRect();
    if (sectorRect) {
      spawnShatterParticles(hitX, hitY, sectorRect, nowMs);
    }

    state.snagHiddenUntilMs = nowMs + SHATTER_DURATION_MS;
    if (state.snagVisible) {
      state.snagVisible = false;
      state.snag?.classList.add("hidden");
      state.snagHitZone?.style.setProperty("pointer-events", "none", "important");
    }
  }

  function tick(nowMs) {
    updateSnag(nowMs);
    updateCompanion(nowMs);
    drawParticles(nowMs);
    state.rafId = window.requestAnimationFrame(tick);
  }

  function init() {
    ensureStyles();
    hideLegacyUi();
    createRoot();
    resizeCanvas();
    state.snagHitZone?.addEventListener("pointerdown", onSnagCaught, { passive: false });
    window.addEventListener("resize", resizeCanvas, { passive: true });
    state.rafId = window.requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
