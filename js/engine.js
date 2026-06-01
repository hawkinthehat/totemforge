// Layered sweep renderer with sector reveal progression.
(() => {
  "use strict";

  const SECTOR_COUNT = 9;
  const FULL_SWEEP_CYCLE_MS = 10000;
  const PARTICLE_DURATION_MS = 1500;
  const PARTICLE_MIN = 35;
  const PARTICLE_MAX = 45;
  const SNAG_RESPAWN_FADE_MS = 280;
  const SNAG_TOUCH_RADIUS_PX = 45;
  const PARTICLE_COLORS = ["#231b15", "#ba5536", "#f8f1df"];
  const SECTOR_REVEAL_ORDER = Array.from({ length: SECTOR_COUNT }, (_, i) => i);

  const state = {
    root: null,
    snag: null,
    particleLayer: null,
    sectors: [],
    revealedSectors: new Set(),
    nextRevealStep: 0,
    hiddenUntil: 0,
    snagHidden: false,
    rafId: 0,
  };

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function pingPong01(t) {
    const phase = t - Math.floor(t);
    return phase < 0.5 ? phase * 2 : 2 - phase * 2;
  }

  function ensureStyles() {
    if (document.getElementById("layered-sweep-engine-style")) return;
    const style = document.createElement("style");
    style.id = "layered-sweep-engine-style";
    style.textContent = `
      #layered-sweep-engine {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 120;
        overflow: hidden;
        touch-action: none;
        background: #1c130f;
      }
      #layered-sweep-engine .lse-base-layer {
        position: absolute;
        inset: 0;
        background:
          repeating-linear-gradient(
            90deg,
            rgba(252, 221, 154, 0.22) 0px,
            rgba(252, 221, 154, 0.22) 2px,
            rgba(177, 117, 61, 0.24) 2px,
            rgba(177, 117, 61, 0.24) 9px
          ),
          radial-gradient(circle at 14% 24%, rgba(243, 206, 128, 0.35) 0%, transparent 42%),
          radial-gradient(circle at 84% 68%, rgba(124, 76, 44, 0.33) 0%, transparent 36%),
          linear-gradient(165deg, #8f5b32 0%, #d8a56f 38%, #f4cf92 62%, #9a643d 100%);
        filter: saturate(1.08) contrast(1.04);
      }
      #layered-sweep-engine .lse-salmon-layer {
        position: absolute;
        left: 50%;
        top: 50%;
        width: min(93vw, 1160px);
        height: min(72vh, 700px);
        transform: translate(-50%, -50%);
        pointer-events: none;
      }
      #layered-sweep-engine .lse-mask-layer {
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-columns: repeat(${SECTOR_COUNT}, minmax(0, 1fr));
        pointer-events: none;
      }
      #layered-sweep-engine .lse-sector-mask {
        background: rgba(9, 7, 6, 0.9);
        box-shadow: inset -1px 0 rgba(255, 255, 255, 0.03);
        opacity: 1;
        visibility: visible;
      }
      #layered-sweep-engine .lse-sector-mask.sector-revealed {
        opacity: 0;
        visibility: hidden;
      }
      #layered-sweep-engine .lse-particles {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      #layered-sweep-engine .lse-particle {
        position: absolute;
        left: 0;
        top: 0;
        border-radius: 999px;
        opacity: 1;
        transform: translate(0px, 0px) scale(1);
        transition:
          transform ${PARTICLE_DURATION_MS}ms linear,
          opacity ${PARTICLE_DURATION_MS}ms linear;
        will-change: transform, opacity;
      }
      #layered-sweep-engine #layered-snag {
        position: absolute;
        left: 0;
        top: 0;
        width: ${SNAG_TOUCH_RADIUS_PX * 2}px;
        height: ${SNAG_TOUCH_RADIUS_PX * 2}px;
        transform: translate(-50%, -50%);
        border: 0;
        background: transparent;
        padding: 0;
        margin: 0;
        cursor: pointer;
        touch-action: none;
        pointer-events: auto !important;
        opacity: 1;
        transition: opacity ${SNAG_RESPAWN_FADE_MS}ms ease;
      }
      #layered-sweep-engine #layered-snag.lse-hidden {
        opacity: 0;
        pointer-events: none !important;
      }
      #layered-sweep-engine .lse-hit-cushion {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: transparent;
        pointer-events: auto !important;
      }
      #layered-sweep-engine .lse-snag-shell {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 34px;
        height: 26px;
        border-radius: 58% 42% 48% 52% / 62% 52% 48% 38%;
        background: linear-gradient(148deg, #7e341f 0%, #ba5536 42%, #d38363 82%, #9a3c24 100%);
        border: 2px solid rgba(35, 27, 21, 0.95);
        transform: translate(-50%, -50%);
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.34);
        pointer-events: none;
      }
      #layered-sweep-engine .lse-snag-core {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 13px;
        height: 9px;
        border-radius: 999px;
        background: rgba(248, 241, 223, 0.94);
        transform: translate(-20%, -64%);
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function createSalmonArtMarkup() {
    return `
      <svg viewBox="0 0 1200 700" role="img" aria-label="Salmon illustration">
        <defs>
          <linearGradient id="salmonBodyFill" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#f8d7a9" />
            <stop offset="37%" stop-color="#f2c389" />
            <stop offset="75%" stop-color="#ebad63" />
            <stop offset="100%" stop-color="#c97a42" />
          </linearGradient>
          <linearGradient id="salmonTopBand" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#7a2f20" />
            <stop offset="100%" stop-color="#b65536" />
          </linearGradient>
          <linearGradient id="salmonBellyBand" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#f9ebce" />
            <stop offset="100%" stop-color="#f2ddba" />
          </linearGradient>
          <filter id="salmonShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#1b130e" flood-opacity="0.35" />
          </filter>
        </defs>
        <g transform="translate(80 50)" filter="url(#salmonShadow)">
          <path
            d="M130 315 C215 215 388 168 620 176 C771 182 907 246 965 322 C905 392 766 452 616 460 C390 473 220 425 130 330 C82 368 54 373 34 362 C57 340 69 322 69 322 C69 322 56 302 34 280 C55 268 83 274 130 315 Z"
            fill="url(#salmonBodyFill)"
            stroke="#231b15"
            stroke-width="13"
            stroke-linejoin="round"
          />
          <path
            d="M146 298 C238 219 418 192 617 201 C770 206 862 250 931 322 C860 390 764 430 615 434 C424 439 246 414 146 346"
            fill="none"
            stroke="url(#salmonTopBand)"
            stroke-width="56"
            stroke-linecap="round"
            opacity="0.96"
          />
          <path
            d="M166 346 C274 398 424 421 614 414 C726 408 814 380 896 322 C810 269 719 248 619 244 C425 238 278 260 166 303"
            fill="none"
            stroke="url(#salmonBellyBand)"
            stroke-width="42"
            stroke-linecap="round"
            opacity="0.92"
          />
          <path
            d="M374 324 C417 301 485 293 550 301 C519 333 515 354 553 390 C491 396 419 383 374 360 C348 347 348 337 374 324 Z"
            fill="#6f2d1f"
            stroke="#231b15"
            stroke-width="10"
          />
          <ellipse cx="724" cy="314" rx="54" ry="36" fill="#f8f1df" stroke="#231b15" stroke-width="10" />
          <ellipse cx="731" cy="314" rx="22" ry="15" fill="#231b15" />
          <path
            d="M286 330 C314 288 320 257 299 219 C354 242 391 266 424 311 C389 355 354 381 299 407 C320 369 315 343 286 330 Z"
            fill="#d8884d"
            stroke="#231b15"
            stroke-width="8"
          />
          <path
            d="M518 408 C560 420 612 420 658 406 C634 453 626 492 624 548 C586 496 552 451 518 408 Z"
            fill="#c66f3b"
            stroke="#231b15"
            stroke-width="8"
          />
        </g>
      </svg>
    `;
  }

  function hideLegacyUi() {
    const canvas = document.getElementById("gameCanvas");
    if (canvas) canvas.style.display = "none";
    document.querySelectorAll(".hud, #gallery-practice-btn, #practice-motor-panel").forEach((element) => {
      element.style.display = "none";
    });
  }

  function nextSectorIndexInProgression() {
    while (state.nextRevealStep < SECTOR_REVEAL_ORDER.length) {
      const sectorIndex = SECTOR_REVEAL_ORDER[state.nextRevealStep];
      if (!state.revealedSectors.has(sectorIndex)) return sectorIndex;
      state.nextRevealStep += 1;
    }
    return -1;
  }

  function revealSector(sectorIndex) {
    if (sectorIndex < 0 || sectorIndex >= state.sectors.length) return;
    const sectorNode = state.sectors[sectorIndex];
    if (!sectorNode || state.revealedSectors.has(sectorIndex)) return;
    state.revealedSectors.add(sectorIndex);
    state.nextRevealStep += 1;
    sectorNode.classList.add("sector-revealed");
  }

  function spawnParticleBurst(pageX, pageY, sectorNode) {
    if (!state.particleLayer || !state.root) return;
    const rootBounds = state.root.getBoundingClientRect();
    const sectorBounds = sectorNode.getBoundingClientRect();
    const startX = pageX - window.scrollX - rootBounds.left;
    const startY = pageY - window.scrollY - rootBounds.top;
    const count = PARTICLE_MIN + Math.floor(Math.random() * (PARTICLE_MAX - PARTICLE_MIN + 1));

    const sectorMinX = sectorBounds.left - rootBounds.left;
    const sectorMaxX = sectorBounds.right - rootBounds.left;
    const sectorMinY = sectorBounds.top - rootBounds.top;
    const sectorMaxY = sectorBounds.bottom - rootBounds.top;

    for (let i = 0; i < count; i += 1) {
      const particle = document.createElement("span");
      const size = randomBetween(2.2, 5.4);
      particle.className = "lse-particle";
      particle.style.width = `${size.toFixed(2)}px`;
      particle.style.height = `${size.toFixed(2)}px`;
      particle.style.left = `${startX.toFixed(2)}px`;
      particle.style.top = `${startY.toFixed(2)}px`;
      particle.style.background = PARTICLE_COLORS[(Math.random() * PARTICLE_COLORS.length) | 0];
      state.particleLayer.appendChild(particle);

      const tx = randomBetween(sectorMinX, sectorMaxX);
      const ty = randomBetween(sectorMinY, sectorMaxY);
      const deltaX = tx - startX;
      const deltaY = ty - startY;
      const scale = randomBetween(0.6, 1.7);
      requestAnimationFrame(() => {
        particle.style.transform = `translate(${deltaX.toFixed(2)}px, ${deltaY.toFixed(2)}px) scale(${scale.toFixed(2)})`;
        particle.style.opacity = "0";
      });
      window.setTimeout(() => particle.remove(), PARTICLE_DURATION_MS + 60);
    }
  }

  function hideSnagImmediately() {
    if (!state.snag) return;
    state.snag.classList.add("lse-hidden");
    state.snagHidden = true;
  }

  function showSnagSmoothly() {
    if (!state.snag) return;
    state.snag.classList.remove("lse-hidden");
    state.snagHidden = false;
  }

  function onSnagHit(event) {
    event.preventDefault();
    const nowMs = performance.now();
    if (nowMs < state.hiddenUntil) return;
    const sectorIndex = nextSectorIndexInProgression();
    if (sectorIndex < 0) return;

    const sectorNode = state.sectors[sectorIndex];
    const pageX = event.pageX;
    const pageY = event.pageY;

    if (typeof window.unlockTotemAudio === "function") window.unlockTotemAudio();
    if (typeof window.setTotemClickPan === "function") window.setTotemClickPan(event.clientX, nowMs);
    if (typeof window.playWoodSnap === "function") window.playWoodSnap(event.clientX, sectorIndex % 3);
    if (typeof window.playTotemFluteStrike === "function") {
      window.playTotemFluteStrike(PARTICLE_DURATION_MS);
    }

    hideSnagImmediately();
    revealSector(sectorIndex);
    spawnParticleBurst(pageX, pageY, sectorNode);
    state.hiddenUntil = nowMs + PARTICLE_DURATION_MS;
  }

  function updateSnagPosition(nowMs) {
    if (!state.root || !state.snag) return;
    const bounds = state.root.getBoundingClientRect();
    const phase = pingPong01(nowMs / FULL_SWEEP_CYCLE_MS);
    const minX = bounds.width * 0.06;
    const maxX = bounds.width * 0.94;
    const x = minX + (maxX - minX) * phase;
    const y = bounds.height * 0.52;
    state.snag.style.left = `${x.toFixed(2)}px`;
    state.snag.style.top = `${y.toFixed(2)}px`;
  }

  function frame(nowMs) {
    updateSnagPosition(nowMs);
    if (state.snagHidden && nowMs >= state.hiddenUntil) showSnagSmoothly();
    state.rafId = requestAnimationFrame(frame);
  }

  function createScene() {
    const existing = document.getElementById("layered-sweep-engine");
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.id = "layered-sweep-engine";
    root.setAttribute("aria-label", "Layered sweep renderer");
    root.setAttribute("role", "img");

    const baseLayer = document.createElement("div");
    baseLayer.className = "lse-base-layer";

    const salmonLayer = document.createElement("div");
    salmonLayer.className = "lse-salmon-layer";
    salmonLayer.innerHTML = createSalmonArtMarkup();

    const maskLayer = document.createElement("div");
    maskLayer.className = "lse-mask-layer";
    const sectorNodes = [];
    for (let i = 0; i < SECTOR_COUNT; i += 1) {
      const sector = document.createElement("div");
      sector.className = "lse-sector-mask";
      sector.dataset.sectorIndex = String(i);
      maskLayer.appendChild(sector);
      sectorNodes.push(sector);
    }

    const particleLayer = document.createElement("div");
    particleLayer.className = "lse-particles";

    const snag = document.createElement("button");
    snag.type = "button";
    snag.id = "layered-snag";
    snag.setAttribute("aria-label", "Tap moving cedar snag");
    snag.innerHTML = `
      <span class="lse-hit-cushion"></span>
      <span class="lse-snag-shell"></span>
      <span class="lse-snag-core"></span>
    `;
    snag.style.setProperty("pointer-events", "auto", "important");
    snag.addEventListener("pointerdown", onSnagHit, { passive: false });

    root.append(baseLayer, salmonLayer, maskLayer, particleLayer, snag);
    document.body.appendChild(root);

    state.root = root;
    state.snag = snag;
    state.particleLayer = particleLayer;
    state.sectors = sectorNodes;
    state.revealedSectors.clear();
    state.nextRevealStep = 0;
    state.hiddenUntil = 0;
    state.snagHidden = false;
  }

  function init() {
    ensureStyles();
    hideLegacyUi();
    createScene();
    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
