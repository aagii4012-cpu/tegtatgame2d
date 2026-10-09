// Browser-independent regression checks for the actual combat functions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const noop = () => {};
const p = { x: 140, y: 452, h: 92, hp: 40, maxHp: 100, en: 20, maxEn: 100, face: 1, atkId: 0, inv: 0 };
const timers = [];
const ctx = vm.createContext({
  Math: Object.assign(Object.create(Math), { random: () => .5 }),
  game: { player: p, hazards: [], projectiles: [], t: 0, runTime: 0, parries: 0, hitstop: 0, flashWhite: 0 },
  STYLES: { player: { weapon: 'saber', coat: '#2C5DA8' } },
  AudioFx: { play: noop, music: noop }, Voice: { say: noop },
  ring: noop, floatText: noop, shake: noop, sparks: noop, dust: noop, vibrate: noop,
  showBanner: noop, addCombo: noop, addScore: noop, killEnemy: noop, checkBossPhase: noop,
  ENERGY_PER_HIT: 3, rand: () => 1, sign: Math.sign,
  input: { right: false, left: false },
  ui: { bossBar: { classList: { remove: noop, add: noop }, offsetWidth: 0 } },
  later: (t, fn) => timers.push({ t, fn }),
  stageClear: () => { ctx.stageCleared = true; },
  setState: (e, state) => { e.state = state; }, setAnim: noop
});
for (const name of ['bossDefeated', 'damageEnemy', 'doParry', 'startAttack']) {
  const begin = code.indexOf(`  function ${name}(`);
  assert.ok(begin >= 0, name);
  const end = code.indexOf('\n  function ', begin + 1);
  vm.runInContext(code.slice(begin, end), ctx);
}
ctx.bossDefeated({ def: { miniBoss: true } });
assert.equal(timers.length, 1, 'mini-boss must not schedule victory');
timers[0].fn();
assert.equal(ctx.stageCleared, true, 'Anhaa advances to a separate final stage');
assert.equal(p.weaponUpgrade, true);
assert.equal(p.style.weapon, 'glaive');
assert.equal(ctx.STYLES.player.weapon, 'saber', 'upgrade must not mutate next-run defaults');
assert.equal(p.hp, 70); assert.equal(p.en, 45);
function enemy() { return { x: 220, y: 452, w: 40, h: 100, hp: 500, def: { armor: true }, inv: 0, flash: 0, state: 'chase' }; }
const e = enemy();
ctx.damageEnemy(e, 100, { heavy: true });
assert.equal(e.hp, 380, 'weapon adds 20% damage');
const broken = enemy(); broken.armorBreak = 4;
ctx.damageEnemy(broken, 100, { heavy: true });
assert.equal(broken.hp, 362, 'armor break adds 15% damage');
ctx.doParry(p, 200, {});
assert.equal(p.counterT, 1.4);
ctx.startAttack(p, 0);
assert.equal(p.counterAttack, true); assert.equal(p.counterT, 0);
ctx.startAttack(p, 1);
assert.equal(p.counterAttack, false, 'counter bonus is consumed once');
ctx.GROUND_Y = 452;
const stageStart = code.indexOf('  const STAGES = [');
const stageEnd = code.indexOf('\n  ];', stageStart) + 6;
vm.runInContext(code.slice(stageStart, stageEnd) + '\nthis.stages = STAGES;', ctx);
assert.equal(ctx.stages.length, 4);
assert.deepEqual([...new Set(ctx.stages[0].waves.flatMap(w => w.list.map(e => e[0])))].sort(), ['ganaa', 'tuvshuu']);
assert.deepEqual([...new Set(ctx.stages[1].waves.flatMap(w => w.list.map(e => e[0])))].sort(), ['erhmee', 'teka']);
assert.equal(ctx.stages[2].boss.type, 'anhaa');
assert.equal(ctx.stages[3].boss.type, 'tekaBoss');
console.log('PASS: four-stage roster, Anhaa reward, damage bonuses, parry counter and fresh-run style.');
