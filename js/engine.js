// Layered Sweep Engine with static SVG assets (no dynamic path tracking).
(() => {
  "use strict";

  const SECTOR_COUNT = 9;
  const SWEEP_CYCLE_MS = 10000;
  const SHATTER_MS = 1500;
  const TOUCH_RADIUS_PX = 45;
  const PARTICLE_MIN = 35;
  const PARTICLE_MAX = 45;
  const BREATH_CYCLE_MS = 19000;
  const BREATH_INHALE_MS = 4000;
  const BREATH_HOLD_MS = 7000;
  const BREATH_EXHALE_MS = 8000;
  const PARTICLE_COLORS = ["#231b15", "#ba5536", "#f8f1df"];

  const state = {
    root: null,
    snag: null,
    sectors: [],
    particles: null,
    companion: null,
    revealedCount: 0,
    snagHiddenUntil: 0,
    snagIsHidden: false,
    engineStartMs: 0,
    breathStartMs: 0,
    rafId: 0,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(start, end, t) {
    return start + (end - start) * t;
  }

  function easeInOut(t) {
    const n = clamp(t, 0, 1);
    return n * n * (3 - 2 * n);
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function ensureStyles() {
    if (document.getElementById("totemforge-layered-sweep-style")) return;

    const style = document.createElement("style");
    style.id = "totemforge-layered-sweep-style";
    style.textContent = `
      #totemforge-layered-sweep {
        position: fixed;
        inset: 0;
        z-index: 200;
        overflow: hidden;
        touch-action: none;
        font-family: Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }

      #totemforge-layered-sweep .tf-base-layer {
        position: absolute;
        inset: 0;
        background:
          repeating-linear-gradient(
            92deg,
            rgba(252, 228, 170, 0.25) 0px,
            rgba(252, 228, 170, 0.25) 2px,
            rgba(188, 132, 76, 0.24) 3px,
            rgba(188, 132, 76, 0.24) 11px
          ),
          radial-gradient(circle at 15% 24%, rgba(253, 225, 163, 0.34) 0%, transparent 41%),
          radial-gradient(circle at 84% 70%, rgba(109, 69, 40, 0.35) 0%, transparent 36%),
          linear-gradient(160deg, #8e5a33 0%, #c58b55 40%, #f4c987 64%, #9a6238 100%);
        filter: saturate(1.08) contrast(1.06);
      }

      #totemforge-layered-sweep .tf-brand-header {
        position: absolute;
        top: max(12px, env(safe-area-inset-top, 0px));
        left: 50%;
        transform: translateX(-50%);
        z-index: 7;
        display: flex;
        flex-direction: column;
        align-items: center;
        pointer-events: none;
      }

      #totemforge-layered-sweep .tf-hawk-icon {
        width: 48px;
        height: 48px;
        margin-bottom: 8px;
        fill: rgba(255, 255, 255, 0.75);
        display: block;
      }

      #totemforge-layered-sweep .tf-brand-title {
        letter-spacing: 0.32em;
        text-transform: uppercase;
        font-weight: 700;
        font-size: 11px;
        color: #cbd5e1;
      }

      #totemforge-layered-sweep .tf-art-layer {
        position: absolute;
        left: 50%;
        top: 52%;
        width: min(94vw, 1140px);
        height: min(72vh, 690px);
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 1;
      }

      #totemforge-layered-sweep .tf-art-layer svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      #totemforge-layered-sweep .tf-mask-layer {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: repeat(${SECTOR_COUNT}, minmax(0, 1fr));
        z-index: 2;
        pointer-events: none;
      }

      #totemforge-layered-sweep .tf-sector {
        background: rgba(8, 6, 5, 0.91);
        box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.03);
        opacity: 1;
        transition: opacity 220ms ease;
      }

      #totemforge-layered-sweep .tf-sector.is-revealed {
        opacity: 0;
      }

      #totemforge-layered-sweep .tf-particle-layer {
        position: absolute;
        inset: 0;
        z-index: 5;
        pointer-events: none;
      }

      #totemforge-layered-sweep .tf-particle {
        position: absolute;
        left: 0;
        top: 0;
        border-radius: 999px;
        opacity: 1;
        transform: translate(0px, 0px) scale(1);
        transition: transform ${SHATTER_MS}ms linear, opacity ${SHATTER_MS}ms linear;
      }

      #totemforge-layered-sweep #tf-red-cedar-snag {
        position: absolute;
        left: 0;
        top: 0;
        width: ${TOUCH_RADIUS_PX * 2}px;
        height: ${TOUCH_RADIUS_PX * 2}px;
        transform: translate(-50%, -50%);
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        cursor: pointer;
        touch-action: none;
        pointer-events: auto !important;
        opacity: 1;
        transition: opacity 240ms ease;
        z-index: 6;
      }

      #totemforge-layered-sweep #tf-red-cedar-snag.is-hidden {
        opacity: 0;
        pointer-events: none !important;
      }

      #totemforge-layered-sweep .tf-touch-zone {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        pointer-events: auto !important;
      }

      #totemforge-layered-sweep .tf-snag-shell {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 36px;
        height: 28px;
        transform: translate(-50%, -50%);
        border-radius: 58% 42% 52% 48% / 62% 54% 46% 38%;
        border: 3px solid #4a2211;
        background: linear-gradient(160deg, #7f3119 0%, #8f3f23 52%, #6a2b16 100%);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
        pointer-events: none;
      }

      #totemforge-layered-sweep .tf-snag-core {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 14px;
        height: 10px;
        transform: translate(-16%, -62%);
        border-radius: 999px;
        background: #8b3a1e;
        pointer-events: none;
      }

      #totemforge-layered-sweep .tf-vagus-companion {
        position: absolute;
        right: max(22px, env(safe-area-inset-right, 0px));
        bottom: max(20px, env(safe-area-inset-bottom, 0px));
        width: min(26vw, 180px);
        min-width: 132px;
        z-index: 6;
        pointer-events: none;
        transform-origin: 50% 50%;
      }

      #totemforge-layered-sweep .tf-vagus-companion svg {
        width: 100%;
        height: auto;
        display: block;
        fill: rgba(11, 11, 11, 0.94);
        stroke: rgba(255, 255, 255, 0.26);
        stroke-width: 3;
      }
    `;
    document.head.appendChild(style);
  }

  function hawkIconMarkup() {
    return `
      <svg class="tf-hawk-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path d="M8 35 L28 30 L41 20 L54 14 L49 25 L58 24 L48 33 L46 41 L37 39 L27 47 L17 45 L24 38 L8 35 Z"></path>
      </svg>
    `;
  }

  function salmonArtMarkup() {
    return `
      <svg viewBox="0 0 1200 700" role="img" aria-label="Salmon illustration">
        <defs>
          <linearGradient id="tf-salmon-body" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#f8d7a9"></stop>
            <stop offset="38%" stop-color="#f3c892"></stop>
            <stop offset="72%" stop-color="#e8a95f"></stop>
            <stop offset="100%" stop-color="#c97842"></stop>
          </linearGradient>
          <linearGradient id="tf-salmon-top" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#7e2f1f"></stop>
            <stop offset="100%" stop-color="#b45836"></stop>
          </linearGradient>
          <linearGradient id="tf-salmon-belly" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#f9ebce"></stop>
            <stop offset="100%" stop-color="#f8dfb9"></stop>
          </linearGradient>
          <filter id="tf-salmon-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#1b130d" flood-opacity="0.4"></feDropShadow>
          </filter>
        </defs>
        <g transform="translate(80 52)" filter="url(#tf-salmon-shadow)">
          <path
            d="M130 315 C215 215 388 168 620 176 C771 182 907 246 965 322 C905 392 766 452 616 460 C390 473 220 425 130 330 C82 368 54 373 34 362 C57 340 69 322 69 322 C69 322 56 302 34 280 C55 268 83 274 130 315 Z"
            fill="url(#tf-salmon-body)"
            stroke="#231b15"
            stroke-width="13"
            stroke-linejoin="round"
          ></path>
          <path
            d="M146 298 C238 219 418 192 617 201 C770 206 862 250 931 322 C860 390 764 430 615 434 C424 439 246 414 146 346"
            fill="none"
            stroke="url(#tf-salmon-top)"
            stroke-width="56"
            stroke-linecap="round"
            opacity="0.96"
          ></path>
          <path
            d="M166 346 C274 398 424 421 614 414 C726 408 814 380 896 322 C810 269 719 248 619 244 C425 238 278 260 166 303"
            fill="none"
            stroke="url(#tf-salmon-belly)"
            stroke-width="42"
            stroke-linecap="round"
            opacity="0.92"
          ></path>
          <path
            d="M374 324 C417 301 485 293 550 301 C519 333 515 354 553 390 C491 396 419 383 374 360 C348 347 348 337 374 324 Z"
            fill="#6f2d1f"
            stroke="#231b15"
            stroke-width="10"
          ></path>
          <ellipse cx="724" cy="314" rx="54" ry="36" fill="#f8f1df" stroke="#231b15" stroke-width="10"></ellipse>
          <ellipse cx="731" cy="314" rx="22" ry="15" fill="#231b15"></ellipse>
          <path
            d="M286 330 C314 288 320 257 299 219 C354 242 391 266 424 311 C389 355 354 381 299 407 C320 369 315 343 286 330 Z"
            fill="#d8884d"
            stroke="#231b15"
            stroke-width="8"
          ></path>
          <path
            d="M518 408 C560 420 612 420 658 406 C634 453 626 492 624 548 C586 496 552 451 518 408 Z"
            fill="#c66f3b"
            stroke="#231b15"
            stroke-width="8"
          ></path>
        </g>
      </svg>
    `;
  }

  function companionMarkup() {
    return `
      <svg viewBox="0 0 420 210" role="img" aria-label="Salmon companion silhouette">
        <path d="M42 112 C82 66 174 40 280 45 C346 49 386 76 404 112 C385 146 342 168 277 170 C173 174 84 153 42 122 C28 132 17 134 9 128 C19 120 23 112 23 112 C23 112 18 104 9 96 C17 90 29 92 42 112 Z"></path>
      </svg>
    `;
  }

  function hideLegacyRenderingSurface() {
    const selectors = [
      "#gameCanvas",
      ".hud",
      "#gallery-practice-btn",
      "#practice-motor-panel",
      "#mentor-welcome-overlay",
      "#potlatch-completion-dialogue",
      "#suite-start-overlay",
      "#salish-tooltip-root",
      "#salish-reveal-toast",
    ];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        node.style.display = "none";
      });
    });
  }

  function createRoot() {
    const oldRoot = document.getElementById("totemforge-layered-sweep");
    if (oldRoot) oldRoot.remove();

    const root = document.createElement("div");
    root.id = "totemforge-layered-sweep";
    root.setAttribute("role", "application");
    root.setAttribute("aria-label", "Layered sweep engine");

    const baseLayer = document.createElement("div");
    baseLayer.className = "tf-base-layer";

    const brandHeader = document.createElement("div");
    brandHeader.className = "tf-brand-header";
    brandHeader.innerHTML = `${hawkIconMarkup()}<div class="tf-brand-title">Totemforge Neural Suite</div>`;

    const artLayer = document.createElement("div");
    artLayer.className = "tf-art-layer";
    artLayer.innerHTML = salmonArtMarkup();

    const maskLayer = document.createElement("div");
    maskLayer.className = "tf-mask-layer";
    const sectors = [];
    for (let index = 0; index < SECTOR_COUNT; index += 1) {
      const sector = document.createElement("div");
      sector.className = "tf-sector";
      sector.dataset.sector = String(index);
      maskLayer.appendChild(sector);
      sectors.push(sector);
    }

    const particleLayer = document.createElement("div");
    particleLayer.className = "tf-particle-layer";

    const snag = document.createElement("button");
    snag.id = "tf-red-cedar-snag";
    snag.type = "button";
    snag.setAttribute("aria-label", "Tap moving red cedar snag target");
    snag.innerHTML = `
      <span class="tf-touch-zone"></span>
      <span class="tf-snag-shell"></span>
      <span class="tf-snag-core"></span>
    `;
    snag.style.setProperty("pointer-events", "auto", "important");

    const companion = document.createElement("div");
    companion.className = "tf-vagus-companion";
    companion.innerHTML = companionMarkup();

    root.append(baseLayer, artLayer, maskLayer, particleLayer, snag, companion, brandHeader);
    document.body.appendChild(root);

    state.root = root;
    state.snag = snag;
    state.sectors = sectors;
    state.particles = particleLayer;
    state.companion = companion;
    state.revealedCount = 0;
    state.snagHiddenUntil = 0;
    state.snagIsHidden = false;
  }

  function revealNextSector() {
    if (state.revealedCount >= state.sectors.length) return null;
    const targetSector = state.sectors[state.revealedCount];
    if (!targetSector) return null;
    targetSector.classList.add("is-revealed");
    state.revealedCount += 1;
    return targetSector;
  }

  function spawnShatterBurst(clientX, clientY, sectorNode) {
    if (!state.root || !state.particles || !sectorNode) return;

    const rootBounds = state.root.getBoundingClientRect();
    const sectorBounds = sectorNode.getBoundingClientRect();
    const originX = clientX - rootBounds.left;
    const originY = clientY - rootBounds.top;
    const count = PARTICLE_MIN + Math.floor(Math.random() * (PARTICLE_MAX - PARTICLE_MIN + 1));
    const sectorMinX = sectorBounds.left - rootBounds.left;
    const sectorMaxX = sectorBounds.right - rootBounds.left;
    const sectorMinY = sectorBounds.top - rootBounds.top;
    const sectorMaxY = sectorBounds.bottom - rootBounds.top;

    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("span");
      const size = randomBetween(2.2, 6.3);
      particle.className = "tf-particle";
      particle.style.width = `${size.toFixed(2)}px`;
      particle.style.height = `${size.toFixed(2)}px`;
      particle.style.left = `${originX.toFixed(2)}px`;
      particle.style.top = `${originY.toFixed(2)}px`;
      particle.style.background = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
      state.particles.appendChild(particle);

      const targetX = randomBetween(sectorMinX, sectorMaxX);
      const targetY = randomBetween(sectorMinY, sectorMaxY);
      const deltaX = targetX - originX;
      const deltaY = targetY - originY;
      const scale = randomBetween(0.55, 1.65);

      requestAnimationFrame(() => {
        particle.style.transform = `translate(${deltaX.toFixed(2)}px, ${deltaY.toFixed(2)}px) scale(${scale.toFixed(2)})`;
        particle.style.opacity = "0";
      });

      window.setTimeout(() => particle.remove(), SHATTER_MS + 80);
    }
  }

  function hideSnag() {
    if (!state.snag) return;
    state.snag.classList.add("is-hidden");
    state.snagIsHidden = true;
  }

  function showSnag() {
    if (!state.snag) return;
    state.snag.classList.remove("is-hidden");
    state.snagIsHidden = false;
  }

  function onSnagTouch(event) {
    event.preventDefault();
    const nowMs = performance.now();
    if (nowMs < state.snagHiddenUntil) return;

    const sectorIndex = state.revealedCount;
    const sectorNode = revealNextSector();
    if (!sectorNode) return;

    if (typeof window.unlockTotemAudio === "function") window.unlockTotemAudio();
    if (typeof window.setTotemClickPan === "function") window.setTotemClickPan(event.clientX, nowMs);
    if (typeof window.playWoodSnap === "function") window.playWoodSnap(event.clientX, sectorIndex % 3);
    if (typeof window.playTotemFluteStrike === "function") {
      window.playTotemFluteStrike(SHATTER_MS);
    }

    hideSnag();
    spawnShatterBurst(event.clientX, event.clientY, sectorNode);
    state.snagHiddenUntil = nowMs + SHATTER_MS;
  }

  function snagSweepPosition(nowMs, width, height) {
    const cycleMs = (nowMs - state.engineStartMs) % SWEEP_CYCLE_MS;
    const halfCycle = SWEEP_CYCLE_MS / 2;
    const travel = cycleMs <= halfCycle ? cycleMs / halfCycle : 1 - (cycleMs - halfCycle) / halfCycle;
    const minX = width * 0.06;
    const maxX = width * 0.94;
    return {
      x: minX + (maxX - minX) * travel,
      y: height * 0.52,
    };
  }

  function colorLerp(from, to, t) {
    const a = {
      r: (from >> 16) & 255,
      g: (from >> 8) & 255,
      b: from & 255,
    };
    const b = {
      r: (to >> 16) & 255,
      g: (to >> 8) & 255,
      b: to & 255,
    };
    const mix = clamp(t, 0, 1);
    const r = Math.round(lerp(a.r, b.r, mix));
    const g = Math.round(lerp(a.g, b.g, mix));
    const bl = Math.round(lerp(a.b, b.b, mix));
    return `rgb(${r}, ${g}, ${bl})`;
  }

  function updateCompanionBreath(nowMs) {
    if (!state.companion) return;

    const phaseMs = (nowMs - state.breathStartMs) % BREATH_CYCLE_MS;
    let scale = 1;
    let glowColor = "rgb(0, 128, 128)";

    if (phaseMs < BREATH_INHALE_MS) {
      const inhaleProgress = easeInOut(phaseMs / BREATH_INHALE_MS);
      scale = lerp(1, 1.15, inhaleProgress);
      glowColor = "rgb(0, 128, 128)";
    } else if (phaseMs < BREATH_INHALE_MS + BREATH_HOLD_MS) {
      const holdProgress = (phaseMs - BREATH_INHALE_MS) / BREATH_HOLD_MS;
      const pulse = Math.sin(holdProgress * Math.PI * 2) * 0.008;
      scale = 1.15 + pulse;
      glowColor = "rgb(0, 128, 128)";
    } else {
      const exhaleProgress = easeInOut((phaseMs - BREATH_INHALE_MS - BREATH_HOLD_MS) / BREATH_EXHALE_MS);
      scale = lerp(1.15, 1, exhaleProgress);
      glowColor = colorLerp(0x008080, 0xcc2929, exhaleProgress);
    }

    state.companion.style.transform = `scale(${scale.toFixed(4)})`;
    state.companion.style.filter =
      `drop-shadow(0 0 8px ${glowColor}) ` +
      `drop-shadow(0 0 20px ${glowColor})`;
  }

  function animate(nowMs) {
    if (state.root && state.snag) {
      const bounds = state.root.getBoundingClientRect();
      const position = snagSweepPosition(nowMs, bounds.width, bounds.height);
      state.snag.style.left = `${position.x.toFixed(2)}px`;
      state.snag.style.top = `${position.y.toFixed(2)}px`;
    }

    if (state.snagIsHidden && nowMs >= state.snagHiddenUntil) {
      showSnag();
    }

    updateCompanionBreath(nowMs);
    state.rafId = requestAnimationFrame(animate);
  }

  function bindInteractions() {
    if (!state.snag) return;
    state.snag.addEventListener("pointerdown", onSnagTouch, { passive: false });
  }

  function init() {
    ensureStyles();
    hideLegacyRenderingSurface();
    createRoot();
    bindInteractions();
    state.engineStartMs = performance.now();
    state.breathStartMs = state.engineStartMs;
    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(animate);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
