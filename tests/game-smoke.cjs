// Browser integration suite for isometric gameplay. Requires Playwright/Chromium.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
 let browser;try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('[TEGTAT]'))errors.push(m.text());});
  await page.clock.install();await page.goto(`http://127.0.0.1:${server.address().port}/game.html?test`);
  const advance=ms=>page.clock.runFor(ms);
  for(let stage=0;stage<4;stage++){
   await page.evaluate(i=>{__tegtat2d.start('ISO QA',i);__tegtat2d.god();},stage);await advance(4500);
   const start=await page.evaluate(()=>({x:__tegtat2d.game.player.wx,y:__tegtat2d.game.player.wy}));
   await page.keyboard.down('KeyD');await advance(500);await page.keyboard.up('KeyD');
   assert.ok(await page.evaluate(s=>__tegtat2d.game.player.wx>s.x&&__tegtat2d.game.player.wy<s.y,start));
   await page.keyboard.press('Space');await advance(100);assert.ok(await page.evaluate(()=>__tegtat2d.game.player.z>0));await advance(900);
   assert.equal(await page.evaluate(()=>__tegtat2d.game.player.z),0);
   for(const key of ['KeyQ','KeyE','KeyR']){
    await page.evaluate(()=>{__tegtat2d.setEn(100);__tegtat2d.game.player.cd={dash:0,power:0,ult:0};});
    await page.keyboard.press(key);await advance(200);assert.ok(await page.evaluate(()=>__tegtat2d.game.player.en<99));await advance(1500);
   }
   await page.click('#pause-btn');const t=await page.evaluate(()=>__tegtat2d.game.t);await advance(500);assert.equal(await page.evaluate(()=>__tegtat2d.game.t),t);await page.click('#resume-btn');
   if(stage===2){await page.evaluate(()=>__tegtat2d.defeatBoss());await advance(6000);
    assert.equal(await page.evaluate(()=>__tegtat2d.game.stageIdx),3);assert.equal(await page.evaluate(()=>__tegtat2d.game.player.weaponUpgrade),true);
   }
   if(process.env.TEGTAT_SCREENSHOTS){fs.mkdirSync(process.env.TEGTAT_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.TEGTAT_SCREENSHOTS,`stage-${stage+1}.png`)});}
  }
  const mobile=await browser.newPage({viewport:{width:844,height:390},isMobile:true,hasTouch:true});mobile.on('pageerror',e=>errors.push(e.message));await mobile.clock.install();
  await mobile.goto(`http://127.0.0.1:${server.address().port}/game.html?test`);await mobile.evaluate(()=>{__tegtat2d.start('Touch');__tegtat2d.god();});await mobile.clock.runFor(2000);
  const pad=await mobile.locator('#t-move').boundingBox();const y=await mobile.evaluate(()=>__tegtat2d.game.player.wy);
  await mobile.dispatchEvent('#t-move','pointerdown',{pointerId:1,pointerType:'touch',clientX:pad.x+pad.width/2,clientY:pad.y+pad.height*.1});await mobile.clock.runFor(300);
  assert.ok(await mobile.evaluate(y=>__tegtat2d.game.player.wy<y,y));
  await mobile.dispatchEvent('#t-move','pointercancel',{pointerId:1,pointerType:'touch'});await mobile.clock.runFor(200);
  const x=await mobile.evaluate(()=>__tegtat2d.game.player.wx);await mobile.clock.runFor(200);assert.equal(await mobile.evaluate(()=>__tegtat2d.game.player.wx),x);
  await mobile.setViewportSize({width:390,height:844});await mobile.click('#settings-btn-hud');await mobile.locator('#set-touchSize').fill('120');await mobile.check('#set-leftHanded');
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);console.log('PASS: four isometric stages, skills, movement, jump, pause, reward and touch controls.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
