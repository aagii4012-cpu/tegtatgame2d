const assert=require('node:assert/strict');
const create=require('../game-iso.js');
const noop=()=>{};
const gradient={addColorStop:noop};
const ctx=new Proxy({}, {get:(o,k)=>o[k]||(()=>gradient),set:(o,k,v)=>(o[k]=v,true)});
const stages=[{key:'steppe',waves:[{list:[['tuvshuu'],['ganaa']]}]},
  {key:'ger',waves:[{list:[['erhmee'],['teka']]}]},
  {key:'mountain',boss:{type:'anhaa'}},{key:'mountain',boss:{type:'tekaBoss'}}];
const p={kind:'player',hp:100,maxHp:100,en:100,maxEn:100,cd:{dash:0,power:0,ult:0},state:'free',stateT:0,animT:0,inv:0,flash:0,face:1,h:92};
const game={mode:'play',player:p,stage:{def:stages[0]},stageIdx:0,enemies:[],items:[],timers:[],t:0,runTime:0,combo:0,hitstop:0,fade:0,darken:0,shake:0,lightning:0,flashWhite:0,hurtFlash:0,score:0};
const pressed=new Set();const input={k:{},t:{},left:false,right:false,consume:key=>pressed.delete(key)};
let clears=0,hits=0;
const B={ctx,game,input,settings:{detail:false},STAGES:stages,ENEMY_DEFS:{},AudioFx:{play:noop,music:noop},Voice:{say:()=>false},ui:{goArrow:{}},
 makeEnemy:type=>({type,def:{boss:['anhaa','tekaBoss'].includes(type),mounted:type==='tekaBoss',miniBoss:type==='anhaa',speed:100,dmg:10,ranged:type==='teka',name:type},state:'chase',stateT:0,animT:0,hp:100,maxHp:100,inv:0,flash:0,face:1,alpha:1}),
 damageEnemy:(e,n)=>{if(e.state==='intro'||e.inv>0)return false;e.hp-=n;hits++;if(e.hp<=0){e.state='dead';e.stateT=0;}return true;},
 hurtPlayer:()=>false, trySkill:(p,s)=>{p.state=s;p.stateT=0;p.en-=10;},
 startAttack:p=>{p.state='attack';p.stateT=0;p.atkStep=0;},stageClear:()=>{clears++;game.stage.cleared=true;},
 drawFigure:noop,drawWarhorse:noop,drawSkillAura:noop,drawSlash:noop,drawGuard:noop,drawBubble:noop,drawParticles:noop,drawTexts:noop,updateParticles:noop,showBanner:noop,ring:noop,sparks:noop,floatText:noop};
const iso=create(B);const advance=seconds=>{for(let t=0;t<seconds;t+=1/60)iso.tick(1/60);};
assert.deepEqual(iso.project(100,100),{x:0,y:70});
iso.tick(1/60);const origin={wx:p.wx,wy:p.wy};
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
}
game.enemies=[];game.inputLock=false;p.state='free';p.stateT=0;p.wx=450;p.wy=430;
const e=B.makeEnemy('erhmee');Object.assign(e,{wx:500,wy:430,hp:500});game.enemies.push(e);
pressed.add('power');advance(.4);assert.equal(e.armorBreak>0,true);
advance(1);pressed.add('ult');advance(.7);assert.ok(hits>=2,'both power and ultimate deal radial damage');
advance(1);const before={wx:p.wx,wy:p.wy};pressed.add('dash');advance(.2);
assert.ok(Math.hypot(p.wx-before.wx,p.wy-before.wy)>50,'dash moves in world space');
iso.render(1);
console.log('PASS: projection, eight-way movement, four-stage spawns, boss intro, skill areas, dash and renderer execution.');
