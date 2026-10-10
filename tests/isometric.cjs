const assert=require('node:assert/strict');
const create=require('../game-iso.js');
const noop=()=>{};
const gradient={addColorStop:noop};
const ctx=new Proxy({}, {get:(o,k)=>o[k]||(()=>gradient),set:(o,k,v)=>(o[k]=v,true)});
const stages=[{id:1,key:'steppe',waves:[{list:[['tuvshuu'],['ganaa']]}]},
  {id:2,key:'ger',waves:[{list:[['erhmee'],['teka']]}]},
  {id:3,key:'mountain',boss:{type:'anhaa'}},{id:4,key:'mountain',boss:{type:'tekaBoss'}}];
const p={kind:'player',hp:100,maxHp:100,en:100,maxEn:100,cd:{dash:0,power:0,ult:0},state:'free',stateT:0,animT:0,inv:0,flash:0,face:1,h:92};
const game={mode:'play',player:p,stage:{def:stages[0]},stageIdx:0,enemies:[],items:[],timers:[],t:0,runTime:0,combo:0,hitstop:0,fade:0,darken:0,shake:0,lightning:0,flashWhite:0,hurtFlash:0,score:0};
const pressed=new Set();const input={k:{},t:{},left:false,right:false,consume:key=>pressed.delete(key)};
let clears=0,hits=0,harms=0;
const B={ctx,game,input,settings:{detail:false},STAGES:stages,ENEMY_DEFS:{},AudioFx:{play:noop,music:noop},Voice:{say:()=>false},ui:{goArrow:{}},
 makeEnemy:type=>({type,def:{boss:['anhaa','tekaBoss'].includes(type),mounted:type==='tekaBoss',miniBoss:type==='anhaa',speed:100,dmg:10,ranged:type==='teka',name:type},state:'chase',stateT:0,animT:0,hp:100,maxHp:100,inv:0,flash:0,face:1,alpha:1}),
 damageEnemy:(e,n,opt={})=>{if(e.state==='intro'||e.inv>0)return false;e.hp-=n;p.en=Math.min(p.maxEn,p.en+(opt.energyGain||0));hits++;if(e.hp<=0){e.state='dead';e.stateT=0;}return true;},
 hurtPlayer:()=>{harms++;return false;}, trySkill:(p,s)=>{if(p.cd[s]>0||p.en<10)return false;p.state=s;p.stateT=0;p.en-=10;return true;},
 startAttack:(p,step)=>{p.state='attack';p.stateT=0;p.atkStep=step;},stageClear:()=>{clears++;game.stage.cleared=true;},
 drawFigure:noop,drawWarhorse:noop,drawSkillAura:noop,drawSlash:noop,drawGuard:noop,drawBubble:noop,drawParticles:noop,drawTexts:noop,updateParticles:noop,showBanner:noop,ring:noop,sparks:noop,floatText:noop};
