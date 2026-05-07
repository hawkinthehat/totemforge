// Bilateral therapeutic soundscape: Deep Cedar Drum + click-localized Wood Snap.
// Vagus cycle timing (12s: 4 inhale / 8 exhale) matches Master Totem Log breath-swell in geometry.js.
// AudioContext starts only after unlockTotemAudio() (call from first user gesture).

(function () {
  const CYCLE_MS = 12000;
  const INHALE_MS = 4000;

  let ac = null;
  let unlocked = false;

  let drumMaster = null;
  let drumBody = null;
  let drumSub = null;
  let drumFilter = null;
  let drumGain = null;
  let drumPanner = null;

  /** Short-lived lateral bias so drum pan follows the latest click (matches tactile lateralization). */
  let clickPanLinear = 0;
  let clickPanRefMs = -1e9;
  const CLICK_PAN_HALF_LIFE_MS = 340;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function breathPanFromTime(nowMs) {
    const t = ((nowMs % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
    if (t < INHALE_MS) return -1 + 2 * (t / INHALE_MS);
    const u = (t - INHALE_MS) / (CYCLE_MS - INHALE_MS);
    return 1 - 2 * u;
  }

  function breathPulseFromTime(nowMs) {
    const t = ((nowMs % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
    if (t < INHALE_MS) return t / INHALE_MS;
    return 1 - (t - INHALE_MS) / (CYCLE_MS - INHALE_MS);
  }

  function snagPanFromTomahawks(tomahawks) {
    if (!tomahawks || tomahawks.length === 0) return 0;
    let sx = 0;
    for (let i = 0; i < tomahawks.length; i++) sx += tomahawks[i].x;
    sx /= tomahawks.length;
    const w = window.innerWidth || 1;
    return (sx / w) * 2 - 1;
  }

  /** EMDR: discrete full left/right pan from hemifield (corpus callosum cue). */
  function emdrHemifieldPan(tomahawks) {
    if (!tomahawks || tomahawks.length === 0) return 0;
    let sx = 0;
    for (let i = 0; i < tomahawks.length; i++) sx += tomahawks[i].x;
    sx /= tomahawks.length;
    const w = window.innerWidth || 1;
    return sx < w * 0.5 ? -1 : 1;
  }

  /** Loudest at screen edges, dipped at center (“click-clack” bilateral sweep). */
  function edgeDrumBoostFromTomahawks(tomahawks) {
    if (!tomahawks || tomahawks.length === 0) return null;
    let sx = 0;
    for (let i = 0; i < tomahawks.length; i++) sx += tomahawks[i].x;
    sx /= tomahawks.length;
    const w = window.innerWidth || 1;
    const lateral = Math.abs(sx / w - 0.5) * 2;
    return 0.34 + 0.66 * lateral;
  }

  function ensureContext() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        ac = null;
      }
    }
    return ac;
  }

  function buildDrumChain() {
    const ctx = ensureContext();
    if (!ctx || drumGain) return;

    drumPanner = ctx.createPanner();
    try {
      drumPanner.panningModel = "HRTF";
    } catch {
      drumPanner.panningModel = "equalpower";
    }
    drumPanner.distanceModel = "linear";
    drumPanner.refDistance = 1;
    drumPanner.maxDistance = 10000;
    drumPanner.rolloffFactor = 0.5;
    drumPanner.coneInnerAngle = 360;
    drumPanner.coneOuterAngle = 360;

    drumFilter = ctx.createBiquadFilter();
    drumFilter.type = "lowpass";
    drumFilter.frequency.value = 220;
    drumFilter.Q.value = 0.7;

    drumGain = ctx.createGain();
    drumGain.gain.value = 0;

    drumBody = ctx.createOscillator();
    drumBody.type = "sine";
    drumBody.frequency.value = 58;

    drumSub = ctx.createOscillator();
    drumSub.type = "sine";
    drumSub.frequency.value = 52;

    drumMaster = ctx.createGain();
    drumMaster.gain.value = 0.42;

    drumBody.connect(drumMaster);
    drumSub.connect(drumMaster);
    drumMaster.connect(drumFilter);
    drumFilter.connect(drumGain);
    drumGain.connect(drumPanner);
    drumPanner.connect(ctx.destination);

    drumBody.start();
    drumSub.start();
  }

  /**
   * Must run inside a user gesture (before resume). Builds graph and starts oscillators.
   */
  window.unlockTotemAudio = function unlockTotemAudio() {
    const ctx = ensureContext();
    if (!ctx) return;
    buildDrumChain();
    unlocked = true;
    ctx.resume().catch(() => {});
  };

  /**
   * Impulse pan toward click X (call from pointerdown). Fades so breath + snag centroid resume.
   */
  window.setTotemClickPan = function setTotemClickPan(clientX, nowMs) {
    const w = window.innerWidth || 1;
    clickPanLinear = clamp(((clientX ?? w * 0.5) / w) * 2 - 1, -1, 1);
    clickPanRefMs = typeof nowMs === "number" ? nowMs : performance.now();
  };

  /**
   * Per-frame: drum amplitude follows Vagus breath; pan blends breath sweep + cedar snag centroid.
   */
  window.updateTotemSoundscape = function updateTotemSoundscape(nowMs, breath, snagArray, modeId) {
    if (!unlocked || !ac || !drumGain || !drumPanner) return;

    const pulse = breathPulseFromTime(nowMs);
    const breath01 = typeof breath?.breath01 === "number" ? breath.breath01 : pulse;
    const breatheMix = 0.55 * pulse + 0.45 * breath01;
    const throb = 0.88 + 0.12 * Math.sin(nowMs * 0.0026);

    const edgeBoost =
      snagArray && snagArray.length
        ? edgeDrumBoostFromTomahawks(snagArray)
        : 0.36 + 0.64 * Math.abs(breathPanFromTime(nowMs));

    const amp = (0.052 + 0.11 * breatheMix * throb) * edgeBoost;
    const now = ac.currentTime;
    drumGain.gain.cancelScheduledValues(now);
    drumGain.gain.setTargetAtTime(amp, now, 0.028);

    let panLinear;
    if (modeId === 0 || modeId === 1) {
      panLinear =
        snagArray && snagArray.length ? emdrHemifieldPan(snagArray) : breathPanFromTime(nowMs);
    } else {
      const bPan = breathPanFromTime(nowMs);
      const sPan = snagPanFromTomahawks(snagArray);
      const snagWeight = snagArray && snagArray.length ? 0.42 : 0;
      panLinear = bPan * (1 - snagWeight) + sPan * snagWeight;
    }

    let ageMixPan = panLinear;
    const age = nowMs - clickPanRefMs;
    if (age >= 0 && age < CLICK_PAN_HALF_LIFE_MS * 4) {
      const clickMix = Math.exp(-age / CLICK_PAN_HALF_LIFE_MS);
      ageMixPan = panLinear * (1 - clickMix * 0.75) + clickPanLinear * (clickMix * 0.75);
    }

    const wPx = window.innerWidth || 1;
    const hPx = window.innerHeight || 1;
    const tcx = wPx * 0.5;
    const tcy = hPx * 0.52;

    if (modeId === 3 && snagArray && snagArray.length) {
      let sumSin = 0;
      let sumCos = 0;
      for (let i = 0; i < snagArray.length; i++) {
        const t = snagArray[i];
        const ang =
          typeof t.spiralAngle === "number"
            ? t.spiralAngle
            : Math.atan2(t.y - tcy, t.x - tcx);
        sumSin += Math.sin(ang);
        sumCos += Math.cos(ang);
      }
      const n = snagArray.length;
      const θ = Math.atan2(sumSin / n, sumCos / n);
      const R = 4.8;
      drumPanner.setPosition(R * Math.sin(θ), 0, R * Math.cos(θ));
    } else {
      const px = clamp(-ageMixPan * 3.8, -4, 4);
      drumPanner.setPosition(px, 0, 0);
    }

    if (modeId === 2 && snagArray && snagArray.length && drumFilter && drumBody && drumSub) {
      let sy = 0;
      for (let i = 0; i < snagArray.length; i++) sy += snagArray[i].y;
      sy /= snagArray.length;
      const H = window.innerHeight || 1;
      const yn = clamp(sy / H, 0, 1);
      const lowMul = 0.72 + (1 - yn) * 0.38;
      drumFilter.frequency.setTargetAtTime(220 * lowMul, now, 0.055);
      drumBody.frequency.setTargetAtTime(58 + (1 - yn) * 16, now, 0.055);
      drumSub.frequency.setTargetAtTime(52 + (1 - yn) * 14, now, 0.055);
    } else if (drumFilter && drumBody && drumSub) {
      drumFilter.frequency.setTargetAtTime(220, now, 0.1);
      drumBody.frequency.setTargetAtTime(58, now, 0.1);
      drumSub.frequency.setTargetAtTime(52, now, 0.1);
    }
  };

  /**
   * Wood snap / clack. Optional `gridColumn` 0|1|2 = Left|Center|Right (EMDR saccadic grid pan).
   * Without gridColumn, pan follows click X.
   */
  window.playWoodSnap = function playWoodSnap(clientX, gridColumn, opts) {
    const ctx = ensureContext();
    if (!ctx) return;
    unlockTotemAudio();

    const w = window.innerWidth || 1;
    let pan;
    if (typeof gridColumn === "number" && gridColumn >= 0 && gridColumn <= 2) {
      pan = gridColumn === 0 ? -1 : gridColumn === 2 ? 1 : 0;
    } else {
      pan = clamp(((clientX ?? w * 0.5) / w) * 2 - 1, -1, 1);
    }

    const vv = opts?.verticalVent;
    /** ST’ÉXEM Vertical Vent: brighter “high” clack from above; darker “deep” from below. */
    const ventPitch = vv === "TOP" ? 1.22 : vv === "BOTTOM" ? 0.62 : 1;
    const bpCenter = 4200 * ventPitch;
    const oscStart = 880 * ventPitch;
    const oscEnd = 2100 * ventPitch;

    const t0 = ctx.currentTime;
    const dur = 0.048;

    const snapPanner = ctx.createStereoPanner();
    snapPanner.pan.value = pan;

    const noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(bpCenter, t0);
    bp.Q.setValueAtTime(5.5, t0);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, t0);
    nGain.gain.exponentialRampToValueAtTime(0.42, t0 + 0.003);
    nGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(snapPanner);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(oscStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(180, oscEnd), t0 + 0.018);

    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.0001, t0);
    oGain.gain.exponentialRampToValueAtTime(0.11, t0 + 0.002);
    oGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.042);

    osc.connect(oGain);
    oGain.connect(snapPanner);
    snapPanner.connect(ctx.destination);

    noise.start(t0);
    noise.stop(t0 + dur + 0.02);
    osc.start(t0);
    osc.stop(t0 + 0.055);
  };
})();
