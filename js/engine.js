// Unified universal perimeter path + attractor shard renderer.
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TRACK_DURATION_MS = 12000;
  const SHARD_FLIGHT_MS = 1500;
  const SHARD_MIN_COUNT = 35;
  const SHARD_MAX_COUNT = 45;
  const WORKSHOP_COLORS = ["#231b15", "#ba5536"];
  const FINISHED_CREAM = "#f8f1df";

  const state = {
    root: null,
    masterPath: null,
    snagGroup: null,
    snagHitCircle: null,
    segmentLayer: null,
    shardLayer: null,
    segments: [],
    shards: [],
    snagHiddenUntilMs: 0,
    snagHidden: false,
    rafId: 0,
    timeouts: [],
  };

  const SEGMENT_DEFINITIONS = [
    {
      id: "segment-back-formline",
      d: (g) =>
        `M ${g.cx - g.rx * 0.56} ${g.cy - g.ry * 0.06} C ${g.cx - g.rx * 0.24} ${g.cy - g.ry * 0.37} ${g.cx + g.rx * 0.26} ${g.cy - g.ry * 0.37} ${g.cx + g.rx * 0.62} ${g.cy - g.ry * 0.05}`,
      center: (g) => ({ x: g.cx + g.rx * 0.1, y: g.cy - g.ry * 0.23 }),
    },
    {
      id: "segment-eye-ovoid",
      d: (g) => {
        const ex = g.cx + g.rx * 0.34;
        const ey = g.cy - g.ry * 0.1;
        const erx = g.rx * 0.11;
        const ery = g.ry * 0.08;
        return `M ${ex - erx} ${ey} A ${erx} ${ery} 0 1 0 ${ex + erx} ${ey} A ${erx} ${ery} 0 1 0 ${ex - erx} ${ey}`;
      },
      center: (g) => ({ x: g.cx + g.rx * 0.34, y: g.cy - g.ry * 0.1 }),
    },
    {
      id: "segment-gill-band",
      d: (g) =>
        `M ${g.cx - g.rx * 0.2} ${g.cy - g.ry * 0.03} C ${g.cx - g.rx * 0.36} ${g.cy + g.ry * 0.02} ${g.cx - g.rx * 0.36} ${g.cy + g.ry * 0.14} ${g.cx - g.rx * 0.17} ${g.cy + g.ry * 0.16}`,
      center: (g) => ({ x: g.cx - g.rx * 0.28, y: g.cy + g.ry * 0.08 }),
    },
    {
      id: "segment-fin-arc",
      d: (g) =>
        `M ${g.cx - g.rx * 0.1} ${g.cy + g.ry * 0.26} C ${g.cx + g.rx * 0.02} ${g.cy + g.ry * 0.42} ${g.cx + g.rx * 0.21} ${g.cy + g.ry * 0.43} ${g.cx + g.rx * 0.33} ${g.cy + g.ry * 0.25}`,
      center: (g) => ({ x: g.cx + g.rx * 0.13, y: g.cy + g.ry * 0.36 }),
    },
    {
      id: "segment-belly-formline",
      d: (g) =>
        `M ${g.cx - g.rx * 0.54} ${g.cy + g.ry * 0.2} C ${g.cx - g.rx * 0.14} ${g.cy + g.ry * 0.56} ${g.cx + g.rx * 0.24} ${g.cy + g.ry * 0.52} ${g.cx + g.rx * 0.6} ${g.cy + g.ry * 0.2}`,
      center: (g) => ({ x: g.cx + g.rx * 0.08, y: g.cy + g.ry * 0.5 }),
    },
    {
      id: "segment-tail-fork",
      d: (g) =>
        `M ${g.cx - g.rx * 0.9} ${g.cy + g.ry * 0.02} L ${g.cx - g.rx * 1.08} ${g.cy - g.ry * 0.15} M ${g.cx - g.rx * 0.9} ${g.cy + g.ry * 0.02} L ${g.cx - g.rx * 1.09} ${g.cy + g.ry * 0.2}`,
      center: (g) => ({ x: g.cx - g.rx * 1.02, y: g.cy + g.ry * 0.02 }),
    },
  ];

  function createSvgNode(tagName, attrs = null) {
    const node = document.createElementNS(SVG_NS, tagName);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    }
    return node;
  }

  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  function mixHex(a, b, t) {
    const u = Math.max(0, Math.min(1, t));
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    const r = Math.round(A[0] + (B[0] - A[0]) * u);
    const g = Math.round(A[1] + (B[1] - A[1]) * u);
    const bCh = Math.round(A[2] + (B[2] - A[2]) * u);
    return `rgb(${r}, ${g}, ${bCh})`;
  }

  function smoothstep01(v) {
    const x = Math.max(0, Math.min(1, v));
    return x * x * (3 - 2 * x);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function ensureStyles() {
    if (document.getElementById("universal-level-engine-style")) return;
    const style = document.createElement("style");
    style.id = "universal-level-engine-style";
    style.textContent = `
      #universal-level-engine {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background: radial-gradient(120% 90% at 50% 44%, #171010 0%, #0f0b09 58%, #070504 100%);
        touch-action: none;
        z-index: 120;
      }
      #universal-level-engine path,
      #universal-level-engine circle,
      #universal-level-engine ellipse {
        vector-effect: non-scaling-stroke;
      }
      #master-perimeter-track {
        fill: none;
        stroke: rgba(255, 244, 227, 0.28);
        stroke-width: 5;
      }
      .formline-segment {
        fill: none;
        stroke: rgba(248, 241, 223, 0.4);
        stroke-width: 6;
        stroke-linecap: round;
        stroke-linejoin: round;
        opacity: 0.12;
      }
      .formline-segment.segment-complete {
        stroke: #f8f1df;
      }
      #moving-snag {
        opacity: 1;
      }
      .snag-hit-target {
        fill: transparent;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  }

  function geometryForViewport() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const cx = w * 0.5;
    const cy = h * 0.53;
    const rx = Math.min(w * 0.34, h * 0.43);
    const ry = Math.min(h * 0.23, w * 0.18);
    return { w, h, cx, cy, rx, ry };
  }

  function perimeterPathD(g) {
    return [
      `M ${g.cx - g.rx} ${g.cy - g.ry * 0.01}`,
      `C ${g.cx - g.rx * 0.56} ${g.cy - g.ry * 1.03} ${g.cx + g.rx * 0.42} ${g.cy - g.ry * 1.06} ${g.cx + g.rx * 0.96} ${g.cy - g.ry * 0.18}`,
      `C ${g.cx + g.rx * 1.11} ${g.cy + g.ry * 0.05} ${g.cx + g.rx * 1.06} ${g.cy + g.ry * 0.34} ${g.cx + g.rx * 0.86} ${g.cy + g.ry * 0.54}`,
      `C ${g.cx + g.rx * 0.44} ${g.cy + g.ry * 1.03} ${g.cx - g.rx * 0.66} ${g.cy + g.ry * 0.94} ${g.cx - g.rx * 0.95} ${g.cy + g.ry * 0.3}`,
      `C ${g.cx - g.rx * 1.09} ${g.cy + g.ry * 0.11} ${g.cx - g.rx * 1.06} ${g.cy - g.ry * 0.14} ${g.cx - g.rx} ${g.cy - g.ry * 0.01}`,
      "Z",
    ].join(" ");
  }

  function nextUncompletedSegmentIndex() {
    for (let i = 0; i < state.segments.length; i++) {
      const segment = state.segments[i];
      if (!segment.complete && !segment.revealing) return i;
    }
    return -1;
  }

  function hideSnagImmediately() {
    if (!state.snagGroup || !state.snagHitCircle) return;
    state.snagGroup.style.transition = "none";
    state.snagGroup.style.opacity = "0";
    state.snagHitCircle.style.setProperty("pointer-events", "none", "important");
    state.snagHidden = true;
    requestAnimationFrame(() => {
      if (!state.snagGroup) return;
      state.snagGroup.style.transition = "opacity 260ms ease";
    });
  }

  function showSnagSmoothly() {
    if (!state.snagGroup || !state.snagHitCircle) return;
    state.snagGroup.style.opacity = "1";
    state.snagHitCircle.style.setProperty("pointer-events", "auto", "important");
    state.snagHidden = false;
  }

  function spawnAttractorShards(tapX, tapY, targetX, targetY, nowMs) {
    if (!state.shardLayer) return;
    const count =
      SHARD_MIN_COUNT + Math.floor(Math.random() * (SHARD_MAX_COUNT - SHARD_MIN_COUNT + 1));
    for (let i = 0; i < count; i++) {
      const shard = createSvgNode("circle", {
        cx: tapX,
        cy: tapY,
        r: (1.2 + Math.random() * 2.4).toFixed(2),
        fill: WORKSHOP_COLORS[(Math.random() * WORKSHOP_COLORS.length) | 0],
      });
      state.shardLayer.appendChild(shard);
      state.shards.push({
        node: shard,
        startMs: nowMs,
        startX: tapX,
        startY: tapY,
        targetX,
        targetY,
        curveX: (Math.random() - 0.5) * 120,
        curveY: (Math.random() - 0.5) * 120,
        startColor: WORKSHOP_COLORS[(Math.random() * WORKSHOP_COLORS.length) | 0],
      });
    }
  }

  function updateShards(nowMs) {
    for (let i = state.shards.length - 1; i >= 0; i--) {
      const shard = state.shards[i];
      const t = (nowMs - shard.startMs) / SHARD_FLIGHT_MS;
      if (t >= 1) {
        shard.node.remove();
        state.shards.splice(i, 1);
        continue;
      }
      const colorT = Math.max(0, Math.min(1, t));
      const motionT = smoothstep01(colorT);
      const arc = motionT * (1 - motionT);
      const x = lerp(shard.startX, shard.targetX, motionT) + shard.curveX * arc;
      const y = lerp(shard.startY, shard.targetY, motionT) + shard.curveY * arc;
      shard.node.setAttribute("cx", x.toFixed(2));
      shard.node.setAttribute("cy", y.toFixed(2));
      shard.node.setAttribute("fill", mixHex(shard.startColor, FINISHED_CREAM, colorT));
    }
  }

  function updateSnagPosition() {
    const masterPath = state.masterPath;
    if (!masterPath || typeof masterPath.getPointAtLength !== "function") return;
    if (typeof masterPath.getTotalLength !== "function") return;
    const total = masterPath.getTotalLength();
    if (!Number.isFinite(total) || total <= 0) return;
    const globalClockProgress = (performance.now() % 12000) / 12000;
    const dist = globalClockProgress * total;
    const p = masterPath.getPointAtLength(dist);
    const p2 = masterPath.getPointAtLength((dist + 2) % total);
    const angle = (Math.atan2(p2.y - p.y, p2.x - p.x) * 180) / Math.PI;
    state.snagGroup?.setAttribute(
      "transform",
      `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${angle.toFixed(2)})`
    );
  }

  function updateLayout() {
    if (!state.root || !state.masterPath) return;
    const g = geometryForViewport();
    state.root.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
    state.masterPath.setAttribute("d", perimeterPathD(g));
    for (let i = 0; i < SEGMENT_DEFINITIONS.length; i++) {
      const def = SEGMENT_DEFINITIONS[i];
      const segment = state.segments[i];
      segment.path.setAttribute("d", def.d(g));
      const center = def.center(g);
      segment.centerX = center.x;
      segment.centerY = center.y;
    }
  }

  function onSnagStrike(event) {
    event.preventDefault();
    const nowMs = performance.now();
    if (nowMs < state.snagHiddenUntilMs) return;
    const nextIndex = nextUncompletedSegmentIndex();
    if (nextIndex < 0) return;

    const segment = state.segments[nextIndex];
    segment.revealing = true;
    segment.path.style.opacity = "0.55";

    const tapX = event.pageX - window.scrollX;
    const tapY = event.pageY - window.scrollY;
    spawnAttractorShards(tapX, tapY, segment.centerX, segment.centerY, nowMs);

    state.snagHiddenUntilMs = nowMs + SHARD_FLIGHT_MS;
    hideSnagImmediately();

    const timeoutId = window.setTimeout(() => {
      segment.revealing = false;
      segment.complete = true;
      segment.path.classList.add("segment-complete");
      segment.path.style.opacity = "1";
    }, SHARD_FLIGHT_MS);
    state.timeouts.push(timeoutId);
  }

  function tick(nowMs) {
    updateSnagPosition();
    updateShards(nowMs);
    if (nowMs >= state.snagHiddenUntilMs && state.snagHidden) showSnagSmoothly();
    state.rafId = requestAnimationFrame(tick);
  }

  function hideLegacyUi() {
    const canvas = document.getElementById("gameCanvas");
    if (canvas) canvas.style.display = "none";
    document.querySelectorAll(".hud, #gallery-practice-btn, #practice-motor-panel").forEach((el) => {
      el.style.display = "none";
    });
  }

  function createScene() {
    const existing = document.getElementById("universal-level-engine");
    if (existing) existing.remove();
    state.segments.length = 0;
    state.shards.length = 0;

    const root = createSvgNode("svg", {
      id: "universal-level-engine",
      "aria-label": "Universal level renderer",
      role: "img",
    });
    const segmentLayer = createSvgNode("g", { id: "segment-layer" });
    const masterPath = createSvgNode("path", { id: "master-perimeter-track" });
    const snagGroup = createSvgNode("g", { id: "moving-snag" });
    const shardLayer = createSvgNode("g", { id: "shard-layer" });

    const snagBody = createSvgNode("ellipse", {
      cx: "0",
      cy: "0",
      rx: "20",
      ry: "13",
      fill: "#ba5536",
      stroke: "#231b15",
      "stroke-width": "2",
      "pointer-events": "none",
    });
    const snagCore = createSvgNode("ellipse", {
      cx: "4",
      cy: "-2",
      rx: "9",
      ry: "6",
      fill: "#f2cab7",
      opacity: "0.86",
      "pointer-events": "none",
    });
    const snagHitCircle = createSvgNode("circle", {
      class: "snag-hit-target",
      cx: "0",
      cy: "0",
      r: "45",
      fill: "transparent",
      "aria-label": "Tap snag",
    });
    snagHitCircle.style.setProperty("pointer-events", "auto", "important");
    snagHitCircle.style.setProperty("touch-action", "none", "important");
    snagHitCircle.addEventListener("pointerdown", onSnagStrike, { passive: false });

    for (const def of SEGMENT_DEFINITIONS) {
      const path = createSvgNode("path", { id: def.id, class: "formline-segment" });
      segmentLayer.appendChild(path);
      state.segments.push({
        id: def.id,
        path,
        centerX: 0,
        centerY: 0,
        complete: false,
        revealing: false,
      });
    }

    snagGroup.append(snagBody, snagCore, snagHitCircle);
    root.append(masterPath, segmentLayer, shardLayer, snagGroup);
    document.body.appendChild(root);

    state.root = root;
    state.masterPath = masterPath;
    state.snagGroup = snagGroup;
    state.snagHitCircle = snagHitCircle;
    state.segmentLayer = segmentLayer;
    state.shardLayer = shardLayer;
  }

  function init() {
    ensureStyles();
    hideLegacyUi();
    createScene();
    updateLayout();
    updateSnagPosition();
    window.addEventListener("resize", updateLayout, { passive: true });
    state.rafId = requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
