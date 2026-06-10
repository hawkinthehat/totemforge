(() => {
  "use strict";

  const SWEEP_MS = 10000;
  const SNAG_HIDE_MS = 1500;
  const PARTICLE_MS = 1500;
  const PARTICLE_MIN = 35;
  const PARTICLE_MAX = 45;
  const HIT_RADIUS_PX = 45;
  const RAW_COLORS = ["#231b15", "#ba5536"];
  const FINISHED_COLORS = ["#f8f1df", "#ffffff", "#231b15"];

  const VIEW_W = 1200;
  const VIEW_H = 520;

  const FORM_SECTIONS = Object.freeze([
    { key: "body", label: "Primary body ovoid", x: 170, y: 160, w: 760, h: 190 },
    { key: "head", label: "Head and eye", x: 780, y: 135, w: 255, h: 220 },
    { key: "gill", label: "Gill crescent", x: 640, y: 180, w: 190, h: 185 },
    { key: "spine", label: "Back formline", x: 245, y: 105, w: 620, h: 150 },
    { key: "belly", label: "Belly counterline", x: 250, y: 290, w: 620, h: 150 },
    { key: "fins", label: "Dorsal and pectoral fins", x: 410, y: 80, w: 330, h: 370 },
    { key: "tail", label: "Tail sweep", x: 50, y: 170, w: 230, h: 185 },
    { key: "inner", label: "Inner ovoids", x: 315, y: 185, w: 340, h: 160 },
    { key: "finish", label: "Final bright knife cuts", x: 92, y: 120, w: 965, h: 275 },
  ]);

  const state = {
    canvas: null,
    ctx: null,
    status: null,
    dpr: 1,
    width: 0,
    height: 0,
    art: { x: 0, y: 0, w: 0, h: 0, scale: 1 },
    revealed: 0,
    particles: [],
    snag: { x: 0, y: 0, hiddenUntil: 0 },
    lastFrameMs: 0,
    rafId: 0,
    started: false,
  };

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(t) {
    const u = clamp(t, 0, 1);
    return u * u * (3 - 2 * u);
  }

  function pingPong01(t) {
    const phase = t - Math.floor(t);
    return phase < 0.5 ? phase * 2 : 2 - phase * 2;
  }

  function colorToRgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  function mixColor(a, b, t) {
    const A = colorToRgb(a);
    const B = colorToRgb(b);
    const u = smoothstep(t);
    const r = Math.round(lerp(A.r, B.r, u));
    const g = Math.round(lerp(A.g, B.g, u));
    const bb = Math.round(lerp(A.b, B.b, u));
    return `rgb(${r}, ${g}, ${bb})`;
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function resizeCanvas() {
    const canvas = state.canvas;
    if (!canvas) return;
    state.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    state.width = window.innerWidth || 1;
    state.height = window.innerHeight || 1;
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    const maxW = Math.min(state.width * 0.93, 1220);
    const maxH = state.height * 0.72;
    let artW = maxW;
    let artH = artW * (VIEW_H / VIEW_W);
    if (artH > maxH) {
      artH = maxH;
      artW = artH * (VIEW_W / VIEW_H);
    }
    state.art = {
      w: artW,
      h: artH,
      x: (state.width - artW) * 0.5,
      y: (state.height - artH) * 0.5,
      scale: artW / VIEW_W,
    };
  }

  function drawCedarBase(ctx, w, h, nowMs) {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#b8793d");
    grad.addColorStop(0.22, "#e4b86d");
    grad.addColorStop(0.52, "#f1ce83");
    grad.addColorStop(0.76, "#c18445");
    grad.addColorStop(1, "#8e5a32");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.22;
    for (let i = 0; i < 42; i += 1) {
      const x = (i / 41) * w + Math.sin(i * 7.13) * 8;
      const wave = Math.sin(nowMs * 0.00008 + i) * 5;
      ctx.strokeStyle = i % 3 === 0 ? "rgba(35,27,21,0.18)" : "rgba(248,241,223,0.18)";
      ctx.lineWidth = i % 5 === 0 ? 1.35 : 0.65;
      ctx.beginPath();
      ctx.moveTo(x + wave, -20);
      ctx.bezierCurveTo(x - 18, h * 0.28, x + 22, h * 0.64, x - wave * 0.6, h + 20);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.18, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    vignette.addColorStop(0, "rgba(255,255,255,0)");
    vignette.addColorStop(1, "rgba(35,27,21,0.26)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function beginBodyPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(178, 268);
    ctx.bezierCurveTo(258, 160, 453, 114, 680, 126);
    ctx.bezierCurveTo(838, 134, 969, 190, 1038, 263);
    ctx.bezierCurveTo(970, 338, 835, 392, 675, 400);
    ctx.bezierCurveTo(442, 412, 258, 370, 178, 280);
    ctx.closePath();
  }

  function beginTailPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(180, 268);
    ctx.bezierCurveTo(126, 222, 85, 201, 50, 207);
    ctx.bezierCurveTo(78, 236, 91, 258, 91, 258);
    ctx.bezierCurveTo(91, 258, 75, 292, 50, 321);
    ctx.bezierCurveTo(87, 327, 128, 308, 180, 280);
    ctx.closePath();
  }

  function drawRoundedBlockSilhouette(ctx) {
    const { x, y, w, h } = state.art;
    const padX = Math.max(22, w * 0.035);
    const padY = Math.max(18, h * 0.11);
    const rx = 26;
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "#231b15";
    ctx.shadowColor = "rgba(35, 27, 21, 0.28)";
    ctx.shadowBlur = 28;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x + padX, y + padY, w - padX * 2, h - padY * 2, rx);
    } else {
      ctx.rect(x + padX, y + padY, w - padX * 2, h - padY * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  function withArtTransform(ctx, draw) {
    ctx.save();
    ctx.translate(state.art.x, state.art.y);
    ctx.scale(state.art.scale, state.art.scale);
    draw();
    ctx.restore();
  }

  function drawUnderlay(ctx) {
    drawRoundedBlockSilhouette(ctx);
    withArtTransform(ctx, () => {
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = "#231b15";
      ctx.strokeStyle = "#231b15";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = 22;
      beginTailPath(ctx);
      ctx.fill();
      beginBodyPath(ctx);
      ctx.fill();
      beginBodyPath(ctx);
      ctx.stroke();

      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 56;
      ctx.beginPath();
      ctx.moveTo(220, 245);
      ctx.bezierCurveTo(372, 178, 610, 168, 832, 211);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(238, 303);
      ctx.bezierCurveTo(415, 360, 646, 362, 870, 296);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawFinishedArt(ctx) {
    withArtTransform(ctx, () => {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.shadowColor = "rgba(35, 27, 21, 0.25)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;
      beginTailPath(ctx);
      ctx.fillStyle = "#ba5536";
      ctx.fill();
      beginBodyPath(ctx);
      ctx.fillStyle = "#f8f1df";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      beginTailPath(ctx);
      ctx.strokeStyle = "#231b15";
      ctx.lineWidth = 16;
      ctx.stroke();
      beginBodyPath(ctx);
      ctx.strokeStyle = "#231b15";
      ctx.lineWidth = 19;
      ctx.stroke();

      ctx.strokeStyle = "#ba5536";
      ctx.lineWidth = 54;
      ctx.beginPath();
      ctx.moveTo(214, 246);
      ctx.bezierCurveTo(345, 172, 566, 160, 761, 183);
      ctx.bezierCurveTo(858, 195, 936, 224, 994, 263);
      ctx.stroke();

      ctx.strokeStyle = "#f8f1df";
      ctx.lineWidth = 36;
      ctx.beginPath();
      ctx.moveTo(248, 304);
      ctx.bezierCurveTo(416, 358, 642, 366, 900, 286);
      ctx.stroke();

      ctx.strokeStyle = "#231b15";
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(225, 270);
      ctx.bezierCurveTo(390, 221, 617, 219, 836, 259);
      ctx.stroke();

      ctx.strokeStyle = "#231b15";
      ctx.lineWidth = 9;
      for (let i = 0; i < 5; i += 1) {
        const gx = 662 + i * 22;
        ctx.beginPath();
        ctx.moveTo(gx, 218 + i * 8);
        ctx.bezierCurveTo(gx + 24, 248, gx + 22, 297, gx - 2, 326);
        ctx.stroke();
      }

      ctx.fillStyle = "#231b15";
      ctx.beginPath();
      ctx.ellipse(886, 248, 58, 42, -0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f8f1df";
      ctx.beginPath();
      ctx.ellipse(895, 246, 34, 24, -0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#231b15";
      ctx.beginPath();
      ctx.ellipse(904, 246, 13, 11, -0.18, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#231b15";
      ctx.beginPath();
      ctx.ellipse(487, 278, 116, 54, 0.02, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ba5536";
      ctx.beginPath();
      ctx.ellipse(487, 278, 78, 35, 0.02, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f8f1df";
      ctx.beginPath();
      ctx.ellipse(502, 275, 35, 16, 0.02, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#231b15";
      ctx.beginPath();
      ctx.moveTo(542, 170);
      ctx.bezierCurveTo(590, 104, 652, 78, 718, 86);
      ctx.bezierCurveTo(672, 132, 650, 176, 657, 226);
      ctx.bezierCurveTo(618, 206, 582, 188, 542, 170);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ba5536";
      ctx.beginPath();
      ctx.moveTo(578, 166);
      ctx.bezierCurveTo(610, 128, 646, 109, 680, 109);
      ctx.bezierCurveTo(654, 145, 642, 174, 643, 200);
      ctx.bezierCurveTo(622, 188, 601, 177, 578, 166);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#231b15";
      ctx.beginPath();
      ctx.moveTo(472, 355);
      ctx.bezierCurveTo(530, 378, 596, 379, 656, 354);
      ctx.bezierCurveTo(626, 414, 608, 454, 606, 492);
      ctx.bezierCurveTo(560, 431, 520, 389, 472, 355);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ba5536";
      ctx.beginPath();
      ctx.moveTo(514, 371);
      ctx.bezierCurveTo(552, 386, 591, 386, 624, 374);
      ctx.bezierCurveTo(606, 414, 596, 439, 593, 461);
      ctx.bezierCurveTo(566, 423, 542, 395, 514, 371);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#f8f1df";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(112, 227);
      ctx.bezierCurveTo(146, 246, 153, 270, 112, 307);
      ctx.stroke();
      ctx.strokeStyle = "#231b15";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(105, 253);
      ctx.lineTo(168, 267);
      ctx.stroke();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.moveTo(317, 233);
      ctx.bezierCurveTo(429, 203, 580, 203, 744, 231);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(346, 327);
      ctx.bezierCurveTo(478, 356, 632, 348, 807, 304);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    });
  }

  function clipToSection(ctx, section) {
    const ar = state.art;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ar.x + section.x * ar.scale, ar.y + section.y * ar.scale, section.w * ar.scale, section.h * ar.scale);
    ctx.clip();
    drawFinishedArt(ctx);
    ctx.restore();
  }

  function drawRevealedSections(ctx) {
    for (let i = 0; i < state.revealed; i += 1) {
      const section = FORM_SECTIONS[i];
      if (section) clipToSection(ctx, section);
    }
  }

  function drawSectionGlow(ctx, nowMs) {
    if (state.revealed <= 0) return;
    const section = FORM_SECTIONS[state.revealed - 1];
    if (!section) return;
    const u = clamp((nowMs - state.lastRevealMs) / 900, 0, 1);
    if (u >= 1) return;
    const a = (1 - u) * 0.28;
    const ar = state.art;
    ctx.save();
    ctx.strokeStyle = `rgba(248, 241, 223, ${a})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = `rgba(248, 241, 223, ${a})`;
    ctx.shadowBlur = 20;
    ctx.strokeRect(
      ar.x + section.x * ar.scale,
      ar.y + section.y * ar.scale,
      section.w * ar.scale,
      section.h * ar.scale
    );
    ctx.restore();
  }

  function sectionTargetPoint(section) {
    const x = section.x + randomBetween(section.w * 0.18, section.w * 0.82);
    const y = section.y + randomBetween(section.h * 0.2, section.h * 0.8);
    return {
      x: state.art.x + x * state.art.scale,
      y: state.art.y + y * state.art.scale,
    };
  }

  function spawnSplinters(clientX, clientY, section) {
    const count = PARTICLE_MIN + Math.floor(Math.random() * (PARTICLE_MAX - PARTICLE_MIN + 1));
    for (let i = 0; i < count; i += 1) {
      const target = sectionTargetPoint(section);
      const angle = Math.random() * Math.PI * 2;
      const kick = randomBetween(26, 112);
      state.particles.push({
        born: performance.now(),
        duration: PARTICLE_MS,
        x0: clientX,
        y0: clientY,
        bx: Math.cos(angle) * kick,
        by: Math.sin(angle) * kick,
        x1: target.x,
        y1: target.y,
        startColor: RAW_COLORS[(Math.random() * RAW_COLORS.length) | 0],
        endColor: FINISHED_COLORS[(Math.random() * FINISHED_COLORS.length) | 0],
        size: randomBetween(2.2, 6.4),
        stretch: randomBetween(1.8, 4.6),
        spin: randomBetween(-5.6, 5.6),
        jag: Math.random() < 0.52,
      });
    }
  }

  function drawParticles(ctx, nowMs) {
    if (!state.particles.length) return;
    const alive = [];
    for (const p of state.particles) {
      const t = (nowMs - p.born) / p.duration;
      if (t >= 1) continue;
      alive.push(p);
      const e = smoothstep(t);
      const burst = Math.sin(Math.PI * Math.min(t, 0.38) / 0.38);
      const x = lerp(p.x0 + p.bx * burst, p.x1, e);
      const y = lerp(p.y0 + p.by * burst - 20 * Math.sin(Math.PI * t), p.y1, e);
      const color = mixColor(p.startColor, p.endColor, t);
      const alpha = 1 - Math.max(0, t - 0.78) / 0.22;
      const angle = Math.atan2(p.y1 - p.y0, p.x1 - p.x0) + p.spin * t;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.beginPath();
      if (p.jag) {
        ctx.moveTo(-p.stretch, -p.size * 0.42);
        ctx.lineTo(p.stretch * 0.82, -p.size * 0.18);
        ctx.lineTo(p.stretch * 0.36, p.size * 0.52);
        ctx.lineTo(-p.stretch * 0.72, p.size * 0.22);
      } else {
        ctx.rect(-p.stretch * 0.5, -p.size * 0.5, p.stretch, p.size);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    state.particles = alive;
  }

  function updateSnag(nowMs) {
    const t = pingPong01(nowMs / SWEEP_MS);
    const ar = state.art;
    state.snag.x = lerp(ar.x + ar.w * 0.07, ar.x + ar.w * 0.93, t);
    state.snag.y = ar.y + ar.h * 0.52;
  }

  function drawSnag(ctx, nowMs) {
    if (nowMs < state.snag.hiddenUntil) return;
    const { x, y } = state.snag;
    const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.004);
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = "rgba(35, 27, 21, 0.32)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#231b15";
    ctx.beginPath();
    ctx.ellipse(0, 0, 23, 17, 0.18, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createRadialGradient(-7, -5, 1, 0, 0, 29);
    grad.addColorStop(0, "#d38363");
    grad.addColorStop(0.42, "#ba5536");
    grad.addColorStop(1, "#692f21");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 19, 13, 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(248, 241, 223, 0.72)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-13, -4);
    ctx.bezierCurveTo(-3, -7, 6, -4, 13, 1);
    ctx.stroke();
    ctx.globalAlpha = 0.18 + pulse * 0.12;
    ctx.strokeStyle = "#231b15";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, HIT_RADIUS_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawProgressCuts(ctx) {
    const ar = state.art;
    const pct = FORM_SECTIONS.length ? state.revealed / FORM_SECTIONS.length : 0;
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = "rgba(35, 27, 21, 0.46)";
    ctx.fillRect(ar.x + ar.w * 0.18, ar.y + ar.h + 16, ar.w * 0.64, 2);
    ctx.fillStyle = "#f8f1df";
    ctx.fillRect(ar.x + ar.w * 0.18, ar.y + ar.h + 16, ar.w * 0.64 * pct, 2);
    ctx.restore();
  }

  function draw(nowMs) {
    const ctx = state.ctx;
    if (!ctx) return;
    state.lastFrameMs = nowMs;
    updateSnag(nowMs);
    drawCedarBase(ctx, state.width, state.height, nowMs);
    drawUnderlay(ctx);
    drawRevealedSections(ctx);
    drawSectionGlow(ctx, nowMs);
    drawProgressCuts(ctx);
    drawParticles(ctx, nowMs);
    drawSnag(ctx, nowMs);
    state.rafId = requestAnimationFrame(draw);
  }

  function updateStatus() {
    if (!state.status) return;
    if (state.revealed >= FORM_SECTIONS.length) {
      state.status.textContent = "The single formline is fully opened in cream, cedar, and charcoal.";
      return;
    }
    const next = FORM_SECTIONS[state.revealed];
    state.status.textContent = `Next cut: ${next.label}. Keep the sweep calm and horizontal.`;
  }

  function strikeSnag(event) {
    if (!state.started) return;
    const nowMs = performance.now();
    if (nowMs < state.snag.hiddenUntil) return;
    if (state.revealed >= FORM_SECTIONS.length) return;

    const rect = state.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - state.snag.x;
    const dy = y - state.snag.y;
    if (dx * dx + dy * dy > HIT_RADIUS_PX * HIT_RADIUS_PX) return;

    event.preventDefault();
    const section = FORM_SECTIONS[state.revealed];
    if (!section) return;
    if (window.formlineHaptics) {
      window.formlineHaptics.strike(nowMs);
      window.formlineHaptics.drum();
    }
    state.snag.hiddenUntil = nowMs + SNAG_HIDE_MS;
    state.revealed += 1;
    state.lastRevealMs = nowMs;
    spawnSplinters(x, y, section);
    if (window.formlineHaptics) window.formlineHaptics.sectionReveal();
    updateStatus();
  }

  function startCanvas() {
    state.started = true;
    if (window.formlineHaptics) window.formlineHaptics.unlock();
    const overlay = document.getElementById("start-overlay");
    if (overlay) {
      overlay.classList.add("is-exiting");
      window.setTimeout(() => {
        overlay.hidden = true;
      }, 380);
    }
    updateStatus();
  }

  function bindStartOverlay() {
    const button = document.getElementById("start-button");
    if (button) button.addEventListener("click", startCanvas, { once: true });
  }

  function init() {
    state.canvas = document.getElementById("gameCanvas");
    state.status = document.getElementById("canvas-status");
    if (!state.canvas) return;
    state.ctx = state.canvas.getContext("2d", { alpha: false });
    if (!state.ctx) return;
    state.lastRevealMs = -Infinity;
    resizeCanvas();
    bindStartOverlay();
    state.canvas.addEventListener("pointerdown", strikeSnag, { passive: false });
    window.addEventListener("resize", resizeCanvas);
    updateStatus();
    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(draw);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
