/* TEGTAT — small low-poly central Ulaanbaatar driving game.
   Three.js (vendored, r160). No other dependencies.
   Map is fictionalized and compact: Peace Avenue, the Baga Toiruu ring,
   a Sükhbaatar-Square-inspired plaza, apartment blocks, mountains around. */

// Load Three.js from this site; if the vendor file is missing, fall back to the CDN copy.
let THREE;
try {
  THREE = await import("./vendor/three.module.min.js");
} catch (localErr) {
  console.warn("[TEGTAT] vendor/three.module.min.js not found, using CDN", localErr);
  try {
    THREE = await import("https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.min.js");
  } catch (cdnErr) {
    const l = document.getElementById("loading");
    window.__tegtatFail = true;
    if (l) l.textContent = "3D сан ачаалагдсангүй. vendor/three.module.min.js файл сайтад байгаа эсэхийг шалгана уу.";
    throw cdnErr;
  }
}
window.__tegtatModule = true;

(() => {
  "use strict";

  /* ======================================================================
     CONFIG
     ====================================================================== */
  const MAX_SCORE = 5000; // must match functions/api/tegtat (server cap)
  const ROUTE_TIME = 240; // seconds
  const SCORE = { checkpoint: 100, coin: 25, route: 500, timeMax: 1000, cleanMax: 500, distPer: 5, distCap: 600 };
  const PENALTY = { building: 25, car: 50, redLight: 50 };
  const STEP = 1 / 60;

  const qs = new URLSearchParams(location.search);
  const TEST = qs.has("test");
  const isTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  const LOW = isTouch && Math.min(screen.width, screen.height) < 900;
  const Q = {
    dpr: Math.min(window.devicePixelRatio || 1, LOW ? 1.25 : 1.75),
    antialias: !LOW,
    shadows: !LOW,
    traffic: LOW ? 10 : 16,
    trees: LOW ? 0.6 : 1
  };

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  let seed = 20261008;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const col = (hex) => new THREE.Color(hex);

  /* ======================================================================
     MAP DEFINITION (meters; +x = east, -z = north)
     ====================================================================== */
  const BOUNDS = { x0: -300, x1: 300, z0: -250, z1: 240 };
  const N = {
    AN: [-240, -180], GN: [-160, -180], BN: [-80, -180], CN: [80, -180], DN: [240, -180],
    AP: [-240, 0], GP: [-160, 0], BP: [-80, 0], CP: [80, 0], EP: [160, 0], DP: [240, 0],
    AS: [-240, 170], BS: [-80, 170], CS: [80, 170], ES: [160, 170], DS: [240, 170]
  };
  // [from, to, width, name]
  const EDGE_DEFS = [
    ["AN", "GN", 10, "БАГА ТОЙРУУ"], ["GN", "BN", 10, "БАГА ТОЙРУУ"], ["BN", "CN", 10, "БАГА ТОЙРУУ"], ["CN", "DN", 10, "БАГА ТОЙРУУ"],
    ["AP", "GP", 16, "ЭНХТАЙВНЫ ӨРГӨН ЧӨЛӨӨ"], ["GP", "BP", 16, "ЭНХТАЙВНЫ ӨРГӨН ЧӨЛӨӨ"], ["BP", "CP", 16, "ЭНХТАЙВНЫ ӨРГӨН ЧӨЛӨӨ"],
    ["CP", "EP", 16, "ЭНХТАЙВНЫ ӨРГӨН ЧӨЛӨӨ"], ["EP", "DP", 16, "ЭНХТАЙВНЫ ӨРГӨН ЧӨЛӨӨ"],
    ["AS", "BS", 10, "БАГА ТОЙРУУ"], ["BS", "CS", 10, "БАГА ТОЙРУУ"], ["CS", "ES", 10, "БАГА ТОЙРУУ"], ["ES", "DS", 10, "БАГА ТОЙРУУ"],
    ["AN", "AP", 10, "БАГА ТОЙРУУ"], ["AP", "AS", 10, "БАГА ТОЙРУУ"], ["DN", "DP", 10, "БАГА ТОЙРУУ"], ["DP", "DS", 10, "БАГА ТОЙРУУ"],
    ["BN", "BP", 14, "ЧИНГИСИЙН ӨРГӨН ЧӨЛӨӨ"], ["BP", "BS", 14, "ЧИНГИСИЙН ӨРГӨН ЧӨЛӨӨ"],
    ["CN", "CP", 14, "ОЛИМПЫН ГУДАМЖ"], ["CP", "CS", 14, "ОЛИМПЫН ГУДАМЖ"],
    ["GN", "GP", 7, "ЖУУЛЧНЫ ГУДАМЖ"], ["EP", "ES", 7, "СӨҮЛИЙН ГУДАМЖ"]
  ];
  const LIT_NODES = ["AP", "BP", "CP", "DP"];
  const NODE = {};
  for (const [k, [x, z]] of Object.entries(N)) NODE[k] = { id: k, x, z, edges: [], r: 0, light: null };
  const EDGES = EDGE_DEFS.map(([a, b, w, name], i) => {
    const A = NODE[a], B = NODE[b];
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz);
    const e = { id: i, a: A, b: B, w, hw: w / 2, name, dx: dx / len, dz: dz / len, len, axis: Math.abs(dx) > Math.abs(dz) ? "x" : "z", lanes: w >= 13 ? 2 : 1 };
    A.edges.push(e); B.edges.push(e);
    return e;
  });
  for (const n of Object.values(NODE)) n.r = Math.max(...n.edges.map((e) => e.hw)) + 0.5;
  for (const id of LIT_NODES) NODE[id].light = { phase: Math.floor(rr(0, 4)), t: rr(0, 6) };

  // Lane geometry: offset to the right of travel direction (right-hand traffic)
  function laneOffset(e, k) {
    const median = e.lanes === 2 ? 1 : 0;
    const lw = (e.hw - median / 2) / e.lanes;
    return median / 2 + lw * (k + 0.5);
  }
  function lanePath(e, forward, k) {
    const from = forward ? e.a : e.b, to = forward ? e.b : e.a;
    const dx = forward ? e.dx : -e.dx, dz = forward ? e.dz : -e.dz;
    const rx = -dz, rz = dx, off = laneOffset(e, k);
    const p0 = { x: from.x + dx * from.r + rx * off, z: from.z + dz * from.r + rz * off };
    const p1 = { x: to.x - dx * to.r + rx * off, z: to.z - dz * to.r + rz * off };
    return { e, forward, k, from, to, dx, dz, rx, rz, p0, p1, len: Math.hypot(p1.x - p0.x, p1.z - p0.z) };
  }

  // Is a world point on asphalt?
  function onRoad(x, z) {
    for (const n of Object.values(NODE)) if (Math.abs(x - n.x) <= n.r && Math.abs(z - n.z) <= n.r) return true;
    for (const e of EDGES) {
      if (e.axis === "x") { if (Math.abs(z - e.a.z) <= e.hw && x >= Math.min(e.a.x, e.b.x) && x <= Math.max(e.a.x, e.b.x)) return true; }
      else if (Math.abs(x - e.a.x) <= e.hw && z >= Math.min(e.a.z, e.b.z) && z <= Math.max(e.a.z, e.b.z)) return true;
    }
    return inParking(x, z);
  }
  const PARK = { x0: 167, x1: 229, z0: 14, z1: 152 };
  const inParking = (x, z) => x >= PARK.x0 && x <= PARK.x1 && z >= PARK.z0 && z <= PARK.z1;

  /* ======================================================================
     RENDERER / SCENE
     ====================================================================== */
  const canvas = $("tg-canvas");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: "high-performance" });
  } catch (err) {
    $("fatal").hidden = false;
    $("fatal").textContent = "Таны браузер WebGL (3D) дэмжихгүй байна. Chrome, Safari эсвэл Firefox-ийн шинэ хувилбараар оролдоно уу.";
    $("loading").textContent = "";
    return;
  }
  renderer.setPixelRatio(Q.dpr);
  renderer.shadowMap.enabled = Q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const SKY = col("#9CC9F0");
  const scene = new THREE.Scene();
  scene.background = SKY.clone();
  scene.fog = new THREE.Fog(col("#B9D5EC"), 260, LOW ? 1100 : 1500);

  const camera = new THREE.PerspectiveCamera(62, 1, 1.0, 2600);
  camera.position.set(-230, 12, 30);

  const hemi = new THREE.HemisphereLight(col("#E4EEFF"), col("#86847C"), 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(col("#FFF8EE"), 1.7);
  sun.position.set(120, 220, 160);
  scene.add(sun);
  scene.add(sun.target);
  if (Q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -70; s.right = 70; s.top = 70; s.bottom = -70; s.near = 10; s.far = 600;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.6;
  }

  // Sky dome (vertex-colored, unaffected by fog)
  {
    const g = new THREE.SphereGeometry(2400, 16, 10);
    const top = col("#5E9EE0"), mid = col("#A8D0F2"), low = col("#DCEBF5");
    const c = [];
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 2400;
      const k = clamp(y, -0.1, 1);
      const cc = k < 0.15 ? low.clone().lerp(mid, clamp(k / 0.15, 0, 1)) : mid.clone().lerp(top, clamp((k - 0.15) / 0.6, 0, 1));
      c.push(cc.r, cc.g, cc.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);
  }

  /* ======================================================================
     GEOMETRY BUILDER (merges many boxes/quads into one draw call)
     ====================================================================== */
  const UV0 = [0.03, 0.03, 0.03, 0.03];
  class GeoBuilder {
    constructor() { this.p = []; this.n = []; this.c = []; this.u = []; }
    face(c, n, u, v, hu, hv, color, uvr = UV0) {
      const P = (su, sv) => [c[0] + u[0] * hu * su + v[0] * hv * sv, c[1] + u[1] * hu * su + v[1] * hv * sv, c[2] + u[2] * hu * su + v[2] * hv * sv];
      const bl = P(-1, -1), br = P(1, -1), tr = P(1, 1), tl = P(-1, 1);
      const [u0, v0, u1, v1] = uvr;
      const verts = [[bl, u0, v0], [br, u1, v0], [tr, u1, v1], [bl, u0, v0], [tr, u1, v1], [tl, u0, v1]];
      for (const [p, uu, vv] of verts) {
        this.p.push(p[0], p[1], p[2]);
        this.n.push(n[0], n[1], n[2]);
        this.c.push(color.r, color.g, color.b);
        this.u.push(uu, vv);
      }
    }
    // Axis-aligned (optionally Y-rotated) box. y0 = bottom.
    box(cx, y0, cz, w, h, d, color, opt = {}) {
      const rot = opt.rot || 0, cs = Math.cos(rot), sn = Math.sin(rot);
      const R = (v) => [v[0] * cs + v[2] * sn, v[1], -v[0] * sn + v[2] * cs];
      const cy = y0 + h / 2;
      const C = (ox, oy, oz) => { const r = R([ox, oy, oz]); return [cx + r[0], cy + r[1], cz + r[2]]; };
      const up = [0, 1, 0];
      const win = opt.windows;
      const sideUV = (len) => (win ? [0, opt.v0 || 0, len / 4, (opt.v0 || 0) + h / 3.3] : UV0);
      const faces = [
        [C(w / 2, 0, 0), R([1, 0, 0]), R([0, 0, -1]), up, d / 2, h / 2, sideUV(d)],
        [C(-w / 2, 0, 0), R([-1, 0, 0]), R([0, 0, 1]), up, d / 2, h / 2, sideUV(d)],
        [C(0, 0, d / 2), R([0, 0, 1]), R([1, 0, 0]), up, w / 2, h / 2, sideUV(w)],
        [C(0, 0, -d / 2), R([0, 0, -1]), R([-1, 0, 0]), up, w / 2, h / 2, sideUV(w)]
      ];
      if (!opt.noTop) faces.push([C(0, h / 2, 0), [0, 1, 0], R([1, 0, 0]), R([0, 0, -1]), w / 2, d / 2, UV0]);
      if (opt.bottom) faces.push([C(0, -h / 2, 0), [0, -1, 0], R([1, 0, 0]), R([0, 0, 1]), w / 2, d / 2, UV0]);
      const topColor = opt.topColor || color;
      faces.forEach((f, i) => this.face(f[0], f[1], f[2], f[3], f[4], f[5], i === 4 ? topColor : color, f[6]));
    }
    ground(cx, y, cz, w, d, color, rot = 0) {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      this.face([cx, y, cz], [0, 1, 0], [cs, 0, -sn], [-sn, 0, -cs], w / 2, d / 2, color);
    }
    mesh(material, opts = {}) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, material);
      m.castShadow = !!opts.cast && Q.shadows;
      m.receiveShadow = !!opts.receive && Q.shadows;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      return m;
    }
  }

  // Window texture (one floor x one bay); tinted by vertex color
  function makeWindowTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, 64, 64);
    x.fillStyle = "#e9e9e9"; x.fillRect(0, 54, 64, 10); // slab line
    const g = x.createLinearGradient(0, 14, 0, 46);
    g.addColorStop(0, "#5b7088"); g.addColorStop(1, "#3c4b5e");
    x.fillStyle = g; x.fillRect(14, 14, 36, 32);
    x.fillStyle = "rgba(255,255,255,.28)"; x.fillRect(16, 16, 10, 28);
    x.fillStyle = "#f4f4f4"; x.fillRect(30, 14, 3, 32);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.magFilter = THREE.LinearFilter;
    return t;
  }
  const MAT = {
    flat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    building: new THREE.MeshLambertMaterial({ vertexColors: true, map: makeWindowTex() }),
    marking: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  };

  /* ======================================================================
     COLLISION WORLD
     ====================================================================== */
  const COLL = []; // {x0,x1,z0,z1}
  const GRID = new Map();
  const GCELL = 40;
  function addAABB(x0, x1, z0, z1) {
    const b = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
    COLL.push(b);
    for (let gx = Math.floor(b.x0 / GCELL); gx <= Math.floor(b.x1 / GCELL); gx++)
      for (let gz = Math.floor(b.z0 / GCELL); gz <= Math.floor(b.z1 / GCELL); gz++) {
        const k = gx + "," + gz;
        if (!GRID.has(k)) GRID.set(k, []);
        GRID.get(k).push(b);
      }
  }
  function nearbyAABB(x, z) {
    const out = new Set();
    const gx = Math.floor(x / GCELL), gz = Math.floor(z / GCELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = GRID.get((gx + i) + "," + (gz + j)); if (a) a.forEach((b) => out.add(b)); }
    return out;
  }
  const pointInAABB = (x, z) => { for (const b of nearbyAABB(x, z)) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true; return false; };

  /* ======================================================================
     WORLD BUILD
     ====================================================================== */
  const PALETTE = ["#F1E4C6", "#EED79F", "#E7B9A3", "#BFD6E2", "#ECECEC", "#CFCFCF", "#C9E0CE", "#D9C4A6", "#E9CFC0", "#F3EEDF", "#A9C3D6", "#E2D3B0"];
  const signs = []; // {text, x, y, z, rot, w, h, style}

  function buildWorld() {
    const asphalt = new GeoBuilder(), marks = new GeoBuilder(), walks = new GeoBuilder(), blds = new GeoBuilder(), misc = new GeoBuilder();
    const ROAD_MAIN = col("#33373C"), ROAD_SIDE = col("#3D4146"), WHITE = col("#F4F4F0"), YELLOW = col("#F2C230"), WALK = col("#B8B3A8"), CURB = col("#8E8A82");

    // Ground: steppe + paved city floor
    misc.ground(0, -0.45, 0, 3200, 3200, col("#A6A276"));
    misc.ground((BOUNDS.x0 + BOUNDS.x1) / 2, -0.18, (BOUNDS.z0 + BOUNDS.z1) / 2, BOUNDS.x1 - BOUNDS.x0 + 30, BOUNDS.z1 - BOUNDS.z0 + 30, col("#BEB8A9"));

    // Roads, intersections
    for (const e of EDGES) {
      const segLen = e.len - e.a.r - e.b.r; // no overlap with intersection squares
      const mx = e.a.x + e.dx * (e.a.r + segLen / 2), mz = e.a.z + e.dz * (e.a.r + segLen / 2);
      const c = e.w >= 13 ? ROAD_MAIN : ROAD_SIDE;
      if (e.axis === "x") asphalt.ground(mx, 0.03, mz, segLen, e.w, c);
      else asphalt.ground(mx, 0.03, mz, e.w, segLen, c);
    }
    for (const n of Object.values(NODE)) asphalt.ground(n.x, 0.03, n.z, n.r * 2, n.r * 2, ROAD_MAIN);
    // Parking lot
    asphalt.ground((PARK.x0 + PARK.x1) / 2, 0.03, (PARK.z0 + PARK.z1) / 2, PARK.x1 - PARK.x0, PARK.z1 - PARK.z0, col("#4B4F55"));

    // Markings
    const line = (x0, z0, x1, z1, wdt, c) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const rot = Math.atan2(-(z1 - z0), x1 - x0);
      marks.ground((x0 + x1) / 2, 0.09, (z0 + z1) / 2, len, wdt, c, rot);
    };
    const dashed = (x0, z0, x1, z1, wdt, c, dash = 3, gap = 5) => {
      const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      for (let s = 1; s + dash < len - 1; s += dash + gap) line(x0 + dx * s, z0 + dz * s, x0 + dx * (s + dash), z0 + dz * (s + dash), wdt, c);
    };
    for (const e of EDGES) {
      const sx = e.a.x + e.dx * e.a.r, sz = e.a.z + e.dz * e.a.r, ex = e.b.x - e.dx * e.b.r, ez = e.b.z - e.dz * e.b.r;
      const rx = -e.dz, rz = e.dx;
      const at = (off) => [sx + rx * off, sz + rz * off, ex + rx * off, ez + rz * off];
      if (e.lanes === 2) {
        line(...at(0.18), 0.14, YELLOW); line(...at(-0.18), 0.14, YELLOW);
        const lw = (e.hw - 0.5) / 2;
        dashed(...at(0.5 + lw), 0.14, WHITE); dashed(...at(-(0.5 + lw)), 0.14, WHITE);
        line(...at(e.hw - 0.35), 0.14, WHITE); line(...at(-(e.hw - 0.35)), 0.14, WHITE);
      } else if (e.w >= 9) {
        dashed(...at(0), 0.14, WHITE, 3, 4);
        line(...at(e.hw - 0.3), 0.12, WHITE); line(...at(-(e.hw - 0.3)), 0.12, WHITE);
      } else {
        dashed(...at(0), 0.12, WHITE, 2, 4);
      }
    }
    // Crosswalks + stop lines at lit intersections
    for (const id of LIT_NODES) {
      const n = NODE[id];
      for (const e of n.edges) {
        const out = e.a === n ? 1 : -1;
        const dx = e.dx * out, dz = e.dz * out, rx = -dz, rz = dx;
        const c0 = n.r + 1.2, c1 = n.r + 4.6;
        for (let o = -e.hw + 0.6; o <= e.hw - 0.6; o += 1.25) {
          const ax = n.x + dx * c0 + rx * o, az = n.z + dz * c0 + rz * o, bx = n.x + dx * c1 + rx * o, bz = n.z + dz * c1 + rz * o;
          line(ax, az, bx, bz, 0.6, WHITE);
        }
        // stop line on the incoming (right side of traffic coming toward node = left side of outward dir)
        const s = n.r + 5.6;
        line(n.x + dx * s, n.z + dz * s, n.x + dx * s - rx * (e.hw - 0.4), n.z + dz * s - rz * (e.hw - 0.4), 0.5, WHITE);
      }
    }
    // Parking stalls
    for (let z = PARK.z0 + 6; z < PARK.z1 - 4; z += 6) {
      line(PARK.x0 + 16, z, PARK.x0 + 26, z, 0.14, WHITE);
      line(PARK.x1 - 12, z, PARK.x1 - 2, z, 0.14, WHITE);
    }

    // Sidewalks along edges + corner pads
    const swW = 3.5;
    for (const e of EDGES) {
      const sx = e.a.x + e.dx * e.a.r, sz = e.a.z + e.dz * e.a.r, len = e.len - e.a.r - e.b.r;
      const mx = sx + e.dx * len / 2, mz = sz + e.dz * len / 2, rx = -e.dz, rz = e.dx;
      for (const side of [1, -1]) {
        const off = e.hw + swW / 2;
        const cx = mx + rx * off * side, cz = mz + rz * off * side;
        if (inParking(cx, cz)) continue;
        if (e.axis === "x") walks.box(cx, 0, cz, len, 0.16, swW, WALK);
        else walks.box(cx, 0, cz, swW, 0.16, len, WALK);
      }
    }
    for (const n of Object.values(NODE)) for (const sx of [1, -1]) for (const sz of [1, -1]) walks.box(n.x + sx * (n.r + swW / 2), 0, n.z + sz * (n.r + swW / 2), swW, 0.16, swW, WALK);

    // ---------- Blocks ----------
    const XS = [-300, -240, -160, -80, 80, 160, 240, 300];
    const ZS = [-250, -180, 0, 170, 240];
    const roadAlong = (axis, coord, s0, s1) => {
      for (const e of EDGES) {
        if (e.axis !== axis) continue;
        const c = axis === "x" ? e.a.z : e.a.x;
        if (Math.abs(c - coord) > 0.1) continue;
        const lo = axis === "x" ? Math.min(e.a.x, e.b.x) : Math.min(e.a.z, e.b.z), hi = axis === "x" ? Math.max(e.a.x, e.b.x) : Math.max(e.a.z, e.b.z);
        if (lo <= s0 + 0.1 && hi >= s1 - 0.1) return e;
      }
      return null;
    };
    for (let i = 0; i < XS.length - 1; i++) for (let j = 0; j < ZS.length - 1; j++) {
      const x0 = XS[i], x1 = XS[i + 1], z0 = ZS[j], z1 = ZS[j + 1];
      const side = (axis, coord, s0, s1, isB) => {
        const e = roadAlong(axis, coord, s0, s1);
        if (e) return { type: "road", inset: e.hw + swW + 0.8, e };
        if (isB) return { type: "boundary", inset: 0 };
        return { type: "none", inset: 1.5 };
      };
      const S = {
        n: side("x", z0, x0, x1, z0 === BOUNDS.z0), s: side("x", z1, x0, x1, z1 === BOUNDS.z1),
        w: side("z", x0, z0, z1, x0 === BOUNDS.x0), e: side("z", x1, z0, z1, x1 === BOUNDS.x1)
      };
      const cell = { x0: x0 + S.w.inset, x1: x1 - S.e.inset, z0: z0 + S.n.inset, z1: z1 - S.s.inset, S };
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (cx === 0 && cz === -90) buildSquare(cell, blds, misc, walks);
      else if (cx === 0 && cz === 85) buildOpera(cell, blds, misc);
      else if (cx === 120 && cz === -90) buildBlueSky(cell, blds);
      else if (cx === 200 && cz === 85) buildParkingCell(cell, blds);
      else fillCell(cell, blds);
    }

    // Boundary walls (invisible)
    addAABB(BOUNDS.x0 - 50, BOUNDS.x0, BOUNDS.z0 - 50, BOUNDS.z1 + 50);
    addAABB(BOUNDS.x1, BOUNDS.x1 + 50, BOUNDS.z0 - 50, BOUNDS.z1 + 50);
    addAABB(BOUNDS.x0 - 50, BOUNDS.x1 + 50, BOUNDS.z0 - 50, BOUNDS.z0);
    addAABB(BOUNDS.x0 - 50, BOUNDS.x1 + 50, BOUNDS.z1, BOUNDS.z1 + 50);

    scene.add(misc.mesh(MAT.flat, { receive: true }));
    scene.add(asphalt.mesh(MAT.flat, { receive: true }));
    scene.add(marks.mesh(MAT.marking, { receive: true }));
    scene.add(walks.mesh(MAT.flat, { receive: true, cast: false }));
    scene.add(blds.mesh(MAT.building, { cast: true, receive: true }));
  }

  function building(b, x0, x1, z0, z1, h, color, opts = {}) {
    const w = x1 - x0, d = z1 - z0;
    if (w < 3 || d < 3) return;
    const c = col(color);
    b.box((x0 + x1) / 2, 0, (z0 + z1) / 2, w, h, d, c, { windows: true, topColor: col("#8C8C88") });
    // parapet & rooftop boxes
    if (rnd() < 0.55 && w > 8 && d > 8) b.box((x0 + x1) / 2 + rr(-w / 5, w / 5), h, (z0 + z1) / 2 + rr(-d / 5, d / 5), rr(3, 6), rr(1.5, 3), rr(3, 5), col("#9A9A96"));
    if (opts.band) b.box((x0 + x1) / 2, 0, (z0 + z1) / 2, w + 0.3, 3.6, d + 0.3, col(opts.band), {});
    addAABB(x0, x1, z0, z1);
  }

  function fillCell(cell, b) {
    const { S } = cell;
    const W = cell.x1 - cell.x0, D = cell.z1 - cell.z0;
    if (W < 8 || D < 8) return;
    const depth = (s) => (s.type === "boundary" ? rr(16, 24) : rr(12, 17));
    const H = (s) => {
      if (s.type === "boundary") return rr(18, 36);
      const main = s.e && s.e.w >= 13;
      if (rnd() < (main ? 0.16 : 0.08)) return rr(40, 62);
      return main ? rr(15, 34) : rr(10, 24);
    };
    const row = (axis, fixed0, fixed1, s0, s1, s) => {
      let cur = s0;
      while (cur < s1 - 5) {
        let w = Math.min(rr(14, 34), s1 - cur);
        if (s1 - (cur + w) < 7) w = s1 - cur;
        const h = H(s), c = pick(PALETTE);
        const band = s.e && s.e.w >= 13 && rnd() < 0.5 ? pick(["#7E6A58", "#5D6B7A", "#8A5C4F", "#556B5E"]) : null;
        if (axis === "x") building(b, cur, cur + w, fixed0, fixed1, h, c, { band });
        else building(b, fixed0, fixed1, cur, cur + w, h, c, { band });
        if (band && rnd() < 0.5) {
          const label = pick(["ДЭЛГҮҮР", "ЭМИЙН САН", "КАФЕ", "ХҮНСНИЙ ДЭЛГҮҮР", "БАНК", "ЗОЧИД БУУДАЛ", "ГУАНЗ", "НОМЫН ДЭЛГҮҮР", "ХУВЦАС", "САЛОН"]);
          // facing the road
          const mid = cur + w / 2;
          if (axis === "x") { const zf = s === S.n ? fixed0 - 0.25 : fixed1 + 0.25; signs.push({ text: label, x: mid, y: 4.4, z: zf, rot: s === S.n ? Math.PI : 0, w: Math.min(w - 2, 10), h: 1.6, style: "shop" }); }
          else { const xf = s === S.w ? fixed0 - 0.25 : fixed1 + 0.25; signs.push({ text: label, x: xf, y: 4.4, z: mid, rot: s === S.w ? -Math.PI / 2 : Math.PI / 2, w: Math.min(w - 2, 10), h: 1.6, style: "shop" }); }
        }
        cur += w + (rnd() < 0.22 ? rr(4, 9) : 0.6);
      }
    };
    const dn = S.n.type !== "none" ? depth(S.n) : 0, ds = S.s.type !== "none" ? depth(S.s) : 0;
    if (dn && D > dn + 6) row("x", cell.z0, cell.z0 + dn, cell.x0, cell.x1, S.n);
    if (ds && D > dn + ds + 6) row("x", cell.z1 - ds, cell.z1, cell.x0, cell.x1, S.s);
    const zA = cell.z0 + (dn ? dn + 1 : 0), zB = cell.z1 - (ds ? ds + 1 : 0);
    if (S.w.type !== "none" && W > 20) { const dw = depth(S.w); row("z", cell.x0, cell.x0 + dw, zA, zB, S.w); }
    if (S.e.type !== "none" && W > 36) { const de = depth(S.e); row("z", cell.x1 - de, cell.x1, zA, zB, S.e); }
    // courtyard trees
    for (let k = 0; k < Math.floor((W * D) / 1400); k++) treeSpots.push([rr(cell.x0 + 22, cell.x1 - 22), rr(cell.z0 + 22, cell.z1 - 22)]);
  }

  const treeSpots = [];
  const busStops = [];

  function buildSquare(cell, b, misc, walks) {
    const STONE = col("#D9D3C4"), STONE2 = col("#C9C2B1"), WHITE = col("#F2EFE6"), GOLD = col("#B48A3E"), BRONZE = col("#6C5838");
    const cx = (cell.x0 + cell.x1) / 2;
    misc.ground(cx, 0.05, (cell.z0 + cell.z1) / 2, cell.x1 - cell.x0, cell.z1 - cell.z0, STONE);
    for (let x = cell.x0 + 8; x < cell.x1; x += 16) misc.ground(x, 0.13, (cell.z0 + cell.z1) / 2, 0.6, cell.z1 - cell.z0, STONE2);
    for (let z = cell.z0 + 8; z < cell.z1; z += 16) misc.ground(cx, 0.14, z, cell.x1 - cell.x0, 0.6, STONE2);
    // Government Palace (north)
    const gz0 = cell.z0 + 6, gz1 = gz0 + 24;
    b.box(cx, 0, (gz0 + gz1) / 2, 130, 17, 24, WHITE, { windows: true, topColor: col("#BDB8AC") });
    b.box(cx, 0, (gz0 + gz1) / 2 - 2, 46, 24, 20, WHITE, { windows: true, topColor: col("#BDB8AC") });
    b.box(cx, 0, gz1 + 6, 52, 1.2, 12, STONE2); // steps
    for (let i = 0; i < 12; i++) b.box(cx - 22 + i * 4, 1.2, gz1 + 2, 1.3, 14, 1.3, WHITE);
    b.box(cx, 15.2, gz1 + 2, 50, 2, 4, WHITE);
    addAABB(cx - 65, cx + 65, gz0, gz1 + 12);
    // Chinggis seated statue (stylized)
    const sz = gz1 + 4;
    b.box(cx, 1.2, sz, 7, 4, 5, col("#8D8778"));
    b.box(cx, 5.2, sz, 5, 3, 3.6, GOLD); b.box(cx, 8.2, sz - 0.4, 3.4, 4, 2.6, GOLD); b.box(cx, 12.2, sz - 0.4, 1.8, 1.8, 1.8, GOLD);
    b.box(cx, 13.9, sz - 0.4, 2.4, 0.6, 2.4, GOLD);
    // Sükhbaatar equestrian statue (center)
    const mz = (cell.z0 + cell.z1) / 2 + 22;
    b.box(cx, 0.06, mz, 9, 3.2, 9, col("#9C9585"));
    const top = 3.26;
    for (const [ox, oz] of [[-0.55, -1.9], [0.55, -1.9], [-0.55, 1.9], [0.55, 1.9]]) b.box(cx + ox, top, mz + oz, 0.45, 1.7, 0.45, BRONZE);
    b.box(cx, top + 1.7, mz, 1.6, 1.5, 5, BRONZE); // horse body
    b.box(cx, top + 2.6, mz - 2.7, 0.9, 1.9, 1.1, BRONZE); // neck
    b.box(cx, top + 3.9, mz - 3.3, 0.8, 0.8, 1.6, BRONZE); // head
    b.box(cx, top + 0.9, mz + 2.6, 0.35, 1.6, 0.35, BRONZE); // tail
    b.box(cx, top + 3.2, mz + 0.2, 1.1, 1.9, 1.0, BRONZE); // rider
    b.box(cx, top + 5.1, mz + 0.2, 0.6, 0.65, 0.6, BRONZE);
    b.box(cx + 0.75, top + 4.3, mz - 0.4, 0.22, 0.22, 2.2, BRONZE); // raised arm
    addAABB(cx - 4.5, cx + 4.5, mz - 4.5, mz + 4.5);
    // flags
    flagSpots.push([cx - 30, gz1 + 14], [cx, gz1 + 16], [cx + 30, gz1 + 14]);
    // bollard ring around the square (not drivable)
    const bol = col("#5A5F66");
    const ring = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 3);
      for (let i = 0; i <= n; i++) { const t = i / n; b.box(lerp(x0, x1, t), 0, lerp(z0, z1, t), 0.4, 0.9, 0.4, bol); }
    };
    ring(cell.x0, cell.z0, cell.x1, cell.z0); ring(cell.x0, cell.z1, cell.x1, cell.z1); ring(cell.x0, cell.z0, cell.x0, cell.z1); ring(cell.x1, cell.z0, cell.x1, cell.z1);
    addAABB(cell.x0 - 0.3, cell.x1 + 0.3, cell.z1 - 0.3, cell.z1 + 0.3);
    addAABB(cell.x0 - 0.3, cell.x1 + 0.3, cell.z0 - 0.3, cell.z0 + 0.3);
    addAABB(cell.x0 - 0.3, cell.x0 + 0.3, cell.z0, cell.z1);
    addAABB(cell.x1 - 0.3, cell.x1 + 0.3, cell.z0, cell.z1);
    signs.push({ text: "СҮХБААТАРЫН ТАЛБАЙ", x: cx + 34, y: 1.0, z: cell.z1 - 1.2, rot: 0, w: 9, h: 1.2, style: "plaza" });
    for (let x = cell.x0 + 10; x < cell.x1 - 5; x += 14) { treeSpots.push([x, cell.z1 - 6]); }
  }
  const flagSpots = [];

  function buildOpera(cell, b, misc) {
    const cx = (cell.x0 + cell.x1) / 2;
    const PINK = col("#E59A8E"), WHITE = col("#F5F0E6");
    misc.ground(cx, 0.06, cell.z0 + 18, 70, 30, col("#D5CDBD"));
    const oz0 = cell.z0 + 34, oz1 = oz0 + 34;
    b.box(cx, 0, (oz0 + oz1) / 2, 56, 17, 34, PINK, { windows: true, topColor: col("#A98B84") });
    b.box(cx, 0, oz0 - 3, 30, 1.2, 6, col("#CFC6B4"));
    for (let i = 0; i < 8; i++) b.box(cx - 12.6 + i * 3.6, 1.2, oz0 - 2, 1.1, 12, 1.1, WHITE);
    b.box(cx, 13.2, oz0 - 2.2, 30, 1.6, 4.2, WHITE);
    b.box(cx, 14.8, oz0 - 2.2, 22, 2.4, 3.6, WHITE); // pediment block
    addAABB(cx - 28, cx + 28, oz0 - 6, oz1);
    signs.push({ text: "ДУУРЬ БҮЖГИЙН ТЕАТР", x: cx, y: 13, z: oz0 - 4.45, rot: 0, w: 14, h: 1.4, style: "plaque" });
    for (let k = 0; k < 6; k++) treeSpots.push([cx - 30 + k * 12, cell.z0 + 6]);
    // side blocks
    fillCell({ ...cell, x1: cx - 36, S: { ...cell.S, e: { type: "none", inset: 0 } } }, b);
    fillCell({ ...cell, x0: cx + 36, S: { ...cell.S, w: { type: "none", inset: 0 } } }, b);
    busStops.push([cx - 20, 0, 8 + 1.75, 0]);
  }

  function buildBlueSky(cell, b) {
    // perimeter along north + east, signature sail tower near Peace Ave
    fillCell({ ...cell, z1: cell.z1 - 52, S: { ...cell.S, s: { type: "none", inset: 0 } } }, b);
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 18, -Math.PI * 0.5, Math.PI * 0.5, false);
    shape.absarc(-9, 0, 15, Math.PI * 0.5, -Math.PI * 0.5, true);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 104, bevelEnabled: false, curveSegments: 10 });
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: col("#5E93C6"), emissive: col("#0B2238") });
    const tower = new THREE.Mesh(geo, mat);
    const tx = (cell.x0 + cell.x1) / 2 + 4, tz = cell.z1 - 26;
    tower.position.set(tx, 0, tz);
    tower.rotation.y = -Math.PI * 0.25;
    tower.castShadow = Q.shadows;
    scene.add(tower);
    const pod = new GeoBuilder();
    pod.box(tx, 0, tz, 40, 8, 30, col("#D8DEE4"), { windows: true, topColor: col("#9AA2AA") });
    scene.add(pod.mesh(MAT.building, { cast: true, receive: true }));
    addAABB(tx - 20, tx + 20, tz - 15, tz + 15);
    signs.push({ text: "ЦЭНХЭР ТЭНГЭР ТАУЭР", x: tx, y: 6.2, z: tz + 15.3, rot: 0, w: 14, h: 1.5, style: "plaque" });
  }

  function buildParkingCell(cell, b) {
    // buildings only along the east road and the south road edges outside the lot
    fillCell({ ...cell, x0: PARK.x1 + 2, S: { ...cell.S, w: { type: "none", inset: 0 } } }, b);
    signs.push({ text: "P  ЗОГСООЛ", x: PARK.x0 + 2, y: 3.2, z: PARK.z0 + 6, rot: -Math.PI / 2, w: 6, h: 1.6, style: "parking" });
    parkedSpots.push(...[[PARK.x0 + 21, PARK.z0 + 21, Math.PI / 2], [PARK.x0 + 21, PARK.z0 + 45, Math.PI / 2], [PARK.x1 - 7, PARK.z0 + 27, -Math.PI / 2],
      [PARK.x1 - 7, PARK.z0 + 63, -Math.PI / 2], [PARK.x0 + 21, PARK.z0 + 87, Math.PI / 2], [PARK.x1 - 7, PARK.z0 + 99, -Math.PI / 2], [PARK.x0 + 21, PARK.z0 + 111, Math.PI / 2]]);
  }
  const parkedSpots = [];
  function buildParked() {
    for (const [x, z, rot] of parkedSpots) {
      const car = makeCarMerged(rnd() < 0.25 ? "van" : "sedan", pick(TCOLORS));
      car.position.set(x, 0, z); car.rotation.y = rot;
      scene.add(car);
      const L = car.userData.L / 2 + 0.2, W = car.userData.W / 2 + 0.2;
      const along = Math.abs(Math.cos(rot)) > 0.5;
      if (along) addAABB(x - L, x + L, z - W, z + W); else addAABB(x - W, x + W, z - L, z + L);
    }
  }

  /* ---------- Props: trees, lamps, poles, signs, flags, bus stops ---------- */
  function buildProps() {
    // trees along Peace Avenue + avenues
    for (const e of EDGES) {
      if (e.w < 13) continue;
      const len = e.len - e.a.r - e.b.r - 10;
      for (let s = 6; s < len; s += 15) for (const side of [1, -1]) {
        const off = e.hw + 2.6;
        const x = e.a.x + e.dx * (e.a.r + 5 + s) + -e.dz * off * side, z = e.a.z + e.dz * (e.a.r + 5 + s) + e.dx * off * side;
        if (!inParking(x, z) && rnd() < Q.trees) treeSpots.push([x, z]);
      }
    }
    const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 2.6, 5); trunkG.translate(0, 1.3, 0);
    const crownG = new THREE.IcosahedronGeometry(2.3, 0); crownG.translate(0, 4.2, 0);
    const n = treeSpots.length;
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: col("#6B4F36") }), n);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const greens = ["#5E8F4E", "#6E9C55", "#4F7F45", "#8DAA4F", "#C9A93C", "#78A35A"];
    treeSpots.forEach(([x, z], i) => {
      const s = rr(0.8, 1.25);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, 6.28));
      m.compose(p.set(x, 0, z), q, sc.set(s, s * rr(0.9, 1.3), s));
      trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, col(pick(greens)));
    });
    crowns.instanceColor.needsUpdate = true;
    crowns.castShadow = trunks.castShadow = Q.shadows;
    scene.add(trunks, crowns);

    // street lamps on main roads
    const lampSpots = [];
    for (const e of EDGES) {
      if (e.w < 13) continue;
      const len = e.len - e.a.r - e.b.r;
      for (let s = 12; s < len - 6; s += 32) for (const side of [1, -1]) {
        const off = e.hw + 0.9;
        lampSpots.push([e.a.x + e.dx * (e.a.r + s) - e.dz * off * side, e.a.z + e.dz * (e.a.r + s) + e.dx * off * side, Math.atan2(e.dx * side, -e.dz * side)]);
      }
    }
    const poleG = new THREE.CylinderGeometry(0.1, 0.15, 8, 6); poleG.translate(0, 4, 0);
    const armG = new THREE.BoxGeometry(0.18, 0.18, 2.4); armG.translate(0, 7.9, -1.1);
    const headG = new THREE.BoxGeometry(0.7, 0.22, 1.2); headG.translate(0, 7.8, -2.2);
    const poleM = new THREE.MeshLambertMaterial({ color: col("#5E646B") });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: col("#FFF3D0") });
    const poles = new THREE.InstancedMesh(poleG, poleM, lampSpots.length), arms = new THREE.InstancedMesh(armG, poleM, lampSpots.length), heads = new THREE.InstancedMesh(headG, lampHeadMat, lampSpots.length);
    lampSpots.forEach(([x, z, r], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r); m.compose(p.set(x, 0, z), q, sc.set(1, 1, 1)); poles.setMatrixAt(i, m); arms.setMatrixAt(i, m); heads.setMatrixAt(i, m); });
    scene.add(poles, arms, heads);

    // wooden utility poles + wires along the Baga Toiruu / side streets
    const wSpots = [];
    const wire = [];
    for (const e of EDGES) {
      if (e.w >= 13) continue;
      const len = e.len - e.a.r - e.b.r;
      let prev = null;
      for (let s = 4; s < len - 2; s += 30) {
        const off = e.hw + 3.0;
        const x = e.a.x + e.dx * (e.a.r + s) - e.dz * off, z = e.a.z + e.dz * (e.a.r + s) + e.dx * off;
        if (inParking(x, z) || pointInAABB(x, z)) { prev = null; continue; }
        wSpots.push([x, z]);
        if (prev) wire.push(prev[0], 7.3, prev[1], x, 7.3, z, prev[0], 6.7, prev[1], x, 6.7, z);
        prev = [x, z];
      }
    }
    const upG = new THREE.CylinderGeometry(0.14, 0.18, 7.8, 5); upG.translate(0, 3.9, 0);
    const ups = new THREE.InstancedMesh(upG, new THREE.MeshLambertMaterial({ color: col("#7A5C40") }), wSpots.length);
    wSpots.forEach(([x, z], i) => { m.compose(p.set(x, 0, z), q.identity(), sc.set(1, 1, 1)); ups.setMatrixAt(i, m); });
    scene.add(ups);
    const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: col("#2B2F33") })));

    // Bus stops on Peace Avenue
    busStops.push([-200, 0, 8 + 1.75, 0], [120, 0, -(8 + 1.75), Math.PI], [-120, 0, -(8 + 1.75), Math.PI]);
    const bs = new GeoBuilder();
    for (const [x, , zOff, rot] of busStops) {
      const z = zOff;
      const s = rot ? -1 : 1;
      bs.box(x, 2.6, z + s * 0.6, 6, 0.2, 2.2, col("#2E6FB7"));
      bs.box(x, 0.16, z + s * 1.5, 6, 2.5, 0.12, col("#BFD8EE"));
      bs.box(x - 2.9, 0.16, z + s * 0.6, 0.12, 2.5, 1.8, col("#3E4650"));
      bs.box(x + 2.9, 0.16, z + s * 0.6, 0.12, 2.5, 1.8, col("#3E4650"));
      bs.box(x, 0.16, z + s * 1.0, 4.2, 0.5, 0.5, col("#6A7480"));
      signs.push({ text: "АВТОБУСНЫ БУУДАЛ", x, y: 3.1, z: z + s * (-0.45), rot: rot ? Math.PI : 0, w: 4.4, h: 0.7, style: "bus" });
    }
    // Flags
    for (const [x, z] of flagSpots) bs.box(x, 0, z, 0.25, 12, 0.25, col("#D9D9D9"));
    scene.add(bs.mesh(MAT.flat, { cast: true }));
    const flagTex = (() => {
      const c = document.createElement("canvas"); c.width = 96; c.height = 48;
      const x = c.getContext("2d");
      x.fillStyle = "#C4272F"; x.fillRect(0, 0, 32, 48); x.fillRect(64, 0, 32, 48);
      x.fillStyle = "#015197"; x.fillRect(32, 0, 32, 48);
      x.fillStyle = "#F9CF02"; x.fillRect(12, 10, 8, 28); x.beginPath(); x.arc(16, 8, 4, 0, 6.3); x.fill();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    flags.length = 0;
    for (const [x, z] of flagSpots) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(4, 2, 6, 1), new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }));
      f.position.set(x + 2.1, 10.8, z);
      f.geometry.translate(0, 0, 0);
      flags.push(f);
      scene.add(f);
    }

    // Street name signs at intersections
    for (const n of Object.values(NODE)) {
      const eh = n.edges.find((e) => e.axis === "x"), ev = n.edges.find((e) => e.axis === "z");
      if (eh && rnd() < 0.8) signs.push({ text: eh.name, x: n.x + n.r + 2.2, y: 3.6, z: n.z + n.r + 2.2, rot: 0, w: Math.max(5, eh.name.length * 0.36), h: 0.9, style: "street", pole: true });
      if (ev && ev.name !== (eh && eh.name) && rnd() < 0.8) signs.push({ text: ev.name, x: n.x - n.r - 2.2, y: 3.6, z: n.z - n.r - 2.2, rot: Math.PI / 2, w: Math.max(5, ev.name.length * 0.36), h: 0.9, style: "street", pole: true });
    }
    buildSigns();
  }
  const flags = [];

  function buildSigns() {
    const styles = {
      shop: { bg: "#1F3B57", fg: "#FFFFFF", border: "#F2B33D" },
      street: { bg: "#1E5AA8", fg: "#FFFFFF", border: "#FFFFFF" },
      bus: { bg: "#FFFFFF", fg: "#1E5AA8", border: "#1E5AA8" },
      plaza: { bg: "#7A1F35", fg: "#FFF4E0", border: "#F2B33D" },
      plaque: { bg: "#2B2B2B", fg: "#F2D08A", border: "#F2D08A" },
      parking: { bg: "#1E5AA8", fg: "#FFFFFF", border: "#FFFFFF" }
    };
    // pack every sign into one atlas texture → one draw call
    const AW = 2048, RH = 64;
    let x0 = 0, y0 = 0;
    const placed = signs.map((s) => {
      const w = Math.min(AW, Math.round(RH * (s.w / s.h)));
      if (x0 + w > AW) { x0 = 0; y0 += RH; }
      const r = { s, x: x0, y: y0, w };
      x0 += w;
      return r;
    });
    const AH = THREE.MathUtils.ceilPowerOfTwo(y0 + RH);
    const c = document.createElement("canvas"); c.width = AW; c.height = AH;
    const ctx = c.getContext("2d");
    for (const r of placed) {
      const st = styles[r.s.style];
      ctx.fillStyle = st.bg; ctx.fillRect(r.x, r.y, r.w, RH);
      ctx.strokeStyle = st.border; ctx.lineWidth = 4; ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, RH - 6);
      ctx.fillStyle = st.fg;
      let fs = 34;
      ctx.font = `700 ${fs}px "Golos Text", Arial, sans-serif`;
      while (ctx.measureText(r.s.text).width > r.w - 24 && fs > 12) { fs -= 2; ctx.font = `700 ${fs}px "Golos Text", Arial, sans-serif`; }
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(r.s.text, r.x + r.w / 2, r.y + RH / 2 + 2);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const P = [], U = [];
    for (const r of placed) {
      const s = r.s, cs = Math.cos(s.rot), sn = Math.sin(s.rot);
      const ux = cs, uz = -sn; // local +x after rotation about Y
      const hw = s.w / 2, hh = s.h / 2;
      const corner = (a, b) => [s.x + ux * a * hw, s.y + b * hh, s.z + uz * a * hw];
      const u0 = r.x / AW, u1 = (r.x + r.w) / AW, v1 = 1 - r.y / AH, v0 = 1 - (r.y + RH) / AH;
      const bl = corner(-1, -1), br = corner(1, -1), tr = corner(1, 1), tl = corner(-1, 1);
      P.push(...bl, ...br, ...tr, ...bl, ...tr, ...tl);
      U.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      if (s.pole) { // readable from behind too
        P.push(...br, ...bl, ...tl, ...br, ...tl, ...tr);
        U.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex })));
    const poleB = new GeoBuilder();
    for (const s of signs) if (s.pole) poleB.box(s.x - Math.cos(s.rot) * (s.w / 2 - 0.2), 0, s.z + Math.sin(s.rot) * (s.w / 2 - 0.2), 0.14, s.y + s.h / 2, 0.14, col("#6B737C"));
    scene.add(poleB.mesh(MAT.flat));
  }

  /* ---------- Mountains + ger district ---------- */
  function buildBackdrop() {
    const parts = [];
    const add = (geo, x, z, rotY, colTop, colBase, base, h) => {
      const g = geo.toNonIndexed();
      const pos = g.attributes.position;
      let maxY = 0;
      for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
      // deterministic jitter per original vertex → shared corners move together (no cracks)
      const off = new Map();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < 1 || y > maxY - 1) continue;
        const key = Math.round(pos.getX(i) * 10) + "," + Math.round(y * 10) + "," + Math.round(pos.getZ(i) * 10);
        if (!off.has(key)) off.set(key, [rr(-1, 1) * base * 0.09, rr(-1, 1) * h * 0.07, rr(-1, 1) * base * 0.09]);
        const o = off.get(key);
        pos.setXYZ(i, pos.getX(i) + o[0], y + o[1], pos.getZ(i) + o[2]);
      }
      g.rotateY(rotY); g.translate(x, 0, z);
      g.computeVertexNormals();
      const cc = [];
      for (let i = 0; i < pos.count; i++) { const k = clamp(pos.getY(i) / maxY, 0, 1); const c = colBase.clone().lerp(colTop, k); cc.push(c.r, c.g, c.b); }
      g.setAttribute("color", new THREE.Float32BufferAttribute(cc, 3));
      g.deleteAttribute("uv");
      parts.push(g);
    };
    const count = 34;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rr(-0.05, 0.05);
      const south = Math.cos(a - Math.PI / 2) > 0.55; // Bogd Khan side (+z)
      const R = rr(760, 1050) + (south ? -80 : 0);
      const h = south ? rr(230, 330) : rr(110, 230);
      const base = south ? rr(260, 360) : rr(170, 300);
      const geo = new THREE.ConeGeometry(base, h, 8, 3);
      geo.translate(0, h / 2, 0);
      add(geo, Math.cos(a) * R * 1.05, Math.sin(a) * R, rr(0, 6), south ? col("#4E6B47") : col("#B9AD86"), south ? col("#6E7F57") : col("#9C9168"), base, h);
    }
    // merge
    let total = 0; parts.forEach((g) => (total += g.attributes.position.count));
    const P = new Float32Array(total * 3), Nn = new Float32Array(total * 3), C = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) { P.set(g.attributes.position.array, o * 3); Nn.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(P, 3));
    mg.setAttribute("normal", new THREE.BufferAttribute(Nn, 3));
    mg.setAttribute("color", new THREE.BufferAttribute(C, 3));
    const mts = new THREE.Mesh(mg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    scene.add(mts);

    // Ger district on the northern foothills
    const gers = [];
    for (let i = 0; i < (LOW ? 40 : 70); i++) gers.push([rr(-420, 420), rr(-560, -330)]);
    for (let i = 0; i < (LOW ? 10 : 20); i++) gers.push([rr(-520, -360), rr(-200, 200)]);
    const wallG = new THREE.CylinderGeometry(3, 3, 2.4, 8); wallG.translate(0, 1.2, 0);
    const roofG = new THREE.ConeGeometry(3.3, 1.6, 8); roofG.translate(0, 3.2, 0);
    const walls = new THREE.InstancedMesh(wallG, new THREE.MeshLambertMaterial({ color: col("#F4F1EA") }), gers.length);
    const roofs = new THREE.InstancedMesh(roofG, new THREE.MeshLambertMaterial({ color: 0xffffff }), gers.length);
    const fenceB = new GeoBuilder();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    gers.forEach(([x, z], i) => {
      m.compose(p.set(x, 0, z), q, s); walls.setMatrixAt(i, m); roofs.setMatrixAt(i, m);
      roofs.setColorAt(i, col(pick(["#E9E4D8", "#D8D2C4", "#C9584B", "#3E77B6", "#E9E4D8"])));
      if (rnd() < 0.6) { const fw = rr(14, 22); const fc = col(pick(["#A26B3E", "#7C8C96", "#B08A55"])); fenceB.box(x, 0, z - fw / 2, fw, 1.8, 0.3, fc); fenceB.box(x, 0, z + fw / 2, fw, 1.8, 0.3, fc); fenceB.box(x - fw / 2, 0, z, 0.3, 1.8, fw, fc); fenceB.box(x + fw / 2, 0, z, 0.3, 1.8, fw, fc); }
    });
    roofs.instanceColor.needsUpdate = true;
    scene.add(walls, roofs, fenceB.mesh(MAT.flat));
  }

  /* ======================================================================
     TRAFFIC LIGHTS
     ====================================================================== */
  const LAMP_COL = { r: ["#FF3B30", "#3A1513"], y: ["#FFC93C", "#3A2F12"], g: ["#3CE07A", "#103A20"] };
  const LAMP = { geo: null, ranges: {} };
  function buildTrafficLights() {
    const gb = new GeoBuilder();
    const P = [], C = [];
    const dark = col("#22262B"), pole = col("#5A6168");
    for (const id of LIT_NODES) {
      const n = NODE[id];
      for (const e of n.edges) {
        const toward = e.b === n ? 1 : -1;
        const dx = e.dx * toward, dz = e.dz * toward, rx = -dz, rz = dx;
        const px = n.x - dx * (n.r + 1.4) + rx * (e.hw + 1.2), pz = n.z - dz * (n.r + 1.4) + rz * (e.hw + 1.2);
        const rot = Math.atan2(-dx, -dz);
        gb.box(px, 0, pz, 0.2, 4.1, 0.2, pole, { rot });
        gb.box(px, 4.05, pz, 0.55, 1.7, 0.45, dark, { rot });
        // lamp discs on the face toward oncoming traffic (local +z after rot)
        const fx = Math.sin(rot), fz = Math.cos(rot), ux = Math.cos(rot), uz = -Math.sin(rot);
        ["r", "y", "g"].forEach((k, i) => {
          const key = id + "|" + e.axis + "|" + k;
          const start = P.length / 3;
          const cx = px + fx * 0.235, cy = 5.4 - i * 0.52 - 0.0, cz = pz + fz * 0.235;
          const seg = 10, r = 0.19;
          for (let j = 0; j < seg; j++) {
            const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
            const v = (a) => [cx + ux * Math.cos(a) * r, cy + Math.sin(a) * r, cz + uz * Math.cos(a) * r];
            P.push(cx, cy, cz, ...v(a0), ...v(a1));
            for (let q = 0; q < 3; q++) C.push(0, 0, 0);
          }
          (LAMP.ranges[key] = LAMP.ranges[key] || []).push([start, P.length / 3 - start]);
        });
      }
    }
    scene.add(gb.mesh(MAT.flat, { cast: true }));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    LAMP.geo = g;
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }
  function lightState(nodeId, axis) {
    const L = NODE[nodeId].light;
    if (!L) return "g";
    const ew = axis === "x";
    switch (L.phase) {
      case 0: return ew ? "g" : "r";
      case 1: return ew ? "y" : "r";
      case 2: return ew ? "r" : "g";
      default: return ew ? "r" : "y";
    }
  }
  const PHASE_T = [9, 2.2, 9, 2.2];
  function updateLights(dt) {
    for (const id of LIT_NODES) {
      const L = NODE[id].light;
      L.t += dt;
      if (L.t >= PHASE_T[L.phase]) { L.t = 0; L.phase = (L.phase + 1) % 4; paintLights(id); }
    }
  }
  function paintLights(id) {
    const attr = LAMP.geo.attributes.color;
    for (const axis of ["x", "z"]) {
      const st = lightState(id, axis);
      for (const k of ["r", "y", "g"]) {
        const c = col(LAMP_COL[k][st === k ? 0 : 1]);
        for (const [start, count] of LAMP.ranges[id + "|" + axis + "|" + k] || []) for (let i = start; i < start + count; i++) attr.setXYZ(i, c.r, c.g, c.b);
      }
    }
    attr.needsUpdate = true;
  }

  /* ======================================================================
     CARS
     ====================================================================== */
  const carGeo = {
    sedanBody: new THREE.BoxGeometry(4.4, 0.75, 1.86),
    sedanCabin: new THREE.BoxGeometry(2.3, 0.62, 1.66),
    vanBody: new THREE.BoxGeometry(4.8, 1.9, 1.95),
    busBody: new THREE.BoxGeometry(11, 2.6, 2.5),
    wheel: new THREE.CylinderGeometry(0.38, 0.38, 0.3, 8),
    glass: new THREE.BoxGeometry(2.32, 0.46, 1.68),
    light: new THREE.BoxGeometry(0.08, 0.18, 0.4),
    shadow: new THREE.PlaneGeometry(1, 1)
  };
  carGeo.wheel.rotateX(Math.PI / 2);
  const matCache = {};
  const lam = (hex) => (matCache[hex] = matCache[hex] || new THREE.MeshLambertMaterial({ color: col(hex) }));
  const blobTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"); const g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const headM = new THREE.MeshBasicMaterial({ color: col("#FFF6D8") });
  const tailM = new THREE.MeshBasicMaterial({ color: col("#E0352B") });

  const carMergedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mergedCache = {};
  // Collapse a car group into ONE mesh (vertex colors) → 1 draw call per car
  function makeCarMerged(type, color) {
    const key = type + color;
    if (!mergedCache[key]) {
      const g = makeCar(type, color, true);
      g.updateMatrixWorld(true);
      const parts = [];
      g.traverse((o) => {
        if (!o.isMesh || o.material === blobMat) return;
        const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        const c = o.material.color, n = geo.attributes.position.count, arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
        parts.push(geo);
      });
      let total = 0; parts.forEach((p) => (total += p.attributes.position.count));
      const P = new Float32Array(total * 3), Nn = new Float32Array(total * 3), C = new Float32Array(total * 3);
      let o = 0;
      for (const p of parts) { P.set(p.attributes.position.array, o * 3); Nn.set(p.attributes.normal.array, o * 3); C.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute("position", new THREE.BufferAttribute(P, 3));
      mg.setAttribute("normal", new THREE.BufferAttribute(Nn, 3));
      mg.setAttribute("color", new THREE.BufferAttribute(C, 3));
      mg.computeBoundingSphere();
      mergedCache[key] = { geo: mg, L: g.userData.L, W: g.userData.W };
    }
    const d = mergedCache[key];
    const grp = new THREE.Group();
    const m = new THREE.Mesh(d.geo, carMergedMat);
    m.castShadow = Q.shadows;
    grp.add(m);
    if (!Q.shadows) { const sh = new THREE.Mesh(carGeo.shadow, blobMat); sh.rotation.x = -Math.PI / 2; sh.scale.set(d.L * 1.2, d.W * 1.6, 1); sh.position.y = 0.06; grp.add(sh); }
    grp.rotation.order = "YXZ";
    grp.userData = { L: d.L, W: d.W, wheels: [] };
    return grp;
  }

  function makeCar(type, color, forMerge) {
    const g = new THREE.Group();
    const body = lam(color);
    const glassM = lam("#22303D");
    let L = 4.4, W = 1.86;
    const wheelM = lam("#1C1E21");
    const wheels = [];
    const addWheels = (xs, half) => { for (const x of xs) for (const z of [-half, half]) { const w = new THREE.Mesh(carGeo.wheel, wheelM); w.position.set(x, 0.38, z); g.add(w); wheels.push(w); } };
    if (type === "bus") {
      L = 11; W = 2.5;
      const b = new THREE.Mesh(carGeo.busBody, body); b.position.y = 1.75; g.add(b);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(11.02, 0.9, 2.52), glassM); stripe.position.y = 2.25; g.add(stripe);
      addWheels([-3.6, 3.6], 1.15);
    } else if (type === "van") {
      L = 4.8; W = 1.95;
      const b = new THREE.Mesh(carGeo.vanBody, body); b.position.y = 1.4; g.add(b);
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 1.7), glassM); w.position.set(2.42, 1.75, 0); g.add(w);
      addWheels([-1.6, 1.6], 0.86);
    } else {
      const b = new THREE.Mesh(carGeo.sedanBody, body); b.position.y = 0.8; g.add(b);
      const c = new THREE.Mesh(carGeo.sedanCabin, body); c.position.set(-0.25, 1.48, 0); g.add(c);
      const gl = new THREE.Mesh(carGeo.glass, glassM); gl.position.set(-0.25, 1.46, 0); gl.scale.set(1.0, 0.95, 1.01); g.add(gl);
      addWheels([-1.35, 1.35], 0.88);
    }
    for (const z of [-W / 2 + 0.35, W / 2 - 0.35]) {
      const h = new THREE.Mesh(carGeo.light, headM); h.position.set(L / 2 + 0.01, type === "bus" ? 1.1 : 0.85, z); g.add(h);
      const t = new THREE.Mesh(carGeo.light, tailM); t.position.set(-L / 2 - 0.01, type === "bus" ? 1.1 : 0.9, z); g.add(t);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = Q.shadows; });
    if (!Q.shadows && !forMerge) { const sh = new THREE.Mesh(carGeo.shadow, blobMat); sh.rotation.x = -Math.PI / 2; sh.scale.set(L * 1.2, W * 1.6, 1); sh.position.y = 0.06; g.add(sh); }
    g.rotation.order = "YXZ";
    g.userData = { L, W, wheels };
    return g;
  }

  /* ======================================================================
     PLAYER
     ====================================================================== */
  const START = { x: -205, z: 4.8, heading: 0 };
  const player = {
    x: START.x, z: START.z, heading: 0, speed: 0, steer: 0, mesh: null, L: 4.4, R: 2.0,
    redCheck: null
  };
  function buildPlayer() {
    const car = makeCar("sedan", "#E4462F");
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.42, 0.12, 0.5), lam("#F2B33D"));
    stripe.position.y = 1.12; car.add(stripe);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.28, 0.9), new THREE.MeshBasicMaterial({ color: col("#F2B33D") }));
    sign.position.set(-0.3, 1.93, 0); car.add(sign);
    player.mesh = car;
    scene.add(car);
  }

  /* ======================================================================
     TRAFFIC AI
     ====================================================================== */
  const traffic = [];
  const TCOLORS = ["#F4F4F4", "#C9CDD2", "#2B2E33", "#9A1F1F", "#1F4E8C", "#3C6E4E", "#B8B8B8", "#E0C25A", "#5A3E2B", "#FFFFFF", "#7E8B99"];
  function laneChoices(node, cameFromEdge) {
    const out = [];
    for (const e of node.edges) {
      if (e === cameFromEdge && node.edges.length > 1) continue;
      out.push({ e, forward: e.a === node });
    }
    return out;
  }
  function spawnTraffic() {
    const n = Q.traffic;
    let tries = 0;
    while (traffic.length < n && tries++ < 500) {
      const e = pick(EDGES);
      const forward = rnd() < 0.5;
      const k = Math.floor(rnd() * e.lanes);
      const lp = lanePath(e, forward, k);
      if (lp.len < 20) continue;
      const s = rr(4, lp.len - 6);
      const x = lerp(lp.p0.x, lp.p1.x, s / lp.len), z = lerp(lp.p0.z, lp.p1.z, s / lp.len);
      if (Math.hypot(x - START.x, z - START.z) < 40) continue;
      if (traffic.some((t) => Math.hypot(t.x - x, t.z - z) < 14)) continue;
      const type = traffic.filter((t) => t.type === "bus").length < 2 && rnd() < 0.12 ? "bus" : rnd() < 0.22 ? "van" : "sedan";
      if (type === "bus" && e.lanes < 2) continue;
      const color = type === "bus" ? pick(["#2E6FB7", "#E0B83A"]) : pick(TCOLORS);
      const mesh = makeCarMerged(type, color);
      scene.add(mesh);
      traffic.push({ type, mesh, L: mesh.userData.L, lane: lp, s, x, z, heading: Math.atan2(-lp.dz, lp.dx), speed: rr(6, 10), base: type === "bus" ? 8.5 : rr(10, 13.5), turn: null, wait: 0, bump: 0 });
    }
  }
  function bezier(p0, c, p1, t) { const u = 1 - t; return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, z: u * u * p0.z + 2 * u * t * c.z + t * t * p1.z }; }
  function startTurn(car) {
    const lp = car.lane, node = lp.to;
    const opts = laneChoices(node, lp.e);
    let choice = pick(opts);
    // avoid parking-only direction issues: none. Prefer straight sometimes
    if (rnd() < 0.45) { const st = opts.find((o) => (o.forward ? 1 : -1) * o.e.dx === lp.dx && (o.forward ? 1 : -1) * o.e.dz === lp.dz); if (st) choice = st; }
    const ne = choice.e;
    const ndx = choice.forward ? ne.dx : -ne.dx, ndz = choice.forward ? ne.dz : -ne.dz;
    const cross = lp.dx * ndz - lp.dz * ndx; // >0 → right turn (in x/z with -z north)
    let k = 0;
    if (ne.lanes === 2) { k = cross > 0.5 ? 1 : cross < -0.5 ? 0 : Math.min(lp.k, 1); }
    if (car.type === "bus" && ne.lanes < 2) { // buses stay on wide roads
      const wide = opts.filter((o) => o.e.lanes === 2);
      if (wide.length) return startTurnTo(car, pick(wide), 1);
    }
    return startTurnTo(car, choice, k);
  }
  function startTurnTo(car, choice, k) {
    const lp = car.lane;
    const nlp = lanePath(choice.e, choice.forward, Math.min(k, choice.e.lanes - 1));
    const p0 = lp.p1, p1 = nlp.p0;
    let c;
    if (Math.abs(lp.dx * nlp.dz - lp.dz * nlp.dx) < 0.1) c = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
    else c = Math.abs(lp.dx) > 0.5 ? { x: p1.x, z: p0.z } : { x: p0.x, z: p1.z };
    const len = Math.hypot(c.x - p0.x, c.z - p0.z) + Math.hypot(p1.x - c.x, p1.z - c.z);
    car.turn = { p0, c, p1, t: 0, len: Math.max(len, 1), node: lp.to, next: nlp };
  }
  function updateTraffic(dt) {
    const cars = traffic;
    for (const car of cars) {
      if (car.bump > 0) { car.bump -= dt; car.speed = Math.max(0, car.speed - 20 * dt); }
      let desired = car.base;
      const fx = Math.cos(car.heading), fz = -Math.sin(car.heading);
      // lights / intersection
      if (!car.turn) {
        const lp = car.lane;
        const remain = lp.len - car.s;
        const node = lp.to;
        if (node.light) {
          const st = lightState(node.id, lp.e.axis);
          const stopAt = remain - 5.6 - car.L / 2;
          if (st === "r" || (st === "y" && stopAt > 6)) desired = Math.min(desired, stopAt < 0.5 ? 0 : Math.sqrt(2 * 6 * Math.max(0, stopAt - 0.5)));
        } else if (remain < 14) {
          desired = Math.min(desired, 7);
          if (remain < 3 && cars.some((o) => o !== car && o.turn && o.turn.node === node)) desired = 0;
        }
      }
      // leader (cars + player)
      const creep = car.wait > 8; // deadlock breaker: briefly ignore other AI cars
      const others = (creep ? [] : cars.map((o) => ({ x: o.x, z: o.z, L: o.L, o })));
      if (game.state !== "menu") others.push({ x: player.x, z: player.z, L: player.L, o: player });
      for (const o of others) {
        if (o.o === car) continue;
        if (car.turn && o.o !== player) { // while turning only yield to cars on/into the target lane
          const oc = o.o;
          const onTarget = (!oc.turn && oc.lane === car.turn.next && oc.s < 14) || (oc.turn && oc.turn.next === car.turn.next && oc.turn.t > car.turn.t);
          if (!onTarget) continue;
        }
        const vx = o.x - car.x, vz = o.z - car.z;
        const along = vx * fx + vz * fz;
        if (along <= 0 || along > 30) continue;
        const lat = Math.abs(vx * -fz + vz * fx);
        if (lat > 2.4) continue;
        const gap = along - (car.L + o.L) / 2;
        desired = Math.min(desired, Math.max(0, (gap - 2.5) * 1.1));
      }
      const dv = desired - car.speed;
      car.speed = clamp(car.speed + clamp(dv, -10 * dt, 3.2 * dt), 0, 16);
      if (car.speed < 0.2 && desired < 0.5) car.wait += dt; else if (car.speed > 2) car.wait = 0;
      if (car.wait > 10.5) car.wait = 0;
      // advance
      const d = car.speed * dt;
      if (car.turn) {
        const T = car.turn;
        T.t += d / T.len;
        if (T.t >= 1) { car.lane = T.next; car.s = (T.t - 1) * T.len; car.turn = null; }
        else {
          const p = bezier(T.p0, T.c, T.p1, T.t), p2 = bezier(T.p0, T.c, T.p1, Math.min(1, T.t + 0.02));
          car.x = p.x; car.z = p.z;
          car.heading = Math.atan2(-(p2.z - p.z), p2.x - p.x);
        }
      }
      if (!car.turn) {
        car.s += d;
        const lp = car.lane;
        if (car.s >= lp.len) { car.s = lp.len; startTurn(car); }
        const t = car.s / lp.len;
        car.x = lerp(lp.p0.x, lp.p1.x, t); car.z = lerp(lp.p0.z, lp.p1.z, t);
        car.heading = Math.atan2(-lp.dz, lp.dx);
      }
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.heading;
      const wr = car.speed * dt / 0.38;
      for (const w of car.mesh.userData.wheels) w.rotation.z -= wr;
    }
  }

  /* ======================================================================
     CHECKPOINTS + COINS
     ====================================================================== */
  const CPS = [
    { x: 0, z: 0, axis: "x", w: 16 },
    { x: 80, z: -100, axis: "z", w: 14 },
    { x: 0, z: -180, axis: "x", w: 10 },
    { x: -160, z: -90, axis: "z", w: 7 },
    { x: -80, z: 85, axis: "z", w: 14 },
    { x: 160, z: 85, axis: "z", w: 7 },
    { x: 198, z: 84, axis: "x", w: 18, finish: true }
  ];
  const COINS_POS = [[-130, 4.5], [40, -4.5], [80, -150], [40, -180], [-110, -180], [-160, -135], [-160, -40], [-80, 40], [-80, 130], [20, 170], [120, 170], [160, 125], [200, 120]];
  const cpMeshes = [];
  const coins = [];
  function buildCheckpoints() {
    const ringMat = new THREE.MeshBasicMaterial({ color: col("#F2B33D"), transparent: true, opacity: 0.9 });
    const finMat = new THREE.MeshBasicMaterial({ map: checkerTex(), side: THREE.DoubleSide });
    const beamMat = new THREE.MeshBasicMaterial({ color: col("#FFD66B"), transparent: true, opacity: 0.18, depthWrite: false });
    CPS.forEach((cp, i) => {
      const g = new THREE.Group();
      const half = cp.w / 2 + 1.4;
      const postG = new THREE.BoxGeometry(0.6, 6.5, 0.6);
      const pA = new THREE.Mesh(postG, ringMat), pB = new THREE.Mesh(postG, ringMat);
      pA.position.set(0, 3.25, -half); pB.position.set(0, 3.25, half);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, half * 2 + 0.6), cp.finish ? finMat : ringMat);
      top.position.y = 6.4;
      g.add(pA, pB, top);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshBasicMaterial({ map: textTex(cp.finish ? "FINISH" : "CHECKPOINT " + (i + 1), "#1E1405", "#F2B33D"), side: THREE.DoubleSide }));
      label.position.set(0.33, 6.4, 0); label.rotation.y = Math.PI / 2;
      if (!cp.finish) g.add(label);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(half, half, 60, 12, 1, true), beamMat);
      beam.position.y = 30; beam.scale.set(0.12, 1, 1);
      g.add(beam);
      g.position.set(cp.x, 0, cp.z);
      g.rotation.y = cp.axis === "x" ? 0 : Math.PI / 2;
      g.visible = false;
      scene.add(g);
      cpMeshes.push(g);
    });
    const coinG = new THREE.CylinderGeometry(0.9, 0.9, 0.22, 14); coinG.rotateX(Math.PI / 2);
    const coinM = new THREE.MeshLambertMaterial({ color: col("#F2C230"), emissive: col("#6B4A00") });
    for (const [x, z] of COINS_POS) { const m = new THREE.Mesh(coinG, coinM); m.position.set(x, 1.4, z); scene.add(m); coins.push({ x, z, mesh: m, taken: false }); }
  }
  function checkerTex() {
    const c = document.createElement("canvas"); c.width = 128; c.height = 32; const x = c.getContext("2d");
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? "#111" : "#fff"; x.fillRect(i * 8, j * 8, 8, 8); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
  }
  function textTex(text, fg, bg) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 96; const x = c.getContext("2d");
    x.fillStyle = bg; x.fillRect(0, 0, 512, 96); x.fillStyle = fg; x.font = '800 52px "Unbounded", "Golos Text", Arial'; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 256, 52);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // Direction arrow floating above the player
  let guideArrow;
  function buildGuide() {
    const g = new THREE.ConeGeometry(0.34, 1.1, 4); g.rotateZ(-Math.PI / 2);
    guideArrow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col("#F2B33D"), transparent: true, opacity: 0.92, depthTest: false }));
    guideArrow.renderOrder = 10;
    scene.add(guideArrow);
  }

  /* ======================================================================
     GAME STATE
     ====================================================================== */
  const game = {
    state: "menu", // menu | countdown | playing | paused | over
    name: "", time: ROUTE_TIME, cpIndex: 0, dist: 0, coins: 0, cpPts: 0, penalties: 0,
    collisions: 0, redLights: 0, shake: 0, countdown: 0, runId: 0, finished: false, camMode: 0
  };
  const liveScore = () => Math.min(SCORE.distCap, Math.floor(game.dist / SCORE.distPer)) + game.cpPts + game.coins * SCORE.coin;

  /* ======================================================================
     INPUT
     ====================================================================== */
  const input = { up: false, down: false, left: false, right: false, src: { up: new Set(), down: new Set(), left: new Set(), right: new Set() } };
  const press = (k, s) => { input.src[k].add(s); input[k] = true; };
  const release = (k, s) => { input.src[k].delete(s); input[k] = input.src[k].size > 0; };
  const KEYMAP = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };
  window.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT") return;
    const k = KEYMAP[e.code];
    if (k) { press(k, e.code); e.preventDefault(); }
    if ((e.code === "KeyP" || e.code === "Escape") && !e.repeat) togglePause();
    if (e.code === "KeyC" && !e.repeat) cycleCam();
  });
  window.addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) release(k, e.code); });
  window.addEventListener("blur", () => { for (const k of Object.keys(input.src)) { input.src[k].clear(); input[k] = false; } });
  document.querySelectorAll(".t-btn").forEach((b) => {
    const k = b.dataset.key;
    const down = (e) => { e.preventDefault(); b.setPointerCapture && b.setPointerCapture(e.pointerId); press(k, "p" + e.pointerId); b.classList.add("is-down"); audio.unlock(); };
    const up = (e) => { release(k, "p" + e.pointerId); b.classList.remove("is-down"); };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("lostpointercapture", up);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  if (isTouch) document.body.classList.add("has-touch");
  document.addEventListener("touchmove", (e) => { if (game.state === "playing" || game.state === "countdown") e.preventDefault(); }, { passive: false });
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  /* ======================================================================
     AUDIO (tiny Web Audio synth, starts after a user gesture)
     ====================================================================== */
  const audio = {
    ctx: null, on: true, engine: null, engGain: null, filter: null,
    unlock() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.gain.value = this.on ? 0.5 : 0; this.master.connect(this.ctx.destination);
        this.engine = this.ctx.createOscillator(); this.engine.type = "sawtooth"; this.engine.frequency.value = 50;
        this.filter = this.ctx.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.frequency.value = 420;
        this.engGain = this.ctx.createGain(); this.engGain.gain.value = 0;
        this.engine.connect(this.filter).connect(this.engGain).connect(this.master); this.engine.start();
      } catch (e) { this.ctx = null; }
    },
    setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.5 : 0; },
    engineUpdate(speed, active) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.engine.frequency.setTargetAtTime(44 + Math.abs(speed) * 5.2, t, 0.08);
      this.filter.frequency.setTargetAtTime(300 + Math.abs(speed) * 40, t, 0.1);
      this.engGain.gain.setTargetAtTime(active ? 0.07 + Math.min(0.08, Math.abs(speed) * 0.004) : 0, t, 0.15);
    },
    beep(freqs, dur = 0.12, type = "triangle", vol = 0.2) {
      if (!this.ctx || !this.on) return;
      const t0 = this.ctx.currentTime;
      freqs.forEach((f, i) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + i * dur); g.gain.exponentialRampToValueAtTime(vol, t0 + i * dur + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i + 1) * dur);
        o.connect(g).connect(this.master); o.start(t0 + i * dur); o.stop(t0 + (i + 1) * dur + 0.02);
      });
    },
    crash() {
      if (!this.ctx || !this.on) return;
      const len = 0.25, b = this.ctx.createBuffer(1, this.ctx.sampleRate * len, this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); g.gain.value = 0.45; s.buffer = b; s.connect(g).connect(this.master); s.start();
    }
  };

  /* ======================================================================
     PHYSICS
     ====================================================================== */
  function updatePlayer(dt) {
    const p = player;
    const canDrive = game.state === "playing";
    const throttle = canDrive && input.up ? 1 : 0;
    const brake = canDrive && input.down ? 1 : 0;
    const steerIn = canDrive ? (input.left ? 1 : 0) - (input.right ? 1 : 0) : 0;
    p.steer = lerp(p.steer, steerIn, 1 - Math.exp(-dt * 7));
    const road = onRoad(p.x, p.z);
    const vmax = road ? 26 : 13;
    if (throttle) p.speed += (p.speed < 0 ? 18 : 8.5 * (1 - Math.max(0, p.speed) / (vmax + 4))) * dt;
    if (brake) p.speed -= (p.speed > 0.5 ? 20 : 6) * dt;
    if (!throttle && !brake) p.speed -= Math.sign(p.speed) * Math.min(Math.abs(p.speed), (1.4 + 0.012 * p.speed * p.speed) * dt);
    if (p.speed > vmax) p.speed -= (p.speed - vmax) * 2.5 * dt;
    p.speed = clamp(p.speed, -8, 30);
    const k = clamp(p.speed / 7, -1, 1);
    const turnRate = p.steer * k * (1.95 - 0.95 * Math.min(1, Math.abs(p.speed) / 26));
    p.heading += turnRate * dt;
    const fx = Math.cos(p.heading), fz = -Math.sin(p.heading);
    const ox = p.x, oz = p.z;
    p.x += fx * p.speed * dt; p.z += fz * p.speed * dt;
    if (canDrive) game.dist += Math.hypot(p.x - ox, p.z - oz);

    // buildings (two circles: front + rear)
    let hit = false, impact = 0;
    for (const off of [1.3, -1.3]) {
      const cx = p.x + fx * off, cz = p.z + fz * off, r = 1.15;
      for (const b of nearbyAABB(cx, cz)) {
        const nx = clamp(cx, b.x0, b.x1), nz = clamp(cz, b.z0, b.z1);
        const dx = cx - nx, dz = cz - nz, d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          let d = Math.sqrt(d2), ux, uz;
          if (d < 1e-4) { // center inside box: push along smallest axis
            const pen = [[cx - b.x0, -1, 0], [b.x1 - cx, 1, 0], [cz - b.z0, 0, -1], [b.z1 - cz, 0, 1]].sort((a, c) => a[0] - c[0])[0];
            ux = pen[1]; uz = pen[2]; d = -pen[0];
          } else { ux = dx / d; uz = dz / d; }
          const push = r - d;
          p.x += ux * push; p.z += uz * push;
          const vn = (fx * ux + fz * uz) * p.speed;
          if (vn < 0) { impact = Math.max(impact, -vn); hit = true; }
        }
      }
    }
    if (hit) {
      const sp = Math.abs(p.speed);
      p.speed *= -0.25;
      if (impact > 5 && canDrive) collide("building", impact);
      else if (sp > 2) game.shake = Math.max(game.shake, 0.15);
    }
    // traffic
    for (const t of traffic) {
      const tfx = Math.cos(t.heading), tfz = -Math.sin(t.heading);
      const n = Math.max(1, Math.round(t.L / 2.4));
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : -t.L / 2 + 1.2 + (i * (t.L - 2.4)) / (n - 1);
        const tx = t.x + tfx * off, tz = t.z + tfz * off;
        for (const poff of [1.2, -1.2]) {
          const cx = p.x + fx * poff, cz = p.z + fz * poff;
          const dx = cx - tx, dz = cz - tz, d = Math.hypot(dx, dz), min = 2.1;
          if (d < min && d > 1e-4) {
            const ux = dx / d, uz = dz / d;
            p.x += ux * (min - d); p.z += uz * (min - d);
            const rel = Math.abs(p.speed - t.speed * (tfx * fx + tfz * fz));
            if (rel > 4 && t.bump <= 0 && canDrive) { collide("car", rel); t.bump = 1.5; }
            p.speed *= -0.3;
          }
        }
      }
    }
    p.x = clamp(p.x, BOUNDS.x0 + 2, BOUNDS.x1 - 2); p.z = clamp(p.z, BOUNDS.z0 + 2, BOUNDS.z1 - 2);
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.heading;
    p.mesh.rotation.z = clamp(-p.speed * 0.002, -0.04, 0.04) * (throttle ? 1 : brake ? -1 : 0);
    p.mesh.rotation.x = -p.steer * Math.min(1, Math.abs(p.speed) / 20) * 0.05;
    const wr = p.speed * dt / 0.38;
    p.mesh.userData.wheels.forEach((w, i) => { w.rotation.z -= wr; if (i % 2 === 0 || true) w.rotation.y = i >= 2 ? p.steer * 0.45 : 0; });
    if (canDrive) checkRedLight();
  }

  function collide(kind, impact) {
    const pen = kind === "car" ? PENALTY.car : PENALTY.building;
    game.penalties += pen; game.collisions += 1;
    game.shake = Math.min(1.2, 0.35 + impact * 0.05);
    toast(kind === "car" ? "МӨРГӨЛДӨӨН −" + pen : "ОНОЛОО −" + pen, "bad");
    audio.crash();
    if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {}
  }

  function checkRedLight() {
    const p = player;
    let inside = null;
    for (const id of LIT_NODES) { const n = NODE[id]; if (Math.abs(p.x - n.x) < n.r - 0.5 && Math.abs(p.z - n.z) < n.r - 0.5) { inside = n; break; } }
    if (!inside) { p.redCheck = null; return; }
    if (p.redCheck === inside.id) return;
    p.redCheck = inside.id;
    if (Math.abs(p.speed) < 3) return;
    const axis = Math.abs(Math.cos(p.heading)) > Math.abs(Math.sin(p.heading)) ? "x" : "z";
    if (lightState(inside.id, axis) === "r") {
      game.penalties += PENALTY.redLight; game.redLights += 1;
      toast("УЛААН ГЭРЭЛ −" + PENALTY.redLight, "bad");
      audio.beep([220, 180], 0.14, "square", 0.15);
    }
  }

  function updateObjectives(dt, time) {
    const p = player;
    const cp = CPS[game.cpIndex];
    if (cp) {
      const reach = Math.max(cp.w / 2 + 2.5, 7);
      const dx = p.x - cp.x, dz = p.z - cp.z;
      const ok = cp.axis === "x" ? Math.abs(dx) < 3.2 && Math.abs(dz) < reach : Math.abs(dz) < 3.2 && Math.abs(dx) < reach;
      if (ok) {
        if (cp.finish) { finishRun(true); return; }
        game.cpIndex++; game.cpPts += SCORE.checkpoint;
        toast("CHECKPOINT +" + SCORE.checkpoint, "good");
        audio.beep([660, 880, 1100], 0.09);
        refreshCheckpoints();
      }
    }
    for (const c of coins) {
      if (c.taken) continue;
      c.mesh.rotation.y = time * 3;
      c.mesh.position.y = 1.4 + Math.sin(time * 3 + c.x) * 0.2;
      if (Math.hypot(p.x - c.x, p.z - c.z) < 3) { c.taken = true; c.mesh.visible = false; game.coins++; toast("₮ +" + SCORE.coin, "good"); audio.beep([1200, 1600], 0.06, "sine", 0.18); }
    }
  }
  function refreshCheckpoints() {
    cpMeshes.forEach((m, i) => { m.visible = game.state !== "menu" && i === game.cpIndex; });
  }

  /* ======================================================================
     CAMERA
     ====================================================================== */
  const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 62 };
  const CAM_MODES = [{ back: 9.5, up: 4.2, ahead: 5 }, { back: 15, up: 8.5, ahead: 8 }, { back: 5.5, up: 2.4, ahead: 6 }];
  function cycleCam() { game.camMode = (game.camMode + 1) % CAM_MODES.length; }
  function updateCamera(dt, snap) {
    const p = player, M = CAM_MODES[game.camMode];
    const fx = Math.cos(p.heading), fz = -Math.sin(p.heading);
    const back = M.back + Math.min(4, Math.abs(p.speed) * 0.12);
    let tx = p.x - fx * back, tz = p.z - fz * back;
    // keep camera out of buildings: pull closer if blocked
    for (let i = 1; i <= 6; i++) {
      const t = i / 6, sx = lerp(p.x, tx, t), sz = lerp(p.z, tz, t);
      if (pointInAABB(sx, sz)) { tx = lerp(p.x, tx, Math.max(0.25, t - 0.18)); tz = lerp(p.z, tz, Math.max(0.25, t - 0.18)); break; }
    }
    const target = new THREE.Vector3(tx, M.up + Math.min(1.5, Math.abs(p.speed) * 0.04), tz);
    const k = snap ? 1 : 1 - Math.exp(-dt * 5.5);
    camState.pos.lerp(target, k);
    const look = new THREE.Vector3(p.x + fx * M.ahead, 1.4, p.z + fz * M.ahead);
    camState.look.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 9));
    camera.position.copy(camState.pos);
    if (game.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * game.shake; camera.position.y += (Math.random() - 0.5) * game.shake * 0.6; camera.position.z += (Math.random() - 0.5) * game.shake;
      game.shake = Math.max(0, game.shake - dt * 2.4);
    }
    camera.lookAt(camState.look);
    camState.roll = lerp(camState.roll, -p.steer * Math.min(1, Math.abs(p.speed) / 18) * 0.045, 1 - Math.exp(-dt * 6));
    camera.rotateZ(camState.roll);
    const fov = 62 + Math.min(10, Math.abs(p.speed) * 0.38);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix(); }
    // shadow follows player
    sun.position.set(p.x + 120, 220, p.z + 160); sun.target.position.set(p.x, 0, p.z);
  }
  // Menu flyover
  function updateMenuCamera(time) {
    const a = time * 0.06;
    camera.position.set(Math.cos(a) * 230, 95, Math.sin(a) * 200 - 40);
    camera.lookAt(0, 10, -40);
    sun.position.set(120, 220, 160); sun.target.position.set(0, 0, 0);
  }

  /* ======================================================================
     HUD / MINIMAP / TOAST
     ====================================================================== */
  const ui = {
    hud: $("hud"), score: $("hud-score"), time: $("hud-time"), timeBox: document.querySelector(".hud-time"), cp: $("hud-cp"), speed: $("hud-speed"),
    arrow: $("hud-arrow"), nextText: $("hud-next-text"), toast: $("toast"), mini: $("minimap"),
    start: $("screen-start"), pause: $("screen-pause"), end: $("screen-end"), board: $("screen-board"),
    nameForm: $("name-form"), nameInput: $("player-name"), nameError: $("name-error"), startBtn: $("start-btn"), loading: $("loading"),
    endKicker: $("end-kicker"), endTitle: $("end-title"), endScore: $("end-score"), breakdown: $("breakdown"), saveStatus: $("save-status"), retrySave: $("retry-save"),
    boardList: $("board-list"), boardStatus: $("board-status"), boardYou: $("board-you"), rotate: $("rotate-hint")
  };
  let toastTimer = 0;
  function toast(text, kind) {
    ui.toast.textContent = text;
    ui.toast.className = "toast " + (kind || "");
    void ui.toast.offsetWidth;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1500);
  }
  const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(4, "0");
  const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  let hudAcc = 0;
  function updateHud(dt) {
    hudAcc += dt;
    if (hudAcc < 0.08) return;
    hudAcc = 0;
    ui.score.textContent = pad(liveScore());
    ui.time.textContent = fmtTime(game.time);
    ui.timeBox.classList.toggle("is-low", game.time < 30);
    ui.cp.textContent = Math.min(game.cpIndex, 6) + " / 6";
    ui.speed.textContent = Math.round(Math.abs(player.speed) * 3.6);
    const cp = CPS[game.cpIndex];
    if (cp) {
      const dx = cp.x - player.x, dz = cp.z - player.z;
      const ang = Math.atan2(-dz, dx) - player.heading; // relative, CCW
      ui.arrow.style.transform = "rotate(" + (-ang) + "rad)";
      ui.nextText.textContent = (cp.finish ? "FINISH · ЗОГСООЛ" : "CHECKPOINT " + (game.cpIndex + 1)) + " · " + Math.round(Math.hypot(dx, dz)) + " м";
    }
    drawMinimap();
  }
  // Minimap: static roads image + dynamic dots (north-up, player-centred)
  const MM = { scale: 0.42, img: null };
  function prepareMinimap() {
    const S = 4; // px per meter / 10
    const w = (BOUNDS.x1 - BOUNDS.x0) * MM.scale * 2, h = (BOUNDS.z1 - BOUNDS.z0) * MM.scale * 2;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    const sx = (v) => (v - BOUNDS.x0) * MM.scale * 2, sz = (v) => (v - BOUNDS.z0) * MM.scale * 2;
    x.fillStyle = "#2a3646"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#4b5868";
    for (const b of COLL) { if (b.x1 - b.x0 > 100 || b.z1 - b.z0 > 100) continue; x.fillRect(sx(b.x0), sz(b.z0), (b.x1 - b.x0) * MM.scale * 2, (b.z1 - b.z0) * MM.scale * 2); }
    x.strokeStyle = "#c9d3de"; x.lineCap = "round";
    for (const e of EDGES) { x.lineWidth = e.w * MM.scale * 2; x.beginPath(); x.moveTo(sx(e.a.x), sz(e.a.z)); x.lineTo(sx(e.b.x), sz(e.b.z)); x.stroke(); }
    x.fillStyle = "#c9d3de"; x.fillRect(sx(PARK.x0), sz(PARK.z0), (PARK.x1 - PARK.x0) * MM.scale * 2, (PARK.z1 - PARK.z0) * MM.scale * 2);
    x.fillStyle = "#d9cfb8"; x.fillRect(sx(-72), sz(-170), 144 * MM.scale * 2, 160 * MM.scale * 2);
    MM.img = c; MM.sx = sx; MM.sz = sz;
    void S;
  }
  function drawMinimap() {
    const c = ui.mini, x = c.getContext("2d"), W = c.width, H = c.height;
    x.clearRect(0, 0, W, H);
    x.save();
    x.beginPath(); x.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); x.clip();
    x.fillStyle = "#1c2633"; x.fillRect(0, 0, W, H);
    const px = MM.sx(player.x), pz = MM.sz(player.z);
    x.drawImage(MM.img, W / 2 - px, H / 2 - pz);
    x.fillStyle = "#ffffff";
    for (const t of traffic) { const dx = MM.sx(t.x) - px + W / 2, dz = MM.sz(t.z) - pz + H / 2; x.fillRect(dx - 3, dz - 3, 6, 6); }
    for (const cn of coins) if (!cn.taken) { x.fillStyle = "#F2C230"; x.beginPath(); x.arc(MM.sx(cn.x) - px + W / 2, MM.sz(cn.z) - pz + H / 2, 3.5, 0, 6.3); x.fill(); }
    const cp = CPS[game.cpIndex];
    if (cp) {
      let dx = MM.sx(cp.x) - px, dz = MM.sz(cp.z) - pz;
      const d = Math.hypot(dx, dz), maxR = W / 2 - 14;
      if (d > maxR) { dx *= maxR / d; dz *= maxR / d; }
      x.fillStyle = cp.finish ? "#ffffff" : "#F2B33D"; x.strokeStyle = "#1c2633"; x.lineWidth = 3;
      x.beginPath(); x.arc(W / 2 + dx, H / 2 + dz, 10, 0, 6.3); x.fill(); x.stroke();
    }
    // player arrow
    x.translate(W / 2, H / 2); x.rotate(-player.heading + Math.PI / 2);
    x.fillStyle = "#E4462F"; x.strokeStyle = "#fff"; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, -16); x.lineTo(11, 12); x.lineTo(0, 6); x.lineTo(-11, 12); x.closePath(); x.fill(); x.stroke();
    x.restore();
  }

  /* ======================================================================
     NAME, API, LEADERBOARD
     ====================================================================== */
  const NAME_RE = /^[\p{L}\p{N} _.\-']+$/u;
  const normalizeName = (raw) => String(raw || "").normalize("NFC").replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, "").replace(/\s+/g, " ").trim();
  function validateName(n) {
    if (!n) return "Нэрээ оруулна уу.";
    if ([...n].length > 16) return "Нэр 16 тэмдэгтээс хэтрэхгүй.";
    if (!NAME_RE.test(n)) return "Зөвхөн үсэг, тоо, зай, _ . - ' ашиглана.";
    return null;
  }
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const api = {
    async board() {
      const r = await fetch("/api/tegtat/leaderboard", { cache: "no-store", headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.ok) throw new Error((d && d.message) || "HTTP " + r.status);
      return d.scores;
    },
    async save(name, score) {
      const r = await fetch("/api/tegtat/save-score", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ name, score }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.ok) throw new Error((d && d.message) || "HTTP " + r.status);
      return d;
    }
  };
  const friendly = (err) => {
    if (location.protocol === "file:") return "Cloudflare Pages-ээр нээж байж leaderboard ажиллана.";
    const m = String(err && err.message || "");
    if (/HTTP 404/.test(m)) return "Leaderboard API deploy хийгдээгүй байна.";
    if (/Failed to fetch|NetworkError|Load failed/.test(m)) return "Интернэт холболтоо шалгана уу.";
    return m;
  };
  let lastSaved = null;
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  async function loadBoard() {
    ui.boardStatus.textContent = "Ачаалж байна…";
    try {
      const rows = await api.board();
      ui.boardList.innerHTML = rows.map((r, i) => {
        const you = lastSaved && r.id === lastSaved.id;
        return `<li class="${you ? "is-you" : ""}"><span class="rank">${String(i + 1).padStart(2, "0")}</span><span class="nm">${escapeHtml(r.name)}${you ? '<b class="you"> · YOU</b>' : ""}<span class="dt">${String(r.created_at || "").slice(0, 10)}</span></span><span class="sc">${r.score}</span></li>`;
      }).join("");
      ui.boardStatus.textContent = rows.length ? "" : "Одоогоор оноо алга. Анхны жолооч нь болоорой!";
      const inTop = lastSaved && rows.some((r) => r.id === lastSaved.id);
      ui.boardYou.hidden = !(lastSaved && !inTop);
      if (lastSaved && !inTop) ui.boardYou.textContent = "Таны байр: #" + lastSaved.rank + " · " + lastSaved.score;
    } catch (err) {
      ui.boardList.innerHTML = "";
      ui.boardStatus.textContent = "Leaderboard ачаалсангүй. " + friendly(err);
    }
  }
  const saved = new Map();
  async function saveScore(runId, name, score) {
    if (saved.get(runId) === "saving" || saved.get(runId) === "ok") return;
    ui.retrySave.hidden = true;
    ui.saveStatus.className = "save-status";
    if (score <= 0) { ui.saveStatus.textContent = "0 оноо хадгалагдахгүй."; saved.set(runId, "skip"); return; }
    saved.set(runId, "saving");
    ui.saveStatus.textContent = "Хадгалж байна…";
    try {
      const r = await api.save(name, score);
      saved.set(runId, "ok"); lastSaved = r;
      ui.saveStatus.classList.add("ok");
      ui.saveStatus.textContent = "Оноо хадгалагдлаа ✓ · Байр #" + r.rank;
    } catch (err) {
      saved.set(runId, "err");
      ui.saveStatus.classList.add("err");
      ui.saveStatus.textContent = "Хадгалж чадсангүй. " + friendly(err);
      ui.retrySave.hidden = false;
      ui.retrySave.onclick = () => saveScore(runId, name, score);
    }
  }

  /* ======================================================================
     FLOW
     ====================================================================== */
  function resetRun() {
    game.time = ROUTE_TIME; game.cpIndex = 0; game.dist = 0; game.coins = 0; game.cpPts = 0; game.penalties = 0; game.collisions = 0; game.redLights = 0; game.shake = 0; game.finished = false;
    game.runId++;
    player.x = START.x; player.z = START.z; player.heading = START.heading; player.speed = 0; player.steer = 0; player.redCheck = null;
    coins.forEach((c) => { c.taken = false; c.mesh.visible = true; });
    // clear traffic near start
    for (const t of traffic) if (Math.hypot(t.x - START.x, t.z - START.z) < 40) { t.s = Math.min(t.lane.len, t.s + 0); }
    updatePlayer(0);
  }
  function startRun() {
    resetRun();
    hideOverlays();
    ui.hud.hidden = false;
    document.body.classList.add("playing");
    game.state = "countdown"; game.countdown = 3;
    refreshCheckpoints();
    updateCamera(0, true);
    toast("3", "good");
    audio.beep([440], 0.12);
    checkRotate();
  }
  function hideOverlays() { [ui.start, ui.pause, ui.end, ui.board].forEach((o) => (o.hidden = true)); }
  function togglePause() {
    if (game.state === "playing" || game.state === "countdown") { game.prev = game.state; game.state = "paused"; ui.pause.hidden = false; audio.engineUpdate(0, false); }
    else if (game.state === "paused") { game.state = game.prev || "playing"; ui.pause.hidden = true; }
  }
  function toMenu() {
    game.state = "menu"; hideOverlays(); ui.start.hidden = false; ui.hud.hidden = true; document.body.classList.remove("playing"); refreshCheckpoints(); audio.engineUpdate(0, false);
  }
  function finishRun(completed) {
    if (game.state === "over") return;
    game.state = "over";
    game.finished = completed;
    const dist = Math.min(SCORE.distCap, Math.floor(game.dist / SCORE.distPer));
    const route = completed ? SCORE.route : 0;
    const timeB = completed ? Math.round((game.time / ROUTE_TIME) * SCORE.timeMax) : 0;
    const clean = completed ? Math.max(0, SCORE.cleanMax - game.penalties) : 0;
    const coinsP = game.coins * SCORE.coin;
    const total = Math.min(MAX_SCORE, Math.max(0, dist + game.cpPts + coinsP + route + timeB + clean));
    ui.endKicker.textContent = completed ? "ROUTE COMPLETE · " + fmtTime(ROUTE_TIME - game.time) : "ХУГАЦАА ДУУСЛАА";
    ui.endTitle.textContent = completed ? "FINISH!" : "TIME UP";
    const rows = [["Checkpoint", game.cpPts], ["Зам (" + Math.round(game.dist) + " м)", dist], ["₮ зоос", coinsP], ["Маршрут", route], ["Цагийн бонус", timeB], ["Цэвэр жолоодлого", clean]];
    ui.breakdown.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>+${v}</dd></div>`).join("") + `<div class="wide"><dt>Мөргөлдөөн / улаан гэрэл</dt><dd>${game.collisions} / ${game.redLights}</dd></div>`;
    ui.endScore.textContent = "0";
    ui.hud.hidden = true;
    document.body.classList.remove("playing");
    ui.end.hidden = false;
    countUp(ui.endScore, total);
    audio.engineUpdate(0, false);
    audio.beep(completed ? [523, 659, 784, 1046] : [392, 330, 262], 0.14);
    game.lastTotal = total;
    saveScore(game.runId, game.name, total);
  }
  function countUp(el, target) {
    const t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 1100); el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function showBoard() { ui.board.hidden = false; loadBoard(); }
  function checkRotate() {
    const portrait = isTouch && window.innerHeight > window.innerWidth;
    ui.rotate.hidden = !(portrait && game.state !== "menu" && game.state !== "over");
    clearTimeout(checkRotate.t);
    if (!ui.rotate.hidden) checkRotate.t = setTimeout(() => (ui.rotate.hidden = true), 5000);
  }

  function bindUi() {
    const savedName = store.get("tegtat-name"); if (savedName) ui.nameInput.value = savedName;
    ui.nameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = normalizeName(ui.nameInput.value);
      const err = validateName(name);
      if (err) { ui.nameError.textContent = err; ui.nameError.hidden = false; ui.nameInput.focus(); return; }
      ui.nameError.hidden = true;
      ui.nameInput.value = name; store.set("tegtat-name", name);
      game.name = name;
      ui.nameInput.blur();
      audio.unlock();
      startRun();
    });
    ui.nameInput.addEventListener("input", () => (ui.nameError.hidden = true));
    $("help-btn").addEventListener("click", () => { const h = $("help"); h.hidden = !h.hidden; $("help-btn").setAttribute("aria-expanded", String(!h.hidden)); });
    document.querySelectorAll('[data-action="board"]').forEach((b) => b.addEventListener("click", showBoard));
    $("board-close").addEventListener("click", () => (ui.board.hidden = true));
    $("board-refresh").addEventListener("click", loadBoard);
    $("resume-btn").addEventListener("click", togglePause);
    $("restart-btn").addEventListener("click", () => { audio.unlock(); startRun(); });
    $("quit-btn").addEventListener("click", toMenu);
    $("again-btn").addEventListener("click", () => { audio.unlock(); startRun(); });
    $("pause-btn").addEventListener("click", togglePause);
    $("cam-btn").addEventListener("click", cycleCam);
    $("sound-btn").addEventListener("click", (e) => { audio.unlock(); audio.setOn(!audio.on); e.currentTarget.textContent = audio.on ? "🔊" : "🔇"; e.currentTarget.setAttribute("aria-pressed", String(audio.on)); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && (game.state === "playing" || game.state === "countdown")) togglePause(); });
    window.addEventListener("orientationchange", () => setTimeout(checkRotate, 300));
  }

  /* ======================================================================
     LOOP
     ====================================================================== */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  let last = performance.now(), acc = 0, clockT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.1) dt = 0.1;
    try { tick(dt); } catch (err) { if (!frame.err) { frame.err = true; console.error("[TEGTAT]", err); } }
  }
  function tickLogicOnly() {
    updateLights(STEP); updateTraffic(STEP);
    if (game.state !== "menu") updatePlayer(STEP);
    if (game.state === "countdown") { game.countdown -= STEP; if (game.countdown <= 0) game.state = "playing"; }
    else if (game.state === "playing") { game.time -= STEP; clockT += STEP; updateObjectives(STEP, clockT); if (game.time <= 0 && game.state === "playing") { game.time = 0; finishRun(false); } }
  }
  function tick(dt) {
    if (game.state !== "paused") {
      clockT += dt;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        updateLights(STEP);
        updateTraffic(STEP);
        if (game.state !== "menu") updatePlayer(STEP);
        if (game.state === "countdown") {
          const before = Math.ceil(game.countdown);
          game.countdown -= STEP;
          const after = Math.ceil(game.countdown);
          if (after !== before) { if (after > 0) { toast(String(after), "good"); audio.beep([440], 0.12); } else { toast("GO!", "good"); audio.beep([880], 0.2); game.state = "playing"; } }
        } else if (game.state === "playing") {
          game.time -= STEP;
          updateObjectives(STEP, clockT);
          if (game.time <= 0 && game.state === "playing") { game.time = 0; finishRun(false); }
        }
        acc -= STEP; steps++;
      }
      if (steps === 5) acc = 0;
    }
    for (const f of flags) { const pos = f.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + 2; pos.setZ(i, Math.sin(clockT * 4 + x * 1.6) * 0.18 * (x / 4)); } pos.needsUpdate = true; }
    if (game.state === "menu") updateMenuCamera(clockT);
    else {
      updateCamera(dt, false);
      const cp = CPS[game.cpIndex];
      if (cp && game.state !== "over") {
        guideArrow.visible = true;
        guideArrow.position.set(player.x, 3.3 + Math.sin(clockT * 4) * 0.1, player.z);
        guideArrow.rotation.y = Math.atan2(-(cp.z - player.z), cp.x - player.x);
      } else guideArrow.visible = false;
      if (game.state === "playing" || game.state === "countdown") updateHud(dt);
      audio.engineUpdate(player.speed, game.state === "playing" || game.state === "countdown");
    }
    if (game.state === "menu") guideArrow.visible = false;
    renderer.render(scene, camera);
  }

  /* ======================================================================
     BOOT
     ====================================================================== */
  function boot() {
    buildWorld();
    buildProps();
    buildBackdrop();
    buildTrafficLights();
    LIT_NODES.forEach(paintLights);
    buildPlayer();
    buildParked();
    spawnTraffic();
    buildCheckpoints();
    buildGuide();
    prepareMinimap();
    resetRun();
    bindUi();
    resize();
    window.addEventListener("resize", resize);
    ui.loading.textContent = "";
    ui.startBtn.disabled = false;
    window.__tegtatReady = true;
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
    if (TEST) window.__tegtat = { game, player, traffic, CPS, coins, NODE, COLL, finishRun, teleport(x, z, h) { player.x = x; player.z = z; player.heading = h || 0; player.speed = 0; }, info: () => renderer.info.render, input, snap() { updateCamera(0, true); }, simulate(sec) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) { acc = STEP; tickLogicOnly(); } } };
  }
  ui.startBtn && (ui.startBtn.disabled = true);
  // Let fonts settle so canvas sign text uses Golos Text when available
  const fontsReady = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  fontsReady.then(boot).catch((err) => { console.error(err); $("fatal").hidden = false; $("fatal").textContent = "Тоглоом ачаалахад алдаа гарлаа: " + err.message; });
})();
