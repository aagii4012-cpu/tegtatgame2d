/* ==========================================================================
   TEGTAT — Mongolian 2D Adventure
   Isometric arena action game. World-space combat, procedural environment.

   Stage 1  ТӨВШӨӨ · ГАНАА — тал нутаг
   Stage 2  ЭРХМЭЭ · ТЭКА — гэр хороолол
   Stage 3  АНХАА — зэвсгийн шагнал
   Stage 4  МОРЬТ ТЭКА 👑 — эцсийн босс

   Leaderboard: GET /api/leaderboard, POST /api/save-score  (Cloudflare Pages + D1)
   Voice lines: audio/voice/voice-lines.json + audio/voice/*.mp3 (заавал биш)
   ========================================================================== */
(() => {
  "use strict";

  /* ======================================================================
     CONSTANTS
     ====================================================================== */
  const VIEW_W = 960;
  const VIEW_H = 540;
  const GROUND_Y = 452;
  const STEP = 1 / 60;
  const GRAVITY = 1850;
  const MAX_SCORE = 12000;           // functions/api/_shared.js + schema CHECK-тэй ижил
  const TEST_MODE = /[?&]test\b/.test(location.search);

  const SKILLS = {
    dash:  { cost: 18, cd: 1.2,  label: "DASH" },
    power: { cost: 30, cd: 4,    label: "POWER ATTACK" },
    ult:   { cost: 65, cd: 14,   label: "ULTIMATE" }
  };

  const ENERGY_REGEN = 2.4;          // /сек
  const ENERGY_PER_HIT = 3;
  const ENERGY_PER_KILL = 8;
  const COMBO_WINDOW = 2.6;
  const PARRY_WINDOW = 0.22;         // сек — хамгаалалт эхэлснээс хойш энэ хугацаанд цохилт ирвэл PARRY
  const PARRY_RETRY = 0.45;          // сек — parry-г дахин оролдох доод зай (spam хамгаалалт)          // сек — үүнээс удаан цохихгүй бол тэглэнэ

  /* ======================================================================
     SMALL UTILS
     ====================================================================== */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const sign = (v) => (v < 0 ? -1 : 1);
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  const $ = (id) => document.getElementById(id);

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
  };

  /* ======================================================================
     SETTINGS
     ====================================================================== */
  const SETTINGS_KEY = "tegtat2d.settings.v1";
  const settings = Object.assign(
    { music: 55, sfx: 80, voice: 100, subs: true, shake: true, touchSize: 100, touchOffset: 0, leftHanded: false, vibration: false, detail: !window.matchMedia("(prefers-reduced-motion: reduce)").matches },
    store.get(SETTINGS_KEY, {})
  );
  function applyTouchSettings() {
    settings.touchSize = clamp(Number(settings.touchSize) || 100, 80, 120);
    settings.touchOffset = clamp(Number(settings.touchOffset) || 0, 0, 30);
    document.documentElement.style.setProperty("--touch-size", settings.touchSize / 100);
    document.documentElement.style.setProperty("--touch-offset", settings.touchOffset + "px");
    document.body.classList.toggle("left-handed", !!settings.leftHanded);
  }
  function vibrate(ms) {
    if (settings.vibration && document.body.classList.contains("is-touch") && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* unsupported */ }
    }
  }
  function saveSettings() { store.set(SETTINGS_KEY, settings); AudioFx.applyVolumes(); applyTouchSettings(); }

  /* ======================================================================
     AUDIO — Web Audio synth (файлгүй ажиллана)
     ====================================================================== */
  const AudioFx = (() => {
    let ctx = null, master, musicBus, sfxBus, voiceBus, noiseBuf, duck;
    const vol = (v) => Math.pow(clamp(v, 0, 100) / 100, 1.6);

    function ensure() {
      if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => {}); return ctx; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain(); master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ctx.destination);
      duck = ctx.createGain(); duck.connect(master);
      musicBus = ctx.createGain(); musicBus.connect(duck);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      voiceBus = ctx.createGain(); voiceBus.connect(master);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      applyVolumes();
      return ctx;
    }

    function applyVolumes() {
      if (!ctx) return;
      musicBus.gain.value = vol(settings.music) * 0.42;
      sfxBus.gain.value = vol(settings.sfx) * 0.9;
      voiceBus.gain.value = vol(settings.voice) * 1.1;
    }

    function env(g, t, a, peak, d) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }

    function tone(freq, dur, opt = {}) {
      if (!ctx || settings.sfx <= 0 && !opt.bus) return;
      const t = ctx.currentTime + (opt.delay || 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = opt.type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (opt.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t + dur);
      if (opt.detune) o.detune.value = opt.detune;
      env(g, t, opt.attack || 0.005, opt.vol || 0.2, dur);
      let node = o;
      if (opt.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = opt.lp; o.connect(f); node = f; }
      node.connect(g); g.connect(opt.bus || sfxBus);
      o.start(t); o.stop(t + dur + 0.05);
    }

    function noise(dur, opt = {}) {
      if (!ctx) return;
      const t = ctx.currentTime + (opt.delay || 0);
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = dur > 0.9;
      const f = ctx.createBiquadFilter();
      f.type = opt.filter || "bandpass";
      f.frequency.setValueAtTime(opt.from || 1200, t);
      if (opt.to) f.frequency.exponentialRampToValueAtTime(opt.to, t + dur);
      f.Q.value = opt.q || 1;
      const g = ctx.createGain();
      env(g, t, opt.attack || 0.004, opt.vol || 0.25, dur);
      s.connect(f); f.connect(g); g.connect(opt.bus || sfxBus);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    }

    const sfx = {
      hoof(fast) {
        tone(110, .065, { type: "sine", to: 48, vol: fast ? .24 : .16 });
        noise(.055, { from: 1100, to: 260, vol: .11, filter: "lowpass" });
        tone(160, .045, { type: "triangle", to: 65, vol: .09, delay: .065 });
      },
      neigh() {
        // Stylized synthetic whinny; no recorded animal or external assets.
        for (let i=0;i<5;i++) tone(460-i*38,.16,{type:"sawtooth",to:310-i*30,vol:.045,lp:1800,delay:i*.11});
        noise(.3,{from:1300,to:450,vol:.08,delay:.48});
      },
      blade() {
        noise(.16,{from:1400,to:6200,vol:.18,q:1.8});
        tone(1900,.18,{type:"triangle",to:1100,vol:.035,delay:.04});
      },
      swing(heavy) { noise(heavy ? 0.22 : 0.13, { from: heavy ? 900 : 1800, to: heavy ? 3500 : 5200, q: 1.4, vol: heavy ? 0.28 : 0.18, filter: "bandpass" }); },
      hit(heavy) {
        tone(heavy ? 120 : 170, heavy ? 0.18 : 0.1, { type: "sine", to: 50, vol: heavy ? 0.55 : 0.4 });
        noise(heavy ? 0.16 : 0.08, { from: 2500, to: 600, vol: heavy ? 0.35 : 0.25, filter: "lowpass" });
      },
      block() { tone(900, 0.07, { type: "square", vol: 0.08 }); tone(1350, 0.09, { type: "triangle", vol: 0.08, delay: 0.02 }); noise(0.08, { from: 3000, to: 1200, vol: 0.12 }); },
      parry() {
        tone(1760, 0.18, { type: "square", vol: 0.1, lp: 5000 });
        tone(2640, 0.32, { type: "triangle", vol: 0.12, delay: 0.01 });
        tone(3520, 0.4, { type: "sine", vol: 0.08, delay: 0.03 });
        noise(0.06, { from: 7000, vol: 0.25, filter: "highpass" });
      },
      hurt() { tone(220, 0.22, { type: "sawtooth", to: 90, vol: 0.2, lp: 1400 }); noise(0.12, { from: 1500, to: 300, vol: 0.25, filter: "lowpass" }); },
      jump() { tone(260, 0.12, { type: "triangle", to: 520, vol: 0.13 }); },
      land() { noise(0.07, { from: 500, to: 200, vol: 0.12, filter: "lowpass" }); },
      dash() { noise(0.28, { from: 400, to: 3000, q: 0.8, vol: 0.3 }); tone(180, 0.2, { type: "sine", to: 420, vol: 0.12 }); },
      power() {
        tone(90, 0.5, { type: "sine", to: 38, vol: 0.7 });
        noise(0.45, { from: 1600, to: 120, vol: 0.45, filter: "lowpass" });
        tone(440, 0.25, { type: "sawtooth", to: 110, vol: 0.1, lp: 2000 });
      },
      ultCharge() { tone(220, 0.5, { type: "sawtooth", to: 880, vol: 0.12, lp: 3000 }); tone(330, 0.5, { type: "sawtooth", to: 1320, vol: 0.08, lp: 3000, detune: 8 }); },
      thunder() {
        noise(0.9, { from: 4000, to: 90, vol: 0.55, filter: "lowpass" });
        tone(70, 0.6, { type: "sine", to: 30, vol: 0.6 });
        noise(0.06, { from: 6000, vol: 0.3, filter: "highpass" });
      },
      pickup(kind) {
        const base = kind === "hp" ? 523 : kind === "en" ? 587 : kind === "power" ? 392 : 659;
        [0, 4, 7, 12].forEach((s, i) => tone(base * Math.pow(2, s / 12), 0.12, { type: "triangle", vol: 0.14, delay: i * 0.05 }));
      },
      deny() { tone(150, 0.12, { type: "square", vol: 0.1, lp: 900 }); tone(110, 0.14, { type: "square", vol: 0.1, lp: 900, delay: 0.09 }); },
      enemyDie() { tone(300, 0.35, { type: "sawtooth", to: 60, vol: 0.14, lp: 1200 }); noise(0.3, { from: 800, to: 120, vol: 0.2, filter: "lowpass" }); },
      shoot() { tone(700, 0.08, { type: "triangle", to: 300, vol: 0.12 }); noise(0.1, { from: 3000, to: 1200, vol: 0.12 }); },
      deflect() { tone(1500, 0.09, { type: "square", vol: 0.08, to: 2400 }); },
      warn() { tone(880, 0.09, { type: "square", vol: 0.1 }); tone(880, 0.09, { type: "square", vol: 0.1, delay: 0.16 }); },
      slam() { tone(70, 0.45, { type: "sine", to: 32, vol: 0.65 }); noise(0.4, { from: 900, to: 80, vol: 0.45, filter: "lowpass" }); },
      roar() {
        tone(110, 1.1, { type: "sawtooth", to: 70, vol: 0.22, lp: 700, attack: 0.08 });
        tone(116, 1.1, { type: "sawtooth", to: 66, vol: 0.18, lp: 600, attack: 0.08, detune: -20 });
        noise(1.0, { from: 600, to: 200, vol: 0.18, filter: "bandpass", attack: 0.1 });
      },
      meteor() { noise(0.6, { from: 300, to: 2400, vol: 0.18, filter: "bandpass" }); },
      boom() { tone(60, 0.5, { type: "sine", to: 28, vol: 0.6 }); noise(0.5, { from: 2000, to: 100, vol: 0.4, filter: "lowpass" }); },
      combo(n) { tone(660 + Math.min(n, 20) * 30, 0.07, { type: "triangle", vol: 0.06 }); },
      stageClear() { [0, 4, 7, 12, 7, 12].forEach((s, i) => tone(440 * Math.pow(2, s / 12), 0.18, { type: "triangle", vol: 0.14, delay: i * 0.1 })); },
      victory() {
        const seq = [0, 3, 5, 7, 10, 12, 15, 19];
        seq.forEach((s, i) => tone(330 * Math.pow(2, s / 12), 0.3, { type: "triangle", vol: 0.16, delay: i * 0.11 }));
        tone(165, 1.4, { type: "sawtooth", vol: 0.1, lp: 900, delay: 0.9 });
      },
      gameOver() { [7, 5, 3, 0].forEach((s, i) => tone(220 * Math.pow(2, s / 12), 0.35, { type: "sawtooth", vol: 0.12, lp: 1100, delay: i * 0.22 })); },
      click() { tone(700, 0.04, { type: "triangle", vol: 0.06 }); }
    };

    /* ---------- Music: жижиг sequencer (морин хуур маягийн drone + давхих хэмнэл) ---------- */
    const PENTA = [0, 3, 5, 7, 10];                // минор пентатоник
    const TRACKS = {
      steppe: { bpm: 104, root: 57, mel: [0,null,2,null,3,2,0,null, 4,null,3,2,1,null,0,null, 2,null,3,null,4,null,5,4, 3,null,2,null,0,null,null,null], drums: "gallop", drone: true },
      ger:    { bpm: 116, root: 59, mel: [0,null,0,2,3,null,2,0, 1,null,1,3,2,null,null,null, 0,2,3,4,5,null,4,3, 2,null,1,null,0,null,null,null], drums: "gallop", drone: true },
      calm:   { bpm: 80,  root: 52, mel: [0,null,null,null,2,null,null,null, 1,null,null,null,0,null,null,null], drums: "none", drone: true },
      boss:   { bpm: 148, root: 52, mel: [0,0,null,3,null,2,null,0, 5,null,4,null,3,2,null,null, 0,0,null,3,null,4,null,5, 7,null,6,5,4,null,3,null], drums: "boss", drone: true }
    };
    let track = null, stepIdx = 0, nextTime = 0, timer = null;

    function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
    function degree(d, root) { const oct = Math.floor(d / 5); return root + 12 + oct * 12 + PENTA[((d % 5) + 5) % 5]; }

    function scheduleStep(t) {
      const tr = TRACKS[track];
      const spb = 60 / tr.bpm / 2;              // 8th note
      const s = stepIdx % tr.mel.length;
      const m = tr.mel[s];
      if (m != null) bowed(midi(degree(m, tr.root)), spb * 1.8, t, track === "boss" ? 0.12 : 0.1);
      if (tr.drone && s % 8 === 0) {
        bowed(midi(tr.root - 12), spb * 8.2, t, 0.07, true);
        bowed(midi(tr.root - 5), spb * 8.2, t, 0.04, true);
      }
      if (tr.drums === "gallop") {
        const pat = [1, 0, 1, 1, 1, 0, 1, 1];
        if (pat[s % 8]) drum(t, s % 4 === 0 ? 0.32 : 0.16);
      } else if (tr.drums === "boss") {
        if (s % 2 === 0) drum(t, s % 4 === 0 ? 0.42 : 0.24);
        if (s % 4 === 2) hat(t, 0.08);
        if (s % 8 === 4) snare(t);
      }
      stepIdx++;
      return spb;
    }

    function bowed(freq, dur, t, v, low) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator();
      const f = ctx.createBiquadFilter(), g = ctx.createGain();
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = "sawtooth"; o2.type = "sawtooth";
      o.frequency.value = freq; o2.frequency.value = freq; o2.detune.value = 9;
      lfo.frequency.value = 5.2; lg.gain.value = low ? 0 : freq * 0.008;
      lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      f.type = "lowpass"; f.frequency.value = low ? 520 : 1500; f.Q.value = 2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + Math.min(0.08, dur * 0.3));
      g.gain.setValueAtTime(v, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(musicBus);
      [o, o2, lfo].forEach((n) => { n.start(t); n.stop(t + dur + 0.05); });
    }
    function drum(t, v) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.2);
    }
    function hat(t, v) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = 6000;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random() * 0.5); s.stop(t + 0.06);
    }
    function snare(t) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; f.type = "bandpass"; f.frequency.value = 1800;
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random() * 0.5); s.stop(t + 0.18);
    }

    function pump() {
      if (!ctx || !track) return;
      while (nextTime < ctx.currentTime + 0.15) {
        if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.02;
        nextTime += scheduleStep(nextTime);
      }
    }

    function music(name) {
      if (!ensure()) return;
      if (track === name) return;
      track = name || null;
      stepIdx = 0;
      nextTime = ctx.currentTime + 0.08;
      if (!timer) timer = setInterval(pump, 50);
      if (!track) { clearInterval(timer); timer = null; }
    }

    function duckMusic(seconds) {
      if (!ctx) return;
      const t = ctx.currentTime;
      duck.gain.cancelScheduledValues(t);
      duck.gain.setTargetAtTime(0.35, t, 0.04);
      duck.gain.setTargetAtTime(1, t + seconds, 0.25);
    }

    /* ---------- Дуу файлгүй үед: синтез хоолой (эрэгтэй "ёо!/хөө!" маягийн дуу) ---------- */
    const VOWELS = { o: [500, 900, 2400], a: [760, 1250, 2500], u: [350, 700, 2300], e: [520, 1700, 2500] };
    function vocal(group) {
      if (!ensure() || settings.voice <= 0) return 0;
      const plans = {
        hurt:       [{ v: "o", f0: [230, 120], d: 0.34, g: 0.5 }],
        lowHp:      [{ v: "o", f0: [150, 105], d: 0.55, g: 0.45 }, { v: "e", f0: [140, 95], d: 0.4, g: 0.35, at: 0.5 }],
        skill:      [{ v: "a", f0: [150, 210], d: 0.32, g: 0.6 }],
        bossDefeat: [{ v: "a", f0: [140, 190], d: 0.3, g: 0.5 }, { v: "u", f0: [190, 130], d: 0.45, g: 0.45, at: 0.32 }],
        tekaTaunt:  [{ v: "e", f0: [155, 205], d: 0.26, g: 0.58 }, { v: "a", f0: [205, 145], d: 0.36, g: 0.5, at: 0.24 }]
      };
      const plan = plans[group] || plans.hurt;
      const jitter = rand(0.92, 1.08);
      let total = 0;
      for (const syl of plan) {
        const t = ctx.currentTime + (syl.at || 0);
        const src = ctx.createOscillator();
        src.type = "sawtooth";
        src.frequency.setValueAtTime(syl.f0[0] * jitter, t);
        src.frequency.exponentialRampToValueAtTime(syl.f0[1] * jitter, t + syl.d);
        const vib = ctx.createOscillator(), vg = ctx.createGain();
        vib.frequency.value = 7; vg.gain.value = 4; vib.connect(vg); vg.connect(src.frequency);
        const out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(syl.g, t + 0.025);
        out.gain.setValueAtTime(syl.g, t + syl.d * 0.55);
        out.gain.exponentialRampToValueAtTime(0.0001, t + syl.d);
        VOWELS[syl.v].forEach((fq, i) => {
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass"; bp.frequency.value = fq; bp.Q.value = i === 0 ? 6 : 9;
          const fg = ctx.createGain(); fg.gain.value = [1.0, 0.55, 0.22][i];
          src.connect(bp); bp.connect(fg); fg.connect(out);
        });
        // амьсгал
        const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
        n.buffer = noiseBuf; nf.type = "bandpass"; nf.frequency.value = 1600; nf.Q.value = 0.8;
        ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(syl.g * 0.12, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.0001, t + syl.d * 0.8);
        n.connect(nf); nf.connect(ng); ng.connect(voiceBus);
        out.connect(voiceBus);
        src.start(t); vib.start(t); n.start(t, Math.random() * 0.5);
        src.stop(t + syl.d + 0.05); vib.stop(t + syl.d + 0.05); n.stop(t + syl.d + 0.05);
        total = Math.max(total, (syl.at || 0) + syl.d);
      }
      return total;
    }

    return {
      ensure, applyVolumes, sfx, music, duckMusic, vocal,
      get ctx() { return ctx; },
      get voiceBus() { return voiceBus; },
      play(name, ...args) { if (ctx && sfx[name]) { try { sfx[name](...args); } catch (e) { /* ignore */ } } }
    };
  })();

  /* ======================================================================
     CHARACTER VOICE SYSTEM
     Файлууд: audio/voice/<id>.mp3 — жагсаалт audio/voice/voice-lines.json
     Файл байхгүй бол тоглоом хэвийн ажиллана (зөвхөн бичвэр гарна).
     ====================================================================== */
  const VOICE_DEFAULTS = {
    enabled: false,
    basePath: "audio/voice/",
    lines: {
      hurt_01:        { group: "hurt",       file: "hurt_01.mp3",        text: "Ёоё, писда!",               weight: 4 },
      hurt_02:        { group: "hurt",       file: "hurt_02.mp3",        text: "Өө, хөөе!",                 weight: 1 },
      hurt_03:        { group: "hurt",       file: "hurt_03.mp3",        text: "Боль л доо!",               weight: 1 },
      hurt_04:        { group: "hurt",       file: "hurt_04.mp3",        text: "Арай ч дээ!",               weight: 1 },
      hurt_05:        { group: "hurt",       file: "hurt_05.mp3",        text: "Яасан хатуу цохидог юм!",   weight: 1 },
      low_hp_01:      { group: "lowHp",      file: "low_hp_01.mp3",      text: "Өө, хэцүүдлээ!",            weight: 1 },
      low_hp_02:      { group: "lowHp",      file: "low_hp_02.mp3",      text: "Амь хүрэхгүй нь!",          weight: 1 },
      skill_01:       { group: "skill",      file: "skill_01.mp3",       text: "За ав!",                    weight: 1 },
      skill_02:       { group: "skill",      file: "skill_02.mp3",       text: "Одоо хар!",                 weight: 1 },
      boss_defeat_01: { group: "bossDefeat", file: "boss_defeat_01.mp3", text: "За, дууслаа!",              weight: 1 },
      teka_taunt_01:  { group: "tekaTaunt",  file: "teka_taunt_01.mp3",  text: "Гэчий минь!",               weight: 1 }
    }
  };

  const Voice = {
    cfg: VOICE_DEFAULTS,
    buffers: new Map(),
    loading: null,
    lastAt: -99,
    lastId: null,
    current: null,
    bubble: null,            // { text, t } — canvas дээр дүрийн толгой дээр гарна
    rules: {
      hurt:       { chance: 0.45, cooldown: 3.5 },
      lowHp:      { chance: 1,    cooldown: 0 },
      skill:      { chance: 0.7,  cooldown: 2.5 },
      bossDefeat: { chance: 1,    cooldown: 0 },
      tekaTaunt:  { chance: 0.65, cooldown: 5.5 }
    },
    groupLast: {},

    init() {
      if (this.loading) return this.loading;
      this.loading = (async () => {
        try {
          if (location.protocol === "file:") return;
          const res = await fetch(VOICE_DEFAULTS.basePath + "voice-lines.json", { cache: "no-cache" });
          if (!res.ok) return;
          const m = await res.json();
          if (!m || typeof m !== "object") return;
          const lines = {};
          for (const [id, def] of Object.entries(VOICE_DEFAULTS.lines)) {
            const o = (m.lines && m.lines[id]) || {};
            lines[id] = {
              group: def.group,
              file: typeof o.file === "string" ? o.file.replace(/[^\w.\-]/g, "") : def.file,
              text: typeof o.text === "string" ? o.text.slice(0, 60) : def.text,
              weight: Number.isFinite(o.weight) ? clamp(o.weight, 0, 20) : def.weight
            };
          }
          this.cfg = { enabled: m.enabled === true, basePath: VOICE_DEFAULTS.basePath, lines };
        } catch (e) { /* manifest байхгүй — default */ }
        this.updateNote();
        if (!this.cfg.enabled) return;
        const ctx = AudioFx.ensure();
        if (!ctx) return;
        await Promise.all(Object.entries(this.cfg.lines).map(async ([id, line]) => {
          if (!line.file) return;
          try {
            const r = await fetch(this.cfg.basePath + line.file);
            if (!r.ok) return;
            const ab = await r.arrayBuffer();
            const buf = await new Promise((ok, fail) => {
              const p = ctx.decodeAudioData(ab, ok, fail);
              if (p && p.then) p.then(ok, fail);
            });
            this.buffers.set(id, buf);
          } catch (e) { /* алга болсон / эвдэрсэн файл — алгасна */ }
        }));
        this.updateNote();
      })();
      return this.loading;
    },

    updateNote() {
      const el = $("voice-note");
      if (!el) return;
      const n = this.buffers.size;
      el.textContent = n
        ? `Дуут хэллэг: ${n}/${Object.keys(this.cfg.lines).length} файл ачааллаа.`
        : "Монгол дуу бичлэгийн файл одоогоор алга — түр синтез хоолой + бичвэрээр гарна (audio/voice/README.md).";
    },

    /** group: hurt | lowHp | skill | bossDefeat | tekaTaunt */
    say(group, now, force) {
      const rule = this.rules[group];
      if (!rule) return false;
      if (!force) {
        if (now - this.lastAt < 1.2) return false;                      // ерөнхий давхцал
        if (now - (this.groupLast[group] ?? -99) < rule.cooldown) return false;
        if (Math.random() > rule.chance) return false;
      }
      const ids = Object.keys(this.cfg.lines).filter((id) => this.cfg.lines[id].group === group);
      if (!ids.length) return false;
      let pool = ids.filter((id) => id !== this.lastId);
      if (!pool.length) pool = ids;
      const total = pool.reduce((s, id) => s + (this.cfg.lines[id].weight || 1), 0);
      let r = Math.random() * total, id = pool[0];
      for (const k of pool) { r -= this.cfg.lines[k].weight || 1; if (r <= 0) { id = k; break; } }
      this.lastId = id;
      this.lastAt = now;
      this.groupLast[group] = now;
      this.play(id);
      return true;
    },

    play(id) {
      const line = this.cfg.lines[id];
      if (!line) return;
      const buf = this.buffers.get(id);
      const ctx = AudioFx.ctx;
      let dur = 1.4;
      if (buf && ctx && settings.voice > 0) {
        try {
          if (this.current) { try { this.current.stop(); } catch (e) { /* already stopped */ } }
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.playbackRate.value = rand(0.97, 1.03);
          src.connect(AudioFx.voiceBus);
          src.start();
          this.current = src;
          dur = buf.duration;
          AudioFx.duckMusic(buf.duration);
        } catch (e) { /* ignore */ }
      } else if (settings.voice > 0) {
        // mp3 байхгүй — синтез хоолойгоор орлуулна (жинхэнэ бичлэг хийвэл автоматаар солигдоно)
        const d = AudioFx.vocal(line.group);
        if (d) AudioFx.duckMusic(d);
      }
      if (settings.subs) this.bubble = { text: line.text, t: 0, dur: Math.max(1.3, dur + 0.5) };
    }
  };

  /* ======================================================================
     DOM
     ====================================================================== */
  const ui = {
    frame: $("frame"), canvas: $("game-canvas"), hud: $("hud"),
    barHp: $("bar-hp"), hpFill: $("hp-fill"), hpLag: $("hp-lag"), hpText: $("hp-text"),
    barEn: $("bar-en"), enFill: $("en-fill"), enText: $("en-text"),
    buff: $("buff-power"), buffTime: $("buff-time"),
    stageChip: $("stage-chip"), stageKicker: $("stage-kicker"), stageName: $("stage-name"), stageLeft: $("stage-left"),
    objective: $("combat-objective"),
    bossBar: $("boss-bar"), bossName: $("boss-name"), bossFill: $("boss-fill"), bossLag: $("boss-lag"), bossPhase: $("boss-phase"),
    scoreBox: document.querySelector(".score-box"), score: $("score-text"),
    combo: $("combo"), comboCount: $("combo-count"), comboMult: $("combo-mult"), comboTimer: $("combo-timer"),
    skillbar: $("skillbar"), skillEls: document.querySelectorAll("[data-skill]"),
    banner: $("banner"), bannerKicker: $("banner-kicker"), bannerTitle: $("banner-title"), bannerSub: $("banner-sub"),
    goArrow: $("go-arrow"), toast: $("toast"), touch: $("touch"), tMove: $("t-move"), tKnob: $("t-knob"),
    nameForm: $("name-form"), nameInput: $("player-name"), nameError: $("name-error"),
    boardBody: $("board-body"), boardStatus: $("board-status"), boardYou: $("board-you"),
    endCard: document.querySelector(".end-card"), endKicker: $("end-kicker"), endTitle: $("end-title"), endScore: $("end-score"),
    stKills: $("st-kills"), stTime: $("st-time"), stSkills: $("st-skills"), stCombo: $("st-combo"),
    saveBtn: $("save-btn"), saveStatus: $("save-status"),
    screens: {
      start: $("screen-start"), help: $("screen-help"), settings: $("screen-settings"),
      board: $("screen-board"), pause: $("screen-pause"), end: $("screen-end")
    }
  };

  /* ======================================================================
     INPUT — keyboard + touch
     ====================================================================== */
  const input = {
    k: { left: false, right: false, up: false, down: false, jump: false, attack: false, block: false },
    t: { left: false, right: false, up: false, down: false, jump: false, attack: false, block: false },
    m: { block: false, attack: false },
    aim: { mouse: false, x: 480, y: 270, touch: false, vx: 0, vy: -1, until: -99 },
    buf: { jump: -99, attack: -99, dash: -99, power: -99, ult: -99 },
    get left() { return this.k.left || this.t.left; },
    get right() { return this.k.right || this.t.right; },
    get jumpHeld() { return this.k.jump || this.t.jump; },
    get attackHeld() { return this.k.attack || this.t.attack || this.m.attack; },
    get blockHeld() { return this.k.block || this.t.block || this.m.block; },
    press(action) { if (action in this.buf) this.buf[action] = game.t; },
    consume(action, win = 0.16) {
      if (game.t - this.buf[action] <= win) { this.buf[action] = -99; return true; }
      return false;
    },
    clear() {
      for (const o of [this.k, this.t, this.m]) for (const key in o) o[key] = false;
      for (const key in this.buf) this.buf[key] = -99;
      ui.tMove.classList.remove("is-left", "is-right");
      ui.tKnob.style.setProperty("--kx", "0px");
      ui.tKnob.style.setProperty("--ky", "0px");
      document.querySelectorAll(".t-btn.is-down").forEach((b) => b.classList.remove("is-down"));
      this.aim.touch = false; this.aim.until = -99;
    }
  };

  const KEYMAP = {
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    ArrowUp: "up", KeyW: "up", KeyK: "jump", Space: "jump", ArrowDown: "down", KeyS: "down",
    KeyJ: "attack",                      // + хулганы зүүн товч (mouse 1)
    KeyF: "block", KeyC: "block",        // + хулганы баруун товч (mouse 2) — хамгаалах / parry
    KeyQ: "dash", ShiftLeft: "dash", ShiftRight: "dash", KeyL: "dash",
    KeyE: "power", KeyR: "ult",
    KeyP: "pause", Escape: "pause"
  };

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) && t.type !== "range" && t.type !== "checkbox";
  }

  window.addEventListener("keydown", (e) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    if (action === "pause") {
      if (closeTopModal()) { e.preventDefault(); return; }
      if (game.mode === "play") { e.preventDefault(); pauseGame(); }
      else if (game.mode === "paused" && !e.repeat) { e.preventDefault(); resumeGame(); }
      return;
    }
    if (isTyping(e)) return;
    if (game.mode !== "play") return;
    e.preventDefault();
    if (action in input.k) input.k[action] = true;
    if (!e.repeat) input.press(action);
  });
  window.addEventListener("keyup", (e) => {
    const action = KEYMAP[e.code];
    if (action && game.mode === "play" && !isTyping(e)) e.preventDefault();   // фокустай товчийг SPACE-ээр дарахгүй
    if (action && action in input.k) input.k[action] = false;
  });
  window.addEventListener("blur", () => { input.clear(); if (game.mode === "play") pauseGame(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && game.mode === "play") pauseGame(); });

  /* ---------- Touch ---------- */
  function enableTouchUi() {
    if (document.body.classList.contains("is-touch")) return;
    document.body.classList.add("is-touch");
    requestAnimationFrame(() => resize());
  }
  if ((window.matchMedia && matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 0 && !matchMedia("(pointer: fine)").matches) enableTouchUi();
  window.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") enableTouchUi(); }, { passive: true });

  (function bindTouch() {
    const pad = ui.tMove;
    let padId = null;
    const update = (e) => {
      const r = pad.getBoundingClientRect();
      const rel = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      const vertical = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      input.t.left = rel < -0.2;
      input.t.right = rel > 0.2;
      input.t.up = vertical < -.2; input.t.down = vertical > .2;
      pad.classList.toggle("is-left", input.t.left);
      pad.classList.toggle("is-right", input.t.right);
      ui.tKnob.style.setProperty("--kx", (rel * r.width * 0.3).toFixed(1) + "px");
      ui.tKnob.style.setProperty("--ky", (vertical * r.height * .3).toFixed(1) + "px");
    };
    const end = (e) => {
      if (e.pointerId !== padId) return;
      padId = null;
      input.t.left = input.t.right = false;
      input.t.up = input.t.down = false;
      pad.classList.remove("is-left", "is-right");
      ui.tKnob.style.setProperty("--kx", "0px");
      ui.tKnob.style.setProperty("--ky", "0px");
    };
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      padId = e.pointerId;
      try { pad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      update(e);
    });
    pad.addEventListener("pointermove", (e) => { if (e.pointerId === padId) update(e); });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => pad.addEventListener(ev, end));

    document.querySelectorAll(".t-btn[data-key]").forEach((btn) => {
      const key = btn.dataset.key;
      const ids = new Set();
      const starts = new Map();
      const aimable = key === "power" || key === "ult";
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        ids.add(e.pointerId);
        if (aimable) starts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        btn.classList.add("is-down");
        if (key in input.t) input.t[key] = true;
        if (game.mode === "play" && !aimable) input.press(key);
      });
      btn.addEventListener("pointermove", (e) => {
        const start = starts.get(e.pointerId); if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y, n = Math.hypot(dx, dy);
        if (n > 10) { input.aim.touch = true; input.aim.vx = dx / n; input.aim.vy = dy / n; input.aim.until = game.t + .4; }
      });
      const up = (e, cancelled = false) => {
        if (!ids.delete(e.pointerId)) return;
        const start = starts.get(e.pointerId); starts.delete(e.pointerId);
        if (aimable && !cancelled && game.mode === "play") {
          const dx = start ? e.clientX - start.x : 0, dy = start ? e.clientY - start.y : 0, n = Math.hypot(dx, dy);
          if (n > 10) { input.aim.touch = true; input.aim.vx = dx / n; input.aim.vy = dy / n; input.aim.until = game.t + .4; }
          input.press(key);
        }
        if (ids.size) return;
        btn.classList.remove("is-down");
        if (key in input.t) input.t[key] = false;
      };
      btn.addEventListener("pointerup", (e) => up(e, false));
      ["pointercancel", "lostpointercapture"].forEach((ev) => btn.addEventListener(ev, (e) => up(e, true)));
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    });

    // PC: POWER болон ULTIMATE нь курсор байгаа цэг рүү чиглэнэ.
    ui.canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      const r = ui.canvas.getBoundingClientRect();
      input.aim.mouse = true;
      input.aim.x = clamp((e.clientX - r.left) / r.width * VIEW_W, 0, VIEW_W);
      input.aim.y = clamp((e.clientY - r.top) / r.height * VIEW_H, 0, VIEW_H);
    });
    // Курсор skill bar руу шилжсэн ч хамгийн сүүлд заасан байг хадгална.

    // Desktop skill bar — хулганаар дарж болно
    ui.skillbar.querySelectorAll(".skill").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());          // focus авахгүй (SPACE давхар дарагдахаас сэргийлнэ)
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (game.mode === "play" && btn.dataset.act !== "block") input.press(btn.dataset.skill || btn.dataset.act);
      });
    });

    // Энгийн цохилт: тоглоомын талбай дээр хулганы зүүн товч
    ui.frame.addEventListener("mousedown", (e) => {
      if (e.button === 2 && game.mode === "play") { e.preventDefault(); input.m.block = true; return; }
      if (e.button !== 0 || game.mode !== "play") return;
      if (e.target.closest("button, a, input, .overlay, .touch")) return;
      e.preventDefault();
      input.m.attack = true;
      input.press("attack");
    });
    ui.frame.addEventListener("contextmenu", (e) => { if (game.mode === "play") e.preventDefault(); });
    window.addEventListener("mouseup", (e) => { if (e.button === 2) input.m.block = false; if(e.button===0)input.m.attack=false; });
    // Skill bar-ийн GUARD товч — дарж байх хугацаандаа хамгаална
    const gBtn = ui.skillbar.querySelector('[data-act="block"]');
    if (gBtn) {
      gBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); if (game.mode === "play") { input.m.block = true; gBtn.classList.add("is-down"); } });
      const gUp = () => { input.m.block = false; gBtn.classList.remove("is-down"); };
      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => gBtn.addEventListener(ev, gUp));
    }
  })();

  /* ======================================================================
     MODALS
     ====================================================================== */
  const modalStack = [];
  function openModal(name) {
    const el = ui.screens[name];
    if (!el) return;
    AudioFx.ensure();
    if (name === "board") loadLeaderboard();
    if (name === "settings") syncSettingsUi();
    if (!modalStack.includes(name)) modalStack.push(name);
    el.hidden = false;
    const focusable = el.querySelector("[data-close], button, input");
    if (focusable && !document.body.classList.contains("is-touch")) setTimeout(() => focusable.focus({ preventScroll: true }), 30);
  }
  function closeModal(name) {
    const el = ui.screens[name];
    if (!el) return;
    el.hidden = true;
    const i = modalStack.indexOf(name);
    if (i >= 0) modalStack.splice(i, 1);
  }
  function closeTopModal() {
    const name = modalStack[modalStack.length - 1];
    if (!name) return false;
    closeModal(name);
    return true;
  }
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) { AudioFx.play("click"); openModal(open.dataset.open); return; }
    const close = e.target.closest("[data-close]");
    if (close) { AudioFx.play("click"); const ov = close.closest(".overlay"); if (ov) closeModal(Object.keys(ui.screens).find((k) => ui.screens[k] === ov)); return; }
    const ov = e.target.classList && e.target.classList.contains("overlay-modal") ? e.target : null;
    if (ov && ov !== ui.screens.pause) closeModal(Object.keys(ui.screens).find((k) => ui.screens[k] === ov));
  });

  /* ---------- Settings UI ---------- */
  function syncSettingsUi() {
    for (const k of ["music", "sfx", "voice"]) {
      $("set-" + k).value = settings[k];
      $("out-" + k).textContent = settings[k];
    }
    $("set-subs").checked = !!settings.subs;
    $("set-shake").checked = !!settings.shake;
    $("set-detail").checked = !!settings.detail;
    for (const k of ["touchSize", "touchOffset"]) {
      $("set-" + k).value = settings[k]; $("out-" + k).textContent = settings[k];
    }
    $("set-leftHanded").checked = !!settings.leftHanded;
    $("set-vibration").checked = !!settings.vibration;
    Voice.updateNote();
  }
  for (const k of ["music", "sfx", "voice"]) {
    $("set-" + k).addEventListener("input", (e) => {
      settings[k] = clamp(Math.round(Number(e.target.value) || 0), 0, 100);
      $("out-" + k).textContent = settings[k];
      AudioFx.ensure();
      saveSettings();
    });
  }
  $("set-sfx").addEventListener("change", () => AudioFx.play("hit", false));
  $("set-voice").addEventListener("change", () => { Voice.init(); if (Voice.buffers.size) Voice.play("skill_01"); });
  $("set-subs").addEventListener("change", (e) => { settings.subs = e.target.checked; saveSettings(); });
  $("set-shake").addEventListener("change", (e) => { settings.shake = e.target.checked; saveSettings(); });
  $("set-detail").addEventListener("change", (e) => { settings.detail = e.target.checked; saveSettings(); });
  for (const k of ["touchSize", "touchOffset"]) $("set-" + k).addEventListener("input", e => {
    settings[k] = Number(e.target.value); saveSettings(); $("out-" + k).textContent = settings[k];
  });
  for (const k of ["leftHanded", "vibration"]) $("set-" + k).addEventListener("change", e => {
    settings[k] = e.target.checked; saveSettings();
  });
  $("settings-btn-hud").addEventListener("click", () => { if (game.mode === "play") pauseGame(); openModal("settings"); });

  /* ======================================================================
     HUD
     ====================================================================== */
  const hudCache = {};
  function setText(el, key, text) { if (hudCache[key] !== text) { hudCache[key] = text; el.textContent = text; } }
  function setWidth(el, key, pct) {
    const v = pct.toFixed(1);
    if (hudCache[key] !== v) { hudCache[key] = v; el.style.width = v + "%"; }
  }
  function setClass(el, key, cls, on) { const k = key + cls; if (hudCache[k] !== on) { hudCache[k] = on; el.classList.toggle(cls, on); } }
  function restartAnim(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  function updateHud() {
    const p = game.player;
    if (!p) return;
    const hp = Math.max(0, Math.ceil(p.hp));
    setText(ui.hpText, "hp", `${hp} / ${p.maxHp}`);
    setWidth(ui.hpFill, "hpw", (hp / p.maxHp) * 100);
    setWidth(ui.hpLag, "hpl", (hp / p.maxHp) * 100);
    setClass(ui.barHp, "hpbar", "is-low", hp > 0 && hp <= p.maxHp * 0.25);
    const en = Math.floor(p.en);
    setText(ui.enText, "en", `${en} / ${p.maxEn}`);
    setWidth(ui.enFill, "enw", (p.en / p.maxEn) * 100);

    if (p.boost > 0) { ui.buff.hidden = false; setText(ui.buffTime, "boost", String(Math.ceil(p.boost))); }
    else ui.buff.hidden = true;

    setText(ui.score, "score", String(Math.min(game.score, MAX_SCORE)).padStart(6, "0"));

    // combo
    if (game.combo >= 2) {
      ui.combo.hidden = false;
      setText(ui.comboCount, "combo", "x" + game.combo);
      setText(ui.comboMult, "mult", "×" + comboMult().toFixed(2));
      ui.comboTimer.style.transform = `scaleX(${clamp(game.comboT / COMBO_WINDOW, 0, 1).toFixed(3)})`;
      setClass(ui.combo, "combo", "is-hot", game.combo >= 10);
    } else ui.combo.hidden = true;

    // skills
    for (const el of ui.skillEls) {
      const s = el.dataset.skill, def = SKILLS[s];
      const cdk = p.cd[s] > 0 ? p.cd[s] / def.cd : 0;
      const k = "cd" + s + el.className.length;
      const v = cdk.toFixed(2);
      if (hudCache[k] !== v) { hudCache[k] = v; el.style.setProperty("--cd", v); }
      const low = p.en < def.cost;
      if (el._low !== low) { el._low = low; el.classList.toggle("is-low", low); }
      const ready = !low && cdk === 0;
      if (el._ready !== ready) { el._ready = ready; el.classList.toggle("is-ready", ready); }
      const label=p.cd[s]>0?p.cd[s].toFixed(1)+'s':'';
      if(el.dataset.cooldown!==label)el.dataset.cooldown=label;
    }

    // boss
    const boss = game.boss;
    if (boss && !boss.removed && game.bossShown) {
      ui.bossBar.hidden = false;
      const pct = (Math.max(0, boss.hp) / boss.maxHp) * 100;
      setWidth(ui.bossFill, "bossw", pct);
      setWidth(ui.bossLag, "bossl", pct);
      setText(ui.bossName, "bossname", boss.def.name);
      setText(ui.bossPhase, "phase", boss.def.miniBoss ? "MINI BOSS" : "PHASE " + boss.phase);
    } else ui.bossBar.hidden = true;

    // stage chip
    const st = game.stage;
    if (st) {
      setText(ui.stageKicker, "sk", "STAGE " + st.def.id + " / " + STAGES.length);
      setText(ui.stageName, "sn", st.def.title);
      let left = "";
      if (st.def.waves) left = `${Math.max(1, Math.min(st.waveIdx, st.def.waves.length))}/${st.def.waves.length}`;
      setText(ui.stageLeft, "sl", left ? "WAVE " + left : "");
      ui.stageChip.hidden = !!(boss && game.bossShown);
      const alive=game.enemies.filter(e=>e.state!=='dead').length;
      setText(ui.objective,'objective',st.cleared?'ҮЕ ДУУСЛАА':p.weaponUpgrade?'АНХААГИЙН ЗЭВСЭГ · +20% ХҮЧ':boss?'БОССЫН ДОХИОГ АЖИГЛА':alive?'ДАЙСАН '+alive+' · ЗАЙГАА БАРЬ':'ДАРААГИЙН ТУЛААНД БЭЛТГЭ');
    }
    ui.goArrow.hidden = !(game.mode === "play" && st && !st.lock && st.goHint > 0 && !game.boss);
  }

  let bannerTimer = 0;
  function showBanner(kicker, title, sub, dur = 2.2, warn = false) {
    ui.bannerKicker.textContent = kicker || "";
    ui.bannerTitle.textContent = title || "";
    ui.bannerSub.textContent = sub || "";
    ui.banner.classList.toggle("is-warn", !!warn);
    ui.banner.classList.remove("is-out");
    ui.banner.hidden = false;
    restartAnim(ui.banner, "banner");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      ui.banner.classList.add("is-out");
      bannerTimer = setTimeout(() => { ui.banner.hidden = true; }, 340);
    }, dur * 1000);
  }
  function hideBanner() { clearTimeout(bannerTimer); ui.banner.hidden = true; }

  let toastTimer = 0;
  function toast(text, info) {
    ui.toast.textContent = text;
    ui.toast.classList.toggle("is-info", !!info);
    ui.toast.hidden = false;
    restartAnim(ui.toast, "toast");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 1100);
  }

  function denySkill(skill, reason) {
    AudioFx.play("deny");
    toast(reason);
    document.querySelectorAll(`[data-skill="${skill}"]`).forEach((el) => restartAnim(el, "is-deny"));
    if (reason === "Not enough Energy") restartAnim(ui.barEn, "is-shake");
  }

  /* ======================================================================
     NICKNAME (функцийн _shared.js-тэй ижил дүрэм)
     ====================================================================== */
  const NAME_KEY = "tegtat2d.name";
  function normalizeName(raw) {
    return String(raw || "")
      .normalize("NFC")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function validateName(name) {
    if (!name) return "Nickname-аа оруулна уу.";
    if ([...name].length > 16) return "Nickname 16 тэмдэгтээс ихгүй байна.";
    if (!/^[\p{L}\p{N} _.\-']+$/u.test(name)) return "Зөвхөн үсэг, тоо, зай, _ . - ' ашиглана уу.";
    return "";
  }

  /* ======================================================================
     LEADERBOARD API (одоо байгаа endpoint-ууд)
     ====================================================================== */
  const api = {
    async leaderboard() {
      const res = await fetch("/api/leaderboard", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      return data.scores || [];
    },
    async save(name, score) {
      const res = await fetch("/api/save-score", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, score })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      return data;
    }
  };

  function friendlyError(err) {
    const msg = String((err && err.message) || "");
    if (location.protocol === "file:") return "Leaderboard зөвхөн Cloudflare Pages дээр ажиллана.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Интернэт холболтоо шалгана уу.";
    if (/HTTP 404/.test(msg)) return "Leaderboard API хараахан deploy хийгдээгүй байна.";
    if (/too_many_requests/.test(msg)) return "Хэт ойрхон хадгаллаа — хэдэн секунд хүлээгээд дахин оролдоно уу.";
    if (/db_not_bound|db_error/.test(msg)) return "Database тохиргоо дутуу байна (D1 binding).";
    return msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  let boardReq = 0;
  async function loadLeaderboard() {
    const req = ++boardReq;
    ui.boardStatus.textContent = "Ачаалж байна…";
    try {
      const rows = await api.leaderboard();
      if (req !== boardReq) return;
      const youId = game.saved && game.saved.id;
      ui.boardBody.innerHTML = rows.map((r, i) => {
        const cls = [i < 3 ? "r" + (i + 1) : "", youId && r.id === youId ? "is-you" : ""].join(" ").trim();
        return `<tr class="${cls}"><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${Number(r.score) || 0}</td></tr>`;
      }).join("");
      ui.boardStatus.textContent = rows.length ? "" : "Одоохондоо оноо алга. Эхний хүн нь болоорой!";
      const inTop = youId && rows.some((r) => r.id === youId);
      ui.boardYou.hidden = !(game.saved && !inTop);
      if (game.saved && !inTop) ui.boardYou.textContent = `Таны байр: #${game.saved.rank} · ${game.saved.score}`;
    } catch (err) {
      if (req !== boardReq) return;
      ui.boardBody.innerHTML = "";
      ui.boardStatus.textContent = "Leaderboard ачаалсангүй. " + friendlyError(err);
    }
  }
  $("board-refresh").addEventListener("click", loadLeaderboard);

  async function submitScore() {
    const run = game.run;
    if (!run || run.saveState === "saving" || run.saveState === "saved") return;
    const score = clamp(Math.floor(run.finalScore), 0, MAX_SCORE);
    ui.saveStatus.className = "save-status";
    if (score <= 0) { ui.saveStatus.textContent = "0 оноо хадгалагдахгүй."; return; }
    run.saveState = "saving";
    ui.saveBtn.disabled = true;
    ui.saveStatus.textContent = "Хадгалж байна…";
    try {
      const result = await api.save(game.name, score);
      run.saveState = "saved";
      game.saved = result;
      ui.saveStatus.classList.add("is-ok");
      ui.saveStatus.textContent = result.rank ? `Хадгаллаа ✓ · Байр #${result.rank}` : "Хадгаллаа ✓";
      ui.saveBtn.textContent = "SAVED ✓";
    } catch (err) {
      run.saveState = "error";
      ui.saveBtn.disabled = false;
      ui.saveBtn.textContent = "RETRY SAVE";
      ui.saveStatus.classList.add("is-error");
      ui.saveStatus.textContent = "Хадгалж чадсангүй. " + friendlyError(err);
    }
  }
  ui.saveBtn.addEventListener("click", submitScore);

  /* ======================================================================
     CANVAS
     ====================================================================== */
  const cv = ui.canvas;
  const ctx = cv.getContext("2d", { alpha: false });
  let K = 1;                                   // backing px / logical px
  const bgCache = new Map();

  function resize() {
    const r = ui.frame.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(480, Math.round(r.width * dpr));
    const h = Math.round((w * 9) / 16);
    if (cv.width === w && cv.height === h) return;
    cv.width = w; cv.height = h;
    K = w / VIEW_W;
    bgCache.clear();
  }
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(ui.frame);
  window.addEventListener("resize", resize);

  /* ======================================================================
     STAGES
     ====================================================================== */
  const STAGES = [
    {
      id: 1, key: "steppe", title: "ТӨВШӨӨ · ГАНАА", sub: "Тал нутаг · Улаанбаатарын зах", music: "steppe",
      width: 2700, clearBonus: 300,
      waves: [
        { at: 180,  list: [["tuvshuu", "R"], ["tuvshuu", "R"]] },
        { at: 860,  list: [["ganaa", "R"], ["tuvshuu", "L"], ["tuvshuu", "R"]] },
        { at: 1580, list: [["tuvshuu", "R"], ["ganaa", "R"], ["tuvshuu", "L"], ["ganaa", "R"]] }
      ],
      platforms: [{ x: 1270, w: 124, y: GROUND_Y - 58, prop: "cart" }],
      props: [
        { t: "ger", x: 330, s: 1 }, { t: "fence", x: 470, w: 260 }, { t: "horse", x: 800, c: "#6B4630" },
        { t: "horse", x: 905, c: "#D9D1C4", flip: true }, { t: "ger", x: 1090, s: 0.86 }, { t: "post", x: 1180 },
        { t: "ovoo", x: 1520 }, { t: "fence", x: 1680, w: 200 }, { t: "ger", x: 1980, s: 1.05 },
        { t: "pole", x: 2160 }, { t: "fence", x: 2240, w: 220 }, { t: "pole", x: 2460 }, { t: "sign", x: 2580, text: "ГЭР ХОРООЛОЛ →" }
      ]
    },
    {
      id: 2, key: "ger", title: "ЭРХМЭЭ · ТЭКА", sub: "Гэр хороолол", music: "ger",
      width: 3300, clearBonus: 500,
      waves: [
        { at: 180,  list: [["teka", "R"], ["teka", "R"]] },
        { at: 900,  list: [["erhmee", "R"], ["teka", "L"]] },
        { at: 1640, list: [["erhmee", "R"], ["teka", "L"], ["teka", "R"]] },
        { at: 2380, list: [["erhmee", "R"], ["teka", "R"], ["erhmee", "L"]] }
      ],
      platforms: [
        { x: 1240, w: 150, y: GROUND_Y - 84, prop: "container" },
        { x: 2060, w: 96, y: GROUND_Y - 52, prop: "crates" }
      ],
      props: [
        { t: "khashaa", x: -40, w: 420, c: "#3E6FA8" }, { t: "gerTop", x: 120 }, { t: "pole", x: 60 },
        { t: "shop", x: 480, sign: "ДЭЛГҮҮР", c: "#C2415E", w: 180 }, { t: "pole", x: 380 },
        { t: "khashaa", x: 700, w: 380, c: "#4E8B5A" }, { t: "gerTop", x: 860 }, { t: "pole", x: 700 },
        { t: "pole", x: 1020 }, { t: "khashaa", x: 1100, w: 120, c: "#8A5A3A" },
        { t: "shop", x: 1440, sign: "ХҮНС", c: "#2C7A8A", w: 170, dish: true }, { t: "pole", x: 1340 },
        { t: "khashaa", x: 1650, w: 360, c: "#A0472E" }, { t: "gerTop", x: 1800 }, { t: "pole", x: 1660 },
        { t: "pole", x: 1980 }, { t: "kiosk", x: 2210, sign: "УС" }, { t: "pole", x: 2300 },
        { t: "khashaa", x: 2380, w: 340, c: "#3E6FA8" }, { t: "gerTop", x: 2520 }, { t: "pole", x: 2620 },
        { t: "shop", x: 2780, sign: "ЗАСВАР", c: "#6D5BA8", w: 170 }, { t: "pole", x: 2940 },
        { t: "khashaa", x: 3000, w: 360, c: "#4E8B5A" }, { t: "sign", x: 3180, text: "УУЛ →" }
      ]
    },
    {
      id: 3, key: "mountain", title: "АНХАА", sub: "Уулын даваа · Зэвсгийн эзэн", music: "calm",
      width: 1500, clearBonus: 400, healBonus: 0, boss: { at: 380, type: "anhaa" },
      platforms: [
        { x: 600, w: 120, y: GROUND_Y - 74, prop: "ledge" },
        { x: 1100, w: 120, y: GROUND_Y - 74, prop: "ledge" }
      ],
      props: [
        { t: "pine", x: 40, s: 1.2 }, { t: "ovoo", x: 200, big: true }, { t: "pine", x: 300, s: 0.9 },
        { t: "tug", x: 410 }, { t: "rock", x: 520, w: 70, h: 40 }, { t: "pine", x: 860, s: 1.1 },
        { t: "rock", x: 960, w: 90, h: 50 }, { t: "tug", x: 1320 }, { t: "pine", x: 1420, s: 1.3 }
      ]
    },
    {
      id: 4, key: "mountain", title: "МОРЬТ ТЭКА 👑", sub: "Уулын оргил · Эцсийн тулаан", music: "calm",
      width: 1500, clearBonus: 1000, boss: { at: 380, type: "tekaBoss" },
      platforms: [{ x: 620, w: 120, y: GROUND_Y - 74, prop: "ledge" }],
      props: [{ t: "ovoo", x: 140, big: true }, { t: "tug", x: 370 },
        { t: "rock", x: 530, w: 70, h: 40 }, { t: "pine", x: 900, s: 1.3 },
        { t: "tug", x: 1250 }, { t: "ovoo", x: 1380, big: true }]
    }
  ];

  /* ======================================================================
     BACKGROUND LAYERS (тайл хэлбэрээр урьдчилан зурна)
     ====================================================================== */
  const THEMES = {
    steppe: {
      sky: [[0, "#506f82"], [0.5, "#96b0b8"], [0.78, "#d9d9c6"], [1, "#e8d6ac"]],
      sun: { x: 790, y: 95, r: 25, c: "rgba(255,248,220,", glow: 160 },
      far: { base: 312, amp: [[2, 34], [5, 18], [11, 7]], col: "#83989a", snow: 286, snowCol: "#E9EFF5", haze: "rgba(221,239,243," },
      mid: { base: 392, amp: [[3, 14], [7, 6]], col: "#858c65", col2: "#646f50", dots: "ger" },
      ground: { top: "#78805a", top2: "#68734f", road: "#a69572", road2: "#766b51", track: "rgba(90,60,30,.25)", edge: "#596448" }
    },
    ger: {
      sky: [[0, "#323e51"], [0.42, "#84777c"], [0.72, "#c39377"], [1, "#ecd0a3"]],
      sun: { x: 280, y: 230, r: 38, c: "rgba(255,190,120,", glow: 220 },
      far: { base: 300, amp: [[1, 40], [3, 16]], col: "#726d7a", city: true, cityCol: "#555465" },
      mid: { base: 388, amp: [[2, 18], [5, 8]], col: "#4f5058", col2: "#3d434b", dots: "district" },
      ground: { top: "#7D6047", top2: "#6C513C", road: "#8F6E50", road2: "#7E5F44", track: "rgba(40,25,15,.25)", edge: "#5A4433", puddles: true }
    },
    mountain: {
      sky: [[0, "#111d2c"], [0.45, "#334556"], [0.78, "#677683"], [1, "#a6a79c"]],
      sun: { x: 640, y: 150, r: 30, c: "rgba(255,226,214,", glow: 120 },
      far: { base: 280, amp: [[2, 70], [5, 30], [13, 10]], col: "#3d4e61", snow: 250, snowCol: "#bbc7cd", ridged: true, haze: "rgba(148,57,79," },
      mid: { base: 372, amp: [[3, 28], [8, 10]], col: "#2a3946", col2: "#202f39", dots: "pines", ridged: true },
      ground: { top: "#4F4659", top2: "#433B4E", road: "#5B5266", road2: "#4E4659", track: "rgba(0,0,0,.18)", edge: "#3A3346", stone: true }
    }
  };

  function ridgeY(x, base, amps, seed, ridged) {
    let y = base;
    for (let i = 0; i < amps.length; i++) {
      const [k, a] = amps[i];
      const s = Math.sin((x / VIEW_W) * Math.PI * 2 * k + seed * (i + 1) * 1.7);
      y -= ridged ? (Math.abs(s) * 2 - 1) * a : s * a;
    }
    y += Math.sin(x / VIEW_W * Math.PI * 2 * 23 + seed) * 2.8;
    y += Math.sin(x / VIEW_W * Math.PI * 2 * 47 + seed * 2) * 1.4;
    return y;
  }

  function makeLayer(draw) {
    const c = document.createElement("canvas");
    c.width = Math.round(VIEW_W * K); c.height = Math.round(VIEW_H * K);
    const g = c.getContext("2d");
    g.setTransform(K, 0, 0, K, 0, 0);
    draw(g);
    return c;
  }

  function buildBackground(key) {
    const th = THEMES[key];
    const sky = makeLayer((g) => {
      const gr = g.createLinearGradient(0, 0, 0, VIEW_H * 0.85);
      th.sky.forEach(([o, c]) => gr.addColorStop(o, c));
      g.fillStyle = gr; g.fillRect(0, 0, VIEW_W, VIEW_H);
      const s = th.sun;
      const rg = g.createRadialGradient(s.x, s.y, s.r * 0.4, s.x, s.y, s.glow);
      rg.addColorStop(0, s.c + "0.55)"); rg.addColorStop(1, s.c + "0)");
      g.fillStyle = rg; g.fillRect(0, 0, VIEW_W, VIEW_H);
      g.fillStyle = s.c + "0.95)"; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
      if (key === "mountain") {               // одод
        for (let i = 0; i < 70; i++) {
          g.fillStyle = `rgba(255,255,255,${0.25 + hash(i) * 0.6})`;
          g.fillRect(hash(i * 3.1) * VIEW_W, hash(i * 7.7) * 200, 1.5, 1.5);
        }
      }
    });
    const far = makeLayer((g) => {
      const f = th.far;
      g.beginPath(); g.moveTo(0, VIEW_H);
      for (let x = 0; x <= VIEW_W; x += 4) g.lineTo(x, ridgeY(x, f.base, f.amp, 1.3, f.ridged));
      g.lineTo(VIEW_W, VIEW_H); g.closePath();
      const stone = g.createLinearGradient(0, 170, 0, 415);
      stone.addColorStop(0, shade(f.col, 0.12)); stone.addColorStop(1, shade(f.col, -0.12));
      g.fillStyle = stone; g.fill();
      g.save(); g.clip();
      for (let i = 0; i < 65; i++) {
        const x = hash(i * 5.3) * VIEW_W, y = ridgeY(x, f.base, f.amp, 1.3, f.ridged);
        const drift = 12 + hash(i * 2.7) * 44, depth = 50 + hash(i * 3.9) * 100;
        const relief = g.createLinearGradient(x, y, x, y + depth);
        relief.addColorStop(0, "rgba(26,40,47,.13)"); relief.addColorStop(1, "rgba(26,40,47,0)");
        g.fillStyle = relief;
        g.beginPath();g.moveTo(x, y);g.lineTo(x + drift * .22, y + depth * .25);
        g.lineTo(x + drift * .14, y + depth * .48);g.lineTo(x + drift, y + depth);
        g.lineTo(x - 8, y + depth * .73);g.lineTo(x - 5, y + depth * .32);g.closePath();g.fill();
      }
      g.restore();
      if (f.snow) {
        g.save();
        g.beginPath(); g.moveTo(0, VIEW_H);
        for (let x = 0; x <= VIEW_W; x += 4) g.lineTo(x, ridgeY(x, f.base, f.amp, 1.3, f.ridged));
        g.lineTo(VIEW_W, VIEW_H); g.closePath(); g.clip();
        g.fillStyle = f.snowCol;
        g.beginPath(); g.moveTo(0, 0);
        for (let x = 0; x <= VIEW_W; x += 8) g.lineTo(x, f.snow + Math.sin(x * 0.09) * 6 + Math.sin(x * 0.023) * 8);
        g.lineTo(VIEW_W, 0); g.closePath(); g.fill();
        g.restore();
      }
      if (f.city) {                            // УБ-ын барилга, яндан
        g.fillStyle = f.cityCol;
        for (let i = 0; i < 22; i++) {
          const bx = (i / 22) * VIEW_W + hash(i) * 20, bw = 22 + hash(i * 2) * 30, bh = 30 + hash(i * 5) * 70;
          g.fillRect(bx, 350 - bh, bw, bh + 60);
          g.fillStyle = "rgba(255,214,140,.55)";
          for (let wy = 350 - bh + 6; wy < 345; wy += 9) for (let wx = bx + 4; wx < bx + bw - 4; wx += 7) if (hash(wx * 1.3 + wy) > 0.62) g.fillRect(wx, wy, 2.5, 3);
          g.fillStyle = f.cityCol;
        }
        for (const cx of [180, 230, 640]) {
          g.fillStyle = f.cityCol; g.fillRect(cx, 200, 12, 160);
          g.fillStyle = "#C2415E"; g.fillRect(cx, 206, 12, 5); g.fillRect(cx, 226, 12, 5);
          for (let k = 0; k < 7; k++) {
            g.fillStyle = `rgba(220,200,215,${0.2 - k * 0.025})`;
            g.beginPath(); g.arc(cx + 6 + k * 14, 190 - k * 12, 9 + k * 5, 0, Math.PI * 2); g.fill();
          }
        }
      }
      if (f.haze) {
        const hz = g.createLinearGradient(0, 230, 0, 400);
        hz.addColorStop(0, f.haze + "0)"); hz.addColorStop(1, f.haze + "0.55)");
        g.fillStyle = hz; g.fillRect(0, 230, VIEW_W, 310);
      }
    });
    const mid = makeLayer((g) => {
      const m = th.mid;
      g.beginPath(); g.moveTo(0, VIEW_H);
      for (let x = 0; x <= VIEW_W; x += 4) g.lineTo(x, ridgeY(x, m.base, m.amp, 2.7, m.ridged));
      g.lineTo(VIEW_W, VIEW_H); g.closePath();
      const gr = g.createLinearGradient(0, m.base - 40, 0, VIEW_H);
      gr.addColorStop(0, m.col); gr.addColorStop(1, m.col2);
      g.fillStyle = gr; g.fill();
      for (let i = 0; i < 40; i++) {
        const x = hash(i * 9.1) * VIEW_W;
        const y = ridgeY(x, m.base, m.amp, 2.7, m.ridged);
        if (m.dots === "ger" && i < 9) {
          g.fillStyle = "#F4F1E8"; g.fillRect(x - 6, y + 4, 12, 5);
          g.beginPath(); g.moveTo(x - 7, y + 4); g.lineTo(x, y - 1); g.lineTo(x + 7, y + 4); g.fill();
        } else if (m.dots === "ger" && i < 16) {
          g.fillStyle = "rgba(60,40,30,.6)"; g.fillRect(x, y + 8, 5, 2.5);
        } else if (m.dots === "district") {
          g.fillStyle = hash(i) > 0.5 ? "#5A4060" : "#4A3552";
          g.fillRect(x - 10, y + 2, 22, 8);
          g.fillStyle = "#D8CFC8"; g.beginPath(); g.arc(x, y + 3, 4, Math.PI, 0); g.fill();
          if (hash(i * 4) > 0.6) { g.fillStyle = "rgba(255,210,130,.8)"; g.fillRect(x + 6, y + 4, 2, 2); }
        } else if (m.dots === "pines") {
          g.fillStyle = "#15111F";
          const h = 16 + hash(i * 3) * 22;
          g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + h * 0.32, y + 4); g.lineTo(x - h * 0.32, y + 4); g.fill();
        }
      }
    });
    return { sky, far, mid, theme: th };
  }

  function getBackground(key) {
    const id = key + "@" + K.toFixed(3);
    let bg = bgCache.get(id);
    if (!bg) { bg = buildBackground(key); bgCache.set(id, bg); }
    return bg;
  }

  function drawTiled(img, offsetPx) {
    const w = img.width;
    let x = -(((offsetPx % w) + w) % w);
    ctx.drawImage(img, Math.floor(x), 0);
    ctx.drawImage(img, Math.floor(x) + w - 1, 0);
  }

  function drawBackground(key, camX, t) {
    const bg = getBackground(key);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg.sky, 0, 0);
    ctx.setTransform(K, 0, 0, K, 0, 0);
    TegtatWorld.clouds(ctx, key, camX, settings.detail ? t : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawTiled(bg.far, camX * 0.12 * K);
    drawTiled(bg.mid, camX * 0.32 * K);
    ctx.setTransform(K, 0, 0, K, 0, 0);
  }

  /* ---------- Ground ---------- */
  function drawGround(th, camX) {
    const g = th.ground;
    ctx.fillStyle = g.top;
    ctx.fillRect(0, GROUND_Y - 30, VIEW_W, VIEW_H);
    ctx.fillStyle = g.top2;
    ctx.fillRect(0, GROUND_Y - 30, VIEW_W, 8);
    // зам
    const gr = ctx.createLinearGradient(0, GROUND_Y - 8, 0, VIEW_H);
    gr.addColorStop(0, g.road); gr.addColorStop(1, g.road2);
    ctx.fillStyle = gr;
    ctx.fillRect(0, GROUND_Y - 6, VIEW_W, VIEW_H);
    ctx.fillStyle = g.edge;
    ctx.fillRect(0, GROUND_Y - 6, VIEW_W, 3);
    // дугуйн мөр, чулуу
    const i0 = Math.floor(camX / 48) - 1, i1 = i0 + Math.ceil(VIEW_W / 48) + 2;
    for (let i = i0; i < i1; i++) {
      const x = i * 48 - camX;
      const h = hash(i);
      ctx.fillStyle = g.track;
      ctx.fillRect(x, GROUND_Y + 22 + (h > 0.5 ? 1 : 0), 34 + h * 14, 3);
      ctx.fillRect(x + 12, GROUND_Y + 58, 26 + h * 20, 3);
      if (h > 0.55) { ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(x + h * 40, GROUND_Y + 36 + h * 30, 4, 3); }
      if (g.puddles && h > 0.86) {
        ctx.fillStyle = "rgba(60,50,80,.55)";
        ctx.beginPath(); ctx.ellipse(x + 20, GROUND_Y + 44, 26, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(255,190,140,.35)";
        ctx.beginPath(); ctx.ellipse(x + 16, GROUND_Y + 43, 12, 2, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (g.stone && h > 0.3) {
        ctx.strokeStyle = "rgba(0,0,0,.22)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, GROUND_Y + 10 + h * 60); ctx.lineTo(x + 18, GROUND_Y + 20 + h * 60); ctx.lineTo(x + 26, GROUND_Y + 14 + h * 60); ctx.stroke();
      }
      // өвс
      if (!g.stone) {
        ctx.fillStyle = g.edge;
        const gx = x + h * 30;
        ctx.beginPath(); ctx.moveTo(gx, GROUND_Y - 6); ctx.lineTo(gx + 3, GROUND_Y - 14 - h * 6); ctx.lineTo(gx + 6, GROUND_Y - 6); ctx.fill();
      }
    }
  }

  /* ---------- Props (world space) ---------- */
  function drawProps(stage, camX, t, layer) {
    const def = stage.def;
    if (layer === 0) {
      for (const p of def.props) {
        const x = p.x - camX;
        const w = p.w || 200;
        if (x > VIEW_W + 220 || x + w < -220) continue;
        PROP[p.t] && PROP[p.t](x, GROUND_Y - 6, p, t);
      }
      // цахилгааны утас — шон хооронд
      const poles = def.props.filter((p) => p.t === "pole");
      ctx.strokeStyle = "rgba(20,15,25,.7)"; ctx.lineWidth = 1.2;
      for (let i = 0; i < poles.length - 1; i++) {
        const a = poles[i].x - camX, b = poles[i + 1].x - camX;
        if (b < -50 || a > VIEW_W + 50) continue;
        for (const dy of [0, 10]) {
          ctx.beginPath();
          ctx.moveTo(a + 16, GROUND_Y - 176 + dy);
          ctx.quadraticCurveTo((a + b) / 2, GROUND_Y - 140 + dy, b - 16, GROUND_Y - 176 + dy);
          ctx.stroke();
        }
      }
    } else {
      for (const pl of def.platforms || []) {
        const x = pl.x - camX;
        if (x > VIEW_W + 40 || x + pl.w < -40) continue;
        PLATFORM[pl.prop](x, pl.y, pl.w);
      }
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function smokePuffs(x, y, t, col) {
    for (let i = 0; i < 5; i++) {
      const phase = (t * .32 + i / 5) % 1;
      const px = x + phase * 36 + Math.sin(t + i) * 4, py = y - phase * 52;
      const r = 6 + phase * 15;
      const smoke = ctx.createRadialGradient(px, py, 0, px, py, r);
      smoke.addColorStop(0, col.replace("A", (.22 * (1 - phase)).toFixed(3)));
      smoke.addColorStop(1, col.replace("A", "0"));
      ctx.fillStyle = smoke; ctx.fillRect(px-r,py-r,r*2,r*2);
    }
  }

  const PROP = {
    ger(x, gy, p, t) {
      const s = p.s || 1, w = 128 * s, h = 46 * s;
      ctx.fillStyle = "rgba(0,0,0,.15)"; ctx.beginPath(); ctx.ellipse(x, gy + 2, w * 0.6, 8, 0, 0, Math.PI * 2); ctx.fill();
      const felt = ctx.createLinearGradient(x - w / 2, gy - h, x + w / 2, gy);
      felt.addColorStop(0, "#8f9387"); felt.addColorStop(.4, "#d5d0ba"); felt.addColorStop(.8, "#eee3c9"); felt.addColorStop(1, "#b6b4a0");
      ctx.fillStyle = felt; ctx.fillRect(x - w / 2, gy - h, w, h);
      ctx.strokeStyle = "rgba(77,71,56,.17)"; ctx.lineWidth = .7;
      for (let i = 0; i < 30; i++) {
        const fx = x - w / 2 + i * w / 30;
        ctx.beginPath(); ctx.moveTo(fx, gy-h+2); ctx.lineTo(fx + Math.sin(i)*2, gy-3); ctx.stroke();
      }
      ctx.fillStyle = "#2C5DA8"; ctx.fillRect(x - w / 2, gy - h + 8 * s, w, 5 * s);
      ctx.fillStyle = "#F0C463";
      for (let i = 0; i < 8; i++) ctx.fillRect(x - w / 2 + 6 * s + i * (w - 12 * s) / 8, gy - h + 9 * s, 6 * s, 3 * s);
      ctx.fillStyle = felt;
      ctx.beginPath(); ctx.moveTo(x - w / 2 - 6 * s, gy - h); ctx.quadraticCurveTo(x, gy - h - 52 * s, x + w / 2 + 6 * s, gy - h); ctx.fill();
      ctx.strokeStyle = "rgba(120,100,80,.5)"; ctx.lineWidth = 1.5;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 12 * s, gy - h - 34 * s); ctx.lineTo(x + i * 30 * s, gy - h); ctx.stroke(); }
      ctx.fillStyle = "#D96B2B"; ctx.fillRect(x - 12 * s, gy - 34 * s, 24 * s, 34 * s);
      ctx.strokeStyle = "#F0C463"; ctx.lineWidth = 2; ctx.strokeRect(x - 9 * s, gy - 31 * s, 18 * s, 28 * s);
      ctx.fillStyle = "#4A4048"; ctx.fillRect(x + 22 * s, gy - h - 48 * s, 6 * s, 22 * s);
      smokePuffs(x + 25 * s, gy - h - 52 * s, t, "rgba(240,240,240,A)");
    },
    gerTop(x, gy, p, t) {
      ctx.fillStyle = "#E9E3D6";
      ctx.beginPath(); ctx.moveTo(x - 70, gy - 92); ctx.quadraticCurveTo(x, gy - 140, x + 70, gy - 92); ctx.fill();
      ctx.fillStyle = "#4A4048"; ctx.fillRect(x + 16, gy - 150, 6, 30);
      smokePuffs(x + 19, gy - 152, t, "rgba(200,190,200,A)");
    },
    fence(x, gy, p) {
      ctx.fillStyle = "#7A5636";
      for (let i = 0; i <= p.w; i += 34) ctx.fillRect(x + i, gy - 44, 6, 44);
      ctx.fillStyle = "#8E6640";
      ctx.fillRect(x, gy - 38, p.w + 6, 5); ctx.fillRect(x, gy - 20, p.w + 6, 5);
    },
    khashaa(x, gy, p) {
      const wood = ctx.createLinearGradient(0, gy - 88, 0, gy);
      wood.addColorStop(0, shade(p.c,-.12)); wood.addColorStop(.5,shade(p.c,-.28)); wood.addColorStop(1,shade(p.c,-.5));
      ctx.fillStyle = wood;
      ctx.fillRect(x, gy - 88, p.w, 88);
      ctx.strokeStyle="rgba(231,208,162,.13)";ctx.lineWidth=.7;
      for(let i=0;i<p.w;i+=7){ctx.beginPath();ctx.moveTo(x+i,gy-80+hash(i+p.x)*18);ctx.lineTo(x+i+1,gy-12-hash(i*2+p.x)*20);ctx.stroke();}
      ctx.fillStyle = "rgba(0,0,0,.18)";
      for (let i = 0; i < p.w; i += 16) ctx.fillRect(x + i, gy - 88 + (hash(i + p.x) * 6), 2, 88);
      ctx.fillStyle = "rgba(255,255,255,.12)";
      for (let i = 8; i < p.w; i += 32) ctx.fillRect(x + i, gy - 90 - hash(i * 3 + p.x) * 6, 14, 6);
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(x, gy - 54, p.w, 4);
    },
    shop(x, gy, p) {
      const w = p.w || 170, h = 104;
      ctx.fillStyle = "#E7DCCB"; ctx.fillRect(x, gy - h, w, h);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.moveTo(x - 10, gy - h); ctx.lineTo(x + w / 2, gy - h - 40); ctx.lineTo(x + w + 10, gy - h); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,.15)";
      for (let i = 0; i < w + 20; i += 10) ctx.fillRect(x - 10 + i, gy - h - 4, 2, 4);
      ctx.fillStyle = "#24324A"; ctx.fillRect(x + 14, gy - 70, 46, 36);
      ctx.fillStyle = "rgba(255,226,150,.55)"; ctx.fillRect(x + 17, gy - 67, 40, 30);
      ctx.fillStyle = "#5A3A2A"; ctx.fillRect(x + w - 48, gy - 64, 32, 64);
      ctx.fillStyle = "#F7F1E6"; roundRect(ctx, x + 8, gy - h + 6, w - 16, 22, 4); ctx.fill();
      ctx.fillStyle = p.c; ctx.font = "800 13px Unbounded, Golos Text, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.sign, x + w / 2, gy - h + 17);
      if (p.dish) {
        ctx.fillStyle = "#D8D8DE"; ctx.beginPath(); ctx.ellipse(x + w - 24, gy - h - 18, 12, 16, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#8A8A96"; ctx.fillRect(x + w - 26, gy - h - 10, 3, 12);
      }
    },
    kiosk(x, gy, p) {
      ctx.fillStyle = "#2C7FB8"; roundRect(ctx, x, gy - 92, 90, 92, 6); ctx.fill();
      ctx.fillStyle = "#F7F1E6"; ctx.fillRect(x + 10, gy - 80, 70, 26);
      ctx.fillStyle = "#2C7FB8"; ctx.font = "800 16px Unbounded, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.sign, x + 45, gy - 66);
      ctx.fillStyle = "#1B4E73"; ctx.fillRect(x + 18, gy - 44, 54, 30);
      ctx.fillStyle = "#3D86C6"; ctx.fillRect(x + 64, gy - 22, 30, 22);
    },
    pole(x, gy) {
      ctx.fillStyle = "#4E3A2C"; ctx.fillRect(x - 4, gy - 190, 8, 190);
      ctx.fillStyle = "#3E2E22"; ctx.fillRect(x - 20, gy - 180, 40, 5);
      ctx.fillStyle = "#C9C9D2"; ctx.fillRect(x - 18, gy - 184, 4, 5); ctx.fillRect(x + 14, gy - 184, 4, 5);
    },
    horse(x, gy, p, t) {
      ctx.save(); ctx.translate(x, gy); if (p.flip) ctx.scale(-1, 1);
      const graze = Math.sin(t * 0.8 + p.x) > 0.2 ? 1 : 0;
      ctx.fillStyle = p.c; ctx.strokeStyle = p.c; ctx.lineCap = "round";
      ctx.beginPath(); ctx.ellipse(0, -46, 34, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 6;
      for (const lx of [-24, -14, 18, 26]) { ctx.beginPath(); ctx.moveTo(lx, -40); ctx.lineTo(lx + (lx > 0 ? 2 : -2), 0); ctx.stroke(); }
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(26, -52); ctx.lineTo(graze ? 44 : 42, graze ? -18 : -76); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(graze ? 48 : 48, graze ? -12 : -80, 11, 6, graze ? 1.2 : 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(30,20,15,.8)"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(30,20,15,.8)";
      ctx.beginPath(); ctx.moveTo(-33, -50); ctx.quadraticCurveTo(-46, -36, -40, -18); ctx.stroke();
      ctx.restore();
    },
    post(x, gy) {
      ctx.fillStyle = "#6B4A30"; ctx.fillRect(x - 3, gy - 60, 6, 60); ctx.fillRect(x - 30, gy - 56, 60, 5); ctx.fillRect(x + 27, gy - 60, 6, 60);
    },
    ovoo(x, gy, p, t) {
      const s = p.big ? 1.4 : 1;
      ctx.fillStyle = "#6E6670";
      ctx.beginPath(); ctx.moveTo(x - 46 * s, gy); ctx.lineTo(x, gy - 62 * s); ctx.lineTo(x + 46 * s, gy); ctx.fill();
      ctx.fillStyle = "#857C88";
      for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(x - 30 * s + hash(i + p.x) * 60 * s, gy - 8 - hash(i * 3) * 34 * s, 7 * s, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#5A3E2A"; ctx.fillRect(x - 2, gy - 120 * s, 4, 70 * s);
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = i % 2 ? "#4A9FE0" : "#7FC0F0"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x, gy - 110 * s + i * 8);
        ctx.quadraticCurveTo(x + 20 + Math.sin(t * 3 + i) * 6, gy - 104 * s + i * 8, x + 36 + Math.sin(t * 2.4 + i) * 8, gy - 96 * s + i * 10);
        ctx.stroke();
      }
    },
    sign(x, gy, p) {
      ctx.fillStyle = "#5A3E2A"; ctx.fillRect(x - 3, gy - 90, 6, 90);
      ctx.fillStyle = "#F0C463"; roundRect(ctx, x - 70, gy - 108, 140, 30, 6); ctx.fill();
      ctx.fillStyle = "#2A1A06"; ctx.font = "800 12px Unbounded, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.text, x, gy - 93);
    },
    pine(x, gy, p) {
      const s = p.s || 1;
      ctx.fillStyle = "#3A2A22"; ctx.fillRect(x - 4 * s, gy - 30 * s, 8 * s, 30 * s);
      ctx.fillStyle = "#1F3A32";
      for (let i = 0; i < 3; i++) {
        const y = gy - 30 * s - i * 34 * s, w = (44 - i * 10) * s;
        ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x, y - 54 * s); ctx.lineTo(x + w, y); ctx.fill();
      }
      ctx.fillStyle = "rgba(230,230,245,.5)";
      ctx.beginPath(); ctx.moveTo(x - 10 * s, gy - 120 * s); ctx.lineTo(x, gy - 136 * s); ctx.lineTo(x + 10 * s, gy - 120 * s); ctx.fill();
    },
    rock(x, gy, p) {
      ctx.fillStyle = "#3D3548";
      ctx.beginPath(); ctx.moveTo(x - p.w / 2, gy); ctx.lineTo(x - p.w * 0.3, gy - p.h); ctx.lineTo(x + p.w * 0.2, gy - p.h * 1.1); ctx.lineTo(x + p.w / 2, gy); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.beginPath(); ctx.moveTo(x - p.w * 0.3, gy - p.h); ctx.lineTo(x + p.w * 0.2, gy - p.h * 1.1); ctx.lineTo(x, gy - p.h * 0.6); ctx.fill();
    },
    tug(x, gy, p, t) {
      ctx.fillStyle = "#4A3426"; ctx.fillRect(x - 3, gy - 200, 6, 200);
      ctx.fillStyle = "#F0C463"; ctx.beginPath(); ctx.moveTo(x - 7, gy - 200); ctx.lineTo(x, gy - 226); ctx.lineTo(x + 7, gy - 200); ctx.fill();
      ctx.fillStyle = "#14101A";
      for (let i = 0; i < 9; i++) {
        const sway = Math.sin(t * 2 + i * 0.6) * 4;
        ctx.beginPath(); ctx.moveTo(x - 12 + i * 3, gy - 196);
        ctx.quadraticCurveTo(x - 14 + i * 3 + sway, gy - 168, x - 16 + i * 4 + sway * 1.6, gy - 132); ctx.lineTo(x - 12 + i * 4 + sway * 1.6, gy - 132);
        ctx.quadraticCurveTo(x - 10 + i * 3 + sway, gy - 168, x - 9 + i * 3, gy - 196); ctx.fill();
      }
      ctx.fillStyle = "#C2415E"; ctx.fillRect(x - 13, gy - 200, 26, 6);
    }
  };

  const PLATFORM = {
    cart(x, y, w) {
      ctx.fillStyle = "#7A5232"; ctx.fillRect(x, y, w, 14);
      ctx.fillStyle = "#5E3E25"; ctx.fillRect(x, y + 14, w, 6);
      ctx.fillStyle = "#8E6642"; for (let i = 6; i < w; i += 18) ctx.fillRect(x + i, y - 22, 4, 22);
      ctx.fillRect(x, y - 22, w, 4);
      for (const wx of [x + 26, x + w - 26]) {
        ctx.strokeStyle = "#3E2A1A"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(wx, GROUND_Y - 22, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 2; for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.moveTo(wx, GROUND_Y - 22); ctx.lineTo(wx + Math.cos(a) * 20, GROUND_Y - 22 + Math.sin(a) * 20); ctx.stroke(); }
      }
      ctx.fillStyle = "#6B4A30"; ctx.fillRect(x + w, y + 6, 40, 5);
      ctx.fillStyle = "#F0C463"; ctx.fillRect(x, y, w, 2);
    },
    container(x, y, w) {
      ctx.fillStyle = "#B4472F"; ctx.fillRect(x, y, w, GROUND_Y - 6 - y);
      ctx.fillStyle = "rgba(0,0,0,.2)"; for (let i = 8; i < w; i += 12) ctx.fillRect(x + i, y + 6, 4, GROUND_Y - 18 - y);
      ctx.fillStyle = "#D8653F"; ctx.fillRect(x, y, w, 6);
      ctx.fillStyle = "#F0C463"; ctx.fillRect(x, y, w, 2);
    },
    crates(x, y, w) {
      ctx.fillStyle = "#9A7246"; ctx.fillRect(x, y, w, GROUND_Y - 6 - y);
      ctx.strokeStyle = "#6E4F2E"; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, GROUND_Y - 9 - y);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, GROUND_Y - 6); ctx.moveTo(x + w, y); ctx.lineTo(x, GROUND_Y - 6); ctx.stroke();
      ctx.fillStyle = "#F0C463"; ctx.fillRect(x, y, w, 2);
    },
    ledge(x, y, w) {
      ctx.fillStyle = "#4A4157";
      ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + w + 6, y); ctx.lineTo(x + w - 10, GROUND_Y - 6); ctx.lineTo(x + 10, GROUND_Y - 6); ctx.fill();
      ctx.fillStyle = "#615673"; ctx.fillRect(x - 6, y, w + 12, 7);
      ctx.fillStyle = "rgba(240,196,99,.7)"; ctx.fillRect(x - 6, y, w + 12, 2);
    }
  };

  /* ======================================================================
     CHARACTER RENDERER — процедураар зурсан хүн дүрс (араг яс + поз)
     Өнцөг: 0 = доош, +π/2 = урагш, π = дээш (дүрийн харж буй зүг рүү)
     ====================================================================== */
  const STYLES = {
    player:  { skin: "#E3AC80", coat: "#2468A3", coat2: "#153C65", trim: "#F8D478", sash: "#C44856", pants: "#202A3B", boots: "#18131A", bootTrim: "#F0C463", hat: "loovuuz", hatCol: "#2A1F2E", hatFur: "#7A5236", hatTop: "#E0485E", weapon: "saber", coatLen: .9, cape: "#173B62", armor: true, bulk: 1.08, motif: "knot", braid: true },
    tuvshuu: { skin: "#D29A6F", coat: "#94643D", coat2: "#513626", trim: "#EBC17D", sash: "#B84E30", pants: "#3A2E2A", boots: "#2A1E18", bootTrim: "#B88952", hat: "felt", hatCol: "#4A3A30", weapon: "fists", coatLen: 0.95, bulk: 1.18, motif: "step" },
    ganaa:   { skin: "#D9A27A", coat: "#327C5B", coat2: "#163F32", trim: "#EAD39E", sash: "#D0B574", pants: "#293C54", boots: "#35281F", bootTrim: "#D0B574", hat: "felt", hatCol: "#C4B08A", weapon: "club", coatLen: .9, bulk: 1, motif: "horn", rope: true },
    teka:    { skin: "#DDA67E", coat: "#8252B6", coat2: "#40265D", trim: "#D8B7F9", sash: "#9CCBC5", cape: "#38274F", pants: "#26222E", boots: "#2A2630", bootTrim: "#C9A2F0", hat: "loovuuz", hatCol: "#40265D", hatFur: "#BC9468", hatTop: "#E0485E", hair: "#1A1418", weapon: "bow", coatLen: .8, bulk: 0.92, motif: "arrow", quiver: true, braid: true },
    tekaBoss:{ skin: "#DDA67E", coat: "#173F63", coat2: "#102D49", trim: "#F0C463", sash: "#C2415E", pants: "#252737", boots: "#171923", bootTrim: "#F0C463", hat: "helmet", hatCol: "#49677D", plume: "#4AA3DF", weapon: "glaive", coatLen: 0.85, cape: "#214F7A", armor: true, bulk: 1.12, motif: "knot", braid: true },
    erhmee:  { skin: "#C98A62", coat: "#C2283F", coat2: "#8E1830", trim: "#F0C463", pants: "#C98A62", shuudag: "#2B5BB8", boots: "#4A2C1C", bootTrim: "#F0C463", hat: "jodog", hatCol: "#C2283F", weapon: "fists", coatLen: 0, zodog: true, bulk: 1.5 },
    anhaa:   { skin: "#C99070", coat: "#3A3F4E", coat2: "#262A36", trim: "#F0C463", sash: "#C2415E", pants: "#1E2230", boots: "#14161E", bootTrim: "#F0C463", hat: "helmet", hatCol: "#5A6175", plume: "#E0485E", weapon: "glaive", coatLen: 1, cape: "#9E1F35", armor: true, bulk: 1.25, motif: "flame", braid: true }
  };

  const POSE_BASE = { bob: 0, lean: 0.06, head: 0, tb: -0.12, sb: -0.05, tf: 0.2, sf: 0.02, ub: 0.3, fb: 1.1, uf: 0.5, ff: 1.5, w: 2.3, lift: 0, rot: 0, plant: true };

  function pose(o) { return Object.assign({}, POSE_BASE, o); }
  const segK = (k, a, b) => clamp((k - a) / (b - a), 0, 1);

  function computePose(e) {
    const t = e.animT, a = e.anim, k = e.k || 0;
    const st = e.style;
    const guard = st.weapon === "fists" || st.weapon === "club";
    const br = Math.sin((e.animSeed || 0) + t * 2.4);
    switch (a) {
      case "idle": {
        if (st.zodog) return pose({ bob: br, lean: 0.28, tf: 0.55, sf: -0.25, tb: -0.45, sb: -0.85, ub: 1.2 + br * 0.05, fb: 1.9, uf: 1.35 + br * 0.05, ff: 2.1, head: -0.15 });
        if (st.weapon === "bow") return pose({ bob: br * 0.8, ub: 0.4, fb: 0.9, uf: 0.6, ff: 1.2, w: 2.9 });
        if (st.weapon === "glaive") return pose({ bob: br * 1.2, lean: 0.04, ub: 0.35, fb: 0.9, uf: 0.55, ff: 1.35, w: 2.75, tf: 0.26, tb: -0.2 });
        if (guard) return pose({ bob: br * 0.8, lean: 0.1, ub: 0.5 + br * 0.05, fb: 2.3, uf: 0.75, ff: 2.45, w: 2.6 });
        return pose({ bob: br * 0.9, ub: 0.3 + br * 0.04, uf: 0.5 + br * 0.04, ff: 1.45, w: 2.35 });
      }
      case "walk": case "run": {
        const run = a === "run";
        const ph = e.gaitDistance != null ? e.gaitDistance * 0.072 : t * (run ? 12.5 : 8.5) * (e.animRate || 1);
        const s = Math.sin(ph), c = Math.cos(ph), amp = run ? 0.82 : 0.52;
        const tf = s * amp, tb = -s * amp;
        const P = pose({
          bob: -Math.abs(c) * (run ? 3 : 1.6), lean: run ? 0.26 : 0.1,
          tf, tb, sf: tf - (run ? 1.0 : 0.6) * Math.max(0, c) - 0.08, sb: tb - (run ? 1.0 : 0.6) * Math.max(0, -c) - 0.08,
          ub: -s * amp * 0.9, fb: -s * amp * 0.9 + 0.7, uf: s * amp * 0.6 + 0.3, ff: s * amp * 0.6 + 1.1, w: 2.1
        });
        if (st.weapon === "saber") { P.uf = 0.45 + s * 0.2; P.ff = 1.35; P.w = run ? 1.0 : 2.1; if (run) { P.uf = -0.5; P.ff = -0.2; } }
        if (guard) { P.fb = P.ub + 1.6; P.ff = P.uf + 1.7; }
        if (st.zodog) { P.lean = 0.3; P.ub = 1.1 + s * 0.2; P.fb = 1.8; P.uf = 1.3 - s * 0.2; P.ff = 2.0; }
        if (st.weapon === "glaive") { P.uf = 0.55; P.ff = 1.35; P.w = 2.75; }
        return P;
      }
      case "jump":
        if ((e.vy || 0) < 0) return pose({ plant: false, lean: 0.12, tf: 0.95, sf: 0.05, tb: -0.25, sb: -1.05, ub: -0.5, fb: 0.2, uf: 1.2, ff: 2.0, w: 2.7 });
        return pose({ plant: false, lean: 0.06, tf: 0.45, sf: 0.0, tb: -0.3, sb: -0.6, ub: 1.7, fb: 2.3, uf: 1.3, ff: 1.9, w: 2.5 });
      case "block":
        return pose({ lean: -0.06, head: -0.05, tf: 0.42, sf: 0.08, tb: -0.45, sb: -0.32, ub: 1.05, fb: 2.35, uf: 1.15, ff: 2.25, w: 2.45 });
      case "hurt":
        return pose({ lean: -0.38, head: -0.25, ub: -0.9, fb: -0.3, uf: 0.5, ff: 1.5, w: 1.9, tf: 0.35, sf: 0.15, tb: -0.3, sb: -0.25 });
      case "dead": {
        const P = pose({ lean: -0.3, head: -0.3, ub: -1.4, fb: -1.2, uf: -0.4, ff: 0.3, w: 0.8, tf: 0.4, sf: 0.3, tb: 0.1, sb: 0.0, plant: false });
        P.rot = -smooth(t / 0.45) * 1.48;
        return P;
      }
      case "attack": {
        const step = e.atkStep || 0;
        const legs = { tf: 0.5, sf: 0.15, tb: -0.45, sb: -0.3 };
        if (step === 0) {
          const u = k < 0.3 ? lerp(0.6, 3.0, easeOut(k / 0.3)) : lerp(3.0, 0.65, easeOut(segK(k, 0.3, 0.6)));
          return pose(Object.assign({ lean: k < 0.3 ? -0.04 : 0.22, ub: -0.6, fb: -0.1, uf: u, ff: u + 0.3, w: u + 0.5 }, legs));
        }
        if (step === 1) {
          const u = k < 0.25 ? lerp(0.6, -0.5, easeOut(k / 0.25)) : lerp(-0.5, 2.7, easeOut(segK(k, 0.25, 0.55)));
          return pose(Object.assign({ lean: k < 0.25 ? 0.2 : -0.06, ub: 0.8, fb: 1.4, uf: u, ff: u + 0.25, w: u + 0.35 }, legs));
        }
        const u = k < 0.35 ? lerp(0.6, -0.9, easeOut(k / 0.35)) : lerp(-0.9, 1.57, easeOut(segK(k, 0.35, 0.55)));
        return pose({ lean: k < 0.35 ? -0.1 : 0.42, ub: -1.1, fb: -0.6, uf: u, ff: k < 0.35 ? u + 0.6 : 1.57, w: k < 0.35 ? 1.2 : 1.57, tf: 0.85, sf: 0.3, tb: -0.75, sb: -0.45 });
      }
      case "airatk": {
        const u = lerp(2.9, 0.2, easeOut(k / 0.55));
        return pose({ plant: false, lean: 0.25, tf: 0.9, sf: 0.0, tb: -0.1, sb: -1.1, ub: -0.4, fb: 0.2, uf: u, ff: u + 0.2, w: u + 0.3 });
      }
      case "dash":
        return pose({ plant: false, lift: -4, lean: 0.6, tb: -0.95, sb: -0.6, tf: 0.65, sf: 0.2, ub: -1.3, fb: -1.0, uf: -0.7, ff: -0.3, w: -0.95 });
      case "power": {
        if (k < 0.42) {
          const r = easeOut(k / 0.42);
          return pose({ plant: false, lift: -38 * r, lean: -0.08, tf: 0.9, sf: -0.2, tb: -0.1, sb: -1.0, ub: 2.6, fb: 3.0, uf: 2.9, ff: 3.1, w: 3.3 });
        }
        return pose({ lean: 0.5, tf: 1.05, sf: -0.25, tb: -0.7, sb: -1.5, ub: 0.9, fb: 1.1, uf: 0.95, ff: 1.0, w: 0.9 });
      }
      case "ult": {
        const r = smooth(k * 3);
        return pose({ plant: false, lift: -44 * r + Math.sin(t * 6) * 2, lean: -0.1, head: -0.35, tf: 0.2, sf: -0.15, tb: -0.25, sb: -0.55, ub: 2.75, fb: 3.0, uf: 2.95, ff: 3.12, w: 3.14 });
      }
      // ---- enemy actions ----
      case "windup": {
        const r = easeOut(k);
        if (st.zodog) return pose({ lean: lerp(0.28, -0.2, r), head: -0.2, ub: lerp(1.2, 2.8, r), fb: lerp(1.9, 3.1, r), uf: lerp(1.3, 2.9, r), ff: lerp(2.1, 3.15, r), tf: 0.4, sf: 0.1, tb: -0.4, sb: -0.3 });
        if (st.weapon === "club") return pose({ lean: -0.05, ub: 0.4, fb: 1.8, uf: lerp(0.75, 2.9, r), ff: lerp(2.4, 3.1, r), w: lerp(2.6, 3.4, r), tf: 0.4, tb: -0.35 });
        if (st.weapon === "bow") return pose({ lean: -0.04, ub: lerp(0.4, 1.0, r), fb: lerp(0.9, 1.95, r), uf: 1.57, ff: 1.57, w: 1.57, tf: 0.35, tb: -0.3 });
        if (st.weapon === "glaive") return pose({ lean: -0.1, ub: -0.5, fb: 0.2, uf: lerp(0.55, 3.0, r), ff: lerp(1.35, 3.2, r), w: lerp(2.75, 3.6, r), tf: 0.45, tb: -0.4, sb: -0.2 });
        return pose({ lean: -0.06, ub: 0.6, fb: 2.4, uf: lerp(0.75, -0.5, r), ff: lerp(2.45, 0.9, r), tf: 0.35, tb: -0.35 });
      }
      case "strike": {
        if (st.zodog) return pose({ lean: 0.55, head: 0.1, ub: 1.0, fb: 0.9, uf: 1.15, ff: 0.95, tf: 1.0, sf: -0.2, tb: -0.6, sb: -1.3 });
        if (st.weapon === "club") return pose({ lean: 0.25, ub: -0.3, fb: 0.3, uf: 0.8, ff: 0.9, w: 0.95, tf: 0.55, sf: 0.15, tb: -0.5, sb: -0.3 });
        if (st.weapon === "bow") return pose({ lean: -0.02, ub: 0.7, fb: 0.6, uf: 1.57, ff: 1.57, w: 1.57, tf: 0.35, tb: -0.3 });
        if (st.weapon === "glaive") {
          const u = lerp(3.0, 0.55, easeOut(k * 2.2));
          return pose({ lean: 0.3, ub: -0.7, fb: -0.2, uf: u, ff: u + 0.2, w: u + 0.3, tf: 0.6, sf: 0.2, tb: -0.55, sb: -0.35 });
        }
        return pose({ lean: 0.28, ub: 0.4, fb: 2.2, uf: 1.55, ff: 1.57, tf: 0.55, sf: 0.15, tb: -0.5, sb: -0.3 });
      }
      case "lunge":
        return pose({ plant: false, lift: -2, lean: 0.5, ub: st.zodog ? 1.4 : -0.9, fb: st.zodog ? 1.5 : -0.4, uf: 1.5, ff: 1.57, w: 1.57, tf: 0.7, sf: 0.2, tb: -0.8, sb: -0.5 });
      case "throw": {
        const u = k < 0.5 ? lerp(0.6, 3.0, easeOut(k * 2)) : lerp(3.0, 1.1, easeOut((k - 0.5) * 3));
        return pose({ lean: k < 0.5 ? -0.12 : 0.25, ub: 1.2, fb: 1.6, uf: u, ff: u + 0.2, w: 2.75, tf: 0.45, tb: -0.4, sb: -0.2 });
      }
      case "roar":
        return pose({ lean: -0.25, head: -0.45 + Math.sin(t * 30) * 0.03, ub: -1.7, fb: -2.3, uf: 1.9, ff: 2.4, w: 2.6, tf: 0.45, sf: 0.1, tb: -0.45, sb: -0.3 });
      case "cast":
        return pose({ lean: -0.1, head: -0.3, ub: 2.7, fb: 3.0, uf: 3.0, ff: 3.12, w: 3.14, tf: 0.3, tb: -0.3 });
      case "leap":
        return pose({ plant: false, lean: 0.15, tf: 1.1, sf: -0.2, tb: 0.2, sb: -1.0, ub: 2.4, fb: 2.9, uf: 2.8, ff: 3.1, w: 3.3 });
      case "stun":
        return pose({ lean: 0.4, head: 0.4, ub: 0.1, fb: 0.2, uf: 0.2, ff: 0.4, w: 0.6, tf: 0.5, sf: -0.3, tb: -0.3, sb: -0.9 });
      default:
        return pose({});
    }
  }

  function drawFigure(e, camX, extra) {
    const st = e.style, s = e.scale, B = st.bulk;
    const P = computePose(e);
    if (e.def && e.def.mounted) {
      // Seated hips, bent knees and stirrups: rider never runs through the saddle.
      P.plant = false; P.bob = Math.sin(game.t * 10) * Math.min(2, Math.abs(e.vx) / 160);
      P.tf = .85; P.sf = -.22; P.tb = -.65; P.sb = .18;
      P.lean = e.state === "charge" ? .32 : .06;
    }
    if (e.onGround && (e.anim === "idle" || e.anim === "walk" || e.anim === "run")) {
      const settle = e.landing || 0;
      P.tf += settle * .038; P.tb -= settle * .035;
      P.sf -= settle * .052; P.sb -= settle * .048;
      P.lean += (e.bodyLean || 0) * e.face;
    }
    const flash = e.flash > 0 && Math.floor(e.flash * 28) % 2 === 0;
    const C = (key, fallback) => (flash ? "#FFFFFF" : st[key] || fallback);
    const tAnim = game.t + (e.animSeed || 0);
    const material = (color, left, right) => {
      if (flash) return "#fff";
      const gr = ctx.createLinearGradient(left, -75, right, -35);
      gr.addColorStop(0, shade(color,-.3)); gr.addColorStop(.42,color);
      gr.addColorStop(.7,shade(color,.16)); gr.addColorStop(1,shade(color,-.15)); return gr;
    };

    // --- skeleton (hip орон зай) ---
    const L1 = 23, L2 = 23, A1 = 18, A2 = 17, T = 33;
    const relB = Math.cos(P.tb) * L1 + Math.cos(P.sb) * L2;
    const relF = Math.cos(P.tf) * L1 + Math.cos(P.sf) * L2;
    const hipY = P.plant ? -Math.max(relB, relF) + P.bob : -46 + P.bob;
    const hip = { x: 0, y: hipY };
    const neck = { x: hip.x + Math.sin(P.lean) * T, y: hip.y - Math.cos(P.lean) * T };
    const hd = P.lean + P.head;
    const head = { x: neck.x + Math.sin(hd) * 11, y: neck.y - Math.cos(hd) * 11 };
    const sh = { x: neck.x - Math.sin(P.lean) * 5, y: neck.y + Math.cos(P.lean) * 5 };
    const leg = (th, sn, ox) => {
      const kn = { x: hip.x + ox + Math.sin(th) * L1, y: hip.y + Math.cos(th) * L1 };
      return [{ x: hip.x + ox, y: hip.y }, kn, { x: kn.x + Math.sin(sn) * L2, y: kn.y + Math.cos(sn) * L2 }];
    };
    const arm = (up, fo, ox) => {
      const s0 = { x: sh.x + ox, y: sh.y };
      const el = { x: s0.x + Math.sin(up) * A1, y: s0.y + Math.cos(up) * A1 };
      return [s0, el, { x: el.x + Math.sin(fo) * A2, y: el.y + Math.cos(fo) * A2 }];
    };
    const LB = leg(P.tb, P.sb, -3 * B), LF = leg(P.tf, P.sf, 3 * B);
    const AB = arm(P.ub, P.fb, -5 * B), AF = arm(P.uf, P.ff, 4 * B);

    ctx.save();
    ctx.translate(e.x - camX, e.y + P.lift);
    ctx.scale(e.face * s, s);
    if (P.rot) ctx.rotate(P.rot);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    const line = (pts, w, col) => {
      if (!flash && typeof col === "string" && col[0] === "#") {
        const a = pts[0], b = pts[pts.length - 1];
        const material = ctx.createLinearGradient(Math.min(a.x,b.x)-w*.5, a.y, Math.max(a.x,b.x)+w*.5, b.y);
        material.addColorStop(0, shade(col, -.25)); material.addColorStop(.45, col); material.addColorStop(.8, shade(col,.18)); material.addColorStop(1,shade(col,-.1));
        ctx.strokeStyle = material;
      } else ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };
    const boot = (L, col) => {
      const an = L[2];
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(an.x - 5 * B, an.y - 7);
      ctx.lineTo(an.x + 5 * B, an.y - 7);
      ctx.lineTo(an.x + 10 * B, an.y - 1);
      if (st.bootTrim) ctx.quadraticCurveTo(an.x + 15 * B, an.y - 3, an.x + 14 * B, an.y - 7);   // гутлын хошуу
      ctx.lineTo(an.x + 10 * B, an.y + 2);
      ctx.lineTo(an.x - 6 * B, an.y + 2);
      ctx.closePath(); ctx.fill();
      if (st.bootTrim && !flash) { ctx.fillStyle = st.bootTrim; ctx.fillRect(an.x - 5 * B, an.y - 4, 10 * B, 2); }
    };
    const hand = (A, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(A[2].x, A[2].y, (st.weapon === "fists" ? 5.4 : 4.3) * B, 0, Math.PI * 2); ctx.fill(); };

    // Back-mounted gear gives every role a readable silhouette before combat starts.
    if (st.quiver) {
      ctx.save(); ctx.translate(sh.x - 10 * B, sh.y - 4); ctx.rotate(-.24);
      ctx.fillStyle = flash ? "#fff" : "#5B3526"; roundRect(ctx, -6, -17, 11, 44, 4); ctx.fill();
      ctx.strokeStyle = flash ? "#fff" : st.trim; ctx.lineWidth = 1.5; ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const ax = -4 + i * 3;
        ctx.strokeStyle = flash ? "#fff" : "#D8C8A5"; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(ax, -12); ctx.lineTo(ax - 3, -34 - i * 2); ctx.stroke();
        ctx.fillStyle = flash ? "#fff" : (i % 2 ? "#C44856" : st.trim);
        ctx.beginPath(); ctx.moveTo(ax - 3, -35 - i * 2); ctx.lineTo(ax - 8, -31 - i * 2); ctx.lineTo(ax + 1, -30 - i * 2); ctx.fill();
      }
      ctx.restore();
    }

    // cape
    if (st.cape) {
      const fl = Math.sin(tAnim * 4) * 4 + (e.vx ? Math.min(14, Math.abs(e.vx) / 30) : 0);
      ctx.fillStyle = C("cape");
      ctx.beginPath();
      ctx.moveTo(sh.x - 8 * B, sh.y - 2);
      ctx.lineTo(sh.x + 4 * B, sh.y - 2);
      ctx.quadraticCurveTo(hip.x - 10, hip.y + 10, hip.x - 22 - fl, hip.y + 34);
      ctx.lineTo(hip.x - 34 - fl * 1.5, hip.y + 28);
      ctx.quadraticCurveTo(hip.x - 26, hip.y - 4, sh.x - 8 * B, sh.y - 2);
      ctx.fill();
    }

    // back leg + arm (бараан)
    const pantsB = flash ? "#fff" : shade(st.pants, -0.18);
    line(LB.slice(0, 2), 10.5 * B, pantsB); line(LB.slice(1), 9 * B, pantsB);
    boot(LB, C("boots"));
    const sleeveB = flash ? "#fff" : (st.zodog ? shade(st.skin, -0.15) : shade(st.coat2, -0.1));
    line(AB.slice(0, 2), 8 * B, st.zodog ? (flash ? "#fff" : st.coat2) : sleeveB);
    line(AB.slice(1), 7 * B, sleeveB);
    hand(AB, flash ? "#fff" : shade(st.skin, -0.12));

    // front leg
    line(LF.slice(0, 2), 10.5 * B, C("pants")); line(LF.slice(1), 9 * B, C("pants"));
    boot(LF, C("boots"));

    // skirt / deel
    if (st.coatLen > 0) {
      const kn1 = LB[1], kn2 = LF[1];
      const bottom = hip.y + 25 * st.coatLen;
      const minX = Math.min(kn1.x, kn2.x, hip.x - 8) - 6 * B, maxX = Math.max(kn1.x, kn2.x, hip.x + 8) + 6 * B;
      ctx.fillStyle = material(st.coat, -18 * B, 18 * B);
      ctx.beginPath();
      ctx.moveTo(hip.x - 11 * B, hip.y - 2);
      ctx.lineTo(hip.x + 11 * B, hip.y - 2);
      ctx.lineTo(lerp(hip.x + 11 * B, maxX, st.coatLen), bottom);
      ctx.lineTo(lerp(hip.x - 11 * B, minX, st.coatLen), bottom);
      ctx.closePath(); ctx.fill();
      if (!flash && st.coatLen > 0.5) {
        ctx.fillStyle = st.trim;
        ctx.fillRect(lerp(hip.x - 11 * B, minX, st.coatLen), bottom - 3, lerp(hip.x + 11 * B, maxX, st.coatLen) - lerp(hip.x - 11 * B, minX, st.coatLen), 3);
        // Small repeated geometric embroidery on the deel hem.
        ctx.strokeStyle=st.trim;ctx.lineWidth=1;
        const left=lerp(hip.x-11*B,minX,st.coatLen),right=lerp(hip.x+11*B,maxX,st.coatLen);
        for(let x=left+4;x<right-3;x+=7){ctx.beginPath();ctx.moveTo(x-2,bottom-7);ctx.lineTo(x,bottom-10);ctx.lineTo(x+2,bottom-7);ctx.lineTo(x,bottom-4);ctx.closePath();ctx.stroke();}
      }
    }
    if (st.zodog) {                       // шуудаг
      ctx.fillStyle = C("shuudag");
      ctx.beginPath(); ctx.moveTo(hip.x - 12 * B, hip.y - 5); ctx.lineTo(hip.x + 12 * B, hip.y - 5); ctx.lineTo(hip.x + 9 * B, hip.y + 9); ctx.lineTo(hip.x - 9 * B, hip.y + 9); ctx.closePath(); ctx.fill();
    }

    // torso
    ctx.save();
    ctx.translate(hip.x, hip.y);
    ctx.rotate(P.lean);
    const tw = 11 * B, sw = 10.5 * B;
    ctx.fillStyle = material(st.zodog ? st.skin : st.coat, -tw, tw);
    ctx.beginPath();
    ctx.moveTo(-tw, 0); ctx.lineTo(tw, 0); ctx.lineTo(sw, -T + 2); ctx.quadraticCurveTo(0, -T - 4, -sw, -T + 2);
    ctx.closePath(); ctx.fill();
    if (!flash) {
      if (!st.zodog && !st.armor) {
        ctx.strokeStyle = shade(st.coat,-.22); ctx.lineWidth = .9;
        for (let fold=0;fold<4;fold++) {
          const fy=-12-fold*4.5;
          ctx.beginPath();ctx.moveTo(-tw+2,fy);ctx.quadraticCurveTo(0,fy+3+Math.sin(tAnim*2)*.7,tw-3,fy+1);ctx.stroke();
        }
        ctx.strokeStyle = "rgba(246,228,182,.3)";ctx.lineWidth=.7;
        ctx.beginPath();ctx.moveTo(sw-1,-T+4);ctx.lineTo(tw-1,-10);ctx.stroke();
      }
      if (st.zodog) {
        ctx.fillStyle = st.coat;                           // зодог: нуруу + ханцуй
        ctx.beginPath(); ctx.moveTo(-sw, -T + 2); ctx.lineTo(-2, -T - 1); ctx.lineTo(-tw * 0.4, -10); ctx.lineTo(-tw, -8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade(st.skin, -0.12);
        ctx.beginPath(); ctx.arc(4, -T + 12, 5 * B, 0, Math.PI); ctx.fill();
      } else if (st.armor) {
        ctx.fillStyle = shade(st.coat2,.2); roundRect(ctx, -tw + 2, -T + 4, tw * 2 - 4, T - 10, 5); ctx.fill();
        ctx.strokeStyle = st.trim; ctx.lineWidth = 2; ctx.stroke();
        // Laced lamellar rows over a coloured deel instead of a solid plate.
        for(let row=0;row<4;row++)for(let col=0;col<4;col++){
          const x=-tw+4+col*(tw*2-8)/4,y=-T+7+row*5;
          ctx.fillStyle=row%2?shade(st.hatCol||st.coat,.08):shade(st.hatCol||st.coat,-.08);
          ctx.fillRect(x,y,(tw*2-8)/4-1,4);ctx.fillStyle=st.trim;ctx.fillRect(x+1,y+1,1,1);
        }
        ctx.fillStyle = st.trim; ctx.beginPath(); ctx.arc(2, -T + 16, 4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = st.trim; ctx.lineWidth = 2.4;      // энгэр
        ctx.beginPath(); ctx.moveTo(1, -T + 1); ctx.quadraticCurveTo(tw * 0.9, -T + 8, tw * 0.75, -12); ctx.stroke();
        if (st.coatLen < 0.5) { ctx.beginPath(); ctx.moveTo(2, -T + 2); ctx.lineTo(2, -2); ctx.stroke(); }
      }
      if (st.sash) {
        ctx.fillStyle = st.sash; ctx.fillRect(-tw - 0.5, -8, tw * 2 + 1, 7);
        const fl = Math.sin(tAnim * 7) * 3;
        ctx.beginPath(); ctx.moveTo(-tw, -7); ctx.quadraticCurveTo(-tw - 8, -2 + fl, -tw - 14, 10 + fl); ctx.lineTo(-tw - 8, 10 + fl); ctx.quadraticCurveTo(-tw - 4, 0, -tw + 2, -2); ctx.fill();
        ctx.fillStyle=st.trim;ctx.fillRect(-3,-7,7,5);ctx.fillStyle=st.coat2;ctx.fillRect(-1,-6,3,3);
      }
      if(!st.armor&&!st.zodog){
        ctx.fillStyle=st.trim;for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(tw*.7,-T+10+i*5,1.3,0,Math.PI*2);ctx.fill();}
      }
      if (st.motif && !st.zodog) {
        ctx.strokeStyle = st.trim; ctx.lineWidth = 1.25; ctx.globalAlpha = .9;
        ctx.beginPath();
        if (st.motif === "arrow") { ctx.moveTo(-5,-20);ctx.lineTo(0,-25);ctx.lineTo(5,-20);ctx.moveTo(0,-25);ctx.lineTo(0,-12); }
        else if (st.motif === "flame") { ctx.moveTo(-4,-12);ctx.quadraticCurveTo(-8,-21,0,-26);ctx.quadraticCurveTo(8,-19,3,-12);ctx.quadraticCurveTo(0,-18,-4,-12); }
        else if (st.motif === "horn") { ctx.moveTo(-6,-14);ctx.quadraticCurveTo(-7,-24,0,-22);ctx.quadraticCurveTo(7,-24,6,-14); }
        else { ctx.moveTo(-6,-15);ctx.lineTo(-6,-23);ctx.lineTo(2,-23);ctx.lineTo(2,-18);ctx.lineTo(-2,-18);ctx.lineTo(-2,-14);ctx.lineTo(6,-14); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      if(st.zodog){
        ctx.strokeStyle=st.trim;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(-sw,-T+3);ctx.lineTo(-tw*.4,-10);ctx.stroke();
        ctx.beginPath();ctx.moveTo(-6,-5);ctx.lineTo(0,-2);ctx.lineTo(6,-5);ctx.stroke();
      }
    }
    ctx.restore();

    // shoulders (armor)
    if (st.armor) {
      ctx.fillStyle = C("hatCol");
      ctx.beginPath();ctx.moveTo(sh.x-9*B,sh.y-4);ctx.lineTo(sh.x+3*B,sh.y-8);ctx.lineTo(sh.x+13*B,sh.y-1);ctx.lineTo(sh.x+10*B,sh.y+9);ctx.lineTo(sh.x-8*B,sh.y+5);ctx.closePath();ctx.fill();
      if (!flash) { ctx.strokeStyle = st.trim; ctx.lineWidth = 1.6; ctx.stroke(); }
    }

    // Side-profile anatomy: jaw, nose and ear, shaded by the same key light.
    ctx.fillStyle = material(st.skin, head.x - 9, head.x + 10);
    ctx.beginPath(); ctx.ellipse(head.x, head.y, 9, 11.5, hd, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(head.x+7,head.y-3); ctx.lineTo(head.x+12,head.y+1);
    ctx.lineTo(head.x+8,head.y+3); ctx.lineTo(head.x+6,head.y+9); ctx.lineTo(head.x+1,head.y+10); ctx.fill();
    if (!flash) {
      ctx.fillStyle = shade(st.skin,-.15); ctx.beginPath();ctx.ellipse(head.x-4,head.y+1,2.3,3.5,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle = shade(st.skin,-.38); ctx.lineWidth=.8;
      ctx.beginPath();ctx.moveTo(head.x+5,head.y+6);ctx.lineTo(head.x+8,head.y+6);ctx.stroke();
    }
    ctx.save();
    ctx.translate(head.x, head.y); ctx.rotate(hd);
    if (st.braid && !flash) {
      ctx.strokeStyle = st.hair || "#211820"; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-7, 4); ctx.quadraticCurveTo(-14, 14, -10 + Math.sin(tAnim * 5) * 2, 28); ctx.stroke();
      ctx.strokeStyle = st.trim; ctx.lineWidth = 1.5;
      for (let by = 10; by < 28; by += 6) { ctx.beginPath();ctx.moveTo(-14,by);ctx.lineTo(-7,by+2);ctx.stroke(); }
    }
    if (!flash) {
      ctx.fillStyle = e.eyeGlow ? "#FF5A4E" : "#1A1418";
      ctx.fillRect(4.5, -2.5, e.eyeGlow ? 4 : 2.6, e.eyeGlow ? 2.6 : 3);
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(3.5, -5.5, 5, 1.6);
      if (e.anim === "hurt" || e.anim === "dead") { ctx.fillStyle = "#3A1A1A"; ctx.fillRect(5, 4, 4, 2); }
    }
    drawHat(st, flash, tAnim);
    ctx.restore();

    // front arm
    const sleeve = st.zodog ? C("skin") : C("coat");
    line(AF.slice(0, 2), 8 * B, st.zodog ? C("coat") : sleeve);
    line(AF.slice(1), 7.2 * B, sleeve);
    if (!st.zodog && !flash) { ctx.fillStyle = st.trim; ctx.beginPath(); ctx.arc(AF[2].x - Math.sin(P.ff) * 3, AF[2].y - Math.cos(P.ff) * 3, 3.6 * B, 0, Math.PI * 2); ctx.fill(); }
    // weapon behind/at hand
    drawWeapon(st, AF[2], P.w, AB[2], flash, e);
    hand(AF, C("skin"));

    ctx.restore();

    if (extra) extra(P);
    return P;
  }

  function drawHat(st, flash, t) {
    const W = (k) => (flash ? "#FFFFFF" : st[k]);
    switch (st.hat) {
      case "loovuuz": {
        ctx.fillStyle = W("hatCol");
        ctx.beginPath(); ctx.moveTo(-10, -5); ctx.quadraticCurveTo(-6, -22, -6, -28); ctx.quadraticCurveTo(4, -22, 10, -5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = W("hatFur");
        ctx.beginPath(); ctx.ellipse(0, -5, 12.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = W("hatTop");
        ctx.beginPath(); ctx.arc(-6, -29, 3.6, 0, Math.PI * 2); ctx.fill();
        const fl = Math.sin(t * 6) * 3;
        ctx.strokeStyle = W("hatTop"); ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-10, -4); ctx.quadraticCurveTo(-18, 2 + fl, -27, 6 + fl * 1.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-10, -2); ctx.quadraticCurveTo(-16, 6 - fl, -23, 12 - fl); ctx.stroke();
        break;
      }
      case "felt":
        ctx.fillStyle = W("hatCol");
        ctx.beginPath(); ctx.ellipse(0, -7, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, -11, 9, 7, 0, Math.PI, 0); ctx.fill();
        break;
      case "cap":
        ctx.fillStyle = W("hatCol");
        ctx.beginPath(); ctx.arc(0, -3, 11, Math.PI, 0); ctx.fill();
        ctx.fillRect(4, -5, 13, 3.5);
        if (!flash) { ctx.fillStyle = "#F0C463"; ctx.fillRect(-2, -10, 4, 3); }
        break;
      case "band": {
        ctx.fillStyle = W("hair");
        ctx.beginPath(); ctx.arc(0, -3, 11.3, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(-14, -16); ctx.lineTo(-4, -12); ctx.lineTo(-6, -19); ctx.lineTo(2, -12); ctx.fill();
        ctx.fillStyle = W("hatCol"); ctx.fillRect(-11, -7, 22, 4);
        const fl = Math.sin(t * 8) * 3;
        ctx.beginPath(); ctx.moveTo(-10, -7); ctx.lineTo(-22, -6 + fl); ctx.lineTo(-21, -2 + fl); ctx.lineTo(-10, -3); ctx.fill();
        break;
      }
      case "jodog":
        ctx.fillStyle = W("hatCol");
        ctx.beginPath(); ctx.arc(0, -4, 11, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-3, -14); ctx.lineTo(0, -21); ctx.lineTo(3, -14); ctx.fill();
        if (!flash) { ctx.fillStyle = "#F0C463"; ctx.fillRect(-11, -6, 22, 2.4); }
        break;
      case "helmet": {
        ctx.fillStyle = W("hatCol");
        ctx.beginPath(); ctx.arc(0, -2, 12.5, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
        ctx.fillRect(-12, -3, 7, 13);                      // хацавч
        ctx.fillStyle = flash ? "#fff" : st.trim;
        ctx.fillRect(-12.5, -5, 25, 3);
        ctx.beginPath(); ctx.moveTo(-3, -14); ctx.lineTo(0, -30); ctx.lineTo(3, -14); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-2, -20); ctx.lineTo(2, -20); ctx.lineTo(6, -12); ctx.fill();
        const fl = Math.sin(t * 5) * 4;
        ctx.strokeStyle = W("plume"); ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(0, -28); ctx.quadraticCurveTo(-16, -30 + fl, -30, -16 + fl); ctx.stroke();
        ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -26); ctx.quadraticCurveTo(-12, -22 - fl, -26, -8 - fl); ctx.stroke();
        break;
      }
    }
  }

  function drawWeapon(st, h, a, backHand, flash, e) {
    const dx = Math.sin(a), dy = Math.cos(a);
    const px = -dy, py = dx;                                  // перпендикуляр
    switch (st.weapon) {
      case "saber": {
        ctx.strokeStyle = flash ? "#fff" : "#F0C463"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(h.x + px * 6, h.y + py * 6); ctx.lineTo(h.x - px * 6, h.y - py * 6); ctx.stroke();
        ctx.strokeStyle = flash ? "#fff" : "#4A2E22"; ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(h.x - dx * 7, h.y - dy * 7); ctx.lineTo(h.x, h.y); ctx.stroke();
        ctx.fillStyle = flash ? "#fff" : "#E9EEF6";
        ctx.beginPath();
        ctx.moveTo(h.x + px * 2, h.y + py * 2);
        ctx.quadraticCurveTo(h.x + dx * 24 + px * 6, h.y + dy * 24 + py * 6, h.x + dx * 44 + px * 9, h.y + dy * 44 + py * 9);
        ctx.quadraticCurveTo(h.x + dx * 24 + px * 1, h.y + dy * 24 + py * 1, h.x - px * 2, h.y - py * 2);
        ctx.closePath(); ctx.fill();
        if (e.boost > 0 && !flash) { ctx.strokeStyle = "rgba(255,140,40,.8)"; ctx.lineWidth = 2; ctx.stroke(); }
        break;
      }
      case "club":
        ctx.strokeStyle = flash ? "#fff" : "#7A5232"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(h.x - dx * 4, h.y - dy * 4); ctx.lineTo(h.x + dx * 32, h.y + dy * 32); ctx.stroke();
        break;
      case "bow": {
        const top = { x: h.x + px * 27, y: h.y + py * 27 }, bot = { x: h.x - px * 27, y: h.y - py * 27 };
        ctx.strokeStyle = flash ? "#fff" : "#8A5A2E"; ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.quadraticCurveTo(h.x + dx * 16, h.y + dy * 16, bot.x, bot.y); ctx.stroke();
        const pull = (e.anim === "windup" || e.anim === "strike") ? backHand : { x: h.x - dx * 4, y: h.y - dy * 4 };
        ctx.strokeStyle = "rgba(240,240,240,.85)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(pull.x, pull.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
        if (e.anim === "windup") {
          ctx.strokeStyle = "#E8DCC8"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(pull.x, pull.y); ctx.lineTo(h.x + dx * 14, h.y + dy * 14); ctx.stroke();
          if (e.k > 0.6) { ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(h.x + dx * 14, h.y + dy * 14, 3 + Math.sin(game.t * 40) * 1.5, 0, Math.PI * 2); ctx.fill(); }
        }
        break;
      }
      case "glaive": {
        ctx.strokeStyle = flash ? "#fff" : "#3A2A22"; ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.moveTo(h.x - dx * 34, h.y - dy * 34); ctx.lineTo(h.x + dx * 46, h.y + dy * 46); ctx.stroke();
        ctx.fillStyle = flash ? "#fff" : "#F0C463"; ctx.beginPath(); ctx.arc(h.x + dx * 46, h.y + dy * 46, 4, 0, Math.PI * 2); ctx.fill();
        const bx = h.x + dx * 48, by = h.y + dy * 48;
        ctx.fillStyle = flash ? "#fff" : (e.phase >= 3 ? "#FF9A7A" : "#DDE3EE");
        ctx.beginPath();
        ctx.moveTo(bx - px * 3, by - py * 3);
        ctx.quadraticCurveTo(bx + dx * 18 + px * 14, by + dy * 18 + py * 14, bx + dx * 38 + px * 4, by + dy * 38 + py * 4);
        ctx.quadraticCurveTo(bx + dx * 16 + px * 2, by + dy * 16 + py * 2, bx - px * 3 + dx * 4, by - py * 3 + dy * 4);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = flash ? "#fff" : "#E0485E"; ctx.lineWidth = 3;
        const fl = Math.sin(game.t * 6) * 3;
        ctx.beginPath(); ctx.moveTo(h.x + dx * 44, h.y + dy * 44); ctx.quadraticCurveTo(h.x + dx * 40 - px * 8, h.y + dy * 40 - py * 8 + fl, h.x + dx * 32 - px * 14, h.y + dy * 32 - py * 14 + fl); ctx.stroke();
        break;
      }
    }
  }

  const shadeCache = new Map();
  function shade(hex, amt) {
    const key = hex + amt;
    let v = shadeCache.get(key);
    if (v) return v;
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    v = "#" + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
    shadeCache.set(key, v);
    return v;
  }

  /* ======================================================================
     GAME STATE
     ====================================================================== */
  const game = {
    mode: "menu", t: 0, runTime: 0, name: "",
    score: 0, combo: 0, comboT: 0, maxCombo: 0, kills: 0, skillsUsed: 0,
    player: null, enemies: [], projectiles: [], hazards: [], items: [], particles: [], texts: [], ghosts: [], bolts: [], decals: [],
    stage: null, stageIdx: 0, camX: 0, camMin: 0,
    shake: 0, hitstop: 0, timeScale: 1, slowT: 0,
    flashWhite: 0, hurtFlash: 0, darken: 0, fade: 0, fadeTo: 0, lightning: 0,
    boss: null, bossShown: false, run: null, saved: null, god: false, inputLock: false, timers: []
  };

  function comboMult() { return 1 + Math.min(game.combo, 20) * 0.025; }
  function later(sec, fn) { game.timers.push({ t: sec, fn }); }
  function setAnim(e, name) { if (e.anim !== name) { e.anim = name; e.animT = 0; } }
  function setState(e, s) { e.state = s; e.stateT = 0; e.k = 0; e.struck = false; }
  const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

  /* ======================================================================
     ENTITIES
     ====================================================================== */
  const ENEMY_DEFS = {
    tuvshuu: { name: "ТӨВШӨӨ", hp: 46,  speed: 92,  dmg: 8,  range: 62, windup: 0.45, strike: 0.18, recover: 0.5, cd: [0.9, 1.7], score: 100, scale: 1,    w: 30, h: 92 },
    ganaa:   { name: "ГАНАА",  hp: 80,  speed: 140, dmg: 11, range: 76, windup: 0.34, strike: 0.16, recover: 0.4, cd: [0.6, 1.2], score: 200, scale: 1.02, w: 30, h: 94, combo: true, lunge: true },
    teka:    { name: "ТЭКА",   hp: 58,  speed: 122, dmg: 9,  range: 66, windup: 0.62, strike: 0.2,  recover: 0.4, cd: [1.2, 2.0], score: 250, scale: 0.96, w: 28, h: 88, ranged: true, keep: [230, 420] },
    erhmee:  { name: "ЭРХМЭЭ", hp: 200, speed: 66,  dmg: 18, range: 96, windup: 0.75, strike: 0.22, recover: 0.8, cd: [1.0, 1.8], score: 400, scale: 1.3,  w: 46, h: 122, armor: true, kbMul: 0.3, slam: true },
    anhaa:   { name: "АНХАА", hp: 560, speed: 100, dmg: 11, range: 135, score: 600, scale: 1.42, w: 48, h: 138, boss: true, miniBoss: true, kbMul: 0.14 },
    tekaBoss:{ name: "МОРЬТ ТЭКА", hp: 1400, speed: 135, dmg: 15, range: 175, score: 1800, scale: 1.38, w: 92, h: 178, boss: true, mounted: true, kbMul: 0.05 }
  };

  const ATK = [
    { dur: 0.30, a0: 0.08, a1: 0.17, dmg: 12, kb: 170, x0: 6, x1: 92,  y0: -104, y1: -6, lunge: 110 },
    { dur: 0.30, a0: 0.07, a1: 0.16, dmg: 13, kb: 180, x0: 6, x1: 92,  y0: -118, y1: -16, lunge: 110 },
    { dur: 0.44, a0: 0.15, a1: 0.26, dmg: 24, kb: 400, x0: 6, x1: 112, y0: -96,  y1: -14, lunge: 300, heavy: true }
  ];
  const AIRATK = { dur: 0.34, a0: 0.06, a1: 0.22, dmg: 15, kb: 180, x0: -16, x1: 86, y0: -96, y1: 36 };

  function makePlayer() {
    return {
      kind: "player", style: STYLES.player, scale: 1, x: 140, y: GROUND_Y, vx: 0, vy: 0, face: 1, w: 30, h: 92,
      onGround: true, onPlatform: false, hp: 100, maxHp: 100, en: 50, maxEn: 100,
      state: "free", stateT: 0, anim: "idle", animT: 0, k: 0, atkStep: 0, atkQueued: false, atkId: 0,
      inv: 0, flash: 0, runHold: 0, coyote: 0, dropT: 0, cd: { dash: 0, power: 0, ult: 0 }, boost: 0,
      lowWarned: false, deadT: 0, dashHits: new Set(), ghostT: 0, animSeed: 0, alpha: 1, powerDone: false, ultDone: false
    };
  }

  function makeEnemy(type, x) {
    const d = ENEMY_DEFS[type];
    return {
      kind: "enemy", type, def: d, style: STYLES[type], scale: d.scale, x, y: GROUND_Y, vx: 0, vy: 0, face: -1,
      w: d.w, h: d.h, hp: d.hp, maxHp: d.hp, state: "enter", stateT: 0, anim: "walk", animT: 0, k: 0,
      cdT: rand(0.3, 1.0), hitBy: -1, flash: 0, alpha: 1, onGround: true, removed: false, deadT: 0,
      firstHitT: null, animSeed: rand(0, 10), animRate: d.speed / 110, struck: false, comboLeft: 0, entered: false,
      phase: 1, inv: 0, eyeGlow: false
    };
  }

  /* ---------- physics ---------- */
  function physics(e, dt, opts = {}) {
    const prevY = e.y, prevX = e.x;
    e.landing = Math.max(0, (e.landing || 0) - dt * 32);
    const accel = (e.vx - (e.lastVx ?? e.vx)) / Math.max(dt, .001);
    e.bodyLean = lerp(e.bodyLean || 0, clamp(accel / 18000, -.1, .1), 1 - Math.exp(-dt * 10));
    e.lastVx = e.vx;
    const impactSpeed = Math.max(0, e.vy);
    const wasGround = e.onGround;
    if (!opts.noGrav) e.vy = Math.min(e.vy + GRAVITY * dt, 1400);
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.onGround = false; e.onPlatform = false;
    if (e.vy >= 0) {
      if (opts.platforms && !(e.dropT > 0)) {
        for (const pl of game.stage.def.platforms || []) {
          if (e.x > pl.x - 8 && e.x < pl.x + pl.w + 8 && prevY <= pl.y + 1 && e.y >= pl.y) {
            e.y = pl.y; e.vy = 0; e.onGround = true; e.onPlatform = true; break;
          }
        }
      }
      if (e.y >= GROUND_Y) { e.y = GROUND_Y; e.vy = 0; e.onGround = true; }
    }
    if (!wasGround && e.onGround && prevY < e.y - 0.1) {
      e.landing = clamp(impactSpeed / 125, 0, 7);
      if (e.kind === "player") {
        dust(e.x, e.y, Math.round(3 + e.landing)); AudioFx.play("land");
        if (impactSpeed > 620) shake(Math.min(3.5, impactSpeed / 260));
      }
    }
    if (e.onGround) {
      e.gaitDistance = (e.gaitDistance || 0) + Math.abs(e.x - prevX);
      if (e.kind === "player" && e.state === "free" && Math.abs(e.vx) > 80) {
        const step = Math.floor(e.gaitDistance / 43);
        if (step !== e.lastFootstep) {
          e.lastFootstep = step;
          dust(e.x - e.face * 7, e.y, Math.abs(e.vx) > 250 ? 3 : 1);
          game.decals.push({type: "footprint", x: e.x, y: e.y, face: e.face, life: 5, max: 5});
          if (game.decals.length > 80) game.decals.shift();
        }
      }
    }
  }
  function supportY(e) {
    if (game.stage) for (const pl of game.stage.def.platforms || []) if (e.x > pl.x - 8 && e.x < pl.x + pl.w + 8 && e.y <= pl.y + 1) return pl.y;
    return GROUND_Y;
  }

  /* ======================================================================
     PARTICLES / TEXT
     ====================================================================== */
  function particle(o) {
    if (game.particles.length > 360) game.particles.shift();
    game.particles.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 3, color: "#fff", grav: 0, drag: 0, type: "dot", rot: 0 }, o, { max: o.life || 0.5 }));
  }
  function dust(x, y, n = 6, col = "rgba(210,190,160,") {
    for (let i = 0; i < n; i++) particle({ x: x + rand(-14, 14), y: y - 2, vx: rand(-90, 90), vy: rand(-80, -20), life: rand(0.3, 0.6), size: rand(4, 9), color: col, type: "smoke", drag: 3 });
  }
  function sparks(x, y, n, col = "#FFF3C4", spd = 380) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(spd * 0.4, spd);
      particle({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.15, 0.35), size: rand(2, 3.5), color: col, type: "spark", drag: 6 });
    }
  }
  function ring(x, y, r, col, life = 0.35, width = 5) { particle({ x, y, life, size: r, color: col, type: "ring", width }); }
  function floatText(x, y, text, color = "#fff", size = 18, opts = {}) {
    if (game.texts.length > 40) game.texts.shift();
    game.texts.push({ x, y, text, color, size, life: opts.life || 0.9, max: opts.life || 0.9, vy: opts.vy ?? -70, pop: 0 });
  }
  function shake(n) { if (settings.shake) game.shake = Math.max(game.shake, n); }

  /* ======================================================================
     SCORE / COMBO
     ====================================================================== */
  function addScore(n, x, y, label) {
    if (n <= 0) return;
    game.score += Math.round(n);
    if (x != null) floatText(x, y, "+" + Math.round(n) + (label ? " " + label : ""), "#FFD66B", label ? 15 : 17, { vy: -55, life: 1.1 });
    restartAnim(ui.scoreBox, "is-pop");
  }
  function addCombo() {
    game.combo++;
    game.comboT = COMBO_WINDOW;
    if (game.combo > game.maxCombo) game.maxCombo = game.combo;
    if (game.combo >= 2) { restartAnim(ui.combo, "is-pop"); if (game.combo % 5 === 0) AudioFx.play("combo", game.combo); }
  }
  function breakCombo() { game.combo = 0; game.comboT = 0; }

  /* ======================================================================
     COMBAT
     ====================================================================== */
  function hurtbox(e) {
    const w = e.w * (e.kind === "player" ? 1 : 1), h = e.h;
    return { x0: e.x - w / 2, x1: e.x + w / 2, y0: e.y - h, y1: e.y };
  }
  const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

  function damageEnemy(e, dmg, o = {}) {
    if (e.state === "dead" || e.removed || e.inv > 0 || e.state === "intro") return false;
    const p = game.player;
    const boosted = p.boost > 0;
    const armorBroken = (e.armorBreak || 0) > 0;
    dmg = Math.max(1, Math.round(dmg * (boosted ? 1.6 : 1) * (p.weaponUpgrade ? 1.2 : 1) * (armorBroken ? 1.15 : 1) * rand(0.92, 1.08)));
    e.hp -= dmg;
    e.flash = 0.16;
    if (e.firstHitT == null) e.firstHitT = game.runTime;
    addCombo();
    p.en = Math.min(p.maxEn, p.en + (o.energyGain ?? ENERGY_PER_HIT));
    const hx = e.x - sign(e.x - p.x) * e.w * 0.3, hy = e.y - e.h * 0.55;
    floatText(e.x + rand(-10, 10), e.y - e.h - 8, String(dmg), o.heavy || o.skill ? "#FFD66B" : "#FFFFFF", o.heavy || o.skill ? 24 : 18, { vy: -90, life: 0.75 });
    sparks(hx, hy, o.heavy ? 14 : 8, boosted ? "#FFB070" : "#FFF3C4", o.heavy ? 520 : 380);
    ring(hx, hy, o.heavy ? 30 : 18, "rgba(255,240,200,", 0.2, o.heavy ? 5 : 3);
    if (!o.noStop) game.hitstop = Math.max(game.hitstop, o.heavy ? 0.075 : 0.04);
    shake(o.heavy ? 7 : 3);
    AudioFx.play("hit", !!o.heavy);
    vibrate(o.heavy ? 24 : 10);

    if (e.hp <= 0) { killEnemy(e, o); return true; }

    const d = e.def;
    const dir = o.dir || sign(e.x - p.x);
    if (d.boss) {
      e.vx += dir * 60;
      if (o.ult && (e.state === "think" || e.state === "walk" || e.state === "recover")) { setState(e, "stun"); e.stunDur = 0.7; }
      ui.bossBar.classList.remove("is-hit"); void ui.bossBar.offsetWidth; ui.bossBar.classList.add("is-hit");
      checkBossPhase(e);
    } else if (d.armor && !armorBroken && !o.heavy) {
      e.vx = dir * 60;
      if (Math.random() < 0.3) floatText(e.x, e.y - e.h - 30, "ARMOR", "#9FD3FF", 12, { life: 0.5 });
    } else {
      setState(e, "hurt");
      e.hurtDur = o.heavy ? 0.5 : 0.28;
      e.vx = dir * (o.kb || 160) * (d.kbMul || 1);
      if (o.up) { e.vy = -o.up * (d.kbMul ? 0.5 : 1); e.onGround = false; }
      setAnim(e, "hurt");
    }
    return true;
  }

  function killEnemy(e, o = {}) {
    const p = game.player;
    setState(e, "dead");
    setAnim(e, "dead");
    e.deadT = 0;
    e.vx = sign(e.x - p.x) * (e.def.boss ? 60 : 260);
    e.vy = e.def.boss ? 0 : -320;
    e.onGround = false;
    game.kills++;
    p.en = Math.min(p.maxEn, p.en + ENERGY_PER_KILL);
    const mult = comboMult();
    addScore(e.def.score * mult, e.x, e.y - e.h - 30);
    if (o.skill) later(0.15, () => addScore(50, e.x, e.y - e.h - 54, "SKILL"));
    if (!e.def.boss && e.firstHitT != null && game.runTime - e.firstHitT < 2.2) later(0.3, () => addScore(50, e.x, e.y - e.h - 78, "FAST"));
    AudioFx.play("enemyDie");
    dust(e.x, e.y, 10);
    sparks(e.x, e.y - e.h * 0.5, 16, "#FFE2A0", 460);
    if (e.def.boss) { bossDefeated(e); return; }
    rollDrop(e.x, e.y - 40);
  }

  function rollDrop(x, y) {
    const p = game.player;
    const r = Math.random();
    let type = null;
    const hpNeed = p.hp < p.maxHp * 0.6 ? 0.08 : 0;
    if (r < 0.04) type = "power";
    else if (r < 0.26 + hpNeed) type = "hp";
    else if (r < 0.50 + hpNeed) type = "en";
    else if (r < 0.78) type = "star";
    if (type) spawnItem(type, x, y);
  }

  function spawnItem(type, x, y) {
    game.items.push({ type, x, y, vx: rand(-60, 60), vy: -360, onGround: false, life: 14, t: 0 });
  }

  function doParry(p, fromX, o) {
    p.parryReady = false;
    p.inv = Math.max(p.inv, 0.35);
    p.parryFlash = 0.4;
    p.counterT = 1.4;
    vibrate(30);
    p.vx = sign(p.x - fromX) * 60;
    game.parries = (game.parries || 0) + 1;
    game.hitstop = Math.max(game.hitstop, 0.11);
    game.flashWhite = Math.max(game.flashWhite, 0.18);
    shake(6);
    AudioFx.play("parry");
    const sx = p.x + p.face * 30, sy = p.y - 62;
    ring(sx, sy, 70, "rgba(255,214,107,", 0.4, 7);
    ring(sx, sy, 34, "rgba(255,255,255,", 0.25, 4);
    sparks(sx, sy, 20, "#FFE08F", 560);
    floatText(p.x, p.y - p.h - 26, "PARRY!", "#FFD66B", 26, { life: 1.0, vy: -50 });
    p.en = Math.min(p.maxEn, p.en + 12);
    addCombo();
    later(0.12, () => addScore(50, p.x, p.y - p.h - 54, "PARRY"));
    const src = o.src;
    if (src && src.state !== "dead" && !src.removed) {
      const dir = sign(src.x - p.x);
      if (src.def.boss) {
        if (!["phase", "intro", "dead"].includes(src.state)) { setState(src, "stun"); src.stunDur = 0.85; src.vx = dir * 140; setAnim(src, "stun"); }
      } else {
        setState(src, "hurt"); src.hurtDur = 1.0; src.vx = dir * 280; setAnim(src, "stun");
        src.cdT = Math.max(src.cdT, 1.2);
      }
      src.flash = 0.2;
    }
    return "parry";
  }

  function hurtPlayer(dmg, fromX, o = {}) {
    const p = game.player;
    if (!p || p.state === "dead" || p.inv > 0 || p.state === "dash" || p.state === "ult" || game.god || game.inputLock) return false;
    if (p.state === "block") {
      const facing = sign(fromX - p.x) === p.face || Math.abs(fromX - p.x) < 6;
      if (o.unblockable) {
        floatText(p.x, p.y - p.h - 30, "UNBLOCKABLE", "#FF8A8A", 13, { life: 0.7 });
      } else if (facing) {
        if (p.parryReady && p.blockT <= PARRY_WINDOW) return doParry(p, fromX, o);
        const chip = Math.max(1, Math.round(dmg * (o.heavy ? 0.35 : 0.2)));
        p.hp = Math.max(0, p.hp - chip);
        p.inv = 0.22;
        p.guardHit = 0.18;
        p.vx = sign(p.x - fromX) * (o.heavy ? 300 : 170);
        shake(o.heavy ? 5 : 3);
        AudioFx.play("block");
        sparks(p.x + p.face * 30, p.y - 62, 10, "#BFE8FF", 360);
        floatText(p.x, p.y - p.h - 10, "BLOCK -" + chip, "#9FD3FF", 16, { vy: -60, life: 0.7 });
        if (p.hp <= 0) { playerDie(); return true; }
        return "blocked";
      }
    }
    p.hp = Math.max(0, p.hp - dmg);
    p.inv = 0.9;
    p.flash = 0.28;
    breakCombo();
    setState(p, "hurt");
    setAnim(p, "hurt");
    p.vx = sign(p.x - fromX) * (o.kb || 240);
    p.vy = -(o.up || 240);
    p.onGround = false;
    shake(8);
    game.hurtFlash = 0.4;
    AudioFx.play("hurt");
    floatText(p.x, p.y - p.h - 10, "-" + dmg, "#FF6B7D", 20, { vy: -60 });
    sparks(p.x, p.y - 56, 8, "#FF8A8A", 300);
    if (p.hp <= 0) { playerDie(); return true; }
    if (p.hp <= p.maxHp * 0.25 && !p.lowWarned) { p.lowWarned = true; Voice.say("lowHp", game.t, true); }
    else Voice.say("hurt", game.t);
    return true;
  }

  /* ======================================================================
     PLAYER
     ====================================================================== */
  function startAttack(p, step) {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir) p.face = dir;
    setState(p, "attack");
    p.atkStep = step;
    p.atkQueued = false;
    p.atkId++;
    p.counterAttack = (p.counterT || 0) > 0;
    if (p.counterAttack) { p.counterT = 0; floatText(p.x,p.y-p.h-30,"COUNTER!","#FFD66B",18); }
    setAnim(p, "attack");
    p.animT = 0;
    AudioFx.play("swing", step === 2);
    AudioFx.play("blade");
  }

  function trySkill(p, s) {
    const def = SKILLS[s];
    if (p.cd[s] > 0) { denySkill(s, `${def.label} · ${p.cd[s].toFixed(1)}s`); return false; }
    if (p.en < def.cost) {
      denySkill(s, "Not enough Energy");
      floatText(p.x, p.y - p.h - 22, "Not enough Energy", "#8BE3FF", 13, { life: 0.8 });
      return false;
    }
    p.en -= def.cost;
    p.cd[s] = def.cd;
    game.skillsUsed++;
    if (s === "dash") {
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (dir) p.face = dir;
      setState(p, "dash"); setAnim(p, "dash");
      p.dashHits.clear();
      p.inv = Math.max(p.inv, 0.26);
      AudioFx.play("dash");
      dust(p.x, p.y, 8, "rgba(160,200,255,");
    } else if (s === "power") {
      setState(p, "power"); setAnim(p, "power");
      p.powerDone = false;
      AudioFx.play("swing", true);
      Voice.say("skill", game.t);
    } else if (s === "ult") {
      setState(p, "ult"); setAnim(p, "ult");
      p.ultDone = false;
      AudioFx.play("ultCharge");
      Voice.say("skill", game.t);
      floatText(p.x, p.y - p.h - 50, "ТЭНГЭРИЙН АЯНГА!", "#FFE08F", 20, { life: 1.2, vy: -30 });
    }
    return true;
  }

  function attackBox(p, A) {
    const f = p.face;
    const a = p.x + f * A.x0, b = p.x + f * A.x1;
    return { x0: Math.min(a, b), x1: Math.max(a, b), y0: p.y + A.y0, y1: p.y + A.y1 };
  }

  function doPlayerHits(p, A) {
    const box = attackBox(p, A);
    for (const e of game.enemies) {
      if (e.state === "dead" || e.hitBy === p.atkId) continue;
      if (!overlap(box, hurtbox(e))) continue;
      e.hitBy = p.atkId;
      damageEnemy(e, A.dmg * (p.counterAttack ? 1.5 : 1), { heavy: A.heavy || p.counterAttack, kb: A.kb, up: A.heavy ? 260 : 0, dir: p.face });
    }
    for (const pr of game.projectiles) {
      if (pr.dead || pr.friendly) continue;
      if (pr.x > box.x0 - 8 && pr.x < box.x1 + 8 && pr.y > box.y0 && pr.y < box.y1) {
        pr.dead = true;
        sparks(pr.x, pr.y, 10, "#BFE8FF", 300);
        AudioFx.play("deflect");
        floatText(pr.x, pr.y - 16, "DEFLECT", "#9FD3FF", 14, { life: 0.6 });
        addScore(20, null);
      }
    }
  }

  function powerImpact(p) {
    p.powerDone = true;
    AudioFx.play("power");
    shake(14);
    ring(p.x + p.face * 60, p.y - 10, 160, "rgba(255,214,107,", 0.45, 8);
    ring(p.x + p.face * 60, p.y - 10, 90, "rgba(255,255,255,", 0.3, 4);
    for (let i = 0; i < 18; i++) {
      particle({ x: p.x + p.face * rand(10, 200), y: p.y - 2, vx: rand(-40, 40), vy: rand(-420, -160), life: rand(0.4, 0.7), size: rand(3, 6), color: "#a69572", grav: 1400, type: "dot" });
    }
    dust(p.x + p.face * 80, p.y, 14);
    game.decals.push({ type: "crack", x: p.x + p.face * 70, life: 1.6, max: 1.6 });
    for (const e of game.enemies) {
      if (e.state === "dead") continue;
      const dx = (e.x - p.x) * p.face;
      if (dx > -80 && dx < 230 && Math.abs(e.y - p.y) < 110) {
        if (damageEnemy(e, 46, { heavy: true, skill: true, kb: 440, up: 380, dir: sign(e.x - p.x), stun: true })) {
          e.armorBreak = 4;
          floatText(e.x,e.y-e.h-28,"ARMOR BREAK","#9FD3FF",14);
        }
      }
    }
    for (const pr of game.projectiles) if (!pr.friendly && Math.abs(pr.x - p.x) < 240) { pr.dead = true; sparks(pr.x, pr.y, 6, "#BFE8FF"); }
  }

  function ultStrike(p) {
    p.ultDone = true;
    const targets = game.enemies.filter((e) => e.state !== "dead" && !e.removed && e.x > game.camX - 30 && e.x < game.camX + VIEW_W + 30);
    if (!targets.length) for (let i = 0; i < 4; i++) game.bolts.push({ x: game.camX + rand(100, VIEW_W - 100), t: -i * 0.08, target: null, hit: false });
    targets.forEach((e, i) => game.bolts.push({ x: e.x, t: -i * 0.09, target: e, hit: false }));
    for (const pr of game.projectiles) if (!pr.friendly) pr.dead = true;
    for (const h of game.hazards) if (h.type === "meteor" && !h.fallen) h.dead = true;
  }

  function updatePlayer(p, dt) {
    p.counterT = Math.max(0, (p.counterT || 0) - dt);
    p.animT += dt; p.stateT += dt;
    for (const s in p.cd) p.cd[s] = Math.max(0, p.cd[s] - dt);
    p.inv = Math.max(0, p.inv - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.dropT = Math.max(0, p.dropT - dt);
    if (p.boost > 0) { p.boost = Math.max(0, p.boost - dt); if (Math.random() < 0.4) particle({ x: p.x + rand(-14, 14), y: p.y - rand(10, 90), vx: rand(-20, 20), vy: rand(-90, -40), life: 0.45, size: rand(3, 5), color: "rgba(255,140,40,", type: "smoke" }); }
    if (p.hp > p.maxHp * 0.4) p.lowWarned = false;

    if (p.state === "dead") {
      p.deadT += dt;
      p.vx = approach(p.vx, 0, 600 * dt);
      physics(p, dt, { platforms: true });
      return;
    }
    p.en = Math.min(p.maxEn, p.en + ENERGY_REGEN * dt);

    const locked = game.inputLock;
    const canAct = !locked && (p.state === "free" || p.state === "attack" || p.state === "airatk" || p.state === "block");
    p.parryFlash = Math.max(0, (p.parryFlash || 0) - dt);
    p.guardHit = Math.max(0, (p.guardHit || 0) - dt);
    const startBlock = () => {
      setState(p, "block"); setAnim(p, "block");
      p.blockT = 0;
      p.parryReady = game.t - (p.lastBlockAt ?? -9) > PARRY_RETRY;
      p.lastBlockAt = game.t;
      input.buf.attack = -99;
    };
    if (canAct) {
      if (input.consume("ult")) trySkill(p, "ult");
      else if (input.consume("power")) trySkill(p, "power");
      else if (input.consume("dash")) trySkill(p, "dash");
    }

    let noGrav = false;
    switch (p.state) {
      case "free": {
        const dir = locked ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (dir) { p.face = dir; p.runHold += dt; } else p.runHold = 0;
        const spd = p.runHold > 0.35 ? 310 : 215;
        p.vx = approach(p.vx, dir * spd, (p.onGround ? 2600 : 1600) * dt);
        p.coyote = p.onGround ? 0.09 : p.coyote - dt;
        if (!locked && p.coyote > 0 && input.consume("jump", 0.14)) {
          if (input.down && p.onPlatform) { p.dropT = 0.25; p.y += 2; p.onGround = false; }
          else { p.vy = -665; p.onGround = false; p.coyote = 0; AudioFx.play("jump"); dust(p.x, p.y, 4); }
        }
        if (!input.jumpHeld && p.vy < -200) p.vy += GRAVITY * 1.1 * dt;      // богино үсрэлт
        if (!locked && input.down && p.onPlatform && input.k.down && p.dropT <= 0 && Math.abs(p.vx) < 5 && p.stateT > 0.2) { /* S дарж хүлээвэл бууна */ }
        if (!locked && p.onGround && input.blockHeld) { startBlock(); break; }
        if (!locked && input.consume("attack")) { if (p.onGround) startAttack(p, 0); else { setState(p, "airatk"); setAnim(p, "airatk"); p.atkId++; p.counterAttack = false; AudioFx.play("swing", false); } }
        if (p.state === "free") {
          if (!p.onGround) setAnim(p, "jump");
          else if (Math.abs(p.vx) > 250) setAnim(p, "run");
          else if (Math.abs(p.vx) > 20) setAnim(p, "walk");
          else setAnim(p, "idle");
        }
        break;
      }
      case "attack": {
        const A = ATK[p.atkStep];
        p.k = p.stateT / A.dur;
        if (p.stateT < 0.1) p.vx = p.face * A.lunge * (1 - p.stateT / 0.1);
        else p.vx = approach(p.vx, 0, 2000 * dt);
        if (p.stateT >= A.a0 && p.stateT <= A.a1) doPlayerHits(p, A);
        if (p.stateT > 0.05 && input.consume("attack", 0.3)) p.atkQueued = true;
        if (p.stateT >= A.dur * 0.8 && p.atkQueued && p.atkStep < 2) { startAttack(p, p.atkStep + 1); break; }
        if (p.stateT > A.a1 && input.blockHeld && !locked) { startBlock(); break; }
        if (p.stateT > A.a1 && input.consume("jump", 0.1)) { setState(p, "free"); p.vy = -640; p.onGround = false; AudioFx.play("jump"); break; }
        if (p.stateT >= A.dur) { setState(p, "free"); if (p.atkStep === 2 && p.atkQueued) input.buf.attack = -99; }
        break;
      }
      case "airatk": {
        p.k = p.stateT / AIRATK.dur;
        const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        p.vx = approach(p.vx, dir * 200, 900 * dt);
        if (p.stateT >= AIRATK.a0 && p.stateT <= AIRATK.a1) doPlayerHits(p, AIRATK);
        if (p.onGround && p.stateT > 0.05 || p.stateT >= AIRATK.dur) setState(p, "free");
        break;
      }
      case "dash": {
        p.vx = p.face * 880;
        p.vy = 0; noGrav = true;
        p.ghostT -= dt;
        if (p.ghostT <= 0) { p.ghostT = 0.028; game.ghosts.push({ x: p.x, y: p.y, face: p.face, life: 0.22, max: 0.22 }); }
        for (const e of game.enemies) {
          if (e.state === "dead" || p.dashHits.has(e)) continue;
          if (Math.abs(e.x - p.x) < 30 + e.w / 2 && Math.abs((e.y - e.h / 2) - (p.y - 46)) < e.h / 2 + 40) {
            p.dashHits.add(e);
            damageEnemy(e, 8, { kb: 220, dir: p.face, skill: true, noStop: true });
          }
        }
        if (p.stateT >= 0.2) { setState(p, "free"); p.vx = p.face * 260; }
        break;
      }
      case "power": {
        p.k = p.stateT / 0.58;
        p.vx = approach(p.vx, 0, 2400 * dt);
        if (!p.powerDone && p.stateT >= 0.25) powerImpact(p);
        if (p.stateT >= 0.58) setState(p, "free");
        break;
      }
      case "ult": {
        p.k = p.stateT / 1.25;
        p.vx = 0; p.vy = 0; noGrav = p.stateT < 1.05;
        game.darken = Math.min(0.6, game.darken + dt * 2);
        if (!p.ultDone && p.stateT >= 0.42) ultStrike(p);
        if (p.stateT >= 1.25) setState(p, "free");
        break;
      }
      case "hurt": {
        p.vx = approach(p.vx, 0, 700 * dt);
        if (p.stateT >= 0.34) setState(p, "free");
        break;
      }
      case "block": {
        p.blockT += dt;
        setAnim(p, "block");
        p.vx = approach(p.vx, 0, 1300 * dt);
        const dir = locked ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (dir) p.face = dir;                                  // хамгаалж байхдаа эргэж болно
        if (locked || !input.blockHeld || !p.onGround) { setState(p, "free"); break; }
        if (input.consume("attack", 0.2)) { startAttack(p, 0); break; }     // хамгаалалтаас шууд сөрөг цохилт
        if (input.consume("jump", 0.14)) { setState(p, "free"); p.vy = -665; p.onGround = false; AudioFx.play("jump"); break; }
        break;
      }
    }
    physics(p, dt, { platforms: true, noGrav });
    // хил
    const st = game.stage;
    const minX = Math.max(18, game.camX + 18), maxX = Math.min(st.def.width - 18, game.camX + VIEW_W - 18);
    if (p.x < minX) { p.x = minX; if (p.vx < 0) p.vx = 0; }
    if (p.x > maxX) { p.x = maxX; if (p.vx > 0) p.vx = 0; }
  }

  function playerDie() {
    const p = game.player;
    setState(p, "dead");
    setAnim(p, "dead");
    p.deadT = 0;
    p.vx = -p.face * 120;
    game.slowT = 1.0;
    game.inputLock = true;
    AudioFx.music(null);
    AudioFx.play("gameOver");
    shake(12);
    later(2.0, () => endGame(false));
  }

  /* ======================================================================
     ENEMIES
     ====================================================================== */
  function meleeAttackers() {
    let n = 0;
    for (const e of game.enemies) if (!e.def.boss && (e.state === "windup" || e.state === "strike") && !e.ranged) n++;
    return n;
  }

  function enemyHitbox(e, range, y0 = -100, y1 = -4) {
    const a = e.x + e.face * 4 * e.scale, b = e.x + e.face * range;
    return { x0: Math.min(a, b), x1: Math.max(a, b), y0: e.y + y0 * e.scale, y1: e.y + y1 };
  }

  function updateEnemy(e, dt) {
    e.armorBreak = Math.max(0, (e.armorBreak || 0) - dt);
    e.animT += dt; e.stateT += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.cdT -= dt;
    const p = game.player, d = e.def;
    if (e.state === "dead") {
      e.deadT += dt;
      e.vx = approach(e.vx, 0, 500 * dt);
      physics(e, dt);
      if (e.deadT > 0.9) e.alpha = Math.max(0, 1 - (e.deadT - 0.9) / 0.5);
      if (e.deadT > 1.45) e.removed = true;
      return;
    }
    if (d.boss) { updateBoss(e, dt); return; }
    if (e.state === "hurt") {
      e.vx = approach(e.vx, 0, 900 * dt);
      physics(e, dt);
      if (e.stateT >= e.hurtDur && e.onGround) { setState(e, "chase"); e.cdT = Math.max(e.cdT, 0.35); }
      clampEnemy(e);
      return;
    }
    const dx = p.x - e.x, adx = Math.abs(dx);
    const pAlive = p.state !== "dead" && !game.inputLock;
    const lock = game.stage.lock;
    switch (e.state) {
      case "enter": {
        const inL = lock != null ? lock + 60 : game.camX + 60, inR = lock != null ? lock + VIEW_W - 60 : game.camX + VIEW_W - 60;
        const goal = e.x < inL ? 1 : e.x > inR ? -1 : 0;
        if (!goal) { e.entered = true; setState(e, "chase"); break; }
        e.face = goal; e.vx = goal * d.speed * 1.2; setAnim(e, "walk");
        break;
      }
      case "chase": {
        e.face = sign(dx);
        if (d.ranged) { tekaThink(e, adx, pAlive); break; }
        const busy = meleeAttackers() >= 2;
        const want = busy ? 170 : d.range * 0.8;
        if (adx > want + 6) { e.vx = approach(e.vx, e.face * d.speed, 900 * dt); setAnim(e, "walk"); }
        else if (busy && adx < 140) { e.vx = approach(e.vx, -e.face * d.speed * 0.5, 900 * dt); setAnim(e, "walk"); }
        else { e.vx = approach(e.vx, 0, 900 * dt); setAnim(e, "idle"); }
        if (pAlive && e.cdT <= 0 && !busy) {
          if (adx <= d.range && Math.abs(p.y - e.y) < 70) { setState(e, "windup"); e.lunging = false; e.comboLeft = d.combo && Math.random() < 0.5 ? 1 : 0; }
          else if (d.lunge && adx > 150 && adx < 280 && Math.random() < 0.02) { setState(e, "windup"); e.lunging = true; }
          else if (d.armor && adx > 180 && adx < 360 && Math.random() < 0.008) { setState(e, "windup"); e.lunging = true; }
        }
        break;
      }
      case "retreat": {
        e.face = sign(dx);
        e.vx = approach(e.vx, -e.face * d.speed * 1.1, 900 * dt);
        setAnim(e, "walk");
        const nearEdge = e.x < game.camX + 50 || e.x > game.camX + VIEW_W - 50;
        if (adx > d.keep[0] + 30 || nearEdge || e.stateT > 1.4) { setState(e, "chase"); if (nearEdge && adx < 90) { setState(e, "windup"); e.melee = true; } }
        break;
      }
      case "windup": {
        const wd = e.lunging ? d.windup * 1.2 : e.comboLeft === -1 ? d.windup * 0.5 : d.windup;
        e.vx = approach(e.vx, 0, 1400 * dt);
        e.k = e.stateT / wd;
        setAnim(e, "windup");
        if (!e.lunging && !e.melee) e.face = sign(dx) || e.face;
        if (e.stateT >= wd) {
          setState(e, "strike");
          if (e.lunging) { e.vx = e.face * (d.armor ? 520 : 470); setAnim(e, "lunge"); }
          else if (d.ranged && !e.melee) fireArrow(e);
          else if (d.slam) erhmeeSlam(e);
          AudioFx.play("swing", !!d.armor);
        }
        break;
      }
      case "strike": {
        const dur = e.lunging ? 0.34 : d.strike;
        e.k = e.stateT / dur;
        setAnim(e, e.lunging ? "lunge" : "strike");
        if (e.lunging) e.vx = approach(e.vx, 0, 900 * dt);
        else e.vx = approach(e.vx, 0, 1200 * dt);
        if (!e.struck && (!d.ranged || e.melee)) {
          const range = e.lunging ? 60 * e.scale : (e.melee ? 70 : d.range);
          if (overlap(enemyHitbox(e, range), hurtbox(p))) {
            e.struck = true;
            hurtPlayer(e.lunging && d.armor ? d.dmg + 4 : d.dmg, e.x, { kb: d.armor ? 420 : 260, up: d.armor ? 360 : 230, src: e, heavy: !!d.armor });
          }
        }
        if (e.stateT >= dur) {
          if (e.comboLeft > 0) { e.comboLeft = -1; setState(e, "windup"); e.comboLeft = -1; break; }
          setState(e, "recover");
        }
        break;
      }
      case "recover": {
        e.vx = approach(e.vx, 0, 1200 * dt);
        setAnim(e, "idle");
        if (e.stateT >= d.recover * (e.lunging ? 1.4 : 1)) {
          setState(e, "chase");
          e.lunging = false; e.melee = false; e.comboLeft = 0;
          e.cdT = rand(d.cd[0], d.cd[1]);
        }
        break;
      }
    }
    physics(e, dt);
    if (e.entered) clampEnemy(e);
  }

  function clampEnemy(e) {
    const lock = game.stage.lock;
    const L = lock != null ? lock + 22 : 22, R = lock != null ? lock + VIEW_W - 22 : game.stage.def.width - 22;
    if (e.x < L) { e.x = L; if (e.vx < 0) e.vx = 0; }
    if (e.x > R) { e.x = R; if (e.vx > 0) e.vx = 0; }
  }

  function tekaThink(e, adx, pAlive) {
    const d = e.def;
    if (adx < 190 && e.stateT > 0.2) {
      const nearEdge = e.x < game.camX + 60 || e.x > game.camX + VIEW_W - 60;
      if (!nearEdge) { setState(e, "retreat"); return; }
      if (adx < 90 && e.cdT <= 0) { setState(e, "windup"); e.melee = true; return; }
    }
    if (adx > d.keep[1]) { e.vx = approach(e.vx, e.face * d.speed, 30); setAnim(e, "walk"); }
    else { e.vx = approach(e.vx, 0, 30); setAnim(e, "idle"); }
    if (pAlive && e.cdT <= 0 && adx <= d.keep[1] + 60) { setState(e, "windup"); e.melee = false; }
  }

  function fireArrow(e) {
    const p = game.player;
    const lob = Math.random() < 0.35;
    const sx = e.x + e.face * 24 * e.scale, sy = e.y - 58 * e.scale;
    AudioFx.play("shoot");
    if (lob) {
      const tt = 0.9, tx = p.x + p.vx * 0.3;
      const vx = (tx - sx) / tt, vy = (p.y - 20 - sy - 0.5 * 900 * tt * tt) / tt;
      game.projectiles.push({ type: "arrow", x: sx, y: sy, vx, vy, grav: 900, dmg: e.def.dmg, life: 3 });
    } else {
      game.projectiles.push({ type: "arrow", x: sx, y: e.y - 56, vx: e.face * 540, vy: 0, grav: 0, dmg: e.def.dmg, life: 3 });
    }
  }

  function erhmeeSlam(e) {
    AudioFx.play("slam");
    shake(9);
    dust(e.x + e.face * 50, e.y, 12);
    ring(e.x + e.face * 60, e.y - 8, 70, "rgba(255,170,120,", 0.35, 6);
    game.hazards.push({ type: "wave", x: e.x + e.face * 70, y: GROUND_Y, dir: e.face, speed: 400, life: 1.2, max: 1.2, h: 34, dmg: 12, col: "255,150,90" });
  }

  function separateEnemies() {
    const list = game.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === "dead") continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.state === "dead") continue;
        const min = (a.w + b.w) * 0.75;
        const dx = b.x - a.x;
        if (Math.abs(dx) < min) {
          const push = (min - Math.abs(dx)) * 0.12 * (dx === 0 ? (i % 2 ? 1 : -1) : sign(dx));
          if (!a.def.boss) a.x -= push;
          if (!b.def.boss) b.x += push;
        }
      }
    }
  }

  /* ======================================================================
     BOSS — АНХАА (mini-boss) → МОРЬТ ТЭКА 👑
     ====================================================================== */
  function spawnBoss(type = "anhaa") {
    const st = game.stage;
    const b = makeEnemy(type, st.lock + VIEW_W - 180);
    b.y = -260; b.onGround = false; b.state = "intro"; b.stateT = 0; b.face = -1; b.entered = true;
    b.anim = "leap"; b.phase = 1; b.thinkT = 1.0; b.lastAct = null;
    game.enemies.push(b);
    game.boss = b;
    if (b.def.mounted) {
      game.darken = .65;
      game.lightning = .55;
      shake(10);
    }
    AudioFx.music(null);
    AudioFx.play("warn");
    later(0.4, () => AudioFx.play("warn"));
    showBanner("⚠ WARNING ⚠", b.def.name + (b.def.miniBoss ? "" : " 👑"), b.def.miniBoss ? "Зам хаасан хүчтэн!" : "Жинхэнэ эцсийн босс · Морьт баатар!", 2.4, true);
    game.inputLock = true;
  }

  function bossSpeed(b) { return b.phase === 1 ? 1 : b.phase === 2 ? 1.15 : 1.3; }

  function checkBossPhase(b) {
    if (b.def.miniBoss) return;
    const r = b.hp / b.maxHp;
    const want = r <= 0.33 ? 3 : r <= 0.66 ? 2 : 1;
    if (want > b.phase && b.state !== "dead") {
      b.phase = want;
      b.eyeGlow = want >= 3;
      setState(b, "phase");
      setAnim(b, "roar");
      b.inv = 1.6;
      b.vx = 0;
      AudioFx.play("roar");
      shake(12);
      ring(b.x, b.y - 90, 220, "rgba(224,72,94,", 0.6, 10);
      showBanner("PHASE " + want, want === 2 ? "МОРЬТ ДАЙРАЛТ + АЯНГА" : "АЯНГАН ШУУРГА", want === 2 ? "Морины дайралтын чиглэлээс гар!" : "Газрын улаан тэмдгээс зайл!", 2.2, true);
      for (const pr of game.projectiles) pr.dead = true;
    }
  }

  function bossChoose(b) {
    const p = game.player;
    const adx = Math.abs(p.x - b.x);
    const opts = [];
    if (adx < 170) opts.push(["slash", 5]);
    else opts.push(["walk", 3]);
    if (adx > 260) opts.push(["charge", 2.5]);
    if (adx < 170) opts.push(["charge", 0.6]);
    if (b.phase >= 2) { opts.push(["axe", adx > 220 ? 3 : 1.2]); opts.push(["jumpslam", 2]); }
    if (b.phase >= 3) { opts.push(["meteor", b.lastAct === "meteor" ? 0.5 : 3]); opts.push(["wave", 2]); }
    const filtered = opts.filter(([n]) => n !== b.lastAct || n === "slash" || n === "walk");
    const total = filtered.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * total;
    for (const [n, w] of filtered) { r -= w; if (r <= 0) return n; }
    return filtered[0][0];
  }

  function updateBoss(b, dt) {
    const p = game.player, sp = bossSpeed(b);
    b.inv = Math.max(0, b.inv - dt);
    const dx = p.x - b.x, adx = Math.abs(dx);
    const arenaL = game.stage.lock + 40, arenaR = game.stage.lock + VIEW_W - 40;
    let noGrav = false;
    if (b.def.mounted && b.onGround && Math.abs(b.vx) > 45 && !["intro", "dead"].includes(b.state)) {
      b.hoofT = (b.hoofT || 0) - dt;
      if (b.hoofT <= 0) {
        AudioFx.play("hoof", b.state === "charge");
        b.hoofT = b.state === "charge" ? .14 : .28;
      }
    } else b.hoofT = 0;
    if (b.phase >= 3 && Math.random() < dt * 0.5) game.lightning = 0.25;
    switch (b.state) {
      case "intro": {
        if (b.def.mounted) {
          game.darken = .55;
          if (!b.introThunder && b.stateT > .45) {
            b.introThunder = true; game.lightning = .65;
            AudioFx.play("thunder"); AudioFx.play("neigh"); shake(14);
          }
        }
        if (b.stateT < 0.1) { b.vy = 200; }
        if (b.onGround && !b.landed) {
          b.landed = true;
          AudioFx.play("slam"); shake(16); dust(b.x, b.y, 20); ring(b.x, b.y - 10, 200, "rgba(255,214,107,", 0.5, 8);
          setAnim(b, "roar"); AudioFx.play("roar");
          b.introT = 0;
        }
        if (b.landed) {
          b.introT += dt;
          if (b.introT > (b.def.mounted ? 2.8 : 1.6)) {
            setState(b, "think"); b.thinkT = 0.6;
            game.bossShown = true;
            game.inputLock = false;
            AudioFx.music("boss");
          }
        }
        break;
      }
      case "think": {
        b.face = sign(dx);
        b.vx = approach(b.vx, 0, 1200 * dt);
        setAnim(b, "idle");
        b.thinkT -= dt * sp;
        if (b.thinkT <= 0 && p.state !== "dead") {
          const act = bossChoose(b);
          b.lastAct = act;
          setState(b, act);
          b.count = 0;
          if (b.def.mounted && ["charge", "axe", "jumpslam", "meteor", "wave"].includes(act) && Voice.say("tekaTaunt", game.t)) {
            if (Voice.bubble) Voice.bubble.speaker = b;
          }
          if (act === "charge") { b.chargeTo = clamp(p.x + sign(dx) * 150, arenaL, arenaR); AudioFx.play("warn"); }
          if (act === "jumpslam") { b.leapTo = clamp(p.x, arenaL + 30, arenaR - 30); }
        }
        break;
      }
      case "walk": {
        b.face = sign(dx);
        b.vx = approach(b.vx, b.face * b.def.speed * sp, 800 * dt);
        setAnim(b, "walk"); b.animRate = 0.9 * sp;
        if (adx < 150 || b.stateT > 1.6) { setState(b, adx < 170 ? "slash" : "think"); b.thinkT = 0.2; b.count = 0; }
        break;
      }
      case "slash": {
        const wd = 0.55 / sp, sd = 0.3;
        b.vx = approach(b.vx, 0, 1500 * dt);
        if (b.stateT < wd) { b.k = b.stateT / wd; setAnim(b, "windup"); b.face = sign(dx); }
        else {
          if (!b.struck) { AudioFx.play("swing", true); AudioFx.play("blade"); b.vx = b.face * 260; }
          setAnim(b, "strike"); b.k = (b.stateT - wd) / sd;
          if (!b.struck && overlap(enemyHitbox(b, 165, -120, -4), hurtbox(p))) hurtPlayer(b.def.dmg, b.x, { kb: 380, up: 300, src: b, heavy: true });
          b.struck = true;
          if (b.stateT >= wd + sd) {
            b.count++;
            if (b.phase >= 2 && b.count < 2) { b.stateT = wd * 0.4; b.struck = false; }
            else { setState(b, "recover"); b.recDur = 0.55; }
          }
        }
        break;
      }
      case "charge": {
        const tele = 0.75 / Math.sqrt(sp);
        if (b.stateT < tele) {
          b.k = b.stateT / tele; b.vx = 0; setAnim(b, "windup");
          b.face = sign(b.chargeTo - b.x) || b.face;
        } else {
          setAnim(b, "lunge");
          const dir = sign(b.chargeTo - b.x);
          b.vx = dir * 780 * Math.min(1.2, sp);
          if (!b.struck && Math.abs(p.x - b.x) < 60 && p.y > b.y - 160) { hurtPlayer(b.def.dmg + 2, b.x - dir * 50, { kb: 460, up: 340, src: b, heavy: true }); b.struck = true; }
          if ((dir > 0 && b.x >= b.chargeTo) || (dir < 0 && b.x <= b.chargeTo) || b.stateT > tele + 1.2) {
            b.vx = 0; dust(b.x, b.y, 10); AudioFx.play("land");
            setState(b, "recover"); b.recDur = 0.8;
          }
          if (Math.random() < 0.5) dust(b.x - dir * 30, b.y, 1);
        }
        break;
      }
      case "axe": {
        const each = 0.5 / sp, n = b.phase >= 3 ? 3 : 2;
        b.face = sign(dx); b.vx = 0;
        setAnim(b, "throw");
        const local = b.stateT - b.count * each;
        b.k = clamp(local / each, 0, 1);
        if (local >= each * 0.55 && !b.struck) {
          b.struck = true;
          const tt = rand(0.75, 0.95), tx = p.x + rand(-40, 40) + p.vx * 0.25;
          const sx = b.x + b.face * 30, sy = b.y - 150;
          game.projectiles.push({ type: "axe", x: sx, y: sy, vx: (tx - sx) / tt, vy: (p.y - 40 - sy - 0.5 * 1100 * tt * tt) / tt, grav: 1100, dmg: 14, life: 3, rot: 0 });
          AudioFx.play("swing", true);
        }
        if (local >= each) { b.count++; b.struck = false; if (b.count >= n) { setState(b, "recover"); b.recDur = 0.5; } }
        break;
      }
      case "jumpslam": {
        if (b.stateT < 0.35 / sp) { setAnim(b, "windup"); b.k = b.stateT / (0.35 / sp); b.vx = 0; }
        else if (!b.jumped) {
          b.jumped = true;
          const tt = 0.85;
          b.vx = (b.leapTo - b.x) / tt; b.vy = -0.5 * GRAVITY * tt; b.onGround = false;
          setAnim(b, "leap"); AudioFx.play("jump");
        } else {
          setAnim(b, "leap");
          if (b.onGround && b.stateT > 0.5) {
            b.vx = 0; b.jumped = false;
            AudioFx.play("slam"); shake(16); dust(b.x, b.y, 18);
            ring(b.x, b.y - 10, 180, "rgba(224,72,94,", 0.45, 8);
            if (Math.abs(p.x - b.x) < 110 && p.y > b.y - 60) hurtPlayer(20, b.x, { kb: 420, up: 360, unblockable: true });
            for (const dir of [-1, 1]) game.hazards.push({ type: "wave", x: b.x + dir * 60, y: GROUND_Y, dir, speed: 430, life: 1.3, max: 1.3, h: 38, dmg: 14, col: "224,72,94" });
            setState(b, "recover"); b.recDur = 0.75;
          }
        }
        break;
      }
      case "meteor": {
        b.vx = 0; setAnim(b, "cast");
        if (!b.struck) { b.struck = true; AudioFx.play("roar"); game.lightning = 0.4; }
        const n = 7;
        const due = Math.floor(b.stateT / 0.2);
        while (b.count < Math.min(n, due)) {
          const tx = b.count === 0 ? p.x : clamp(p.x + rand(-260, 260), arenaL, arenaR);
          game.hazards.push({ type: "meteor", x: tx, t: 0, warn: 1.05, fallen: false, r: 62, dmg: 18 });
          b.count++;
        }
        if (b.stateT > 1.6) { setState(b, "recover"); b.recDur = 0.6; }
        break;
      }
      case "wave": {
        const wd = 0.55 / sp;
        b.vx = 0;
        if (b.stateT < wd) { setAnim(b, "windup"); b.k = b.stateT / wd; }
        else if (!b.struck) {
          b.struck = true; setAnim(b, "strike"); b.k = 1;
          AudioFx.play("slam"); shake(12);
          for (const dir of [-1, 1]) {
            game.hazards.push({ type: "wave", x: b.x + dir * 50, y: GROUND_Y, dir, speed: 380, life: 1.5, max: 1.5, h: 38, dmg: 14, col: "224,72,94" });
            later(0.45, () => { if (b.state !== "dead") game.hazards.push({ type: "wave", x: b.x + dir * 50, y: GROUND_Y, dir, speed: 540, life: 1.2, max: 1.2, h: 30, dmg: 12, col: "255,150,90" }); });
          }
        }
        if (b.stateT > wd + 0.6) { setState(b, "recover"); b.recDur = 0.5; }
        break;
      }
      case "recover": {
        b.vx = approach(b.vx, 0, 1500 * dt);
        setAnim(b, "idle");
        if (b.stateT >= (b.recDur || 0.5) / Math.sqrt(sp)) { setState(b, "think"); b.thinkT = rand(0.5, 0.9); }
        break;
      }
      case "stun": {
        b.vx = approach(b.vx, 0, 1500 * dt); setAnim(b, "stun");
        if (b.stateT >= b.stunDur) { setState(b, "think"); b.thinkT = 0.3; }
        break;
      }
      case "phase": {
        b.vx = 0; setAnim(b, "roar");
        if (Math.random() < 0.3) sparks(b.x + rand(-30, 30), b.y - rand(40, 200), 1, "#FF7B6B", 200);
        if (b.stateT > 1.5) { setState(b, "think"); b.thinkT = 0.3; }
        break;
      }
    }
    physics(b, dt, { noGrav });
    if (b.state !== "intro") { b.x = clamp(b.x, arenaL, arenaR); }
  }

  function bossDefeated(b) {
    if (b.def.miniBoss) {
      game.inputLock = true;
      game.bossShown = false;
      game.hazards.length = 0;
      for (const pr of game.projectiles) pr.dead = true;
      AudioFx.music(null); AudioFx.play("boom"); shake(12);
      showBanner("АНХАА ЯЛАГДЛАА", "ГЭХДЭЭ ТУЛААН ДУУСААГҮЙ", "Морьт ТЭКА ойртож байна…", 2.1, true);
      later(1.9, () => {
        const p = game.player;
        p.weaponUpgrade = true;
        p.style = Object.assign({}, STYLES.player, { weapon: "glaive" });
        AudioFx.play("pickup", "power");
        ring(p.x,p.y-55,100,"rgba(255,214,107,",.7,6);
        floatText(p.x,p.y-p.h-40,"АНХААГИЙН ЗЭВСЭГ · +20% DMG","#FFD66B",18,{life:2});
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + 30);
        game.player.en = Math.min(game.player.maxEn, game.player.en + 25);
        stageClear();
      });
      return;
    }
    game.inputLock = true;
    game.slowT = 2.2;
    AudioFx.music(null);
    AudioFx.play("boom");
    shake(20);
    game.flashWhite = 0.8;
    Voice.say("bossDefeat", game.t, true);
    for (let i = 0; i < 6; i++) later(0.15 * i, () => {
      AudioFx.play("boom");
      sparks(b.x + rand(-50, 50), b.y - rand(30, 200), 24, i % 2 ? "#FFD66B" : "#FF7B6B", 600);
      ring(b.x + rand(-30, 30), b.y - rand(40, 160), rand(60, 140), "rgba(255,214,107,", 0.5, 6);
    });
    game.hazards.length = 0;
    for (const pr of game.projectiles) pr.dead = true;
    later(1.2, () => {
      const st = game.stage;
      addScore(st.def.clearBonus, game.player.x, game.player.y - 140, "FINAL");
      showBanner("МОРЬТ ТЭКА ЯЛАГДЛАА", "VICTORY", "Уулын оргил чинийх боллоо!", 2.2);
    });
    later(3.4, () => endGame(true));
  }

  /* ======================================================================
     PROJECTILES / HAZARDS / ITEMS
     ====================================================================== */
  function updateProjectiles(dt) {
    const p = game.player, hb = hurtbox(p);
    for (const pr of game.projectiles) {
      if (pr.dead) continue;
      pr.life -= dt;
      pr.vy += (pr.grav || 0) * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      if (pr.type === "axe") pr.rot = (pr.rot || 0) + dt * 16 * sign(pr.vx);
      if (pr.life <= 0 || pr.x < game.camX - 80 || pr.x > game.camX + VIEW_W + 80) { pr.dead = true; continue; }
      if (pr.y >= GROUND_Y - 2) { pr.dead = true; dust(pr.x, GROUND_Y, 4); if (pr.type === "axe") { AudioFx.play("land"); sparks(pr.x, GROUND_Y - 4, 6, "#DDE3EE", 240); } continue; }
      if (pr.friendly) {
        for (const e of game.enemies) {
          if (e.state === "dead" || e.removed) continue;
          const b = hurtbox(e);
          if (pr.x > b.x0 && pr.x < b.x1 && pr.y > b.y0 && pr.y < b.y1) { damageEnemy(e, pr.dmg, { skill: true, kb: 240, dir: sign(pr.vx), noStop: true }); pr.dead = true; break; }
        }
        continue;
      }
      if (pr.x > hb.x0 - 4 && pr.x < hb.x1 + 4 && pr.y > hb.y0 && pr.y < hb.y1) {
        const r = hurtPlayer(pr.dmg, pr.x - pr.vx * 0.1, { kb: 220, up: 200, heavy: pr.type === "axe" });
        if (r === "parry") {
          // буцааж ойлгоно — дайсанд 3 дахин их хохирол
          pr.friendly = true; pr.vx = -sign(pr.vx) * Math.max(620, Math.abs(pr.vx) * 1.2); pr.vy = 0; pr.grav = 0;
          pr.dmg = pr.dmg * 3; pr.life = 2; pr.x = p.x + p.face * 36;
        } else if (r) pr.dead = true;
      }
    }
    game.projectiles = game.projectiles.filter((pr) => !pr.dead);
  }

  function updateHazards(dt) {
    const p = game.player;
    for (const h of game.hazards) {
      if (h.dead) continue;
      if (h.type === "wave") {
        h.life -= dt;
        h.x += h.dir * h.speed * dt;
        if (Math.random() < 0.5) particle({ x: h.x, y: GROUND_Y - 4, vx: -h.dir * rand(20, 80), vy: rand(-140, -40), life: 0.35, size: rand(3, 6), color: "rgba(" + h.col + ",", type: "smoke", drag: 2 });
        if (!h.hit && Math.abs(p.x - h.x) < 24 && p.y > GROUND_Y - h.h) { if (hurtPlayer(h.dmg, h.x - h.dir * 30, { kb: 260, up: 300, unblockable: true })) h.hit = true; }
        if (h.life <= 0) h.dead = true;
      } else if (h.type === "meteor") {
        h.t += dt;
        if (!h.fallen && h.t >= h.warn) {
          h.fallen = true; h.t2 = 0;
          AudioFx.play("boom"); shake(9);
          dust(h.x, GROUND_Y, 12, "rgba(255,170,120,");
          sparks(h.x, GROUND_Y - 10, 16, "#FFB070", 500);
          ring(h.x, GROUND_Y - 6, h.r * 1.3, "rgba(255,120,80,", 0.4, 7);
          if (Math.abs(p.x - h.x) < h.r && p.y > GROUND_Y - 110) hurtPlayer(h.dmg, h.x, { kb: 300, up: 380, unblockable: true });
        }
        if (h.fallen) { h.t2 += dt; if (h.t2 > 0.5) h.dead = true; }
        if (!h.fallen && h.t > h.warn - 0.3 && !h.sound) { h.sound = true; AudioFx.play("meteor"); }
      }
    }
    game.hazards = game.hazards.filter((h) => !h.dead);
  }

  const ITEM_INFO = {
    hp:    { label: "+20 HP",     color: "#FF6B7D", glow: "255,107,125" },
    en:    { label: "+20 ENERGY", color: "#6FD0FF", glow: "63,182,255" },
    star:  { label: "+150",       color: "#FFD66B", glow: "255,214,107" },
    power: { label: "POWER BOOST!", color: "#FF9A4A", glow: "255,140,40" }
  };

  function updateItems(dt) {
    const p = game.player;
    for (const it of game.items) {
      it.t += dt; it.life -= dt;
      if (!it.onGround) {
        it.vy += GRAVITY * 0.8 * dt;
        it.x += it.vx * dt; it.y += it.vy * dt;
        const gy = (() => { for (const pl of game.stage.def.platforms || []) if (it.x > pl.x && it.x < pl.x + pl.w && it.y - it.vy * dt <= pl.y + 1 && it.y >= pl.y) return pl.y; return GROUND_Y; })();
        if (it.y >= gy - 14) {
          it.y = gy - 14;
          if (Math.abs(it.vy) > 120) { it.vy *= -0.4; it.vx *= 0.6; } else { it.vy = 0; it.vx = 0; it.onGround = true; }
        }
        it.x = clamp(it.x, game.camX + 24, game.camX + VIEW_W - 24);
      }
      if (it.life <= 0) { it.dead = true; continue; }
      if (p.state !== "dead" && Math.abs(p.x - it.x) < 34 && it.y > p.y - p.h - 10 && it.y < p.y + 24 && it.t > 0.25) {
        it.dead = true;
        collectItem(p, it);
      }
    }
    game.items = game.items.filter((it) => !it.dead);
  }

  function collectItem(p, it) {
    const info = ITEM_INFO[it.type];
    AudioFx.play("pickup", it.type);
    ring(it.x, it.y, 46, "rgba(" + info.glow + ",", 0.4, 4);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      particle({ x: it.x, y: it.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160 - 60, life: 0.45, size: 3, color: info.color, type: "spark", drag: 4 });
    }
    if (it.type === "hp") {
      const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + 20);
      floatText(p.x, p.y - p.h - 16, before >= p.maxHp ? "HP MAX" : "+" + Math.round(p.hp - before) + " HP", info.color, 18);
    } else if (it.type === "en") {
      const before = p.en; p.en = Math.min(p.maxEn, p.en + 20);
      floatText(p.x, p.y - p.h - 16, before >= p.maxEn ? "ENERGY MAX" : "+" + Math.round(p.en - before) + " ENERGY", info.color, 17);
    } else if (it.type === "star") {
      addScore(150, p.x, p.y - p.h - 16, "⭐");
    } else if (it.type === "power") {
      p.boost = 8;
      floatText(p.x, p.y - p.h - 16, "🔥 POWER BOOST ×1.6", info.color, 18, { life: 1.3 });
      toast("🔥 POWER BOOST · 8 сек", true);
    }
  }

  function updateParticles(dt) {
    for (const q of game.particles) {
      q.life -= dt;
      q.vy += q.grav * dt;
      if (q.drag) { const f = Math.max(0, 1 - q.drag * dt); q.vx *= f; q.vy *= f; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.grav && !Iso.active && q.y > GROUND_Y) { q.y = GROUND_Y; q.vy *= -0.3; q.vx *= 0.7; }
    }
    game.particles = game.particles.filter((q) => q.life > 0);
    for (const tx of game.texts) { tx.life -= dt; tx.y += tx.vy * dt; tx.vy *= 1 - 2 * dt; tx.pop += dt; }
    game.texts = game.texts.filter((tx) => tx.life > 0);
    for (const g of game.ghosts) g.life -= dt;
    game.ghosts = game.ghosts.filter((g) => g.life > 0);
    for (const d of game.decals) d.life -= dt;
    game.decals = game.decals.filter((d) => d.life > 0);
  }

  function updateBolts(dt) {
    for (const b of game.bolts) {
      b.t += dt;
      if (b.t >= 0 && !b.hit) {
        b.hit = true;
        AudioFx.play("thunder");
        shake(10);
        game.flashWhite = Math.max(game.flashWhite, 0.45);
        if (b.target) { b.x = b.target.x; damageEnemy(b.target, b.target.def.boss ? 170 : 115, { heavy: true, skill: true, kb: 300, up: 420, ult: true, noStop: true }); }
        sparks(b.x, GROUND_Y - 20, 20, "#CFE8FF", 600);
        ring(b.x, GROUND_Y - 10, 90, "rgba(180,220,255,", 0.4, 6);
        dust(b.x, GROUND_Y, 8, "rgba(180,200,255,");
      }
    }
    game.bolts = game.bolts.filter((b) => b.t < 0.35);
  }

  /* ======================================================================
     STAGE FLOW
     ====================================================================== */
  function loadStage(i) {
    const def = STAGES[i];
    game.stageIdx = i;
    game.stage = { def, waveIdx: 0, lock: null, queue: [], goHint: 1, cleared: false, bossTriggered: false };
    game.enemies = []; game.projectiles = []; game.hazards = []; game.items = []; game.bolts = []; game.ghosts = []; game.decals = [];game.particles=[];game.texts=[];
    game.boss = null; game.bossShown = false;
    const p = game.player;
    Object.assign(p, { x: 110, y: GROUND_Y, vx: 0, vy: 0, face: 1, inv: 0.5 });
    setState(p, "free"); setAnim(p, "idle");
    game.camX = 0; game.camMin = 0;
    game.inputLock = false;
    game.darken = 0;
    AudioFx.music(def.music);
    showBanner("STAGE " + def.id, def.title, def.sub, 2.4);
  }

  function nextWaveAt() {
    const st = game.stage, def = st.def;
    if (def.waves && st.waveIdx < def.waves.length) return def.waves[st.waveIdx].at;
    if (def.boss && !st.bossTriggered) return def.boss.at;
    return Infinity;
  }

  function updateStage(dt) {
    const st = game.stage, def = st.def, p = game.player;
    const camTarget = p.x - VIEW_W * 0.42 + p.face * 30;
    if (st.lock == null && !st.cleared) {
      const at = nextWaveAt();
      if (camTarget >= at - 1 && at !== Infinity) {
        st.lock = Math.min(at, def.width - VIEW_W);
        st.goHint = 0;
        if (def.waves) {
          const wave = def.waves[st.waveIdx];
          st.queue = wave.list.map(([type, side], i) => ({ type, side, t: 0.25 + i * 0.55 }));
        } else if (def.boss) {
          st.bossTriggered = true;
          spawnBoss(def.boss.type);
        }
      }
    }
    if (st.lock != null && def.waves) {
      for (const q of st.queue) {
        q.t -= dt;
        if (q.t <= 0 && !q.done) {
          q.done = true;
          const x = q.side === "R" ? st.lock + VIEW_W + 50 : st.lock - 50;
          const e = makeEnemy(q.type, x);
          e.face = q.side === "R" ? -1 : 1;
          game.enemies.push(e);
        }
      }
      const alive = game.enemies.some((e) => e.state !== "dead");
      if (!alive && st.queue.every((q) => q.done)) {
        st.queue = [];
        game.camMin = st.lock;
        st.lock = null;
        st.waveIdx++;
        waveClear();
      }
    }
    if (def.waves && st.waveIdx >= def.waves.length && st.lock == null && !st.cleared && p.x > def.width - 120) stageClear();
    if (st.goHint > 0 && st.lock == null) st.goHint += dt;
  }

  function waveClear() {
    const st = game.stage, p = game.player;
    st.goHint = 0.01;
    if (Math.random() < 0.6) spawnItem(p.hp < p.maxHp * 0.7 ? "hp" : "en", game.camX + VIEW_W * 0.55, GROUND_Y - 160);
    const last = st.waveIdx >= st.def.waves.length;
    toast(last ? "WAVE CLEAR · GO →" : `WAVE ${st.waveIdx}/${st.def.waves.length} CLEAR`, true);
    AudioFx.play("pickup", "star");
  }

  function stageClear() {
    const st = game.stage, p = game.player;
    st.cleared = true;
    game.inputLock = true;
    const bonus = st.def.clearBonus;
    addScore(bonus, p.x, p.y - p.h - 40, "STAGE");
    const heal = Math.min(st.def.healBonus ?? 25, p.maxHp - p.hp);
    p.hp += heal;
    AudioFx.play("stageClear");
    showBanner("STAGE " + st.def.id + " CLEAR", "STAGE CLEAR!", `+${bonus} bonus${heal > 0 ? " · +" + Math.round(heal) + " HP" : ""}`, 2.2);
    later(2.4, () => { game.fadeTo = 1; });
    later(3.0, () => { if (game.mode === "play") { loadStage(game.stageIdx + 1); game.fadeTo = 0; } });
  }

  function updateCamera(dt) {
    const p = game.player, st = game.stage;
    const lookAhead = clamp(p.vx * .18, -65, 65);
    let target = p.x - VIEW_W * 0.42 + p.face * 22 + lookAhead;
    target = Math.min(target, nextWaveAt());
    target = clamp(target, game.camMin, st.def.width - VIEW_W);
    if (st.lock != null) target = st.lock;
    game.camX += (target - game.camX) * (1 - Math.exp(-dt * 6));
    if (Math.abs(target - game.camX) < 0.3) game.camX = target;
  }

  /* ======================================================================
     GAME FLOW
     ====================================================================== */
  function startGame() {
    AudioFx.ensure();
    Voice.init();
    hideAllScreens();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    game.mode = "play";
    game.t = 0; game.runTime = 0;
    game.score = 0; game.combo = 0; game.comboT = 0; game.maxCombo = 0; game.kills = 0; game.skillsUsed = 0; game.parries = 0;
    game.player = makePlayer();
    game.particles = []; game.texts = []; game.timers = [];
    game.slowT = 0; game.timeScale = 1; game.hitstop = 0; game.shake = 0;
    game.flashWhite = 0; game.hurtFlash = 0; game.fade = 1; game.fadeTo = 0; game.lightning = 0;
    game.run = { id: Date.now(), saveState: "idle", finalScore: 0 };
    game.saved = null;
    input.clear();
    loadStage(TEST_MODE && testStartStage ? testStartStage : 0);
    ui.hud.hidden = false;
    ui.skillbar.hidden = false;
    ui.touch.hidden = false;
    Voice.bubble = null;
    for (const k in hudCache) delete hudCache[k];
  }

  function endGame(victory) {
    if (game.mode !== "play") return;
    game.mode = victory ? "victory" : "gameover";
    game.inputLock = true;
    const final = clamp(Math.floor(game.score), 0, MAX_SCORE);
    game.run.finalScore = final;
    if (victory) AudioFx.play("victory");
    AudioFx.music(victory ? "calm" : null);
    ui.endCard.classList.toggle("is-over", !victory);
    ui.endKicker.textContent = victory ? "🏆 VICTORY" : "GAME OVER";
    ui.endTitle.textContent = victory ? "Тоглоом дууслаа!" : "Дахиад нэг оролдоё!";
    ui.stKills.textContent = String(game.kills);
    ui.stTime.textContent = fmtTime(game.runTime);
    ui.stSkills.textContent = String(game.skillsUsed);
    ui.stCombo.textContent = game.maxCombo ? "x" + game.maxCombo : "—";
    ui.saveBtn.disabled = final <= 0;
    ui.saveBtn.textContent = "SAVE SCORE · " + game.name;
    ui.saveStatus.className = "save-status";
    ui.saveStatus.textContent = final > 0 ? "Оноогоо TOP 10-д илгээх үү?" : "0 оноо хадгалагдахгүй.";
    $("again-btn").textContent = victory ? "PLAY AGAIN" : "RESTART";
    ui.hud.hidden = true;
    ui.skillbar.hidden = true;
    ui.touch.hidden = true;
    ui.goArrow.hidden = true;
    hideBanner();
    ui.screens.end.hidden = false;
    countUp(ui.endScore, final, 900);
    setTimeout(() => { if (!document.body.classList.contains("is-touch")) ui.saveBtn.focus({ preventScroll: true }); }, 50);
  }

  function fmtTime(s) { s = Math.floor(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  function countUp(el, to, ms) {
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function pauseGame() {
    if (game.mode !== "play") return;
    game.mode = "paused";
    input.clear();
    ui.screens.pause.hidden = false;
    if (AudioFx.ctx && AudioFx.ctx.state === "running") AudioFx.ctx.suspend().catch(() => {});
  }
  function resumeGame() {
    if (game.mode !== "paused") return;
    for (const k of ["settings", "help", "board"]) closeModal(k);
    ui.screens.pause.hidden = true;
    game.mode = "play";
    input.clear();
    if (AudioFx.ctx) AudioFx.ctx.resume().catch(() => {});
  }
  function toMenu() {
    for (const k of Object.keys(ui.screens)) ui.screens[k].hidden = true;
    modalStack.length = 0;
    game.mode = "menu";
    game.stage = null;
    game.boss = null;
    ui.hud.hidden = true; ui.skillbar.hidden = true; ui.touch.hidden = true; ui.goArrow.hidden = true;
    hideBanner();
    ui.screens.start.hidden = false;
    if (AudioFx.ctx) AudioFx.ctx.resume().catch(() => {});
    AudioFx.music(null);
    initMenuScene();
  }
  function hideAllScreens() { for (const k of Object.keys(ui.screens)) ui.screens[k].hidden = true; modalStack.length = 0; }

  $("pause-btn").addEventListener("click", () => pauseGame());
  $("resume-btn").addEventListener("click", () => resumeGame());
  $("quit-btn").addEventListener("click", () => toMenu());
  $("again-btn").addEventListener("click", () => startGame());
  $("menu-btn").addEventListener("click", () => toMenu());

  ui.nameInput.value = store.get(NAME_KEY, "") || "";
  ui.nameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = normalizeName(ui.nameInput.value);
    const err = validateName(name);
    ui.nameInput.setAttribute("aria-invalid", err ? "true" : "false");
    ui.nameError.hidden = !err;
    ui.nameError.textContent = err;
    if (err) { ui.nameInput.focus(); return; }
    ui.nameInput.value = name;
    game.name = name;
    store.set(NAME_KEY, name);
    startGame();
  });
  ui.nameInput.addEventListener("input", () => { ui.nameError.hidden = true; ui.nameInput.removeAttribute("aria-invalid"); });

  /* ======================================================================
     RENDER
     ====================================================================== */
  const GHOST_STYLE = (() => {
    const g = Object.assign({}, STYLES.player);
    for (const k in g) if (typeof g[k] === "string" && g[k][0] === "#") g[k] = "#8FD0FF";
    return g;
  })();
  const menu = { player: null, stage: { def: STAGES[0] } };

  function drawShadow(e, camX) {
    const gy = supportY(e);
    const hgt = Math.max(0, gy - e.y);
    const k = clamp(1 - hgt / 220, 0.3, 1);
    const x = e.x - camX, alpha = (e.alpha ?? 1) * k;
    const key = game.stage ? game.stage.def.key : "steppe";
    const direction = key === "ger" ? 1 : -1;
    ctx.save(); ctx.translate(x, gy);
    ctx.scale(1, .24);
    const radius = 31 * e.scale * (e.style.bulk || 1);
    const contact = ctx.createRadialGradient(0, 0, 1, 0, 0, radius);
    contact.addColorStop(0, `rgba(12,17,22,${.45 * alpha})`);
    contact.addColorStop(.45, `rgba(12,17,22,${.21 * alpha})`); contact.addColorStop(1, "rgba(12,17,22,0)");
    ctx.fillStyle = contact; ctx.fillRect(-radius,-radius,radius*2,radius*2); ctx.restore();
    ctx.save();ctx.translate(x,gy);ctx.rotate(direction * .08);
    const cast=ctx.createLinearGradient(0,0,direction*90,0);
    cast.addColorStop(0,`rgba(16,23,28,${.2*alpha})`);cast.addColorStop(1,"rgba(16,23,28,0)");
    ctx.fillStyle=cast;ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(direction*95,-7);
    ctx.lineTo(direction*100,3);ctx.lineTo(12,3);ctx.fill();ctx.restore();
  }

  function drawWarhorse(e, camX) {
    const moving = Math.min(1, Math.abs(e.vx) / 130);
    const gait = (e.gaitDistance || 0) * .065;
    const bob = Math.sin(gait * 2) * 3 * moving;
    ctx.save(); ctx.translate(e.x - camX, e.y); ctx.scale(e.face, 1);
    const coat = ctx.createLinearGradient(0, -110, 0, -20);
    coat.addColorStop(0, "#778394"); coat.addColorStop(.45, "#384554"); coat.addColorStop(1, "#18212d");
    ctx.strokeStyle = "#263240"; ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const x = i < 2 ? -39 : 35, ph = gait + i * Math.PI / 2;
      const knee = x + Math.sin(ph) * 17 * moving;
      const hoof = x + Math.sin(ph + .65) * 26 * moving;
      ctx.lineWidth = i % 2 ? 9 : 7;
      ctx.beginPath(); ctx.moveTo(x, -50 + bob); ctx.lineTo(knee, -25); ctx.lineTo(hoof, -3 - Math.max(0, Math.cos(ph)) * 13 * moving); ctx.stroke();
      ctx.strokeStyle = "#c7b98d"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(hoof - 4, -2); ctx.lineTo(hoof + 6, -2); ctx.stroke(); ctx.strokeStyle = "#263240";
    }
    ctx.fillStyle = coat; ctx.beginPath(); ctx.ellipse(-2, -70 + bob, 57, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(25,-78+bob); ctx.quadraticCurveTo(29,-125,55,-126+bob); ctx.lineTo(75,-113+bob); ctx.lineTo(70,-97+bob); ctx.lineTo(48,-92+bob); ctx.lineTo(42,-57+bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#b8c9d5"; ctx.beginPath(); ctx.moveTo(45,-126+bob); ctx.lineTo(43,-144+bob); ctx.lineTo(54,-129+bob); ctx.fill();
    ctx.fillStyle = "#142d46"; ctx.beginPath(); ctx.moveTo(-30,-88+bob); ctx.lineTo(19,-90+bob); ctx.lineTo(35,-49+bob); ctx.lineTo(-35,-49+bob); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#d9b66f"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#593326"; ctx.fillRect(-18,-97+bob,37,10);
    ctx.strokeStyle = "#b7c8d8"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(27,-81+bob); ctx.lineTo(38,-118+bob); ctx.lineTo(63,-118+bob); ctx.stroke();
    ctx.strokeStyle = "#101a26"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(-55,-79+bob); ctx.quadraticCurveTo(-86,-65,-77,-29+Math.sin(game.t*7)*8); ctx.stroke();
    ctx.strokeStyle = "#c9b277"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(69,-108+bob); ctx.quadraticCurveTo(31,-97,-4,-119+bob); ctx.stroke();
    ctx.fillStyle = "#73dcff"; ctx.beginPath(); ctx.arc(58,-116+bob,2,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawSkillAura(p, camX) {
    if (!settings.detail) return;
    if (!["dash", "power", "ult"].includes(p.state)) return;
    const x = p.x - camX, y = p.y - 48;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const color = p.state === "power" ? "255,180,60" : "80,185,255";
    const radius = p.state === "ult" ? 110 : 62;
    const glow = ctx.createRadialGradient(x,y,2,x,y,radius);
    glow.addColorStop(0,`rgba(${color},.28)`); glow.addColorStop(1,`rgba(${color},0)`);
    ctx.fillStyle=glow; ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
    if (p.state === "dash") {
      for(let i=0;i<5;i++) {
        ctx.strokeStyle=`rgba(100,210,255,${.55-i*.08})`;ctx.lineWidth=3-i*.4;
        ctx.beginPath();ctx.moveTo(x-p.face*(20+i*12),y-22+i*11);ctx.lineTo(x-p.face*(100+i*18),y-22+i*11);ctx.stroke();
      }
      for (let i=0;i<3;i++) {
        const off=i*18, rr=34+i*9;
        ctx.strokeStyle=`rgba(190,240,255,${.55-i*.13})`;ctx.lineWidth=5-i;
        ctx.beginPath();ctx.arc(x-p.face*(34+off),y+8,rr,-1.15,1.15);ctx.stroke();
      }
    } else {
      ctx.translate(x,p.y-3);ctx.scale(1,.28);
      ctx.strokeStyle=`rgba(${color},.8)`;ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,38+p.k*65,game.t*3,game.t*3+Math.PI*1.65);ctx.stroke();
      ctx.beginPath();ctx.arc(0,0,30+p.k*45,-game.t*4,-game.t*4+Math.PI*1.5);ctx.stroke();
      ctx.strokeStyle=`rgba(${color},.48)`;ctx.lineWidth=1.5;
      const rr=52+p.k*44;
      for(let i=0;i<8;i++){
        const a=game.t*(p.state==="ult"?1.8:.8)+i*Math.PI/4;
        const r0=rr+(i%2?0:8),r1=r0+14;
        ctx.beginPath();ctx.moveTo(Math.cos(a)*r0,Math.sin(a)*r0);ctx.lineTo(Math.cos(a)*r1,Math.sin(a)*r1);ctx.stroke();
      }
      if (p.state === "ult") {
        ctx.strokeStyle="rgba(225,240,255,.85)";ctx.lineWidth=2;
        for(let i=0;i<3;i++){
          const a=game.t*2.4+i*Math.PI*2/3;
          ctx.beginPath();ctx.moveTo(Math.cos(a)*28,Math.sin(a)*28);ctx.lineTo(Math.cos(a+.35)*58,Math.sin(a+.35)*58);ctx.lineTo(Math.cos(a+.15)*84,Math.sin(a+.15)*84);ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function drawEntity(e, camX) {
    if (e.x < camX - 160 || e.x > camX + VIEW_W + 160) return;
    drawShadow(e, camX);
    ctx.globalAlpha = e.alpha ?? 1;
    if (e.def && e.def.boss && e.phase >= 2 && e.state !== "dead") {
      const r = 110 + Math.sin(game.t * 6) * 8;
      const gr = ctx.createRadialGradient(e.x - camX, e.y - 100, 10, e.x - camX, e.y - 100, r);
      gr.addColorStop(0, e.phase >= 3 ? "rgba(255,80,80,.35)" : "rgba(255,160,90,.22)");
      gr.addColorStop(1, "rgba(255,80,80,0)");
      ctx.fillStyle = gr; ctx.fillRect(e.x - camX - r, e.y - 100 - r, r * 2, r * 2);
    }
    if (e.kind === "player" && e.state === "ult") {
      const r = 70 + Math.sin(game.t * 20) * 6;
      const gr = ctx.createRadialGradient(e.x - camX, e.y - 90, 5, e.x - camX, e.y - 90, r);
      gr.addColorStop(0, "rgba(200,230,255,.6)"); gr.addColorStop(1, "rgba(120,180,255,0)");
      ctx.fillStyle = gr; ctx.fillRect(e.x - camX - r, e.y - 90 - r, r * 2, r * 2);
    }
    if (e.kind === "player" && e.inv > 0 && e.state !== "dash" && e.state !== "ult" && e.state !== "dead" && Math.floor(game.t * 20) % 2) ctx.globalAlpha *= 0.45;
    if (e.def && e.def.mounted) {
      drawWarhorse(e, camX);
      const rider = Object.assign({}, e, { y: e.y - 45, scale: e.scale * 0.85 });
      drawFigure(rider, camX);
    } else drawFigure(e, camX);
    ctx.globalAlpha = 1;
  }

  function drawSlash(p, camX) {
    let a0, a1, R = 60, show, alpha;
    if (p.state === "attack") {
      const A = ATK[p.atkStep], k = p.stateT;
      show = k >= A.a0 - 0.03 && k <= A.a1 + 0.1;
      alpha = k <= A.a1 ? 1 : 1 - (k - A.a1) / 0.1;
      if (p.atkStep === 2) {
        if (!show) return;
        const x = p.x - camX + p.face * 20, y = p.y - 60;
        const len = 120 * clamp((k - A.a0 + 0.03) / 0.08, 0, 1);
        const gr = ctx.createLinearGradient(x, y, x + p.face * len, y);
        gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.7, `rgba(255,240,190,${0.9 * alpha})`); gr.addColorStop(1, `rgba(255,255,255,${alpha})`);
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + p.face * len, y - 12); ctx.lineTo(x + p.face * (len + 18), y); ctx.lineTo(x + p.face * len, y + 12); ctx.lineTo(x, y + 3); ctx.fill();
        return;
      }
      const prog = clamp((k - A.a0 + 0.03) / (A.a1 - A.a0 + 0.03), 0, 1);
      if (p.atkStep === 0) { a0 = 3.1; a1 = lerp(3.1, 0.55, easeOut(prog)); }
      else { a0 = -0.55; a1 = lerp(-0.55, 2.75, easeOut(prog)); }
    } else if (p.state === "airatk") {
      const k = p.stateT;
      show = k >= AIRATK.a0 - 0.02 && k <= AIRATK.a1 + 0.08;
      alpha = k <= AIRATK.a1 ? 1 : 1 - (k - AIRATK.a1) / 0.08;
      a0 = 2.9; a1 = lerp(2.9, 0.1, easeOut(clamp((k - AIRATK.a0) / (AIRATK.a1 - AIRATK.a0), 0, 1)));
      R = 66;
    } else return;
    if (!show || alpha <= 0) return;
    const cx = p.x - camX + p.face * 4, cy = p.y - 70;
    const th0 = Math.PI / 2 - p.face * a0, th1 = Math.PI / 2 - p.face * a1;
    const ccw = th1 < th0;
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(255,255,255,${0.28 * alpha})`; ctx.lineWidth = 18;
    ctx.beginPath(); ctx.arc(cx, cy, R - 4, th0, th1, ccw); ctx.stroke();
    ctx.strokeStyle = p.boost > 0 ? `rgba(255,150,60,${0.95 * alpha})` : `rgba(255,236,170,${0.95 * alpha})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, R + 4, th0, th1, ccw); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R + 7, th0, th1, ccw); ctx.stroke();
  }

  function drawEnemyUi(e, camX) {
    if (e.state === "dead" || e.def.boss || e.state === "enter" && !e.entered && (e.x < camX || e.x > camX + VIEW_W)) return;
    const x = e.x - camX, top = e.y - 112 * e.scale;
    ctx.font = "700 10px Unbounded, Golos Text, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.7)";
    ctx.strokeText(e.def.name, x, top - 6);
    ctx.fillStyle = e.type === "erhmee" ? "#FFB3A0" : e.type === "teka" ? "#D9BDFF" : e.type === "ganaa" ? "#A8F0C6" : "#F3E3C8";
    ctx.fillText(e.def.name, x, top - 6);
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(x - 22, top - 4, 44, 5);
      ctx.fillStyle = "#EE4D63"; ctx.fillRect(x - 21, top - 3, 42 * Math.max(0, e.hp / e.maxHp), 3);
    }
    if (e.state === "windup") {
      const blink = Math.floor(game.t * 14) % 2;
      const big = e.def.armor || e.lunging;
      ctx.fillStyle = blink ? "#FF3B4E" : "#FFD66B";
      ctx.beginPath(); ctx.arc(x, top - 30, big ? 11 : 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = `800 ${big ? 15 : 12}px Unbounded, sans-serif`; ctx.textBaseline = "middle";
      ctx.fillText("!", x, top - 29);
      if (e.def.slam && !e.lunging) {
        ctx.fillStyle = `rgba(255,60,80,${0.18 + 0.12 * blink})`;
        const x0 = x + e.face * 10, x1 = x + e.face * (e.def.range + 30);
        ctx.fillRect(Math.min(x0, x1), GROUND_Y - 8, Math.abs(x1 - x0), 10);
      }
    }
  }

  function drawBossTelegraphs(b, camX) {
    if (!b || b.state === "dead") return;
    const blink = Math.floor(game.t * 12) % 2;
    if (b.state === "charge" && b.anim === "windup") {
      const x0 = b.x - camX, x1 = b.chargeTo - camX;
      ctx.fillStyle = `rgba(255,40,60,${0.16 + blink * 0.1})`;
      ctx.fillRect(Math.min(x0, x1), GROUND_Y - 160, Math.abs(x1 - x0), 160);
      ctx.fillStyle = `rgba(255,80,90,${0.6 + blink * 0.3})`;
      const dir = sign(x1 - x0);
      for (let i = 1; i < 5; i++) {
        const cx = x0 + (x1 - x0) * i / 5;
        ctx.beginPath(); ctx.moveTo(cx - dir * 10, GROUND_Y - 100); ctx.lineTo(cx + dir * 10, GROUND_Y - 80); ctx.lineTo(cx - dir * 10, GROUND_Y - 60); ctx.lineTo(cx - dir * 4, GROUND_Y - 80); ctx.fill();
      }
    }
    if (b.state === "jumpslam" && b.leapTo != null) {
      const x = b.leapTo - camX;
      ctx.strokeStyle = `rgba(255,60,80,${0.5 + blink * 0.4})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x, GROUND_Y - 2, 110, 14, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(255,60,80,.15)"; ctx.fill();
    }
    if (["slash", "wave", "axe", "meteor", "charge", "jumpslam"].includes(b.state) && (b.anim === "windup" || b.anim === "cast" || b.anim === "throw" && b.k < 0.5)) {
      const x = b.x - camX, y = b.y - 190 * b.scale / 1.62 - 18;
      ctx.fillStyle = blink ? "#FF3B4E" : "#FFD66B";
      ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x + 15, y + 8); ctx.lineTo(x - 15, y + 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#1A0A0E"; ctx.font = "800 14px Unbounded, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("!", x, y - 1);
    }
  }

  function drawItems(camX) {
    for (const it of game.items) {
      if (it.life < 3 && Math.floor(it.life * 8) % 2 === 0) continue;
      const x = it.x - camX, y = it.y + (it.onGround ? Math.sin(it.t * 4) * 4 - 4 : 0);
      const info = ITEM_INFO[it.type];
      ctx.fillStyle = "rgba(0,0,0,.2)";
      ctx.beginPath(); ctx.ellipse(x, it.y + 14, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
      const gr = ctx.createRadialGradient(x, y, 2, x, y, 26);
      gr.addColorStop(0, `rgba(${info.glow},.55)`); gr.addColorStop(1, `rgba(${info.glow},0)`);
      ctx.fillStyle = gr; ctx.fillRect(x - 26, y - 26, 52, 52);
      ctx.save(); ctx.translate(x, y);
      ctx.scale(1 + Math.sin(it.t * 6) * 0.05, 1 + Math.sin(it.t * 6) * 0.05);
      ctx.fillStyle = "rgba(20,14,26,.85)"; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = info.color; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = info.color;
      if (it.type === "hp") {
        ctx.beginPath(); ctx.moveTo(0, 7); ctx.bezierCurveTo(-11, -1, -6, -10, 0, -4); ctx.bezierCurveTo(6, -10, 11, -1, 0, 7); ctx.fill();
      } else if (it.type === "en") {
        ctx.beginPath(); ctx.moveTo(2, -10); ctx.lineTo(-6, 1); ctx.lineTo(-1, 1); ctx.lineTo(-3, 10); ctx.lineTo(6, -2); ctx.lineTo(1, -2); ctx.closePath(); ctx.fill();
      } else if (it.type === "star") {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.2 : 9.5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(0, -11); ctx.quadraticCurveTo(9, -2, 6, 6); ctx.quadraticCurveTo(0, 11, -6, 6); ctx.quadraticCurveTo(-8, -2, -2, -4); ctx.quadraticCurveTo(-1, -8, 0, -11); ctx.fill();
        ctx.fillStyle = "#FFE08F"; ctx.beginPath(); ctx.arc(0, 3, 3.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawGuard(p, camX) {
    if (p.state !== "block" && !(p.parryFlash > 0)) return;
    const cx = p.x - camX + p.face * 24, cy = p.y - 58;
    const win = p.state === "block" && p.parryReady && p.blockT <= PARRY_WINDOW;
    const base = Math.PI / 2 - p.face * (Math.PI / 2);          // урд зүг
    const a0 = base - 1.05, a1 = base + 1.05;
    ctx.lineCap = "round";
    if (p.state === "block") {
      const hit = p.guardHit > 0 ? 1 : 0;
      ctx.strokeStyle = win ? "rgba(255,214,107,.95)" : `rgba(150,215,255,${0.45 + hit * 0.4})`;
      ctx.lineWidth = win ? 6 : 4 + hit * 2;
      ctx.beginPath(); ctx.arc(cx, cy, 46, a0, a1); ctx.stroke();
      ctx.strokeStyle = win ? "rgba(255,240,200,.5)" : "rgba(150,215,255,.18)";
      ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(cx, cy, 40, a0 + 0.2, a1 - 0.2); ctx.stroke();
    }
    if (p.parryFlash > 0) {
      const k = 1 - p.parryFlash / 0.4;
      ctx.strokeStyle = `rgba(255,214,107,${(1 - k) * 0.9})`; ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(cx, cy, 46 + k * 40, a0 - 0.3, a1 + 0.3); ctx.stroke();
    }
  }

  function drawProjectiles(camX) {
    for (const pr of game.projectiles) {
      const x = pr.x - camX, y = pr.y;
      if (pr.friendly) {
        const g = ctx.createRadialGradient(x, y, 2, x, y, 26);
        g.addColorStop(0, "rgba(255,214,107,.7)"); g.addColorStop(1, "rgba(255,214,107,0)");
        ctx.fillStyle = g; ctx.fillRect(x - 26, y - 26, 52, 52);
      }
      ctx.save(); ctx.translate(x, y);
      if (pr.type === "arrow") {
        ctx.rotate(Math.atan2(pr.vy, pr.vx));
        ctx.strokeStyle = "#E8DCC8"; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(8, 0); ctx.stroke();
        ctx.fillStyle = "#C9D2DE"; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(6, -4); ctx.lineTo(6, 4); ctx.fill();
        ctx.fillStyle = "#E0485E"; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-20, -5); ctx.lineTo(-16, 0); ctx.lineTo(-20, 5); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-50, 0); ctx.lineTo(-28, 0); ctx.stroke();
      } else {
        ctx.rotate(pr.rot || 0);
        ctx.strokeStyle = "#3A2A22"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(16, 0); ctx.stroke();
        ctx.fillStyle = "#DDE3EE"; ctx.beginPath(); ctx.moveTo(8, -2); ctx.quadraticCurveTo(24, -16, 22, 10); ctx.quadraticCurveTo(14, 4, 8, 4); ctx.fill();
        ctx.strokeStyle = "rgba(255,120,120,.4)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawHazards(camX, ground) {
    for (const h of game.hazards) {
      const x = h.x - camX;
      if (h.type === "wave" && !ground) {
        const a = clamp(h.life / h.max, 0, 1);
        const gr = ctx.createLinearGradient(0, GROUND_Y - h.h, 0, GROUND_Y);
        gr.addColorStop(0, `rgba(${h.col},0)`); gr.addColorStop(1, `rgba(${h.col},${0.85 * a})`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(x - h.dir * 34, GROUND_Y);
        ctx.quadraticCurveTo(x - h.dir * 4, GROUND_Y - h.h * 1.2, x + h.dir * 14, GROUND_Y);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,240,220,${0.8 * a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - h.dir * 24, GROUND_Y - 2); ctx.quadraticCurveTo(x - h.dir * 2, GROUND_Y - h.h, x + h.dir * 12, GROUND_Y - 2); ctx.stroke();
      } else if (h.type === "meteor") {
        if (ground && !h.fallen) {
          const k = clamp(h.t / h.warn, 0, 1), blink = Math.floor(game.t * 14) % 2;
          ctx.strokeStyle = `rgba(255,60,70,${0.5 + blink * 0.4})`; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(x, GROUND_Y + 2, h.r, 12, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = `rgba(255,60,70,${0.12 + k * 0.25})`;
          ctx.beginPath(); ctx.ellipse(x, GROUND_Y + 2, h.r * k, 12 * k, 0, 0, Math.PI * 2); ctx.fill();
        }
        if (!ground && !h.fallen && h.t > h.warn - 0.32) {
          const k = clamp((h.t - (h.warn - 0.32)) / 0.32, 0, 1);
          const y = lerp(-60, GROUND_Y - 18, k);
          const gr = ctx.createLinearGradient(x, y - 90, x, y);
          gr.addColorStop(0, "rgba(255,120,60,0)"); gr.addColorStop(1, "rgba(255,180,90,.85)");
          ctx.fillStyle = gr; ctx.fillRect(x - 10, y - 90, 20, 90);
          ctx.fillStyle = "#5A3A30"; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#FF8A4A"; ctx.beginPath(); ctx.arc(x - 4, y - 4, 8, 0, Math.PI * 2); ctx.fill();
        }
        if (ground && h.fallen) {
          const a = clamp(1 - h.t2 / 0.5, 0, 1);
          ctx.fillStyle = `rgba(255,120,60,${0.5 * a})`;
          ctx.beginPath(); ctx.ellipse(x, GROUND_Y + 2, h.r * 0.8, 10, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  function drawBolts(camX) {
    for (const b of game.bolts) {
      if (b.t < 0) continue;
      const a = clamp(1 - b.t / 0.35, 0, 1), x = b.x - camX;
      const pts = [];
      let cx = x + rand(-30, 30);
      for (let y = -20; y < GROUND_Y; y += 34) { pts.push([cx, y]); cx += rand(-22, 22); }
      pts.push([x, GROUND_Y - 4]);
      for (const [w, col] of [[14, `rgba(120,170,255,${0.35 * a})`], [6, `rgba(200,230,255,${0.8 * a})`], [2.5, `rgba(255,255,255,${a})`]]) {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = "round";
        ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
      }
      ctx.strokeStyle=`rgba(185,215,255,${.7*a})`;ctx.lineWidth=2;
      for(let i=2;i<pts.length-1;i+=2){
        const [bx,by]=pts[i],dir=i%4?1:-1;
        ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx+dir*18,by+10);ctx.lineTo(bx+dir*32,by+4);ctx.stroke();
      }
      const impact=ctx.createRadialGradient(x,GROUND_Y-4,2,x,GROUND_Y-4,70);
      impact.addColorStop(0,`rgba(255,255,255,${.7*a})`);impact.addColorStop(.3,`rgba(120,190,255,${.35*a})`);impact.addColorStop(1,"rgba(80,140,255,0)");
      ctx.fillStyle=impact;ctx.fillRect(x-70,GROUND_Y-74,140,80);
      ctx.save();ctx.translate(x,GROUND_Y);ctx.scale(1,.24);ctx.strokeStyle=`rgba(180,220,255,${.8*a})`;ctx.lineWidth=4;
      ctx.beginPath();ctx.arc(0,0,42+(1-a)*38,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
  }

  function drawParticles(camX) {
    for (const q of game.particles) {
      const a = clamp(q.life / q.max, 0, 1), x = q.x - camX;
      if (q.type === "spark") {
        ctx.strokeStyle = q.color; ctx.globalAlpha = a; ctx.lineWidth = q.size;
        ctx.beginPath(); ctx.moveTo(x, q.y); ctx.lineTo(x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke();
      } else if (q.type === "ring") {
        ctx.strokeStyle = q.color + (a * 0.9).toFixed(2) + ")"; ctx.lineWidth = (q.width || 4) * a;
        ctx.beginPath(); ctx.arc(x, q.y, q.size * (1 - a * 0.7), 0, Math.PI * 2); ctx.stroke();
      } else if (q.type === "smoke") {
        const radius = q.size * (1.8 - a * .6);
        const plume = ctx.createRadialGradient(x, q.y, 0, x, q.y, radius);
        plume.addColorStop(0, q.color + (a * .4).toFixed(2) + ")");
        plume.addColorStop(1, q.color + "0)");
        ctx.fillStyle = plume; ctx.fillRect(x-radius,q.y-radius,radius*2,radius*2);
      } else {
        ctx.fillStyle = q.color; ctx.globalAlpha = a;
        ctx.fillRect(x - q.size / 2, q.y - q.size / 2, q.size, q.size);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawTexts(camX) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const tx of game.texts) {
      const a = clamp(tx.life / (tx.max * 0.4), 0, 1);
      const s = 1 + Math.max(0, 0.12 - tx.pop) * 4;
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round(tx.size * s)}px Unbounded, Golos Text, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(10,6,14,.85)";
      ctx.strokeText(tx.text, tx.x - camX, tx.y);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, tx.x - camX, tx.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawBubble(p, camX) {
    const b = Voice.bubble;
    if (!b || !p) return;
    const a = clamp(Math.min(b.t / 0.12, (b.dur - b.t) / 0.3), 0, 1);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    ctx.font = "700 15px Golos Text, sans-serif";
    const w = ctx.measureText(b.text).width + 24;
    const x = clamp(p.x - camX, w / 2 + 8, VIEW_W - w / 2 - 8), y = p.y - p.h - 62 + (1 - Math.min(1, b.t * 6)) * 8;
    ctx.fillStyle = "rgba(255,252,244,.96)";
    roundRect(ctx, x - w / 2, y - 16, w, 32, 12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(p.x - camX - 6, y + 15); ctx.lineTo(p.x - camX + 2, y + 26); ctx.lineTo(p.x - camX + 8, y + 15); ctx.fill();
    ctx.fillStyle = "#1A1220"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(b.text, x, y + 1);
    ctx.globalAlpha = 1;
  }

  function drawDecals(camX) {
    for (const d of game.decals) {
      const a = clamp(d.life / d.max, 0, 1), x = d.x - camX;
      if (d.type === "footprint") {
        ctx.fillStyle = `rgba(28,27,23,${a * .15})`;
        ctx.beginPath(); ctx.ellipse(x, d.y + 1, 6, 1.4, d.face * .12, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      ctx.strokeStyle = `rgba(40,25,15,${0.6 * a})`; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = -3; i <= 3; i++) { ctx.moveTo(x, GROUND_Y + 2); ctx.lineTo(x + i * 26 + hash(i) * 10, GROUND_Y + 8 + Math.abs(i) * 4); }
      ctx.stroke();
      ctx.fillStyle = `rgba(255,214,107,${0.25 * a})`;
      ctx.beginPath(); ctx.ellipse(x, GROUND_Y + 4, 90, 10, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  function render() {
    if (game.mode !== "menu" && Iso.active) { Iso.render(K); return; }
    const inMenu = game.mode === "menu" || !game.stage;
    const st = inMenu ? menu.stage : game.stage;
    const key = st.def.key;
    const camX = game.camX;
    let sx = 0, sy = 0;
    if (game.shake > 0.2 && settings.shake) { sx = rand(-1, 1) * game.shake; sy = rand(-1, 1) * game.shake * 0.6; }

    drawBackground(key, camX, game.t);
    if (game.lightning > 0) { ctx.setTransform(K, 0, 0, K, 0, 0); ctx.fillStyle = `rgba(255,220,235,${game.lightning * 0.35})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    ctx.setTransform(K, 0, 0, K, sx * K, sy * K);
    drawProps(st, camX, game.t, 0);
    drawGround(THEMES[key], camX);
    TegtatWorld.ground(ctx, key, camX);
    TegtatWorld.grass(ctx, key, camX, game.t, false, settings.detail);
    drawProps(st, camX, game.t, 1);

    if (game.darken > 0) { ctx.fillStyle = `rgba(6,8,24,${game.darken})`; ctx.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40); }

    if (inMenu) {
      if (menu.player) drawEntity(menu.player, camX);
    } else {
      drawDecals(camX);
      drawHazards(camX, true);
      drawBossTelegraphs(game.boss, camX);
      drawItems(camX);
      for (const e of game.enemies) if (e.state === "dead") drawEntity(e, camX);
      for (const e of game.enemies) if (e.state !== "dead" && !e.def.boss) drawEntity(e, camX);
      if (game.boss && !game.boss.removed && game.boss.state !== "dead") drawEntity(game.boss, camX);
      for (const g of game.ghosts) {
        ctx.globalAlpha = (g.life / g.max) * 0.45;
        drawFigure({ x: g.x, y: g.y, face: g.face, style: GHOST_STYLE, scale: 1, anim: "dash", animT: 0, k: 0, flash: 0 }, camX);
      }
      ctx.globalAlpha = 1;
      const p = game.player;
      if (p) { drawSkillAura(p, camX); drawEntity(p, camX); drawSlash(p, camX); drawGuard(p, camX); }
      if (game.boss && game.boss.def.mounted && game.boss.state === "intro") {
        const b = game.boss, x = b.x - camX;
        ctx.save();ctx.globalCompositeOperation="lighter";
        const halo=ctx.createRadialGradient(x,b.y-90,12,x,b.y-90,190);
        halo.addColorStop(0,"rgba(90,175,255,.3)");halo.addColorStop(1,"rgba(40,90,180,0)");
        ctx.fillStyle=halo;ctx.fillRect(x-190,b.y-280,380,380);
        ctx.strokeStyle="rgba(130,205,255,.45)";ctx.lineWidth=2;
        for(let i=0;i<3;i++) {
          ctx.beginPath();ctx.ellipse(x,b.y-2,55+i*28+Math.sin(game.t*3)*5,9+i*5,0,0,Math.PI*2);ctx.stroke();
        }
        ctx.restore();
      }
      for (const e of game.enemies) drawEnemyUi(e, camX);
      drawProjectiles(camX);
      drawHazards(camX, false);
      drawBolts(camX);
      drawParticles(camX);
      drawTexts(camX);
      drawBubble(Voice.bubble && Voice.bubble.speaker || p, camX);
    }

    TegtatWorld.atmosphere(ctx, key, camX, game.t, settings.detail);
    TegtatWorld.grass(ctx, key, camX, game.t, true, settings.detail);

    // overlays
    ctx.setTransform(K, 0, 0, K, 0, 0);
    const p = game.player;
    if (!inMenu && p && p.hp > 0 && p.hp <= p.maxHp * 0.25) {
      const pulse = 0.35 + Math.sin(game.t * 6) * 0.15;
      const gr = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.62);
      gr.addColorStop(0, "rgba(160,0,20,0)"); gr.addColorStop(1, `rgba(160,0,20,${pulse})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (game.hurtFlash > 0) { ctx.fillStyle = `rgba(220,30,50,${game.hurtFlash * 0.3})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    if (game.flashWhite > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, game.flashWhite)})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    // vignette
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.55, VIEW_H * 0.45, VIEW_W / 2, VIEW_H * 0.55, VIEW_W * 0.7);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.35)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (game.fade > 0.01) { ctx.fillStyle = `rgba(8,6,12,${game.fade})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  }

  /* ======================================================================
     MAIN LOOP
     ====================================================================== */
  function initMenuScene() {
    menu.player = makePlayer();
    menu.player.animSeed = 0;
    game.camX = 0;
    game.fade = 0; game.fadeTo = 0; game.darken = 0; game.shake = 0; game.flashWhite = 0; game.hurtFlash = 0; game.lightning = 0;
    game.timers = [];
  }
  function menuTick(dt) {
    game.camX += dt * 24;
    if (game.camX > STAGES[0].width - VIEW_W) game.camX = 0;
    const p = menu.player;
    p.x = game.camX + 230; p.animT += dt;
    setAnim(p, "idle");
  }

  function tick(dt) {
    if (game.mode === "play") { Iso.tick(dt); return; }
    if (game.mode === "menu") { game.t += dt; menuTick(dt); return; }
    if (game.mode === "paused") return;
    game.t += dt;
    if (game.timers.length) {
      const due = [];
      for (const tm of game.timers) { tm.t -= dt; if (tm.t <= 0) due.push(tm); }
      if (due.length) { game.timers = game.timers.filter((tm) => tm.t > 0); due.forEach((tm) => tm.fn()); }
    }
    game.shake = Math.max(0, game.shake - dt * 36);
    game.flashWhite = Math.max(0, game.flashWhite - dt * 2.4);
    game.hurtFlash = Math.max(0, game.hurtFlash - dt * 1.6);
    game.lightning = Math.max(0, game.lightning - dt * 2);
    game.fade = approach(game.fade, game.fadeTo, dt * 2.4);
    const p = game.player;
    if (p && p.state !== "ult") game.darken = Math.max(0, game.darken - dt * 1.4);
    if (Voice.bubble) { Voice.bubble.t += dt; if (Voice.bubble.t > Voice.bubble.dur) Voice.bubble = null; }
    if (game.mode !== "play") { updateParticles(dt); return; }
    if (game.hitstop > 0) { game.hitstop -= dt; return; }
    let ts = 1;
    if (game.slowT > 0) { game.slowT -= dt; ts = 0.35; }
    const sdt = dt * ts;
    const boss = game.boss;
    if (p.state !== "dead" && !game.stage.cleared && !(boss && boss.state === "dead")) game.runTime += dt;
    if (game.combo > 0) { game.comboT -= sdt; if (game.comboT <= 0) breakCombo(); }
    updatePlayer(p, sdt);
    for (const e of game.enemies) updateEnemy(e, sdt);
    separateEnemies();
    if (game.enemies.some((e) => e.removed)) game.enemies = game.enemies.filter((e) => !e.removed);
    updateProjectiles(sdt);
    updateHazards(sdt);
    updateItems(sdt);
    updateBolts(sdt);
    updateParticles(sdt);
    updateStage(sdt);
    updateCamera(sdt);
  }

  let last = performance.now(), acc = 0, errCount = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    acc += dt;
    let n = 0;
    try {
      while (acc >= STEP && n < 5) { tick(STEP); acc -= STEP; n++; }
      if (n >= 5) acc = 0;
      render();
      if (game.mode === "play" || game.mode === "paused") updateHud();
    } catch (err) {
      if (errCount++ < 3) console.error("[TEGTAT]", err);
    }
  }

  /* ======================================================================
     TEST HOOK (зөвхөн ?test)
     ====================================================================== */
  let testStartStage = 0;
  if (TEST_MODE) {
    window.__tegtat2d = {
      get game() { return game; },
      state() {
        const p = game.player, b = game.boss;
        return {
          mode: game.mode, stage: game.stageIdx + 1, score: game.score, combo: game.combo, maxCombo: game.maxCombo,
          kills: game.kills, skills: game.skillsUsed, hp: p && p.hp, en: p && Math.floor(p.en), boost: p && p.boost,
          pstate: p && p.state, px: p && Math.round(p.x), camX: Math.round(game.camX),
          lock: game.stage && game.stage.lock, wave: game.stage && game.stage.waveIdx,
          enemies: game.enemies.filter((e) => e.state !== "dead").map((e) => e.type + ":" + e.state + ":" + Math.round(e.hp)),
          boss: b ? { type: b.type, hp: Math.round(b.hp), phase: b.phase, state: b.state } : null,
          items: game.items.map((i) => i.type), projectiles: game.projectiles.length, hazards: game.hazards.map((h) => h.type),
          voiceBubble: Voice.bubble && Voice.bubble.text, voiceBuffers: Voice.buffers.size, parries: game.parries || 0, blockT: p && p.blockT
        };
      },
      start(name, stage = 0) { testStartStage = stage; ui.nameInput.value = name || "TEST"; ui.nameForm.requestSubmit(); },
      god(on = true) { game.god = on; },
      setHp(n) { game.player.hp = n; },
      setEn(n) { game.player.en = n; },
      killAll() { for (const e of game.enemies) if (e.state !== "dead" && e.state !== "intro") { e.inv = 0; e.hp = 1; damageEnemy(e, 999, { heavy: true }); } },
      teleport(x, y = 430) { game.player.wx = x; game.player.wy = y; },
      item(type) { spawnItem(type, game.player.x + 50, GROUND_Y - 120); },
      bossHp(r) { const b = game.boss; if (b) { b.inv = 0; b.hp = Math.max(1, b.maxHp * r); checkBossPhase(b); } },
      defeatBoss() { const b = game.boss; if (b && b.state !== "dead" && b.state !== "intro") { b.inv = 0; b.hp = 1; damageEnemy(b, 9999, { heavy: true }); } },
      press(a) { input.press(a); },
      hold(k, on) { input.k[k] = on; },
      hurt(n) { game.player.inv = 0; return hurtPlayer(n, game.player.x + 40); },
      voice: Voice
    };
  }

  /* ======================================================================
     INIT
     ====================================================================== */
  const Iso = TegtatIso({ctx, game, input, settings, STAGES, ENEMY_DEFS,
    makeEnemy, damageEnemy, hurtPlayer, trySkill, startAttack, stageClear, endGame,
    drawFigure, drawWarhorse, drawSkillAura, drawSlash, drawGuard, drawBubble,
    drawParticles, drawTexts, updateParticles, AudioFx, Voice, ui, showBanner,
    setState, setAnim, ring, sparks, floatText, playerDie, doParry, waveClear});
  resize();
  applyTouchSettings();
  initMenuScene();
  syncSettingsUi();
  requestAnimationFrame((t) => { last = t; frame(t); });
  // Анхны хэрэглэгчийн үйлдлээр audio + voice-ийг ачаална (autoplay бодлого)
  const unlock = () => { AudioFx.ensure(); Voice.init(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
})();