const iso=create(B);const advance=seconds=>{for(let t=0;t<seconds;t+=1/60)iso.tick(1/60);};
assert.deepEqual(iso.project(100,100),{x:0,y:70});
iso.tick(1/60);const origin={wx:p.wx,wy:p.wy};
assert.deepEqual(iso.bounds,{width:1600,height:1250});
input.right=true;advance(.4);input.right=false;
assert.ok(p.wx>origin.wx&&p.wy<origin.wy,'screen-right movement uses both world axes');
const y=p.wy;input.k.up=true;advance(.3);input.k.up=false;
assert.ok(p.wy<y,'up moves on ground plane');
advance(1);assert.equal(game.enemies.length,2);
game.enemies.forEach(e=>{e.state='dead';e.stateT=0;});advance(3);assert.equal(clears,1);
for(let i=1;i<4;i++){
 game.stage={def:stages[i]};game.stageIdx=i;game.enemies=[];game.boss=null;game.inputLock=false;p.state='free';p.stateT=0;
 advance(1.2);if(i===1)assert.deepEqual(game.enemies.map(e=>e.type),['erhmee','teka']);
 else {assert.equal(game.boss.type,i===2?'anhaa':'tekaBoss');advance(3.5);assert.equal(game.inputLock,false);}
 iso.render(1);
 if(i===3)assert.deepEqual(iso.bounds,{width:2000,height:1550},'final boss has the largest map');
}
game.enemies=[];game.inputLock=false;p.state='free';p.stateT=0;p.wx=450;p.wy=430;
const e=B.makeEnemy('erhmee');Object.assign(e,{wx:500,wy:430,hp:500});game.enemies.push(e);
pressed.add('power');advance(.4);assert.equal(e.armorBreak>0,true);
advance(1);pressed.add('ult');advance(.7);assert.ok(hits>=2,'both power and ultimate deal radial damage');
advance(1);const before={wx:p.wx,wy:p.wy};pressed.add('dash');advance(.2);
assert.ok(Math.hypot(p.wx-before.wx,p.wy-before.wy)>50,'dash moves in world space');
iso.render(1);
// Input buffering preserves the second swing, but idle time resets the chain.
game.enemies=[];p.state='free';p.stateT=0;p.comboUntil=0;
pressed.add('attack');advance(.15);pressed.add('attack');advance(.18);
assert.equal(p.atkStep,1,'a buffered press chains into swing two');
advance(1.1);pressed.add('attack');advance(.02);assert.equal(p.atkStep,0,'idle resets combo');
advance(.12);pressed.add('dash');advance(.02);assert.equal(p.state,'dash','dash cancels a swing');
advance(.5);p.state='free';p.cd.dash=2;pressed.add('attack');advance(.13);
pressed.add('dash');advance(.02);assert.equal(p.state,'attack','unavailable dodge does not cancel');p.cd.dash=0;
// Recovery is a punish window and landed weapon strikes restore energy.
game.enemies=[];p.state='free';p.stateT=0;p.en=40;
const vulnerable=B.makeEnemy('erhmee');Object.assign(vulnerable,{wx:p.wx+50,wy:p.wy,state:'recover',stateT:0,hp:500});game.enemies.push(vulnerable);
p.comboUntil=0;pressed.add('attack');advance(.15);
assert.ok(Math.abs(vulnerable.hp-(500-12*1.2))<.001,'recovery takes 20% extra damage');
assert.ok(p.en>42,'successful strike returns energy');
// Locked melee direction permits sidestepping behind the enemy.
game.enemies=[];p.state='free';p.stateT=0;p.z=0;p.zv=0;
const attacker=B.makeEnemy('erhmee');Object.assign(attacker,{wx:p.wx+60,wy:p.wy,state:'windup',stateT:.99,attackDir:{x:1,y:0},attackKind:'slash'});game.enemies.push(attacker);
let oldHarms=harms;advance(.05);assert.equal(harms,oldHarms,'locked slash misses player behind attacker');
// A threatening strike in the first dodge frames rewards once per dodge.
p.state='dash';p.stateT=0;p.dir={x:0,y:1};p.dodgeReward=false;p.en=40;
attacker.state='strike';attacker.stateT=0;attacker.struck=false;attacker.attackDir={x:-1,y:0};
advance(.02);assert.ok(p.counterT>1,'perfect dodge opens counter window');assert.ok(p.en>=48);
attacker.struck=false;const rewardEn=p.en;advance(.02);assert.ok(p.en<rewardEn+1,'same dodge cannot farm multiple rewards');
// Crowd attacks are limited to two committed windups at once.
game.enemies=[];p.state='free';p.stateT=0;
for(let i=0;i<4;i++){const mob=B.makeEnemy('erhmee');Object.assign(mob,{wx:p.wx+60,wy:p.wy+i*2,think:0});game.enemies.push(mob);}
advance(.02);assert.equal(game.enemies.filter(e=>e.state==='windup').length,2);
iso.render(1);
console.log('PASS: projection, eight-way movement, four-stage spawns, boss intro, skill areas, dash and renderer execution.');
console.log('PASS: combo buffer/reset, dodge cancel/cooldown, recovery punish, energy return, locked attacks, perfect dodge and crowd fairness.');
// Spatial combat: only the ground cone hits, and the finisher reaches farther.
game.enemies=[];p.state='free';p.stateT=0;p.wx=450;p.wy=430;p.dir={x:1,y:0};p.z=0;
const front=B.makeEnemy('erhmee'),back=B.makeEnemy('erhmee');
Object.assign(front,{wx:575,wy:430,hp:500,state:'recover',stateT:0});
Object.assign(back,{wx:400,wy:430,hp:500,state:'recover',stateT:0});game.enemies.push(front,back);
// Begin directly to keep the intended direction fixed rather than auto-aim.
p.comboUntil=game.t+2;p.comboStep=2;p.attackBuffer=0;
B.startAttack(p,2);p.isoHits=new Set();advance(.2);
assert.ok(front.hp<500,'finisher reaches 125 world units');assert.equal(back.hp,500,'enemy behind cone is safe');
assert.ok(front.wx>575,'heavy hit pushes enemy in world space');
// Ranged enemies retreat instead of walking into the player.
game.enemies=[];p.state='free';p.stateT=0;
const archer=B.makeEnemy('teka');Object.assign(archer,{wx:p.wx+100,wy:p.wy,think:0});game.enemies.push(archer);
const near=iso.distance(archer,p);advance(.2);assert.ok(iso.distance(archer,p)>near,'ranged enemy maintains distance');
// Lane assignment changes nearby melee approach vectors.
game.enemies=[];
const flanker=B.makeEnemy('erhmee');Object.assign(flanker,{wx:p.wx+180,wy:p.wy,lane:1,think:1});game.enemies.push(flanker);
const flankY=flanker.wy;advance(.2);assert.ok(flanker.wy>flankY,'melee flanks toward assigned side');
iso.render(1);
console.log('PASS: directional ground cone, finisher reach, world knockback, ranged retreat and melee flanking.');
// A house between a ranged shot and the player blocks the projectile.
game.stage={def:{key:'ger'}};game.enemies=[];iso.tick(1/60);
p.wx=300;p.wy=150;p.state='free';p.stateT=0;
const coveredShot=B.makeEnemy('teka');Object.assign(coveredShot,{wx:90,wy:150,state:'windup',stateT:.69,attackDir:{x:1,y:0},attackKind:'slash'});game.enemies.push(coveredShot);
oldHarms=harms;advance(.7);assert.equal(harms,oldHarms,'house stops shot before it reaches the player');
console.log('PASS: arena prop projectile cover.');
// Expanded-map supplies persist for exploration and collect only once.
game.items=[];game.enemies=[];game.stage={def:{id:1,key:'steppe'}};iso.tick(1/60);
const supply=game.items.find(i=>i.type==='hp');assert.ok(supply);
advance(120);assert.ok(game.items.includes(supply),'exploration supplies persist until collected');
p.hp=50;p.wx=supply.wx;p.wy=supply.wy;iso.tick(1/60);assert.equal(p.hp,70);assert.ok(!game.items.includes(supply));
p.wx=iso.bounds.width-46;p.wy=500;p.dir={x:1,y:0};p.state='dash';p.stateT=0;
advance(.2);assert.ok(p.wx<=iso.bounds.width-45,'expanded arena boundary still clamps dash');
iso.render(1);
console.log('PASS: expanded stage bounds, persistent exploration supplies, single pickup and boundary collision.');
// Distinct enemy roles retain readable attack timing and counterplay.
game.enemies=[];p.wx=600;p.wy=500;p.z=0;p.zv=0;p.state='free';p.stateT=0;
const quick=B.makeEnemy('tuvshuu');Object.assign(quick,{wx:650,wy:500,think:0});game.enemies.push(quick);
advance(.02);advance(.35);assert.equal(quick.state,'windup');advance(.12);assert.equal(quick.state,'strike','quick fighter commits after .44s');
game.enemies=[];
const club=B.makeEnemy('ganaa');Object.assign(club,{wx:700,wy:500,think:0});game.enemies.push(club);
advance(.02);const clubX=club.wx;advance(.12);assert.ok(club.wx<clubX,'club fighter steps forward during telegraph');assert.equal(club.state,'windup');
game.enemies=[];
const wrestler=B.makeEnemy('erhmee');Object.assign(wrestler,{wx:670,wy:500,think:0});game.enemies.push(wrestler);
advance(.02);advance(.8);assert.equal(wrestler.state,'windup','wrestler gives a full second of warning');
oldHarms=harms;advance(.25);assert.ok(harms>oldHarms,'wrestler slam hits inside ground area');
wrestler.state='strike';wrestler.stateT=0;wrestler.struck=false;p.z=80;p.zv=0;
oldHarms=harms;advance(.02);assert.equal(harms,oldHarms,'jump clears wrestler ground slam');
game.enemies=[];p.z=0;p.zv=0;p.state='free';
const skirmisher=B.makeEnemy('teka');Object.assign(skirmisher,{wx:840,wy:500,think:2,lane:1});game.enemies.push(skirmisher);
const archerY=skirmisher.wy;advance(.2);assert.ok(Math.abs(skirmisher.wy-archerY)>3,'archer sidesteps while waiting for next shot');
iso.render(1);
console.log('PASS: fast fighter timing, club advance, readable wrestler slam/jump counter and archer sidestep.');
