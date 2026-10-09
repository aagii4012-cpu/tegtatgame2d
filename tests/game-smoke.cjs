/* Run: node tests/game-smoke.cjs
   Requires Playwright. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH for a system browser.
   Set TEGTAT_SCREENSHOTS to an output directory to capture the three stages. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
(async () => {
  let browser;
  const errors = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/game.html?test`;
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    async function pageFor(options) {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      page.on('pageerror', err => errors.push(err.message));
      page.on('console', msg => { if (msg.type() === 'error' && msg.text().includes('[TEGTAT]')) errors.push(msg.text()); });
      await page.route('https://**', route => route.abort());
      await page.clock.install();
      await page.goto(url);
      return page;
    }
    const page = await pageFor({ viewport: { width: 1440, height: 900 } });
    const advance = ms => page.clock.runFor(ms);
    async function start(stage) {
      await page.evaluate(stage => { __tegtat2d.start('QA-player', stage); __tegtat2d.god(); }, stage);
      await advance(3200);
      assert.equal(await page.evaluate(() => __tegtat2d.state().mode), 'play');
    }
    await start(0);
    const x = await page.evaluate(() => __tegtat2d.game.player.x);
    await page.keyboard.down('KeyD'); await advance(800); await page.keyboard.up('KeyD');
    assert.ok(await page.evaluate(x => __tegtat2d.game.player.x > x + 100, x), 'running moves player');
    assert.ok(await page.evaluate(() => __tegtat2d.game.decals.some(d => d.type === 'footprint')), 'movement leaves footprints');
    await page.keyboard.down('Space'); await advance(220);
    assert.ok(await page.evaluate(() => __tegtat2d.game.player.y < 400), 'jump leaves ground');
    await page.keyboard.up('Space'); await advance(800);
    assert.equal(await page.evaluate(() => __tegtat2d.game.player.onGround), true, 'jump lands');
    // Skills still consume energy and finish; renderer handles all skill poses.
    for (const [key, skill] of [['KeyQ', 'dash'], ['KeyE', 'power'], ['KeyR', 'ult']]) {
      await page.evaluate(() => { __tegtat2d.setEn(100); __tegtat2d.game.player.cd = {dash:0,power:0,ult:0}; });
      await page.keyboard.press(key); await advance(100);
      assert.ok(await page.evaluate(() => __tegtat2d.game.player.en < 99), `${skill} consumes energy`);
      await advance(1600);
    }
    await page.keyboard.press('KeyJ'); await advance(100);
    assert.equal(await page.evaluate(() => __tegtat2d.game.player.state), 'attack');
    await advance(700);
    await page.click('#pause-btn');
    const paused = await page.evaluate(() => __tegtat2d.game.t);
    await advance(700);
    assert.equal(await page.evaluate(() => __tegtat2d.game.t), paused, 'pause freezes simulation');
    await page.click('#resume-btn');
    for (const stage of [0, 1, 2]) {
      await start(stage);
      if (stage === 2) {
        await page.evaluate(() => __tegtat2d.teleport(820)); await advance(4000);
        assert.ok(await page.evaluate(() => !!__tegtat2d.game.boss), 'boss spawns');
        for (const ratio of [.6, .25]) { await page.evaluate(r => __tegtat2d.bossHp(r), ratio); await advance(1800); }
        assert.equal(await page.evaluate(() => __tegtat2d.game.boss.phase), 3);
        await page.evaluate(() => { __tegtat2d.setEn(100);__tegtat2d.press('ult'); });
        await advance(1600);
      } else if (stage === 1) {
        for (let wave=0;wave<4;wave++) {
          await page.evaluate(wave => { const g=__tegtat2d.game; const at=g.stage.def.waves[wave].at;g.camX=at;g.player.x=at+410; }, wave);
          await advance(2500);
          assert.ok(await page.evaluate(() => __tegtat2d.game.enemies.length>0), 'wave enemies spawn');
          if(wave<3) { await page.evaluate(() => __tegtat2d.killAll());await advance(1200); }
        }
      } else {
        await page.keyboard.down('KeyD'); await advance(2400); await page.keyboard.up('KeyD');
      }
      if (process.env.TEGTAT_SCREENSHOTS) {
        fs.mkdirSync(process.env.TEGTAT_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.TEGTAT_SCREENSHOTS, `stage-${stage+1}.png`) });
      }
    }
    // Falling onto a platform must retain its exact collision height.
    await start(0);
    await page.evaluate(() => { const g=__tegtat2d.game; g.camX=850;g.camMin=850;g.stage.waveIdx=3;g.player.x=1320;g.player.y=250;g.player.vy=250;g.player.vx=0;g.player.onGround=false; });
    await advance(550);
    assert.equal(await page.evaluate(() => __tegtat2d.game.player.y), 394);
    assert.equal(await page.evaluate(() => __tegtat2d.game.player.onPlatform), true);
    await page.click('#settings-btn-hud');
    await page.uncheck('#set-detail');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('tegtat2d.settings.v1')).detail), false);
    await page.reload(); await advance(500);
    await page.click('[data-open="settings"]');
    assert.equal(await page.isChecked('#set-detail'), false, 'detail preference survives reload');
    await page.close();
    // Real touch event handlers, including pointer cancellation (no stuck movement).
    const mobile = await pageFor({ viewport: {width:844,height:390}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
    await mobile.evaluate(() => { __tegtat2d.start('Touch-QA');__tegtat2d.god(); });
    await mobile.clock.runFor(3200);
    const pad = await mobile.locator('#t-move').boundingBox();
    assert.ok(pad, 'touch movement pad is visible');
    const mx = await mobile.evaluate(() => __tegtat2d.game.player.x);
    await mobile.dispatchEvent('#t-move','pointerdown',{pointerId:1,pointerType:'touch',clientX:pad.x+pad.width*.9,clientY:pad.y+pad.height/2});
    await mobile.clock.runFor(650);
    assert.ok(await mobile.evaluate(x => __tegtat2d.game.player.x > x + 50,mx));
    await mobile.dispatchEvent('#t-move','pointercancel',{pointerId:1,pointerType:'touch'});
    await mobile.clock.runFor(400);
    assert.equal(await mobile.evaluate(() => __tegtat2d.game.player.vx),0);
    await mobile.setViewportSize({width:390,height:844}); await mobile.clock.runFor(500);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), 'portrait fits viewport');
    const reduced = await pageFor({viewport:{width:960,height:600},reducedMotion:'reduce'});
    await reduced.click('[data-open="settings"]');
    assert.equal(await reduced.isChecked('#set-detail'),false, 'reduced motion defaults to fewer ambient effects');
    assert.deepEqual(errors, [], 'no game runtime/render errors');
    console.log('PASS: movement, jump/landing, platforms, attacks, skills, pause, all stages, boss phases, settings persistence, touch/cancel, portrait, reduced motion.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode=1; });
