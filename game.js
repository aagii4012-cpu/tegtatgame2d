/* ==========================================================================
   ENEREl — 2D Mini Game
   Canvas side-view action game. No external engine or assets.

   Sections: config · characters · audio · input · world & entities ·
   enemy AI · boss AI · effects · rendering · HUD/UI · scoring & API · loop
   ========================================================================== */
(function () {
  "use strict";

  /* ======================================================================
     CONFIG
     ====================================================================== */
  const VIEW_W = 960;
  const VIEW_H = 540;
  const GROUND_Y = 470;
  const GRAVITY = 2100;
  const STEP = 1 / 60;

  const PLAYER = {
    w: 30, h: 52,
    maxHp: 100,
    attack: 25,
    speed: 300, accel: 3200, airAccel: 2000, friction: 2800,
    jumpVelocity: 780,
    coyoteTime: 0.09, jumpBuffer: 0.12,
    attackTime: 0.24, attackActive: [0.03, 0.15], attackCooldown: 0.3,
    attackRange: 74, attackHeight: 56,
    invincibleTime: 1.0
  };

  // Difficulty: ТӨВШӨӨ < ГАНАА < ТЭКА < ЭРХМЭЭ < АНХАА
  const ENEMY_TYPES = {
    tuvshuu: { name: "ТӨВШӨӨ", role: "Basic enemy", hp: 50, w: 30, h: 42, speed: 85, damage: 8, touch: 5, score: 100, coins: 1, knock: 1, color: "#3FB8A8", stars: 1 },
    ganaa: { name: "ГАНАА", role: "Mid-level fighter", hp: 100, w: 34, h: 50, speed: 120, damage: 12, touch: 6, score: 200, coins: 2, knock: 0.8, color: "#EE8A3C", stars: 2 },
    teka: { name: "ТЭКА", role: "Ranged caster", hp: 75, w: 28, h: 54, speed: 150, damage: 10, touch: 5, score: 250, coins: 2, knock: 0.9, color: "#9B7BFF", stars: 3 },
    erhmee: { name: "ЭРХМЭЭ", role: "Heavy brute", hp: 220, w: 48, h: 66, speed: 62, damage: 22, touch: 8, score: 400, coins: 3, knock: 0.3, color: "#E0483F", stars: 4 },
    anhaa: { name: "АНХАА", role: "Final boss 👑", hp: 1000, w: 84, h: 116, speed: 115, damage: 18, touch: 12, score: 1500, coins: 12, knock: 0.06, color: "#F0C463", stars: 5 }
  };

  const SCORE_RULES = {
    coin: 10,
    stageBonus: [500, 800, 0],
    flawlessBonus: 300,
    hpBonusPerPoint: 10,
    timeBonusMax: 1000,
    timeBonusPar: 420 // seconds; faster runs earn more
  };

  const THEMES = [
    { name: "Dusk Ruins", sky: ["#141129", "#2B1C3D", "#4A2747"], moon: "#F7D9C4", far: "#231A36", mid: "#1B1528", near: "#120E1B", ground: "#1D1622", groundTop: "#5C3B57", accent: "#3FB8A8", ember: "rgba(255,180,140,.7)" },
    { name: "Violet Pass", sky: ["#0E1026", "#231B44", "#3E2358"], moon: "#D9D2FF", far: "#1C1838", mid: "#15122B", near: "#0D0B1C", ground: "#18142A", groundTop: "#4D3A7A", accent: "#9B7BFF", ember: "rgba(190,170,255,.7)" },
    { name: "Crown Arena", sky: ["#14070B", "#341018", "#5B1A22"], moon: "#FFB38A", far: "#2A0E15", mid: "#1F0A10", near: "#13060A", ground: "#1E0D12", groundTop: "#7A2B2B", accent: "#F0C463", ember: "rgba(255,150,90,.8)" }
  ];

  const STAGES = [
    {
      label: "STAGE 1 / 3", title: "STAGE 1", subtitle: "ТӨВШӨӨ", worldW: 1800, theme: 0,
      platforms: [{ x: 360, y: 370, w: 180 }, { x: 760, y: 340, w: 160 }, { x: 1180, y: 370, w: 200 }],
      coins: [[420, 330], [470, 330], [810, 300], [860, 300], [1240, 330], [1300, 330], [600, 440], [980, 440], [1500, 440], [1560, 440]],
      waves: [["tuvshuu", "tuvshuu"], ["tuvshuu", "tuvshuu", "tuvshuu"], ["tuvshuu", "tuvshuu", "tuvshuu"]]
    },
    {
      label: "STAGE 2 / 3", title: "STAGE 2", subtitle: "ГАНАА · ТЭКА · ЭРХМЭЭ", worldW: 2000, theme: 1,
      platforms: [{ x: 300, y: 360, w: 170 }, { x: 640, y: 320, w: 150 }, { x: 980, y: 360, w: 200 }, { x: 1380, y: 330, w: 170 }, { x: 1700, y: 370, w: 150 }],
      coins: [[350, 320], [410, 320], [690, 280], [740, 280], [1040, 320], [1110, 320], [1430, 290], [1490, 290], [1740, 330], [1800, 330], [560, 440], [1250, 440]],
      waves: [["ganaa", "ganaa"], ["ganaa", "teka", "teka"], ["teka", "ganaa", "erhmee"], ["erhmee", "teka", "erhmee"]]
    },
    {
      label: "STAGE 3 / 3", title: "FINAL BOSS", subtitle: "АНХАА 👑", worldW: VIEW_W, theme: 2, boss: true,
      platforms: [{ x: 150, y: 350, w: 150 }, { x: 660, y: 350, w: 150 }],
      coins: [],
      waves: []
    }
  ];

  // Highest score a perfect run can reach. Mirrors MAX_SCORE in functions/api/_shared.js
  const MAX_POSSIBLE_SCORE = 12000;

  /* ======================================================================
     DOM
     ====================================================================== */
  const $ = (id) => document.getElementById(id);
  const canvas = $("game-canvas");
  const ctx = canvas.getContext("2d");
  const frame = $("frame");
  const ui = {
    hud: $("hud"), hpFill: $("hud-hp-fill"), hpText: $("hud-hp-text"), hpWrap: document.querySelector(".hud-hp"),
    atk: $("hud-atk"), stage: $("hud-stage"), score: $("hud-score"), scoreWrap: document.querySelector(".hud-score"),
    soundBtn: $("sound-btn"), pauseBtn: $("pause-btn"),
    bossBar: $("boss-bar"), bossFill: $("boss-fill"), bossLag: $("boss-fill-lag"), bossPhase: $("boss-phase"),
    banner: $("banner"), bannerKicker: $("banner-kicker"), bannerTitle: $("banner-title"), bannerSub: $("banner-sub"),
    rotateHint: $("rotate-hint"),
    start: $("screen-start"), pause: $("screen-pause"), end: $("screen-end"),
    nameForm: $("name-form"), nameInput: $("player-name"), nameError: $("name-error"),
    helpBtn: $("help-btn"), helpPanel: $("help-panel"),
    resumeBtn: $("resume-btn"), quitBtn: $("quit-btn"),
    endKicker: $("end-kicker"), endTitle: $("end-title"), endScore: $("end-score"), endBreakdown: $("end-breakdown"),
    saveStatus: $("save-status"), againBtn: $("again-btn"), retrySave: $("retry-save-btn"),
    board: $("leaderboard"), boardList: $("board-list"), boardStatus: $("board-status"), boardYou: $("board-you"), boardRefresh: $("board-refresh"),
    roster: $("roster-list"), touch: $("touch")
  };

  /* ======================================================================
     UTILITIES
     ====================================================================== */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const centerX = (e) => e.x + e.w / 2;
  const centerY = (e) => e.y + e.h / 2;
  const pad = (n, len) => String(Math.max(0, Math.floor(n))).padStart(len, "0");

  function storageGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ } }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // Deterministic noise for background silhouettes
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  const FONT_UI = '"Unbounded", "Golos Text", system-ui, sans-serif';

  /* ======================================================================
     AUDIO — tiny Web Audio synth, created on first user gesture
     ====================================================================== */
  const audio = {
    ctx: null,
    enabled: storageGet("enerel-game-sound") !== "off",
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
    },
    resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
    tone(freq, dur, type, vol, slideTo, delay) {
      if (!this.enabled || !this.ctx) return;
      const t0 = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    noise(dur, vol, filterFreq) {
      if (!this.enabled || !this.ctx) return;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = filterFreq || 1800;
      const gain = this.ctx.createGain();
      gain.gain.value = vol || 0.12;
      src.connect(filter).connect(gain).connect(this.ctx.destination);
      src.start();
    },
    play(name) {
      switch (name) {
        case "attack": this.noise(0.09, 0.09, 2600); break;
        case "hit": this.tone(220, 0.08, "square", 0.07, 110); break;
        case "hurt": this.tone(180, 0.22, "sawtooth", 0.08, 70); break;
        case "jump": this.tone(360, 0.12, "sine", 0.06, 720); break;
        case "land": this.noise(0.05, 0.05, 500); break;
        case "coin": this.tone(988, 0.07, "square", 0.04); this.tone(1319, 0.12, "square", 0.04, null, 0.06); break;
        case "kill": this.tone(520, 0.1, "triangle", 0.07, 260); this.noise(0.12, 0.06, 900); break;
        case "shoot": this.tone(880, 0.1, "sine", 0.04, 440); break;
        case "warning": this.tone(220, 0.25, "sawtooth", 0.06, 330); this.tone(220, 0.25, "sawtooth", 0.06, 330, 0.3); break;
        case "boom": this.noise(0.35, 0.18, 300); this.tone(90, 0.3, "sine", 0.12, 40); break;
        case "bossHit": this.tone(150, 0.1, "square", 0.08, 90); break;
        case "stage": [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, "triangle", 0.06, null, i * 0.1)); break;
        case "victory": [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.2, "triangle", 0.07, null, i * 0.12)); break;
        case "gameover": [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.28, "sawtooth", 0.06, null, i * 0.18)); break;
        default: break;
      }
    }
  };

  /* ======================================================================
     INPUT — keyboard, mouse, touch (pointer events)
     ====================================================================== */
  const input = {
    left: false, right: false,
    jumpHeld: false, jumpPressed: false,
    attackPressed: false,
    sources: { left: new Set(), right: new Set(), jump: new Set(), attack: new Set() },
    press(action, source) {
      const set = this.sources[action];
      const wasDown = set.size > 0;
      set.add(source);
      if (action === "jump" && !wasDown) this.jumpPressed = true;
      if (action === "attack" && !wasDown) this.attackPressed = true;
      this.sync();
    },
    release(action, source) {
      this.sources[action].delete(source);
      this.sync();
    },
    sync() {
      this.left = this.sources.left.size > 0;
      this.right = this.sources.right.size > 0;
      this.jumpHeld = this.sources.jump.size > 0;
    },
    clear() {
      Object.values(this.sources).forEach((s) => s.clear());
      this.jumpPressed = false;
      this.attackPressed = false;
      this.sync();
    },
    consume() { this.jumpPressed = false; this.attackPressed = false; }
  };

  const KEYMAP = {
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    ArrowUp: "jump", KeyW: "jump", Space: "jump",
    KeyJ: "attack", KeyK: "attack"
  };

  function bindInput() {
    window.addEventListener("keydown", (e) => {
      if (e.target && e.target.tagName === "INPUT") return;
      if ((e.code === "KeyP" || e.code === "Escape") && (game.state === "playing" || game.state === "paused")) {
        e.preventDefault();
        togglePause();
        return;
      }
      const action = KEYMAP[e.code];
      if (!action || game.state !== "playing") return;
      e.preventDefault();
      if (!e.repeat) input.press(action, "key:" + e.code);
    });
    window.addEventListener("keyup", (e) => {
      const action = KEYMAP[e.code];
      if (action) input.release(action, "key:" + e.code);
    });
    window.addEventListener("blur", () => input.clear());

    // Mouse click on the game = attack (touch uses the on-screen buttons)
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button === 0 && game.state === "playing") {
        input.press("attack", "mouse");
        input.release("attack", "mouse");
      }
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Touch buttons — each pointer is tracked so two thumbs work together
    ui.touch.querySelectorAll(".t-btn").forEach((btn) => {
      const action = btn.dataset.key;
      const down = (e) => {
        e.preventDefault();
        audio.init(); audio.resume();
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        btn.classList.add("is-down");
        if (game.state === "playing") input.press(action, "ptr:" + e.pointerId);
      };
      const up = (e) => {
        btn.classList.remove("is-down");
        input.release(action, "ptr:" + e.pointerId);
      };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("lostpointercapture", up);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());
    });

    // Stop the page from scrolling/zooming while touching the game area
    [frame, ui.touch].forEach((el) => {
      el.addEventListener("touchmove", (e) => { if (game.state === "playing") e.preventDefault(); }, { passive: false });
    });
  }

  /* ======================================================================
     GAME STATE
     ====================================================================== */
  const game = {
    state: "menu", // menu | playing | paused | transition | over
    playerName: "",
    stageIndex: 0,
    time: 0,
    runTime: 0,
    score: 0,
    breakdown: null,
    stageDamageTaken: false,
    player: null,
    enemies: [], projectiles: [], coins: [], particles: [], texts: [], shockwaves: [], meteors: [], warnings: [],
    platforms: [], worldW: VIEW_W,
    waveIndex: 0, waveTimer: 0, spawnQueue: [], spawnTimer: 0,
    cam: { x: 0, shake: 0, shakeX: 0, shakeY: 0 },
    hitStop: 0, slowMo: 0, flash: 0,
    boss: null,
    stageClear: false,
    endTimer: 0,
    runId: 0,
    lastSaved: null,
    bg: null
  };

  function newPlayer() {
    return {
      x: 120, y: GROUND_Y - PLAYER.h, w: PLAYER.w, h: PLAYER.h,
      vx: 0, vy: 0, facing: 1, onGround: true, wasOnGround: true,
      hp: PLAYER.maxHp, invincible: 0, hurt: 0,
      coyote: 0, jumpBuffer: 0,
      attackTimer: 0, attackCooldown: 0, attackHits: new Set(), attackId: 0,
      walkPhase: 0, dead: false, deadTimer: 0, controlLock: 0, squash: 0
    };
  }

  function newEnemy(type, x) {
    const def = ENEMY_TYPES[type];
    return {
      type, def,
      x, y: GROUND_Y - def.h, w: def.w, h: def.h,
      vx: 0, vy: 0, facing: -1, onGround: true,
      hp: def.hp, maxHp: def.hp,
      state: "approach", timer: 0, cooldown: rand(0.4, 1.0), jumpCooldown: 0,
      flash: 0, hitBy: -1, dead: false, deathTimer: 0, walkPhase: rand(0, 6),
      spawnFade: 0.4, attackHitDone: false
    };
  }

  /* ======================================================================
     STAGE FLOW
     ====================================================================== */
  function startRun(name) {
    game.playerName = name;
    game.score = 0;
    game.runTime = 0;
    game.runId += 1;
    game.lastSaved = null;
    game.breakdown = { enemies: 0, coins: 0, stage: 0, flawless: 0, hp: 0, time: 0 };
    game.player = newPlayer();
    loadStage(0);
    hideOverlays();
    ui.hud.hidden = false;
    game.state = "playing";
    updateHud(true);
    // Bring the play area into view (menus on small screens may have scrolled the page)
    requestAnimationFrame(() => {
      const r = frame.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight + 4) window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 8), behavior: "auto" });
    });
  }

  function loadStage(index) {
    const stage = STAGES[index];
    game.stageIndex = index;
    game.worldW = stage.worldW;
    game.platforms = stage.platforms.map((p) => ({ ...p, h: 14 }));
    game.enemies = [];
    game.projectiles = [];
    game.shockwaves = [];
    game.meteors = [];
    game.warnings = [];
    game.texts = [];
    game.coins = stage.coins.map(([x, y]) => ({ x, y, vx: 0, vy: 0, r: 9, float: true, phase: rand(0, 6), magnet: false, life: Infinity }));
    game.waveIndex = 0;
    game.waveTimer = 1.6;
    game.spawnQueue = [];
    game.stageDamageTaken = false;
    game.stageClear = false;
    game.boss = null;
    game.bg = buildBackground(stage);

    const p = game.player;
    p.x = stage.boss ? 140 : 120;
    p.y = GROUND_Y - p.h;
    p.vx = 0; p.vy = 0; p.facing = 1;
    p.invincible = 1.2;
    game.cam.x = 0;
    ui.bossBar.hidden = true;
    ui.stage.textContent = stage.label;

    if (stage.boss) {
      startBossEntrance();
    } else {
      showBanner(stage.title, stage.subtitle, "Get ready", "");
      audio.play("stage");
    }
  }

  function completeStage() {
    const index = game.stageIndex;
    game.stageClear = true;
    const bonus = SCORE_RULES.stageBonus[index];
    if (bonus) {
      addScore(bonus, "stage");
      floatText(centerX(game.player), game.player.y - 30, "+" + bonus + " STAGE", "#F0C463", 18);
    }
    if (!game.stageDamageTaken) {
      addScore(SCORE_RULES.flawlessBonus, "flawless");
      floatText(centerX(game.player), game.player.y - 56, "NO DAMAGE +" + SCORE_RULES.flawlessBonus, "#5FD39A", 16);
    }
    // collect remaining coins automatically
    game.coins.forEach((c) => { c.magnet = true; });
    showBanner("STAGE " + (index + 1) + " COMPLETE", "+" + bonus, "", "is-good");
    audio.play("stage");
    game.state = "transition";
    game.endTimer = 2.6;
  }

  function nextStageAfterTransition() {
    const p = game.player;
    p.hp = Math.min(PLAYER.maxHp, p.hp + 30);
    loadStage(game.stageIndex + 1);
    game.state = "playing";
    updateHud(true);
  }

  function spawnWave() {
    const stage = STAGES[game.stageIndex];
    const wave = stage.waves[game.waveIndex];
    if (!wave) return;
    wave.forEach((type, i) => game.spawnQueue.push({ type, delay: i * 0.7, side: i % 2 === 0 ? 1 : -1 }));
    game.spawnTimer = 0;
    if (game.waveIndex > 0) floatBanner("WAVE " + (game.waveIndex + 1) + " / " + stage.waves.length);
    game.waveIndex += 1;
  }

  function processSpawns(dt) {
    if (!game.spawnQueue.length) return;
    game.spawnTimer += dt;
    while (game.spawnQueue.length && game.spawnTimer >= game.spawnQueue[0].delay) {
      const item = game.spawnQueue.shift();
      const p = game.player;
      let side = item.side;
      const leftX = game.cam.x - 50;
      const rightX = game.cam.x + VIEW_W + 10;
      if (side < 0 && leftX < 20) side = 1;
      if (side > 0 && rightX > game.worldW - 60) side = -1;
      let x = side > 0 ? Math.min(rightX, game.worldW - 70) : Math.max(leftX, 20);
      if (Math.abs(x - p.x) < 220) x = clamp(p.x + side * 420, 20, game.worldW - 70);
      const e = newEnemy(item.type, x);
      e.facing = x > p.x ? -1 : 1;
      game.enemies.push(e);
      burst(x + e.w / 2, GROUND_Y - 4, e.def.color, 10, 160);
    }
  }

  /* ======================================================================
     PHYSICS
     ====================================================================== */
  function moveBody(b, dt, opts) {
    const options = opts || {};
    b.vy += GRAVITY * dt * (options.gravityScale || 1);
    if (b.vy > 1400) b.vy = 1400;

    b.x += b.vx * dt;
    b.x = clamp(b.x, 0, game.worldW - b.w);

    const prevBottom = b.y + b.h;
    b.y += b.vy * dt;
    b.onGround = false;

    if (b.y + b.h >= GROUND_Y) {
      b.y = GROUND_Y - b.h;
      b.vy = 0;
      b.onGround = true;
    } else if (b.vy >= 0 && !options.ignorePlatforms) {
      for (const p of game.platforms) {
        if (b.x + b.w > p.x + 4 && b.x < p.x + p.w - 4 && prevBottom <= p.y + 1 && b.y + b.h >= p.y) {
          b.y = p.y - b.h;
          b.vy = 0;
          b.onGround = true;
          break;
        }
      }
    }
  }

  /* ======================================================================
     PLAYER
     ====================================================================== */
  function updatePlayer(dt) {
    const p = game.player;
    if (p.dead) {
      p.deadTimer += dt;
      p.vx *= 0.92;
      moveBody(p, dt);
      return;
    }

    p.invincible = Math.max(0, p.invincible - dt);
    p.hurt = Math.max(0, p.hurt - dt);
    p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    p.controlLock = Math.max(0, p.controlLock - dt);
    p.squash = Math.max(0, p.squash - dt * 4);

    const canControl = p.controlLock <= 0 && game.state === "playing";
    const dir = canControl ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;

    // horizontal movement with acceleration for smooth feel
    const accel = p.onGround ? PLAYER.accel : PLAYER.airAccel;
    if (dir !== 0 && p.hurt <= 0.15) {
      p.vx = clamp(p.vx + dir * accel * dt, -PLAYER.speed, PLAYER.speed);
      if (p.attackTimer <= 0) p.facing = dir;
    } else {
      const f = PLAYER.friction * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }

    // jump with coyote time + input buffer
    p.coyote = p.onGround ? PLAYER.coyoteTime : Math.max(0, p.coyote - dt);
    if (canControl && input.jumpPressed) p.jumpBuffer = PLAYER.jumpBuffer;
    else p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);

    if (p.jumpBuffer > 0 && p.coyote > 0) {
      p.vy = -PLAYER.jumpVelocity;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      audio.play("jump");
      dust(centerX(p), p.y + p.h, 6);
    }
    // variable jump height: release early for a short hop
    if (!input.jumpHeld && p.vy < -260) p.vy += GRAVITY * 1.4 * dt;

    // attack
    if (canControl && input.attackPressed && p.attackCooldown <= 0) {
      p.attackTimer = PLAYER.attackTime;
      p.attackCooldown = PLAYER.attackCooldown;
      p.attackId += 1;
      p.attackHits = new Set();
      audio.play("attack");
    }
    if (p.attackTimer > 0) {
      const elapsed = PLAYER.attackTime - p.attackTimer;
      if (elapsed >= PLAYER.attackActive[0] && elapsed <= PLAYER.attackActive[1]) resolvePlayerAttack(p);
      p.attackTimer -= dt;
    }

    p.wasOnGround = p.onGround;
    moveBody(p, dt);
    if (!p.wasOnGround && p.onGround) {
      p.squash = 1;
      dust(centerX(p), p.y + p.h, 5);
    }
    if (Math.abs(p.vx) > 20 && p.onGround) p.walkPhase += dt * 14;
  }

  function attackBox(p) {
    const w = PLAYER.attackRange;
    return {
      x: p.facing > 0 ? p.x + p.w - 6 : p.x - w + 6,
      y: p.y + p.h / 2 - PLAYER.attackHeight / 2 - 4,
      w, h: PLAYER.attackHeight
    };
  }

  function resolvePlayerAttack(p) {
    const box = attackBox(p);
    for (const e of game.enemies) {
      if (e.dead || p.attackHits.has(e)) continue;
      if (overlap(box, e)) {
        p.attackHits.add(e);
        damageEnemy(e, PLAYER.attack, p.facing);
      }
    }
    // slash cuts through projectiles
    for (const pr of game.projectiles) {
      if (!pr.dead && pr.hostile && overlap(box, { x: pr.x - pr.r, y: pr.y - pr.r, w: pr.r * 2, h: pr.r * 2 })) {
        pr.dead = true;
        sparks(pr.x, pr.y, "#E9DDFF", 8);
        audio.play("hit");
      }
    }
  }

  function damagePlayer(amount, fromX, knock) {
    const p = game.player;
    if (p.dead || p.invincible > 0 || game.state !== "playing") return false;
    p.hp = Math.max(0, p.hp - amount);
    p.invincible = PLAYER.invincibleTime;
    p.hurt = 0.3;
    const dir = centerX(p) >= fromX ? 1 : -1;
    p.vx = dir * (knock || 320);
    p.vy = -320;
    game.stageDamageTaken = true;
    floatText(centerX(p), p.y - 8, "-" + amount, "#FF6B7A", 18);
    burst(centerX(p), centerY(p), "#FF6B7A", 10, 220);
    shake(amount >= 18 ? 12 : 6);
    game.flash = 0.18;
    audio.play("hurt");
    updateHud();
    if (p.hp <= 0) killPlayer();
    return true;
  }

  function killPlayer() {
    const p = game.player;
    p.dead = true;
    p.deadTimer = 0;
    p.vy = -520;
    game.slowMo = 0.9;
    shake(14);
    burst(centerX(p), centerY(p), "#F2B9C5", 26, 320);
    game.state = "dying";
    game.endTimer = 1.6;
    audio.play("gameover");
  }

  /* ======================================================================
     ENEMIES
     ====================================================================== */
  function damageEnemy(e, amount, dir) {
    if (e.dead) return;
    e.hp -= amount;
    e.flash = 0.12;
    const knock = 260 * e.def.knock;
    e.vx = dir * knock;
    if (e.type !== "anhaa" && e.type !== "erhmee") e.vy = -160;
    // light hits interrupt weaker enemies' wind-ups
    if (e.type === "tuvshuu" || e.type === "ganaa") { if (e.state === "windup") { e.state = "recover"; e.timer = 0.3; } }
    game.hitStop = e.type === "anhaa" ? 0.035 : 0.05;
    floatText(centerX(e), e.y - 6, String(amount), "#FFFFFF", e.type === "anhaa" ? 20 : 16);
    sparks(centerX(e) - dir * 8, centerY(e), "#FFF2C9", 7);
    audio.play(e.type === "anhaa" ? "bossHit" : "hit");
    if (e.type === "anhaa") { shake(4); updateBossBar(); }
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.dead = true;
    e.deathTimer = e.type === "anhaa" ? 2.4 : 0.45;
    addScore(e.def.score, "enemies");
    floatText(centerX(e), e.y - 24, "+" + e.def.score, "#F0C463", e.type === "anhaa" ? 30 : 18);
    burst(centerX(e), centerY(e), e.def.color, e.type === "anhaa" ? 60 : 22, e.type === "anhaa" ? 520 : 300);
    ring(centerX(e), centerY(e), e.def.color);
    shake(e.type === "anhaa" ? 22 : e.type === "erhmee" ? 9 : 4);
    for (let i = 0; i < e.def.coins; i += 1) dropCoin(centerX(e), e.y + 10);
    audio.play(e.type === "anhaa" ? "boom" : "kill");
    if (e.type === "anhaa") defeatBoss(e);
  }

  function enemyMeleeBox(e, width, height) {
    return {
      x: e.facing > 0 ? e.x + e.w - 4 : e.x - width + 4,
      y: e.y + e.h - height,
      w: width, h: height
    };
  }

  function updateEnemy(e, dt) {
    const p = game.player;
    e.flash = Math.max(0, e.flash - dt);
    e.spawnFade = Math.max(0, e.spawnFade - dt);
    e.cooldown = Math.max(0, e.cooldown - dt);
    e.jumpCooldown = Math.max(0, e.jumpCooldown - dt);

    if (e.dead) {
      e.deathTimer -= dt;
      e.vx *= 0.9;
      moveBody(e, dt);
      return;
    }

    if (e.type === "anhaa") { updateBoss(e, dt); return; }

    const dx = centerX(p) - centerX(e);
    const dist = Math.abs(dx);
    const def = e.def;
    const friction = 1600 * dt;
    let wantVx = 0;

    switch (e.type) {
      case "tuvshuu": {
        if (e.state === "approach") {
          e.facing = dx > 0 ? 1 : -1;
          wantVx = e.facing * def.speed;
          if (dist < 70 && e.cooldown <= 0 && Math.abs(centerY(p) - centerY(e)) < 60) { e.state = "windup"; e.timer = 0.3; }
        } else if (e.state === "windup") {
          e.timer -= dt;
          if (e.timer <= 0) { e.state = "lunge"; e.timer = 0.22; e.vx = e.facing * 300; e.attackHitDone = false; }
        } else if (e.state === "lunge") {
          e.timer -= dt;
          wantVx = e.facing * 300;
          if (!e.attackHitDone && overlap(enemyMeleeBox(e, 30, 34), p)) { e.attackHitDone = damagePlayer(def.damage, centerX(e)); }
          if (e.timer <= 0) { e.state = "recover"; e.timer = 0.5; e.cooldown = 0.9; }
        } else if (e.state === "recover") {
          e.timer -= dt;
          if (e.timer <= 0) e.state = "approach";
        }
        break;
      }
      case "ganaa": {
        if (e.state === "approach") {
          e.facing = dx > 0 ? 1 : -1;
          wantVx = dist > 56 ? e.facing * def.speed : 0;
          if (dist < 82 && e.cooldown <= 0 && Math.abs(centerY(p) - centerY(e)) < 70) { e.state = "windup"; e.timer = 0.38; }
        } else if (e.state === "windup") {
          e.timer -= dt;
          if (e.timer <= 0) { e.state = "strike"; e.timer = 0.14; e.attackHitDone = false; e.vx = e.facing * 120; }
        } else if (e.state === "strike") {
          e.timer -= dt;
          if (!e.attackHitDone && overlap(enemyMeleeBox(e, 64, 44), p)) e.attackHitDone = damagePlayer(def.damage, centerX(e));
          if (e.timer <= 0) { e.state = "recover"; e.timer = 0.45; e.cooldown = 1.0; }
        } else if (e.state === "recover") {
          e.timer -= dt;
          if (e.timer <= 0) e.state = "approach";
        }
        break;
      }
      case "teka": {
        e.facing = dx > 0 ? 1 : -1;
        if (e.state === "approach") {
          const nearWall = e.x < 40 || e.x > game.worldW - e.w - 40;
          if (dist < 250 && !nearWall) wantVx = -e.facing * def.speed;
          else if (dist > 430) wantVx = e.facing * def.speed;
          if (e.cooldown <= 0 && dist < 620) { e.state = "charge"; e.timer = 0.38; audio.play("shoot"); }
        } else if (e.state === "charge") {
          e.timer -= dt;
          if (e.timer <= 0) {
            const ox = centerX(e) + e.facing * 20;
            const oy = e.y + 16;
            const ang = Math.atan2(centerY(p) - oy, centerX(p) - ox);
            const speed = 430;
            const vy = clamp(Math.sin(ang), -0.35, 0.35);
            game.projectiles.push({ x: ox, y: oy, vx: e.facing * speed * Math.cos(Math.asin(vy)), vy: vy * speed, r: 8, dmg: def.damage, hostile: true, life: 2.6, color: "#B9A2FF", trail: [] });
            e.state = "recover"; e.timer = 0.3; e.cooldown = 1.6;
          }
        } else if (e.state === "recover") {
          e.timer -= dt;
          if (e.timer <= 0) e.state = "approach";
        }
        break;
      }
      case "erhmee": {
        if (e.state === "approach") {
          e.facing = dx > 0 ? 1 : -1;
          wantVx = dist > 70 ? e.facing * def.speed : 0;
          if (dist < 105 && e.cooldown <= 0) {
            e.state = "windup"; e.timer = 0.62;
            game.warnings.push({ kind: "zone", x: e.facing > 0 ? e.x + e.w - 10 : e.x - 110, y: GROUND_Y - 6, w: 120, h: 6, life: 0.62, max: 0.62 });
          }
        } else if (e.state === "windup") {
          e.timer -= dt;
          if (e.timer <= 0) {
            e.state = "slam"; e.timer = 0.16; e.attackHitDone = false;
            shake(9); audio.play("boom");
            dust(e.facing > 0 ? e.x + e.w + 40 : e.x - 40, GROUND_Y, 14);
          }
        } else if (e.state === "slam") {
          e.timer -= dt;
          if (!e.attackHitDone && overlap(enemyMeleeBox(e, 118, 56), p)) e.attackHitDone = damagePlayer(def.damage, centerX(e), 480);
          if (e.timer <= 0) { e.state = "recover"; e.timer = 0.7; e.cooldown = 1.5; }
        } else if (e.state === "recover") {
          e.timer -= dt;
          if (e.timer <= 0) e.state = "approach";
        }
        break;
      }
      default: break;
    }

    // light enemies jump up to platforms to chase
    if ((e.type === "tuvshuu" || e.type === "ganaa") && e.state === "approach" && e.onGround && e.jumpCooldown <= 0) {
      if (p.y + p.h < e.y - 40 && dist < 140 && p.onGround) { e.vy = -760; e.jumpCooldown = 1.4; }
    }

    // move toward desired velocity
    if (wantVx !== 0) e.vx = lerp(e.vx, wantVx, Math.min(1, dt * 8));
    else e.vx = Math.abs(e.vx) <= friction ? 0 : e.vx - Math.sign(e.vx) * friction;
    moveBody(e, dt, { ignorePlatforms: e.type === "erhmee" });
    if (Math.abs(e.vx) > 15) e.walkPhase += dt * (8 + Math.abs(e.vx) / 30);

    // body contact damage
    if (overlap(e, p)) damagePlayer(def.touch, centerX(e), 260);
  }

  /* ======================================================================
     BOSS — АНХАА
     ====================================================================== */
  function startBossEntrance() {
    const boss = newEnemy("anhaa", VIEW_W - 220);
    boss.y = -260;
    boss.state = "entrance";
    boss.timer = 0;
    boss.phase = 1;
    boss.summoned = false;
    boss.attackCount = 0;
    game.enemies.push(boss);
    game.boss = boss;
    game.player.controlLock = 2.4;
    showBanner("FINAL BOSS", "АНХАА 👑", "STAGE 3", "is-boss");
    audio.play("warning");
  }

  function updateBossBar() {
    const b = game.boss;
    if (!b) return;
    const pct = Math.max(0, b.hp / b.maxHp) * 100;
    ui.bossFill.style.width = pct + "%";
    ui.bossLag.style.width = pct + "%";
    ui.bossPhase.textContent = b.phase === 2 ? "RAGE" : "";
  }

  function chooseBossAttack(b, dist) {
    const options = [];
    if (dist < 170) options.push("slash", "slash");
    options.push("charge", "slam");
    if (b.attackCount >= 2) options.push("meteor");
    if (b.phase === 2) options.push("meteor", "slam");
    return options[Math.floor(Math.random() * options.length)];
  }

  function updateBoss(b, dt) {
    const p = game.player;
    const def = b.def;
    const rage = b.phase === 2;
    const speedMul = rage ? 1.25 : 1;
    const cdMul = rage ? 0.7 : 1;
    const dx = centerX(p) - centerX(b);
    const dist = Math.abs(dx);
    b.timer -= dt;

    if (b.state === "entrance") {
      b.vy += GRAVITY * dt;
      b.y += b.vy * dt;
      if (b.y + b.h >= GROUND_Y) {
        b.y = GROUND_Y - b.h;
        b.vy = 0;
        b.state = "roar";
        b.timer = 1.0;
        shake(24);
        game.flash = 0.25;
        audio.play("boom");
        dust(centerX(b), GROUND_Y, 30);
        ring(centerX(b), GROUND_Y - 10, "#F0C463");
        ui.bossBar.hidden = false;
        ui.bossFill.style.width = "0%";
        ui.bossLag.style.width = "0%";
        requestAnimationFrame(() => requestAnimationFrame(updateBossBar));
      }
      return;
    }

    if (b.phase === 1 && b.hp <= b.maxHp * 0.5) {
      b.phase = 2;
      b.state = "roar";
      b.timer = 1.0;
      game.warnings = [];
      shake(16);
      game.flash = 0.2;
      audio.play("warning");
      floatBanner("АНХАА IS ENRAGED");
      updateBossBar();
      if (!b.summoned) {
        b.summoned = true;
        [60, VIEW_W - 100].forEach((x) => {
          const m = newEnemy("tuvshuu", x);
          game.enemies.push(m);
          burst(x + 15, GROUND_Y - 6, "#3FB8A8", 12, 180);
        });
      }
    }

    switch (b.state) {
      case "roar":
        b.vx = 0;
        if (b.timer <= 0) { b.state = "idle"; b.timer = 0.6; }
        break;

      case "idle": {
        b.facing = dx > 0 ? 1 : -1;
        b.vx = lerp(b.vx, dist > 120 ? b.facing * def.speed * speedMul : 0, Math.min(1, dt * 6));
        if (b.timer <= 0) {
          const pick = chooseBossAttack(b, dist);
          b.attackCount += 1;
          startBossAttack(b, pick, rage);
        }
        break;
      }

      case "slash-windup":
        b.vx = 0;
        if (b.timer <= 0) { b.state = "slash"; b.timer = 0.16; b.attackHitDone = false; b.vx = b.facing * 220; audio.play("attack"); }
        break;
      case "slash":
        if (!b.attackHitDone && overlap(enemyMeleeBox(b, 140, 90), p)) b.attackHitDone = damagePlayer(def.damage, centerX(b), 420);
        if (b.timer <= 0) { b.state = "recover"; b.timer = 0.55 * cdMul; }
        break;

      case "charge-windup":
        b.vx = 0;
        if (b.timer <= 0) { b.state = "charge"; b.timer = 1.3; b.attackHitDone = false; shake(6); }
        break;
      case "charge": {
        b.vx = b.facing * 720 * speedMul;
        if (Math.random() < 0.6) dust(b.facing > 0 ? b.x : b.x + b.w, GROUND_Y, 1);
        if (!b.attackHitDone && overlap(b, p)) b.attackHitDone = damagePlayer(22, centerX(b), 560);
        const hitWall = b.x <= 1 || b.x + b.w >= game.worldW - 1;
        if (hitWall || b.timer <= 0) {
          if (hitWall) { shake(14); audio.play("boom"); dust(b.facing > 0 ? b.x + b.w : b.x, GROUND_Y - 40, 16); }
          b.state = "stunned"; b.timer = 0.9; b.vx = -b.facing * 120;
        }
        break;
      }
      case "stunned":
        b.vx *= 0.9;
        if (b.timer <= 0) { b.state = "idle"; b.timer = 0.5 * cdMul; }
        break;

      case "slam-windup":
        b.vx = 0;
        if (b.timer <= 0) {
          b.state = "slam-air";
          b.vy = -980;
          b.vx = clamp((centerX(p) - centerX(b)) * 1.15, -520, 520);
        }
        break;
      case "slam-air":
        if (b.onGround && b.vy === 0) {
          b.state = "recover"; b.timer = 0.9 * cdMul;
          shake(20); game.flash = 0.12; audio.play("boom");
          dust(centerX(b), GROUND_Y, 24);
          [-1, 1].forEach((dir) => game.shockwaves.push({ x: centerX(b), dir, speed: rage ? 470 : 400, life: 1.8, h: 30, dmg: 20, hitDone: false }));
        }
        break;

      case "meteor-cast":
        b.vx = 0;
        if (b.timer <= 0) { b.state = "recover"; b.timer = 1.0 * cdMul; }
        break;

      case "recover":
        b.vx *= 0.85;
        if (b.timer <= 0) { b.state = "idle"; b.timer = rand(0.5, 0.9) * cdMul; }
        break;

      default:
        b.state = "idle";
        break;
    }

    moveBody(b, dt, { ignorePlatforms: true });
    if (Math.abs(b.vx) > 20 && b.onGround) b.walkPhase += dt * 7;
    if (overlap(b, p) && b.state !== "charge") damagePlayer(def.touch, centerX(b), 380);
  }

  function startBossAttack(b, kind, rage) {
    const p = game.player;
    b.facing = centerX(p) > centerX(b) ? 1 : -1;
    switch (kind) {
      case "slash":
        b.state = "slash-windup"; b.timer = rage ? 0.38 : 0.48;
        game.warnings.push({ kind: "zone", x: b.facing > 0 ? b.x + b.w - 10 : b.x - 130, y: b.y + 20, w: 140, h: b.h - 20, life: b.timer, max: b.timer });
        break;
      case "charge": {
        b.state = "charge-windup"; b.timer = 0.85;
        const fromX = b.facing > 0 ? b.x + b.w : 0;
        const toX = b.facing > 0 ? game.worldW : b.x;
        game.warnings.push({ kind: "lane", x: fromX, y: GROUND_Y - b.h, w: toX - fromX, h: b.h, life: 0.85, max: 0.85 });
        game.warnings.push({ kind: "bang", x: centerX(b), y: b.y - 30, life: 0.85, max: 0.85 });
        audio.play("warning");
        break;
      }
      case "slam":
        b.state = "slam-windup"; b.timer = 0.55;
        game.warnings.push({ kind: "bang", x: centerX(b), y: b.y - 30, life: 0.55, max: 0.55 });
        game.warnings.push({ kind: "ground", x: 0, y: GROUND_Y - 4, w: game.worldW, h: 4, life: 1.3, max: 1.3 });
        break;
      case "meteor": {
        b.state = "meteor-cast"; b.timer = 1.0;
        const count = rage ? 7 : 5;
        const xs = [centerX(p)];
        while (xs.length < count) {
          const x = rand(60, game.worldW - 60);
          if (xs.every((o) => Math.abs(o - x) > 80)) xs.push(x);
        }
        xs.forEach((x, i) => game.meteors.push({ x, y: -40 - i * 30, delay: 0.95 + i * 0.12, state: "warn", r: 42, dmg: 16, vy: 0 }));
        audio.play("warning");
        break;
      }
      default:
        b.state = "idle"; b.timer = 0.5;
    }
  }

  function defeatBoss(b) {
    game.slowMo = 1.6;
    game.flash = 0.6;
    ui.bossBar.hidden = true;
    game.enemies.forEach((e) => { if (e !== b && !e.dead) { e.dead = true; e.deathTimer = 0.4; burst(centerX(e), centerY(e), e.def.color, 12, 200); } });
    game.projectiles = [];
    game.shockwaves = [];
    game.meteors = [];
    game.warnings = [];
    showBanner("BOSS DEFEATED", "АНХАА 👑", "", "is-good");
    game.state = "victory-wait";
    game.endTimer = 2.8;
    audio.play("victory");
    for (let i = 0; i < 6; i += 1) setTimeout(() => burst(rand(200, 760), rand(120, 300), ["#F0C463", "#F2B9C5", "#9B7BFF", "#3FB8A8"][i % 4], 24, 320), i * 250);
  }

  /* ======================================================================
     PROJECTILES, SHOCKWAVES, METEORS, COINS
     ====================================================================== */
  function updateHazards(dt) {
    const p = game.player;

    for (const pr of game.projectiles) {
      pr.trail.push({ x: pr.x, y: pr.y });
      if (pr.trail.length > 8) pr.trail.shift();
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.y > GROUND_Y - pr.r) { pr.dead = true; sparks(pr.x, GROUND_Y - 4, pr.color, 5); }
      if (pr.life <= 0 || pr.x < -40 || pr.x > game.worldW + 40) pr.dead = true;
      if (!pr.dead && pr.hostile && overlap({ x: pr.x - pr.r + 3, y: pr.y - pr.r + 3, w: pr.r * 2 - 6, h: pr.r * 2 - 6 }, p)) {
        if (damagePlayer(pr.dmg, pr.x, 280)) { pr.dead = true; sparks(pr.x, pr.y, pr.color, 10); }
      }
    }
    game.projectiles = game.projectiles.filter((pr) => !pr.dead);

    for (const s of game.shockwaves) {
      s.x += s.dir * s.speed * dt;
      s.life -= dt;
      if (Math.random() < 0.5) particle(s.x, GROUND_Y - 4, rand(-40, 40), rand(-160, -60), 0.4, "#FFB38A", 3);
      const box = { x: s.x - 18, y: GROUND_Y - s.h, w: 36, h: s.h };
      if (!s.hitDone && overlap(box, p)) s.hitDone = damagePlayer(s.dmg, s.x, 360);
    }
    game.shockwaves = game.shockwaves.filter((s) => s.life > 0 && s.x > -40 && s.x < game.worldW + 40);

    for (const m of game.meteors) {
      m.delay -= dt;
      if (m.state === "warn" && m.delay <= 0) { m.state = "fall"; m.y = -40; m.vy = 900; }
      if (m.state === "fall") {
        m.vy += 1600 * dt;
        m.y += m.vy * dt;
        if (Math.random() < 0.8) particle(m.x + rand(-6, 6), m.y - 10, rand(-30, 30), rand(-80, -20), 0.35, "#FF9A5A", 3);
        if (m.y >= GROUND_Y - 10) {
          m.state = "done";
          shake(7);
          audio.play("boom");
          burst(m.x, GROUND_Y - 6, "#FF8A4A", 14, 260);
          const box = { x: m.x - m.r, y: GROUND_Y - 70, w: m.r * 2, h: 70 };
          if (overlap(box, p)) damagePlayer(m.dmg, m.x, 340);
        }
      }
    }
    game.meteors = game.meteors.filter((m) => m.state !== "done");

    for (const w of game.warnings) w.life -= dt;
    game.warnings = game.warnings.filter((w) => w.life > 0);
  }

  function dropCoin(x, y) {
    game.coins.push({ x, y, vx: rand(-160, 160), vy: rand(-520, -320), r: 8, float: false, phase: rand(0, 6), magnet: false, life: 12, onGround: false });
  }

  function updateCoins(dt) {
    const p = game.player;
    const px = centerX(p);
    const py = centerY(p);
    for (const c of game.coins) {
      c.phase += dt * 5;
      if (c.life !== Infinity) c.life -= dt;
      const dx = px - c.x;
      const dy = py - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 70 || c.magnet) c.magnet = true;
      if (c.magnet && !p.dead) {
        const sp = 900;
        c.x += (dx / (d || 1)) * sp * dt;
        c.y += (dy / (d || 1)) * sp * dt;
      } else if (!c.float) {
        c.vy += GRAVITY * 0.8 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.vx *= 0.98;
        if (c.y + c.r >= GROUND_Y) { c.y = GROUND_Y - c.r; c.vy *= -0.4; c.vx *= 0.7; if (Math.abs(c.vy) < 40) c.vy = 0; }
        c.x = clamp(c.x, 10, game.worldW - 10);
      }
      if (!p.dead && d < 26) {
        c.collected = true;
        addScore(SCORE_RULES.coin, "coins");
        sparks(c.x, c.y, "#F0C463", 5);
        audio.play("coin");
      }
    }
    game.coins = game.coins.filter((c) => !c.collected && c.life > 0);
  }

  /* ======================================================================
     EFFECTS
     ====================================================================== */
  const MAX_PARTICLES = 260;

  function particle(x, y, vx, vy, life, color, size, gravity) {
    if (game.particles.length >= MAX_PARTICLES) game.particles.shift();
    game.particles.push({ x, y, vx, vy, life, max: life, color, size, gravity: gravity === undefined ? 900 : gravity });
  }

  function burst(x, y, color, count, power) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2);
      const s = rand(power * 0.3, power);
      particle(x, y, Math.cos(a) * s, Math.sin(a) * s - 80, rand(0.35, 0.8), color, rand(2, 5));
    }
  }

  function sparks(x, y, color, count) {
    for (let i = 0; i < count; i += 1) particle(x, y, rand(-260, 260), rand(-260, 120), rand(0.15, 0.35), color, rand(1.5, 3), 400);
  }

  function dust(x, y, count) {
    for (let i = 0; i < count; i += 1) particle(x + rand(-12, 12), y - 2, rand(-120, 120), rand(-120, -20), rand(0.25, 0.5), "rgba(220,200,210,.55)", rand(2, 4), 300);
  }

  function ring(x, y, color) {
    game.particles.push({ x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, color, size: 10, ring: true, gravity: 0 });
  }

  function floatText(x, y, text, color, size) {
    game.texts.push({ x, y, text, color, size: size || 16, life: 0.9, max: 0.9 });
  }

  function shake(amount) { game.cam.shake = Math.max(game.cam.shake, amount); }

  function updateEffects(dt) {
    for (const pt of game.particles) {
      pt.vy += pt.gravity * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
    }
    game.particles = game.particles.filter((pt) => pt.life > 0);
    for (const t of game.texts) { t.y -= 50 * dt; t.life -= dt; }
    game.texts = game.texts.filter((t) => t.life > 0);
    game.flash = Math.max(0, game.flash - dt);

    const c = game.cam;
    c.shake = Math.max(0, c.shake - dt * 40);
    c.shakeX = c.shake > 0 ? rand(-c.shake, c.shake) : 0;
    c.shakeY = c.shake > 0 ? rand(-c.shake, c.shake) * 0.6 : 0;
    if (game.player) {
      const target = clamp(centerX(game.player) - VIEW_W * 0.42, 0, Math.max(0, game.worldW - VIEW_W));
      c.x = lerp(c.x, target, Math.min(1, dt * 6));
    }
  }

  /* ======================================================================
     BACKGROUND (pre-rendered per stage)
     ====================================================================== */
  function buildBackground(stage) {
    const theme = THEMES[stage.theme];
    const rnd = seeded(stage.theme * 97 + 11);
    const layers = [
      { factor: 0.12, color: theme.far, base: 300, amp: 120, step: 120 },
      { factor: 0.3, color: theme.mid, base: 360, amp: 80, step: 70 },
      { factor: 0.55, color: theme.near, base: 410, amp: 46, step: 40 }
    ].map((layer, li) => {
      const width = Math.ceil(VIEW_W + (stage.worldW - VIEW_W) * layer.factor) + 40;
      const off = document.createElement("canvas");
      off.width = width;
      off.height = VIEW_H;
      const c = off.getContext("2d");
      c.fillStyle = layer.color;
      c.beginPath();
      c.moveTo(0, VIEW_H);
      let y = layer.base;
      for (let x = 0; x <= width + layer.step; x += layer.step) {
        y = clamp(y + rand2(rnd, -layer.amp, layer.amp) * 0.6, layer.base - layer.amp, layer.base + layer.amp * 0.4);
        if (li === 0) { c.lineTo(x, y); c.lineTo(x + layer.step * 0.5, y - layer.amp * 0.5 * rnd()); }
        else c.lineTo(x, y);
      }
      c.lineTo(width, VIEW_H);
      c.closePath();
      c.fill();
      if (li === 2) {
        // ruins / pillars on the nearest layer
        for (let x = 60; x < width; x += 180 + rnd() * 200) {
          const h = 60 + rnd() * 90;
          c.fillRect(x, 420 - h, 18, h + 60);
          c.fillRect(x - 6, 420 - h, 30, 8);
        }
      }
      return { canvas: off, factor: layer.factor };
    });
    const stars = Array.from({ length: 60 }, () => ({ x: rnd() * VIEW_W, y: rnd() * 260, r: rnd() * 1.4 + 0.3, tw: rnd() * 6 }));
    const embers = Array.from({ length: 26 }, () => ({ x: rnd() * VIEW_W, y: rnd() * VIEW_H, s: 10 + rnd() * 30, r: rnd() * 1.8 + 0.6, ph: rnd() * 6 }));
    return { theme, layers, stars, embers };
  }

  function rand2(rnd, a, b) { return a + rnd() * (b - a); }

  /* ======================================================================
     CHARACTER DRAWING — simple stylized vector characters
     ====================================================================== */
  function drawShadow(c, x, w) {
    c.fillStyle = "rgba(0,0,0,.35)";
    c.beginPath();
    c.ellipse(x, GROUND_Y + 2, w * 0.55, 5, 0, 0, Math.PI * 2);
    c.fill();
  }

  function legs(c, cx, footY, spread, phase, color, len, width) {
    const swing = Math.sin(phase) * spread;
    c.strokeStyle = color;
    c.lineWidth = width || 6;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(cx - 5, footY - len); c.lineTo(cx - 5 + swing, footY);
    c.moveTo(cx + 5, footY - len); c.lineTo(cx + 5 - swing, footY);
    c.stroke();
  }

  function eyes(c, x, y, gap, color, angry) {
    c.fillStyle = color || "#fff";
    c.fillRect(x - gap / 2 - 3, y, 4, 4);
    c.fillRect(x + gap / 2 - 1, y, 4, 4);
    if (angry) {
      c.strokeStyle = "#140C12";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - gap / 2 - 5, y - 4); c.lineTo(x - gap / 2 + 2, y - 1);
      c.moveTo(x + gap / 2 + 5, y - 4); c.lineTo(x + gap / 2 - 2, y - 1);
      c.stroke();
    }
  }

  function drawHero(c, p, t) {
    const w = p.w;
    const h = p.h;
    const footY = p.y + h;
    const cx = p.x + w / 2;
    const moving = Math.abs(p.vx) > 20 && p.onGround;
    const bob = moving ? Math.abs(Math.sin(p.walkPhase)) * 2 : Math.sin(t * 3) * 0.8;
    const sq = p.squash * 0.12;

    c.save();
    c.translate(cx, footY);
    c.scale(p.facing * (1 + sq), 1 - sq);
    c.translate(-cx, -footY);

    // legs
    if (p.onGround) legs(c, cx, footY, moving ? 7 : 0, p.walkPhase, "#2B2440", 18, 6);
    else { c.strokeStyle = "#2B2440"; c.lineWidth = 6; c.lineCap = "round"; c.beginPath(); c.moveTo(cx - 5, footY - 18); c.lineTo(cx - 8, footY - 6); c.moveTo(cx + 5, footY - 18); c.lineTo(cx + 9, footY - 9); c.stroke(); }

    const top = p.y - bob + 4;
    // scarf (trails behind)
    const flutter = Math.sin(t * 12) * 3;
    c.fillStyle = "#C2415E";
    c.beginPath();
    c.moveTo(cx - 6, top + 16);
    c.quadraticCurveTo(cx - 22, top + 14 + flutter, cx - 30, top + 22 + flutter);
    c.lineTo(cx - 24, top + 26 + flutter);
    c.quadraticCurveTo(cx - 16, top + 22, cx - 4, top + 22);
    c.fill();

    // body
    c.fillStyle = "#3A3460";
    roundRect(c, cx - 11, top + 16, 22, 24, 7);
    c.fill();
    c.fillStyle = "#C2415E";
    c.fillRect(cx - 11, top + 16, 22, 5);

    // head
    c.fillStyle = "#F2D3C2";
    c.beginPath();
    c.arc(cx, top + 8, 10, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#231B2E";
    c.beginPath();
    c.arc(cx - 1, top + 5, 10.5, Math.PI * 1.05, Math.PI * 2.05);
    c.fill();
    c.fillRect(cx - 11, top + 3, 6, 9);
    eyes(c, cx + 3, top + 7, 7, "#231B2E", false);

    // sword arm
    const attacking = p.attackTimer > 0;
    const prog = attacking ? 1 - p.attackTimer / PLAYER.attackTime : 0;
    const angle = attacking ? lerp(-1.9, 1.1, Math.min(1, prog * 1.6)) : 0.6 + Math.sin(t * 3) * 0.05;
    c.save();
    c.translate(cx + 6, top + 24);
    c.rotate(angle);
    c.fillStyle = "#3A3460";
    roundRect(c, -3, -3, 14, 6, 3);
    c.fill();
    c.fillStyle = "#8D8AA6";
    c.fillRect(10, -4, 4, 8);
    const blade = c.createLinearGradient(14, 0, 44, 0);
    blade.addColorStop(0, "#E9EEF7");
    blade.addColorStop(1, "#9FB2D4");
    c.fillStyle = blade;
    c.beginPath();
    c.moveTo(14, -3); c.lineTo(42, -2); c.lineTo(46, 0); c.lineTo(42, 2); c.lineTo(14, 3);
    c.fill();
    c.restore();

    // slash arc
    if (attacking && prog < 0.75) {
      c.save();
      c.globalAlpha = 0.85 * (1 - prog);
      c.strokeStyle = "#FFF4E0";
      c.lineWidth = 5;
      c.lineCap = "round";
      c.beginPath();
      c.arc(cx + 8, top + 26, 44, -1.4, lerp(-1.4, 1.1, Math.min(1, prog * 1.8)));
      c.stroke();
      c.strokeStyle = "rgba(242,185,197,.6)";
      c.lineWidth = 12;
      c.beginPath();
      c.arc(cx + 8, top + 26, 38, -1.2, lerp(-1.2, 0.9, Math.min(1, prog * 1.8)));
      c.stroke();
      c.restore();
    }
    c.restore();
  }

  function nameTag(c, e, text, color) {
    c.font = "700 10px " + FONT_UI;
    const tw = c.measureText(text).width;
    const x = centerX(e);
    const y = e.y - 22;
    c.fillStyle = "rgba(10,7,11,.72)";
    roundRect(c, x - tw / 2 - 6, y - 10, tw + 12, 15, 7);
    c.fill();
    c.fillStyle = color;
    c.textAlign = "center";
    c.fillText(text, x, y + 1);
    // hp bar
    if (e.hp < e.maxHp && !e.dead) {
      c.fillStyle = "rgba(0,0,0,.6)";
      c.fillRect(x - 18, y + 7, 36, 4);
      c.fillStyle = color;
      c.fillRect(x - 18, y + 7, 36 * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  function drawEnemy(c, e, t) {
    const def = e.def;
    const cx = centerX(e);
    const footY = e.y + e.h;
    const moving = Math.abs(e.vx) > 15 && e.onGround;
    const bob = moving ? Math.abs(Math.sin(e.walkPhase)) * 2 : Math.sin(t * 2.5 + e.walkPhase) * 1;
    const windup = e.state === "windup" || e.state === "charge" || e.state.indexOf("windup") >= 0;

    c.save();
    if (e.dead) {
      const k = Math.max(0, e.deathTimer / (e.type === "anhaa" ? 2.4 : 0.45));
      c.globalAlpha = k;
      c.translate(cx, footY);
      c.scale(1 + (1 - k) * 0.3, k);
      c.translate(-cx, -footY);
    } else if (e.spawnFade > 0) {
      c.globalAlpha = 1 - e.spawnFade / 0.4;
    }

    c.translate(cx, 0);
    c.scale(e.facing, 1);
    c.translate(-cx, 0);

    const flashing = e.flash > 0;
    const body = flashing ? "#FFFFFF" : def.color;

    switch (e.type) {
      case "tuvshuu": {
        legs(c, cx, footY, moving ? 6 : 0, e.walkPhase, "#1F5C55", 12, 6);
        const top = e.y + 6 - bob;
        c.fillStyle = body;
        roundRect(c, cx - 15, top + 4, 30, 26, 13);
        c.fill();
        c.fillStyle = flashing ? "#fff" : "#2C8578";
        c.beginPath(); c.arc(cx, top + 6, 11, Math.PI, 0); c.fill(); // beanie
        c.fillStyle = "#F2F2F2"; c.beginPath(); c.arc(cx, top - 6, 3.5, 0, Math.PI * 2); c.fill();
        eyes(c, cx + 3, top + 13, 9, "#0F1E1C", true);
        if (e.state === "lunge" || windup) { c.fillStyle = "#E6FFF9"; c.beginPath(); c.arc(cx + 17, top + 20, 5, 0, Math.PI * 2); c.fill(); }
        break;
      }
      case "ganaa": {
        legs(c, cx, footY, moving ? 8 : 0, e.walkPhase, "#5A3416", 16, 7);
        const top = e.y + 2 - bob;
        c.fillStyle = body;
        roundRect(c, cx - 15, top + 16, 30, 22, 6);
        c.fill();
        c.fillStyle = flashing ? "#fff" : "#B8621E";
        roundRect(c, cx - 13, top - 2, 26, 20, 6); c.fill(); // helmet
        c.fillStyle = "#1B0F08"; c.fillRect(cx - 8, top + 7, 18, 4); // visor slit
        c.fillStyle = "#FFDCA8"; c.fillRect(cx + 2, top + 8, 4, 2);
        // axe
        const swing = e.state === "windup" ? -1.2 : e.state === "strike" ? 1.0 : 0.2;
        c.save(); c.translate(cx + 10, top + 24); c.rotate(swing);
        c.fillStyle = "#6B4A2E"; c.fillRect(0, -2, 28, 4);
        c.fillStyle = flashing ? "#fff" : "#D9D4CC"; c.beginPath(); c.moveTo(24, -10); c.quadraticCurveTo(36, 0, 24, 10); c.lineTo(22, 0); c.fill();
        c.restore();
        break;
      }
      case "teka": {
        legs(c, cx, footY, moving ? 5 : 0, e.walkPhase, "#3B2A6E", 12, 5);
        const top = e.y + 4 - bob;
        c.fillStyle = body;
        c.beginPath(); c.moveTo(cx - 14, footY - 10); c.lineTo(cx - 8, top + 14); c.lineTo(cx + 8, top + 14); c.lineTo(cx + 14, footY - 10); c.closePath(); c.fill(); // robe
        c.fillStyle = flashing ? "#fff" : "#6E4FD8";
        c.beginPath(); c.moveTo(cx - 12, top + 18); c.quadraticCurveTo(cx, top - 14, cx + 12, top + 18); c.closePath(); c.fill(); // hood
        c.fillStyle = "#120B24"; c.beginPath(); c.arc(cx + 1, top + 11, 6.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#7CF7FF"; c.fillRect(cx + 1, top + 9, 3, 3); c.fillRect(cx - 4, top + 9, 3, 3);
        // staff + orb
        c.strokeStyle = "#C9B78E"; c.lineWidth = 3; c.beginPath(); c.moveTo(cx + 14, footY - 4); c.lineTo(cx + 16, top - 2); c.stroke();
        const glow = e.state === "charge" ? 12 + Math.sin(t * 40) * 3 : 7;
        const g = c.createRadialGradient(cx + 16, top - 6, 1, cx + 16, top - 6, glow + 6);
        g.addColorStop(0, "#FFFFFF"); g.addColorStop(0.4, "#B9A2FF"); g.addColorStop(1, "rgba(155,123,255,0)");
        c.fillStyle = g; c.beginPath(); c.arc(cx + 16, top - 6, glow + 6, 0, Math.PI * 2); c.fill();
        break;
      }
      case "erhmee": {
        legs(c, cx, footY, moving ? 6 : 0, e.walkPhase, "#5A1916", 18, 10);
        const top = e.y + 2 - bob;
        c.fillStyle = body;
        roundRect(c, cx - 24, top + 18, 48, 32, 12); c.fill(); // torso
        c.fillStyle = flashing ? "#fff" : "#B1322B";
        roundRect(c, cx - 14, top, 28, 24, 9); c.fill(); // head
        c.fillStyle = "#F4E6D0"; // horns
        c.beginPath(); c.moveTo(cx - 12, top + 4); c.lineTo(cx - 22, top - 10); c.lineTo(cx - 6, top + 2); c.fill();
        c.beginPath(); c.moveTo(cx + 12, top + 4); c.lineTo(cx + 22, top - 10); c.lineTo(cx + 6, top + 2); c.fill();
        eyes(c, cx + 4, top + 9, 10, "#FFE36B", true);
        // club
        const raise = e.state === "windup" ? -2.3 : e.state === "slam" ? 0.9 : 0.4;
        c.save(); c.translate(cx + 18, top + 30); c.rotate(raise);
        c.fillStyle = "#4A2A1A"; roundRect(c, 0, -4, 40, 8, 4); c.fill();
        c.fillStyle = flashing ? "#fff" : "#6B4030"; roundRect(c, 30, -11, 22, 22, 8); c.fill();
        c.restore();
        if (e.state === "windup") { c.fillStyle = "rgba(255,80,60,.25)"; c.beginPath(); c.arc(cx, top + 20, 40 + Math.sin(t * 30) * 3, 0, Math.PI * 2); c.fill(); }
        break;
      }
      case "anhaa": drawBoss(c, e, t, flashing, bob); break;
      default: break;
    }
    c.restore();

    if (e.type !== "anhaa" && !e.dead && !e.noTag) nameTag(c, e, def.name, def.color);
  }

  function drawBoss(c, b, t, flashing, bob) {
    const cx = centerX(b);
    const footY = b.y + b.h;
    const rage = b.phase === 2;
    const top = b.y + 6 - bob;

    // aura
    if (rage || b.state === "roar") {
      const r = 90 + Math.sin(t * 8) * 6;
      const g = c.createRadialGradient(cx, top + 60, 10, cx, top + 60, r);
      g.addColorStop(0, rage ? "rgba(255,60,60,.35)" : "rgba(240,196,99,.3)");
      g.addColorStop(1, "rgba(255,60,60,0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(cx, top + 60, r, 0, Math.PI * 2); c.fill();
    }

    // cape
    c.fillStyle = flashing ? "#fff" : "#7A1F35";
    c.beginPath();
    c.moveTo(cx - 26, top + 34);
    c.quadraticCurveTo(cx - 60, top + 80 + Math.sin(t * 4) * 6, cx - 50, footY - 4);
    c.lineTo(cx + 10, footY - 8);
    c.lineTo(cx + 18, top + 34);
    c.fill();

    legs(c, cx, footY, Math.abs(b.vx) > 20 ? 10 : 0, b.walkPhase, "#14101A", 30, 14);

    // armor torso
    c.fillStyle = flashing ? "#fff" : "#1D1826";
    roundRect(c, cx - 34, top + 30, 68, 56, 16); c.fill();
    c.strokeStyle = flashing ? "#fff" : "#F0C463";
    c.lineWidth = 3;
    roundRect(c, cx - 34, top + 30, 68, 56, 16); c.stroke();
    c.fillStyle = "#F0C463";
    c.beginPath(); c.moveTo(cx, top + 42); c.lineTo(cx + 9, top + 58); c.lineTo(cx, top + 74); c.lineTo(cx - 9, top + 58); c.closePath(); c.fill();

    // shoulders
    c.fillStyle = flashing ? "#fff" : "#2A2236";
    c.beginPath(); c.arc(cx - 32, top + 36, 14, 0, Math.PI * 2); c.arc(cx + 32, top + 36, 14, 0, Math.PI * 2); c.fill();

    // head + crown
    c.fillStyle = flashing ? "#fff" : "#26202F";
    roundRect(c, cx - 20, top, 40, 34, 12); c.fill();
    const eyeColor = rage ? "#FF4D4D" : "#FFD27A";
    c.fillStyle = eyeColor;
    c.shadowColor = eyeColor; c.shadowBlur = 12;
    c.fillRect(cx - 2, top + 14, 10, 5); c.fillRect(cx + 12, top + 14, 6, 5);
    c.shadowBlur = 0;
    c.fillStyle = "#F0C463";
    c.beginPath();
    c.moveTo(cx - 20, top + 2);
    c.lineTo(cx - 20, top - 14); c.lineTo(cx - 10, top - 4); c.lineTo(cx, top - 20); c.lineTo(cx + 10, top - 4); c.lineTo(cx + 20, top - 14);
    c.lineTo(cx + 20, top + 2);
    c.closePath(); c.fill();
    c.fillStyle = "#C2415E"; c.beginPath(); c.arc(cx, top - 8, 3, 0, Math.PI * 2); c.fill();

    // greatsword
    let angle = 0.5;
    if (b.state === "slash-windup") angle = -2.2;
    else if (b.state === "slash") angle = 1.2;
    else if (b.state === "charge-windup" || b.state === "charge") angle = 0;
    else if (b.state === "slam-windup" || b.state === "slam-air") angle = -1.4;
    else if (b.state === "meteor-cast") angle = -1.57 + Math.sin(t * 10) * 0.1;
    c.save();
    c.translate(cx + 30, top + 54);
    c.rotate(angle);
    c.fillStyle = "#3A2F45"; roundRect(c, -4, -5, 22, 10, 4); c.fill();
    c.fillStyle = "#F0C463"; c.fillRect(16, -10, 6, 20);
    const blade = c.createLinearGradient(22, 0, 110, 0);
    blade.addColorStop(0, rage ? "#FFB0B0" : "#E9EEF7");
    blade.addColorStop(1, rage ? "#FF4D4D" : "#8FA3C8");
    c.fillStyle = flashing ? "#fff" : blade;
    c.beginPath(); c.moveTo(22, -7); c.lineTo(104, -5); c.lineTo(116, 0); c.lineTo(104, 5); c.lineTo(22, 7); c.fill();
    c.restore();

    if (b.state === "slash" && b.timer > 0) {
      c.save();
      c.globalAlpha = 0.7;
      c.strokeStyle = rage ? "#FF6B6B" : "#FFF4E0";
      c.lineWidth = 10;
      c.beginPath(); c.arc(cx + 30, top + 54, 100, -1.6, 1.2); c.stroke();
      c.restore();
    }
    if (b.state === "stunned") {
      c.fillStyle = "#FFE36B";
      for (let i = 0; i < 3; i += 1) {
        const a = t * 6 + i * 2.1;
        c.beginPath(); c.arc(cx + Math.cos(a) * 26, top - 24 + Math.sin(a) * 6, 4, 0, Math.PI * 2); c.fill();
      }
    }
  }

  /* ======================================================================
     RENDER
     ====================================================================== */
  let canvasScale = 1;

  function resizeCanvas() {
    const rect = frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvasScale = Math.min(w / VIEW_W, h / VIEW_H);
    // "Compact" = the natural 16:9 frame would be too short for menus. Computed from width/viewport
    // (not the current height) so opening a menu cannot toggle it back and forth.
    const naturalH = Math.min(frame.clientWidth * 9 / 16, window.innerHeight - 64);
    frame.classList.toggle("is-compact", naturalH < 330);
    const portraitPhone = document.documentElement.classList.contains("has-touch") && window.innerHeight > window.innerWidth;
    ui.rotateHint.hidden = !(portraitPhone && game.state === "playing" && game.stageIndex === 0 && game.time < 6);
  }

  function render(t) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0A070B";
    ctx.fillRect(0, 0, W, H);
    const ox = (W - VIEW_W * canvasScale) / 2;
    const oy = (H - VIEW_H * canvasScale) / 2;
    ctx.setTransform(canvasScale, 0, 0, canvasScale, ox, oy);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();

    drawBackground(t);

    const cam = game.cam;
    ctx.save();
    ctx.translate(-Math.round(cam.x) + cam.shakeX, cam.shakeY);

    drawGround();
    drawPlatforms();
    drawWarnings(t);
    drawCoins(t);
    for (const e of game.enemies) drawShadow(ctx, centerX(e), e.w);
    if (game.player) drawShadow(ctx, centerX(game.player), game.player.w);
    for (const e of game.enemies) drawEnemy(ctx, e, t);
    if (game.player && game.state !== "menu") drawPlayer(t);
    drawHazards(t);
    drawParticles();
    drawTexts();
    ctx.restore();

    if (game.flash > 0) {
      ctx.fillStyle = "rgba(255,240,240," + Math.min(0.5, game.flash * 1.6) + ")";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // low HP vignette
    if (game.player && game.player.hp > 0 && game.player.hp <= 30 && game.state === "playing") {
      const v = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85);
      v.addColorStop(0, "rgba(120,0,20,0)");
      v.addColorStop(1, "rgba(160,0,30," + (0.28 + Math.sin(t * 6) * 0.08) + ")");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.restore();
  }

  function drawPlayer(t) {
    const p = game.player;
    if (p.dead) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.deadTimer / 1.4);
      ctx.translate(centerX(p), p.y + p.h);
      ctx.rotate(Math.min(1.4, p.deadTimer * 2) * -p.facing);
      ctx.translate(-centerX(p), -(p.y + p.h));
      drawHero(ctx, p, t);
      ctx.restore();
      return;
    }
    // i-frames: flicker to semi-transparent (never fully invisible, so the player is always trackable)
    const blink = p.invincible > 0 && Math.floor(p.invincible * 16) % 2 === 0 && p.controlLock <= 0;
    ctx.save();
    if (blink) ctx.globalAlpha = 0.35;
    drawHero(ctx, p, t);
    ctx.restore();
  }

  function drawBackground(t) {
    const bg = game.bg;
    if (!bg) return;
    const th = bg.theme;
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, th.sky[0]);
    sky.addColorStop(0.55, th.sky[1]);
    sky.addColorStop(1, th.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    for (const s of bg.stars) {
      ctx.globalAlpha = 0.4 + Math.sin(t * 2 + s.tw) * 0.3;
      ctx.fillStyle = "#fff";
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // moon
    const mx = 760 - game.cam.x * 0.04;
    const moon = ctx.createRadialGradient(mx, 110, 10, mx, 110, 90);
    moon.addColorStop(0, th.moon);
    moon.addColorStop(0.35, th.moon);
    moon.addColorStop(0.36, "rgba(255,255,255,.12)");
    moon.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = moon;
    ctx.beginPath(); ctx.arc(mx, 110, 90, 0, Math.PI * 2); ctx.fill();

    for (const layer of bg.layers) {
      ctx.drawImage(layer.canvas, -Math.round(game.cam.x * layer.factor), 0);
    }

    // drifting embers
    for (const e of bg.embers) {
      const x = (e.x - game.cam.x * 0.7 + t * e.s * 0.6) % (VIEW_W + 20);
      const y = (e.y - t * e.s + VIEW_H * 2) % VIEW_H;
      ctx.globalAlpha = 0.5 + Math.sin(t * 3 + e.ph) * 0.3;
      ctx.fillStyle = th.ember;
      ctx.beginPath(); ctx.arc(x < 0 ? x + VIEW_W + 20 : x, y, e.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // fog band
    const fog = ctx.createLinearGradient(0, 380, 0, GROUND_Y);
    fog.addColorStop(0, "rgba(0,0,0,0)");
    fog.addColorStop(1, "rgba(10,6,12,.55)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 380, VIEW_W, GROUND_Y - 380);
  }

  function drawGround() {
    const th = game.bg ? game.bg.theme : THEMES[0];
    const x0 = Math.floor(game.cam.x / 64) * 64 - 64;
    ctx.fillStyle = th.ground;
    ctx.fillRect(game.cam.x - 40, GROUND_Y, VIEW_W + 80, VIEW_H - GROUND_Y + 40);
    ctx.fillStyle = th.groundTop;
    ctx.fillRect(game.cam.x - 40, GROUND_Y, VIEW_W + 80, 3);
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < game.cam.x + VIEW_W + 64; x += 64) {
      ctx.moveTo(x, GROUND_Y + 3); ctx.lineTo(x, GROUND_Y + 34);
      ctx.moveTo(x + 32, GROUND_Y + 34); ctx.lineTo(x + 32, VIEW_H);
    }
    ctx.moveTo(game.cam.x - 40, GROUND_Y + 34); ctx.lineTo(game.cam.x + VIEW_W + 40, GROUND_Y + 34);
    ctx.stroke();
    // world edges
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(-40, 0, 40, VIEW_H);
    ctx.fillRect(game.worldW, 0, 40, VIEW_H);
  }

  function drawPlatforms() {
    const th = game.bg ? game.bg.theme : THEMES[0];
    for (const p of game.platforms) {
      ctx.fillStyle = "rgba(0,0,0,.3)";
      roundRect(ctx, p.x + 4, p.y + 8, p.w, p.h, 6); ctx.fill();
      ctx.fillStyle = th.ground;
      roundRect(ctx, p.x, p.y, p.w, p.h, 6); ctx.fill();
      ctx.fillStyle = th.groundTop;
      roundRect(ctx, p.x, p.y, p.w, 4, 2); ctx.fill();
      ctx.fillStyle = th.accent;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(p.x + 10, p.y + p.h - 3, p.w - 20, 1);
      ctx.globalAlpha = 1;
    }
  }

  function drawCoins(t) {
    for (const c of game.coins) {
      const y = c.float ? c.y + Math.sin(c.phase) * 3 : c.y;
      const squeeze = Math.abs(Math.cos(c.phase * 0.8));
      if (c.life < 3 && c.life !== Infinity && Math.floor(c.life * 10) % 2 === 0) continue;
      ctx.fillStyle = "rgba(240,196,99,.25)";
      ctx.beginPath(); ctx.arc(c.x, y, c.r + 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#F0C463";
      ctx.beginPath(); ctx.ellipse(c.x, y, c.r * Math.max(0.25, squeeze), c.r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#FFF1C2";
      ctx.fillRect(c.x - 1, y - c.r * 0.5, 2, c.r);
    }
  }

  function drawWarnings(t) {
    for (const w of game.warnings) {
      const k = w.life / w.max;
      const blink = 0.35 + Math.abs(Math.sin(t * 18)) * 0.35;
      if (w.kind === "zone" || w.kind === "lane") {
        ctx.fillStyle = "rgba(255,50,60," + (blink * 0.45) + ")";
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = "rgba(255,90,90," + blink + ")";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(w.x, w.y, w.w, w.h);
        ctx.setLineDash([]);
      } else if (w.kind === "ground") {
        ctx.fillStyle = "rgba(255,120,60," + blink + ")";
        ctx.fillRect(w.x, w.y, w.w, w.h);
      } else if (w.kind === "bang") {
        ctx.save();
        ctx.translate(w.x, w.y - (1 - k) * 8);
        ctx.fillStyle = "#FF3B3B";
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "800 20px " + FONT_UI;
        ctx.textAlign = "center";
        ctx.fillText("!", 0, 7);
        ctx.restore();
      }
    }
    for (const m of game.meteors) {
      if (m.state !== "warn" && m.state !== "fall") continue;
      const blink = 0.4 + Math.abs(Math.sin(t * 16)) * 0.4;
      ctx.strokeStyle = "rgba(255,90,60," + blink + ")";
      ctx.fillStyle = "rgba(255,60,40," + blink * 0.25 + ")";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(m.x, GROUND_Y - 2, m.r, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  function drawHazards(t) {
    for (const pr of game.projectiles) {
      pr.trail.forEach((pt, i) => {
        ctx.globalAlpha = (i / pr.trail.length) * 0.4;
        ctx.fillStyle = pr.color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pr.r * (i / pr.trail.length), 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(pr.x, pr.y, 1, pr.x, pr.y, pr.r + 6);
      g.addColorStop(0, "#FFFFFF"); g.addColorStop(0.45, pr.color); g.addColorStop(1, "rgba(155,123,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.r + 6, 0, Math.PI * 2); ctx.fill();
    }
    for (const s of game.shockwaves) {
      const g = ctx.createLinearGradient(s.x, GROUND_Y - s.h, s.x, GROUND_Y);
      g.addColorStop(0, "rgba(255,180,120,0)");
      g.addColorStop(1, "rgba(255,120,60,.95)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s.x - 22, GROUND_Y);
      ctx.quadraticCurveTo(s.x, GROUND_Y - s.h * 2, s.x + 22, GROUND_Y);
      ctx.fill();
    }
    for (const m of game.meteors) {
      if (m.state !== "fall") continue;
      const g = ctx.createRadialGradient(m.x, m.y, 2, m.x, m.y, 22);
      g.addColorStop(0, "#FFF4D0"); g.addColorStop(0.4, "#FF8A4A"); g.addColorStop(1, "rgba(255,80,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.x, m.y, 22, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawParticles() {
    for (const pt of game.particles) {
      const k = pt.life / pt.max;
      ctx.globalAlpha = Math.max(0, k);
      if (pt.ring) {
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 3 * k;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 10 + (1 - k) * 70, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTexts() {
    ctx.textAlign = "center";
    for (const tx of game.texts) {
      ctx.globalAlpha = Math.min(1, tx.life / tx.max * 1.5);
      ctx.font = "800 " + tx.size + "px " + FONT_UI;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(10,6,12,.85)";
      ctx.strokeText(tx.text, tx.x, tx.y);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
  }

  /* ======================================================================
     HUD & UI
     ====================================================================== */
  let lastHud = { hp: -1, score: -1 };

  function updateHud(force) {
    const p = game.player;
    if (!p) return;
    if (force || p.hp !== lastHud.hp) {
      const pct = Math.max(0, p.hp / PLAYER.maxHp) * 100;
      ui.hpFill.style.width = pct + "%";
      ui.hpText.textContent = String(Math.ceil(p.hp));
      ui.hpWrap.classList.toggle("is-low", p.hp <= 30);
      lastHud.hp = p.hp;
    }
    if (force || game.score !== lastHud.score) {
      ui.score.textContent = pad(game.score, 4);
      if (!force) { ui.scoreWrap.classList.remove("bump"); void ui.scoreWrap.offsetWidth; ui.scoreWrap.classList.add("bump"); }
      lastHud.score = game.score;
    }
    ui.atk.textContent = String(PLAYER.attack);
  }

  function addScore(points, bucket) {
    game.score += points;
    if (game.breakdown && bucket) game.breakdown[bucket] += points;
    updateHud();
  }

  let bannerTimer = null;
  function showBanner(title, sub, kicker, cls) {
    ui.bannerTitle.textContent = title;
    ui.bannerSub.textContent = sub || "";
    ui.bannerKicker.textContent = kicker || "";
    ui.banner.className = "banner";
    if (cls) ui.banner.classList.add(cls);
    ui.banner.hidden = false;
    void ui.banner.offsetWidth;
    ui.banner.classList.add("is-showing");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { ui.banner.hidden = true; }, 2300);
  }

  function floatBanner(text) {
    floatText(game.cam.x + VIEW_W / 2, 150, text, "#F0C463", 22);
  }

  function hideOverlays() {
    ui.start.hidden = true;
    ui.pause.hidden = true;
    ui.end.hidden = true;
  }

  function showMenu() {
    game.state = "menu";
    input.clear();
    hideOverlays();
    ui.start.hidden = false;
    ui.hud.hidden = true;
    ui.bossBar.hidden = true;
    ui.banner.hidden = true;
    game.player = null;
    game.enemies = [];
    game.stageIndex = 0;
    game.bg = buildBackground(STAGES[0]);
    game.cam.x = 0;
  }

  function togglePause(force) {
    if (game.state === "playing" && force !== false) {
      game.state = "paused";
      input.clear();
      ui.pause.hidden = false;
      ui.resumeBtn.focus();
    } else if (game.state === "paused" && force !== true) {
      game.state = "playing";
      ui.pause.hidden = true;
      lastFrame = performance.now();
    }
  }

  function finishRun(victory) {
    const p = game.player;
    if (victory) {
      const hpBonus = Math.round(p.hp * SCORE_RULES.hpBonusPerPoint);
      const timeBonus = Math.round(clamp((SCORE_RULES.timeBonusPar - game.runTime) / SCORE_RULES.timeBonusPar, 0, 1) * SCORE_RULES.timeBonusMax);
      addScore(hpBonus, "hp");
      addScore(timeBonus, "time");
    }
    game.score = Math.min(game.score, MAX_POSSIBLE_SCORE);
    game.state = "over";
    input.clear();
    ui.hud.hidden = true;
    ui.bossBar.hidden = true;

    ui.end.classList.toggle("is-victory", victory);
    ui.end.classList.toggle("is-defeat", !victory);
    ui.endKicker.textContent = victory ? "FINAL BOSS DEFEATED" : (STAGES[game.stageIndex].label);
    ui.endTitle.textContent = victory ? "VICTORY!" : "GAME OVER";
    ui.endScore.textContent = "0";
    const b = game.breakdown;
    const rows = [["Enemies", b.enemies], ["Coins", b.coins], ["Stages", b.stage], ["No damage", b.flawless]];
    if (victory) rows.push(["HP bonus", b.hp], ["Time bonus", b.time]);
    rows.push(["Time", formatTime(game.runTime)]);
    ui.endBreakdown.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${typeof v === "number" ? "+" + v : v}</dd></div>`).join("");
    ui.end.hidden = false;
    countUp(ui.endScore, game.score, 1000);
    if (victory) for (let i = 0; i < 10; i += 1) setTimeout(() => burst(rand(100, 860), rand(80, 260), ["#F0C463", "#F2B9C5", "#9B7BFF", "#3FB8A8", "#FF8A4A"][i % 5], 22, 300), i * 180);

    saveScore(game.runId, game.playerName, game.score);
  }

  function formatTime(sec) {
    const s = Math.floor(sec);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function countUp(el, to, ms) {
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ======================================================================
     NICKNAME
     ====================================================================== */
  function normalizeName(raw) {
    return String(raw || "")
      .normalize("NFC")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function validateName(name) {
    if (!name) return "Нэрээ оруулна уу.";
    if ([...name].length > 16) return "Нэр 16 тэмдэгтээс ихгүй байна.";
    if (!/^[\p{L}\p{N} _.\-']+$/u.test(name)) return "Зөвхөн үсэг, тоо, зай, _ . - ашиглана уу.";
    return "";
  }

  /* ======================================================================
     LEADERBOARD API
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

  const savedRuns = new Map();

  async function saveScore(runId, name, score) {
    if (savedRuns.get(runId) === "saving" || savedRuns.get(runId) === "saved") return;
    savedRuns.set(runId, "saving");
    ui.retrySave.hidden = true;
    ui.saveStatus.className = "save-status";
    if (score <= 0) {
      // Nothing to rank — keep the leaderboard free of empty runs.
      savedRuns.set(runId, "skipped");
      ui.saveStatus.textContent = "0 оноо хадгалагдахгүй — дахин оролдоод үзээрэй!";
      return;
    }
    ui.saveStatus.textContent = "Saving score…";
    try {
      const result = await api.save(name, score);
      savedRuns.set(runId, "saved");
      game.lastSaved = result;
      ui.saveStatus.classList.add("is-ok");
      ui.saveStatus.textContent = result.rank ? "Score saved ✓ · Rank #" + result.rank : "Score saved ✓";
      loadLeaderboard();
    } catch (err) {
      savedRuns.set(runId, "error");
      ui.saveStatus.classList.add("is-error");
      ui.saveStatus.textContent = "Could not save the score. " + friendlyError(err);
      ui.retrySave.hidden = false;
      ui.retrySave.onclick = () => saveScore(runId, name, score);
    }
  }

  function friendlyError(err) {
    const msg = String(err && err.message || "");
    if (location.protocol === "file:") return "Open the site through Cloudflare Pages to use the leaderboard.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Check your connection.";
    if (/HTTP 404/.test(msg)) return "Leaderboard API is not deployed yet.";
    return msg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  async function loadLeaderboard() {
    ui.boardStatus.textContent = ui.boardList.children.length ? "" : "Loading…";
    try {
      const rows = await api.leaderboard();
      const youId = game.lastSaved && game.lastSaved.id;
      if (!rows.length) {
        ui.boardList.innerHTML = "";
        ui.boardStatus.textContent = "No scores yet. Be the first!";
      } else {
        ui.boardStatus.textContent = "";
        ui.boardList.innerHTML = rows.map((r, i) => {
          const date = r.created_at ? String(r.created_at).slice(0, 10) : "";
          const you = youId && r.id === youId;
          return `<li class="board-row${you ? " is-you" : ""}"><span class="rank">${String(i + 1).padStart(2, "0")}</span><span class="name">${escapeHtml(r.name)}</span><span class="score">${Number(r.score)}</span><span class="date">${escapeHtml(date)}</span></li>`;
        }).join("");
      }
      const inTop = youId && rows.some((r) => r.id === youId);
      if (game.lastSaved && !inTop) {
        ui.boardYou.hidden = false;
        ui.boardYou.textContent = "Your rank: #" + game.lastSaved.rank + " · " + game.lastSaved.score;
      } else {
        ui.boardYou.hidden = true;
      }
    } catch (err) {
      ui.boardStatus.textContent = "Leaderboard unavailable. " + friendlyError(err);
    }
  }

  function showBoard() {
    ui.board.scrollIntoView({ behavior: "smooth", block: "start" });
    ui.board.classList.remove("is-flash");
    void ui.board.offsetWidth;
    ui.board.classList.add("is-flash");
    loadLeaderboard();
  }

  /* ======================================================================
     ROSTER (character cards)
     ====================================================================== */
  function renderRoster() {
    const order = ["tuvshuu", "ganaa", "teka", "erhmee", "anhaa"];
    ui.roster.innerHTML = order.map((k) => {
      const d = ENEMY_TYPES[k];
      return `<li class="roster-item"><canvas width="104" height="104" data-type="${k}" aria-hidden="true"></canvas><div><span class="roster-name">${d.name}</span><span class="roster-role">${d.role} · HP ${d.hp}</span><span class="roster-stars" aria-label="Difficulty ${d.stars} of 5">${"★".repeat(d.stars)}${"☆".repeat(5 - d.stars)}</span></div></li>`;
    }).join("");
    ui.roster.querySelectorAll("canvas").forEach((cv) => {
      const c = cv.getContext("2d");
      const type = cv.dataset.type;
      const def = ENEMY_TYPES[type];
      const scale = type === "anhaa" ? 0.62 : type === "erhmee" ? 0.95 : 1.2;
      const e = newEnemy(type, 0);
      e.spawnFade = 0;
      e.noTag = true;
      e.facing = 1;
      e.x = -def.w / 2;
      e.y = -def.h;
      c.save();
      c.translate(52, 96);
      c.scale(scale, scale);
      drawEnemy(c, e, 0.5);
      c.restore();
    });
  }

  /* ======================================================================
     MAIN LOOP
     ====================================================================== */
  let lastFrame = performance.now();
  let accumulator = 0;

  function update(dt) {
    game.time += dt;

    if (game.hitStop > 0) { game.hitStop -= dt; updateEffects(dt * 0.2); return; }
    let simDt = dt;
    if (game.slowMo > 0) { game.slowMo -= dt; simDt = dt * 0.35; }

    if (game.state === "playing" || game.state === "transition" || game.state === "dying" || game.state === "victory-wait") {
      if (game.state === "playing") game.runTime += simDt;
      updatePlayer(simDt);
      for (const e of game.enemies) updateEnemy(e, simDt);
      game.enemies = game.enemies.filter((e) => !(e.dead && e.deathTimer <= 0));
      updateHazards(simDt);
      updateCoins(simDt);

      if (game.state === "playing") {
        const stage = STAGES[game.stageIndex];
        processSpawns(simDt);
        const alive = game.enemies.some((e) => !e.dead);
        if (!stage.boss && !alive && !game.spawnQueue.length) {
          if (game.waveIndex < stage.waves.length) {
            game.waveTimer -= simDt;
            if (game.waveTimer <= 0) { spawnWave(); game.waveTimer = 1.2; }
          } else if (!game.stageClear) {
            completeStage();
          }
        }
      } else {
        game.endTimer -= dt;
        if (game.endTimer <= 0) {
          if (game.state === "transition") nextStageAfterTransition();
          else if (game.state === "dying") finishRun(false);
          else if (game.state === "victory-wait") finishRun(true);
        }
      }
    }
    input.consume();
    updateEffects(simDt);
  }

  let loopErrors = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    try {
      step(now);
    } catch (err) {
      // Never let one bad frame freeze the whole game; log a few for debugging.
      loopErrors += 1;
      if (loopErrors <= 3) console.error("[ENEREl game]", err);
    }
  }

  function step(now) {
    let frameDt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (frameDt > 0.1) frameDt = 0.1;
    if (game.state !== "paused") {
      accumulator += frameDt;
      let steps = 0;
      while (accumulator >= STEP && steps < 6) {
        update(STEP);
        accumulator -= STEP;
        steps += 1;
      }
      if (steps === 6) accumulator = 0;
    }
    render(now / 1000);
  }

  /* ======================================================================
     BOOT
     ====================================================================== */
  function bindUi() {
    const savedName = storageGet("enerel-game-name");
    if (savedName) ui.nameInput.value = savedName;

    ui.nameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = normalizeName(ui.nameInput.value);
      const error = validateName(name);
      if (error) {
        ui.nameError.textContent = error;
        ui.nameError.hidden = false;
        ui.nameInput.focus();
        return;
      }
      ui.nameError.hidden = true;
      storageSet("enerel-game-name", name);
      audio.init();
      audio.resume();
      ui.nameInput.blur();
      startRun(name);
    });

    ui.helpBtn.addEventListener("click", () => {
      const open = ui.helpPanel.hidden;
      ui.helpPanel.hidden = !open;
      ui.helpBtn.setAttribute("aria-expanded", String(open));
    });

    ui.soundBtn.setAttribute("aria-pressed", String(audio.enabled));
    ui.soundBtn.textContent = audio.enabled ? "🔊" : "🔇";
    ui.soundBtn.addEventListener("click", () => {
      audio.enabled = !audio.enabled;
      storageSet("enerel-game-sound", audio.enabled ? "on" : "off");
      ui.soundBtn.setAttribute("aria-pressed", String(audio.enabled));
      ui.soundBtn.textContent = audio.enabled ? "🔊" : "🔇";
      if (audio.enabled) { audio.init(); audio.resume(); audio.play("coin"); }
    });

    ui.pauseBtn.addEventListener("click", () => togglePause());
    ui.resumeBtn.addEventListener("click", () => togglePause(false));
    ui.quitBtn.addEventListener("click", showMenu);
    ui.againBtn.addEventListener("click", () => startRun(game.playerName));
    document.querySelectorAll('[data-action="show-board"]').forEach((b) => b.addEventListener("click", showBoard));
    ui.boardRefresh.addEventListener("click", loadLeaderboard);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && game.state === "playing") togglePause(true);
    });

    const isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 0;
    document.documentElement.classList.toggle("has-touch", isTouch);
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") document.documentElement.classList.add("has-touch");
    }, { passive: true });

    if ("ResizeObserver" in window) new ResizeObserver(resizeCanvas).observe(frame);
    // Track whether a menu overlay is open (used by CSS for small screens)
    const syncOverlay = () => {
      frame.classList.toggle("has-overlay", !ui.start.hidden || !ui.pause.hidden || !ui.end.hidden);
    };
    if ("MutationObserver" in window) {
      const mo = new MutationObserver(syncOverlay);
      [ui.start, ui.pause, ui.end].forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ["hidden"] }));
    }
    syncOverlay();
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));
  }

  bindInput();
  bindUi();
  resizeCanvas();
  showMenu();
  renderRoster();
  loadLeaderboard();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { renderRoster(); });
  requestAnimationFrame((now) => { lastFrame = now; requestAnimationFrame(loop); });

  // Lightweight hook for automated tests only (?test in the URL)
  if (/[?&]test\b/.test(location.search)) {
    window.__enerelGame = { game, input, ENEMY_TYPES, STAGES, damageEnemy, startRun, killPlayer };
  }
})();
