/**
 * Bilateral Audio Engine — Web Audio API
 *
 * • The Pacer — soft LF hum (center), volume tracks the 4s/12s Vagus breath.
 * • Cedar Snap — HPF white-noise crack, 100% L/R via PannerNode when a snag shatters on that side.
 * • Atmosphere — low filtered noise bed (“Salish coast” floor).
 *
 * AudioContext resumes after unlockTotemAudio() — Start overlay + mode buttons (engine.js / config.js).
 */
(function () {
  const CYCLE_MS = 12000;
  const INHALE_MS = 4000;

  let ac = null;
  let unlocked = false;
  let userMuted = false;

  let masterGain = null;

  /** --- Pacer (Vagus drone): inhale swell / exhale fade --- */
  let pacerOsc1 = null;
  let pacerOsc2 = null;
  let pacerFilter = null;
  let pacerGain = null;
  let pacerPanner = null;

  /** --- Coast atmosphere: filtered noise bed --- */
  let atmSource = null;
  let atmFilter = null;
  let atmGain = null;
  let atmPanner = null;

  let clickPanLinear = 0;
  let clickPanRefMs = -1e9;
  const CLICK_PAN_HALF_LIFE_MS = 340;

  /** Potlatch: silence vagus drone + atmosphere while ceremony.mp3 plays. */
  let potlatchDroneSuspended = false;
  /** HTMLAudioElement for Potlatch ceremony (not Web Audio graph). */
  let potlatchCeremonyAudio = null;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function breathEnvelopeFromWallClock(nowMs) {
    const t = ((nowMs % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
    if (t < INHALE_MS) return t / INHALE_MS;
    return 1 - (t - INHALE_MS) / (CYCLE_MS - INHALE_MS);
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

  function emdrHemifieldPan(tomahawks) {
    if (!tomahawks || tomahawks.length === 0) return 0;
    let sx = 0;
    for (let i = 0; i < tomahawks.length; i++) sx += tomahawks[i].x;
    sx /= tomahawks.length;
    const w = window.innerWidth || 1;
    return sx < w * 0.5 ? -1 : 1;
  }

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

  function createPinkNoiseBuffer(ctx, seconds) {
    const len = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      ch[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      ch[i] *= 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  function buildAudioGraph() {
    const ctx = ensureContext();
    if (!ctx || masterGain) return;

    masterGain = ctx.createGain();
    masterGain.gain.value = userMuted ? 0 : 1;
    masterGain.connect(ctx.destination);

    pacerPanner = ctx.createStereoPanner();
    pacerPanner.pan.value = 0;

    pacerFilter = ctx.createBiquadFilter();
    pacerFilter.type = "lowpass";
    pacerFilter.frequency.value = 240;
    pacerFilter.Q.value = 0.65;

    pacerGain = ctx.createGain();
    pacerGain.gain.value = 0;

    pacerOsc1 = ctx.createOscillator();
    pacerOsc1.type = "sine";
    pacerOsc1.frequency.value = 60;

    pacerOsc2 = ctx.createOscillator();
    pacerOsc2.type = "sine";
    pacerOsc2.frequency.value = 120;

    const mix = ctx.createGain();
    mix.gain.value = 0.55;
    const mixHi = ctx.createGain();
    mixHi.gain.value = 0.28;

    pacerOsc1.connect(mix);
    pacerOsc2.connect(mixHi);
    mixHi.connect(mix);

    mix.connect(pacerFilter);
    pacerFilter.connect(pacerGain);
    pacerGain.connect(pacerPanner);
    pacerPanner.connect(masterGain);

    pacerOsc1.start();
    pacerOsc2.start();

    atmPanner = ctx.createStereoPanner();
    atmPanner.pan.value = 0;

    atmFilter = ctx.createBiquadFilter();
    atmFilter.type = "lowpass";
    atmFilter.frequency.value = 820;
    atmFilter.Q.value = 0.45;

    atmGain = ctx.createGain();
    atmGain.gain.value = 0;

    const pink = createPinkNoiseBuffer(ctx, 4);
    atmSource = ctx.createBufferSource();
    atmSource.buffer = pink;
    atmSource.loop = true;

    atmSource.connect(atmFilter);
    atmFilter.connect(atmGain);
    atmGain.connect(atmPanner);
    atmPanner.connect(masterGain);

    atmSource.start();
  }

  function refreshMuteButtonUi() {
    const btn = document.getElementById("audio-mute-toggle");
    if (!btn) return;
    const muted = userMuted;
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.setAttribute("aria-label", muted ? "Unmute suite audio" : "Mute suite audio");
    btn.title = muted ? "Unmute" : "Mute";
    btn.innerHTML = muted
      ? '<span class="audio-mute-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="currentColor"/></svg></span>'
      : '<span class="audio-mute-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor"/></svg></span>';
  }

  window.suspendTotemSoundscapeForPotlatch = function suspendTotemSoundscapeForPotlatch() {
    potlatchDroneSuspended = true;
    const ctx = ac;
    if (ctx && pacerGain && atmGain) {
      const t = ctx.currentTime;
      try {
        pacerGain.gain.cancelScheduledValues(t);
        pacerGain.gain.setTargetAtTime(0, t, 0.045);
        atmGain.gain.cancelScheduledValues(t);
        atmGain.gain.setTargetAtTime(0, t, 0.045);
      } catch (_) {}
    }
  };

  window.resumeTotemSoundscapeAfterPotlatch = function resumeTotemSoundscapeAfterPotlatch() {
    potlatchDroneSuspended = false;
  };

  window.playTotemPotlatchCeremonyAudio = function playTotemPotlatchCeremonyAudio() {
    if (userMuted) return;
    try {
      if (potlatchCeremonyAudio) {
        potlatchCeremonyAudio.pause();
        potlatchCeremonyAudio.src = "";
      }
      potlatchCeremonyAudio = new Audio("ceremony.mp3");
      potlatchCeremonyAudio.volume = 0.88;
      potlatchCeremonyAudio.play().catch(() => {});
    } catch (_) {
      potlatchCeremonyAudio = null;
    }
  };

  /**
   * KW’ÉKW’E Master Finale: layered high flute crescendo over ceremony.mp3 (Web Audio; respects mute / unlock).
   */
  window.playTotemOspreyFinaleFluteCrescendo = function playTotemOspreyFinaleFluteCrescendo() {
    const ctx = ensureContext();
    if (!ctx || !unlocked || userMuted) return;
    const t0 = ctx.currentTime;
    const dur = 2.85;
    const master = masterGain || ctx.destination;

    const mkVoice = (baseHz, detune, startHz, endHz, gainPeak) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.detune.value = detune;
      o.frequency.setValueAtTime(startHz, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(80, endHz), t0 + dur * 0.88);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.setValueAtTime(6.5, t0);
      f.frequency.setValueAtTime(baseHz * 2.2, t0);
      f.frequency.exponentialRampToValueAtTime(baseHz * 5.8, t0 + dur * 0.72);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.55);
      g.gain.exponentialRampToValueAtTime(gainPeak * 1.08, t0 + dur * 0.62);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(f);
      f.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    };

    mkVoice(880, 3, 660, 2340, 0.11);
    mkVoice(1320, -5, 990, 3520, 0.065);
    const air = ctx.createOscillator();
    air.type = "sine";
    air.frequency.setValueAtTime(3520, t0);
    const ag = ctx.createGain();
    ag.gain.setValueAtTime(0.0001, t0);
    ag.gain.exponentialRampToValueAtTime(0.028, t0 + dur * 0.45);
    ag.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.95);
    air.connect(ag);
    ag.connect(master);
    air.start(t0);
    air.stop(t0 + dur);
  };

  window.stopTotemPotlatchCeremonyAudio = function stopTotemPotlatchCeremonyAudio() {
    if (potlatchCeremonyAudio) {
      try {
        potlatchCeremonyAudio.pause();
        potlatchCeremonyAudio.currentTime = 0;
        potlatchCeremonyAudio.src = "";
      } catch (_) {}
      potlatchCeremonyAudio = null;
    }
  };

  /** `true` when ceremony track finished or was never started (muted / error). */
  window.isPotlatchCeremonyAudioComplete = function isPotlatchCeremonyAudioComplete() {
    if (!potlatchCeremonyAudio) return true;
    if (potlatchCeremonyAudio.error) return true;
    return potlatchCeremonyAudio.ended;
  };

  window.unlockTotemAudio = function unlockTotemAudio() {
    const ctx = ensureContext();
    if (!ctx) return;
    buildAudioGraph();
    unlocked = true;
    ctx.resume().catch(() => {});
    refreshMuteButtonUi();
  };

  window.setTotemAudioMuted = function setTotemAudioMuted(muted) {
    userMuted = !!muted;
    if (masterGain && ac) {
      const now = ac.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setTargetAtTime(userMuted ? 0 : 1, now, 0.035);
    }
    refreshMuteButtonUi();
  };

  window.toggleTotemAudioMuted = function toggleTotemAudioMuted() {
    setTotemAudioMuted(!userMuted);
    return !userMuted;
  };

  window.isTotemAudioMuted = function isTotemAudioMuted() {
    return userMuted;
  };

  window.refreshTotemMuteButtonUi = refreshMuteButtonUi;

  window.setTotemClickPan = function setTotemClickPan(clientX, nowMs) {
    const w = window.innerWidth || 1;
    clickPanLinear = clamp(((clientX ?? w * 0.5) / w) * 2 - 1, -1, 1);
    clickPanRefMs = typeof nowMs === "number" ? nowMs : performance.now();
  };

  /**
   * v1.0 Cedar Snap — synthesized wood crack (HPF white-noise burst); pan ∈ [-1, 1].
   * Hemifield bilateral: ±1 → PannerNode position for full L/R ear.
   */
  window.playWoodTapStereo = function playWoodTapStereo(panLinear, opts) {
    const ctx = ensureContext();
    if (!ctx || !unlocked || userMuted) return;

    const pan = clamp(typeof panLinear === "number" ? panLinear : 0, -1, 1);
    const side = pan <= 0 ? -1 : 1;
    const vv = opts?.verticalVent;

    const t0 = ctx.currentTime;
    const dur = 0.04;

    const noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    let hpHz = 3400;
    if (vv === "TOP") hpHz = 4100;
    else if (vv === "BOTTOM") hpHz = 2700;
    hp.frequency.setValueAtTime(hpHz, t0);
    hp.Q.setValueAtTime(0.92, t0);

    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.0001, t0);
    snapGain.gain.exponentialRampToValueAtTime(0.58, t0 + 0.0025);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    const panner = ctx.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    panner.rolloffFactor = 0.35;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 0;
    const spread = 2.5;
    panner.positionX.setValueAtTime(side * spread, t0);
    panner.positionY.setValueAtTime(0, t0);
    panner.positionZ.setValueAtTime(0, t0);

    noise.connect(hp);
    hp.connect(snapGain);
    snapGain.connect(panner);
    panner.connect(masterGain || ctx.destination);

    noise.start(t0);
    noise.stop(t0 + dur + 0.012);
  };

  /**
   * Legacy entry — prefers bilateral pan from grid column / click.
   */
    window.playWoodSnap = function playWoodSnap(clientX, gridColumn, opts) {
    const ctx = ensureContext();
    if (!ctx || userMuted) return;

    const w = window.innerWidth || 1;
    let pan;
    if (typeof gridColumn === "number" && gridColumn >= 0 && gridColumn <= 2) {
      pan = gridColumn === 0 ? -1 : gridColumn === 2 ? 1 : 0;
    } else {
      pan = clamp(((clientX ?? w * 0.5) / w) * 2 - 1, -1, 1);
    }
    window.playWoodTapStereo(pan, opts);
  };

  /** Potlatch finale — crisp snap + brief tonal bloom (ceremony completion). */
  window.playSpiritSnap = function playSpiritSnap() {
    const ctx = ensureContext();
    if (!ctx || !unlocked || userMuted) return;
    const t0 = ctx.currentTime;
    const dur = 0.072;
    const noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2800, t0);
    bp.Q.setValueAtTime(2.4, t0);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.48, t0 + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(masterGain || ctx.destination);
    noise.start(t0);
    noise.stop(t0 + dur + 0.015);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1888, t0);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.14, t0 + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(og);
    og.connect(masterGain || ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  };

  window.updateTotemSoundscape = function updateTotemSoundscape(nowMs, breath, snagArray, modeId) {
    if (!unlocked || !ac || !pacerGain || userMuted) return;

    if (potlatchDroneSuspended) {
      const t = ac.currentTime;
      try {
        pacerGain.gain.cancelScheduledValues(t);
        pacerGain.gain.setTargetAtTime(0, t, 0.02);
        if (atmGain) {
          atmGain.gain.cancelScheduledValues(t);
          atmGain.gain.setTargetAtTime(0, t, 0.02);
        }
      } catch (_) {}
      return;
    }

    const pulse = breathPulseFromTime(nowMs);
    const breath01 = typeof breath?.breath01 === "number" ? breath.breath01 : pulse;
    const env = breathEnvelopeFromWallClock(nowMs);
    const breatheMix = 0.52 * env + 0.48 * breath01;

    /** Pacer / Vagus drone — swell on inhale, ease back on exhale */
    const throb = 0.9 + 0.1 * Math.sin(nowMs * 0.0024);
    const pacerAmp = (0.042 + 0.155 * breatheMix * breatheMix) * throb;

    const edgeBoost =
      snagArray && snagArray.length
        ? edgeDrumBoostFromTomahawks(snagArray)
        : 0.38 + 0.62 * Math.abs(breathPanFromTime(nowMs));

    const now = ac.currentTime;
    pacerGain.gain.cancelScheduledValues(now);
    pacerGain.gain.setTargetAtTime(pacerAmp * edgeBoost * 0.92, now, 0.032);

    /** Gentle spectral tilt with breath (fundamental stays 60 Hz “vagus hum”) */
    const tilt = 210 + 70 * breatheMix;
    pacerFilter.frequency.setTargetAtTime(tilt + 40, now, 0.06);
    pacerOsc1.frequency.setTargetAtTime(60, now, 0.06);
    pacerOsc2.frequency.setTargetAtTime(120, now, 0.06);

    /** Atmosphere bed — slow “coast wind” motion */
    const atmAmp = 0.026 + 0.012 * Math.sin(nowMs * 0.00055) + 0.006 * Math.sin(nowMs * 0.0011);
    atmGain.gain.setTargetAtTime(atmAmp * (0.85 + 0.15 * breatheMix), now, 0.1);
    atmFilter.frequency.setTargetAtTime(620 + 380 * Math.sin(nowMs * 0.00038) + 200 * breatheMix, now, 0.12);

    /** Micro-pan on atmosphere only (optional stereo motion) */
    atmPanner.pan.setTargetAtTime(0.22 * Math.sin(nowMs * 0.00045), now, 0.15);

    /** Light lateral cue from snags / breath (not the strike — keeps soundstage alive) */
    let panLinear;
    if (modeId === 0 || modeId === 1) {
      panLinear =
        snagArray && snagArray.length ? emdrHemifieldPan(snagArray) : breathPanFromTime(nowMs);
    } else {
      const bPan = breathPanFromTime(nowMs);
      const sPan = snagPanFromTomahawks(snagArray);
      const snagWeight = snagArray && snagArray.length ? 0.38 : 0;
      panLinear = bPan * (1 - snagWeight) + sPan * snagWeight;
    }

    let ageMixPan = panLinear;
    const age = nowMs - clickPanRefMs;
    if (age >= 0 && age < CLICK_PAN_HALF_LIFE_MS * 4) {
      const clickMix = Math.exp(-age / CLICK_PAN_HALF_LIFE_MS);
      ageMixPan = panLinear * (1 - clickMix * 0.72) + clickPanLinear * (clickMix * 0.72);
    }

    const wPx = window.innerWidth || 1;
    const hPx = window.innerHeight || 1;
    const tcx = wPx * 0.5;
    const tcy = hPx * 0.52;

    /** Pacer stays mostly centered; subtle pull toward lateral focus */
    const pacerPanMix = clamp(ageMixPan * 0.35, -0.45, 0.45);
    pacerPanner.pan.setTargetAtTime(pacerPanMix, now, 0.06);

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
      atmPanner.pan.setTargetAtTime(0.55 * Math.sin(θ), now, 0.08);
    }

    if (modeId === 2 && snagArray && snagArray.length && atmFilter && pacerOsc1 && pacerOsc2) {
      let sy = 0;
      for (let i = 0; i < snagArray.length; i++) sy += snagArray[i].y;
      sy /= snagArray.length;
      const H = window.innerHeight || 1;
      const yn = clamp(sy / H, 0, 1);
      atmFilter.frequency.setTargetAtTime(520 + (1 - yn) * 420, now, 0.07);
    }
  };

  window.addEventListener("DOMContentLoaded", refreshMuteButtonUi);
})();
