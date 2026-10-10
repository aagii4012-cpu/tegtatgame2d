// Execute the complete shipped JS bundle with a deterministic DOM/canvas host.
// This verifies integration and finite drawing geometry; real-browser QA is separate.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let now=0,raf=[],serial=0;const timers=new Map(),errors=[];
const gradient={addColorStop(){}};
const drawing=new Proxy({}, {
 get(o,k){
  if(k in o)return o[k];
  if(k==='measureText')return text=>({width:String(text).length*7});
  return (...args)=>{for(const arg of args)if(typeof arg==='number')assert.ok(Number.isFinite(arg),'finite canvas '+k);
   return k.startsWith('create')?gradient:undefined;};
 },
 set(o,k,v){if(typeof v==='number')assert.ok(Number.isFinite(v),'finite canvas property '+k);o[k]=v;return true;}
});
class Node {
 constructor(id=''){this.id=id;this.hidden=true;this.value='';this.dataset={};this.style={setProperty(){}};this.events={};this.tagName='DIV';this.className='';this.textContent='';this.offsetWidth=960;this.classes=new Set();
  this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:v=>this.classes.has(v),toggle:(v,on)=>{if(on??!this.classes.has(v))this.classes.add(v);else this.classes.delete(v);}};}
 addEventListener(k,f){(this.events[k]??=[]).push(f);}
 removeEventListener(k,f){this.events[k]=(this.events[k]||[]).filter(x=>x!==f);}
 emit(k,extra={}){const e={target:this,preventDefault(){},stopPropagation(){},...extra};for(const f of this.events[k]||[])f(e);}
 getContext(){return drawing;}
 getBoundingClientRect(){return this.id==='t-move'?{left:0,top:0,width:100,height:100}:{left:0,top:0,width:960,height:540};}
 setAttribute(k,v){this[k]=v;}removeAttribute(k){delete this[k];}
 focus(){}blur(){}setPointerCapture(){}closest(){return null;}
 querySelectorAll(s){return s==='.skill'?skills:[];}
 querySelector(){return new Node();}
 requestSubmit(){this.emit('submit');}
}
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);};
const skills=['dash','power','ult'].map(s=>{const n=new Node(s);n.dataset.skill=s;return n;});
const doc=new Node('document');Object.assign(doc,{getElementById:node,querySelector:node,querySelectorAll:s=>s==='[data-skill]'?skills:[],createElement:()=>new Node(),body:new Node('body'),documentElement:new Node('html'),activeElement:null,hidden:false});
const win=new Node('window');Object.assign(win,{matchMedia:()=>({matches:false}),devicePixelRatio:1});
let seed=17;const seeded=Object.create(Math);seeded.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const context=vm.createContext({window:win,document:doc,navigator:{maxTouchPoints:0},location:{search:'?test',protocol:'file:'},matchMedia:win.matchMedia,Math:seeded,
 localStorage:{getItem:()=>null,setItem(){}},performance:{now:()=>now},
 requestAnimationFrame:f=>raf.push(f),setTimeout:(f,t)=>{timers.set(++serial,{f,t:now+t});return serial;},clearTimeout:id=>timers.delete(id),
 fetch:async()=>({ok:false,json:async()=>({})}),console:{log(){},warn(){},error:(...a)=>errors.push(a.map(x=>x&&x.stack||String(x)).join(' '))},
});
for(const f of ['game-world.js','game-iso.js','game.js']){
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),context,{filename:f});
 if(f==='game-world.js')context.TegtatWorld=win.TegtatWorld;
}
const api=win.__tegtat2d;assert.ok(api);
function advance(seconds){for(let i=0;i<Math.ceil(seconds*60);i++){
 now+=1000/60+.001;for(const [id,t] of timers)if(t.t<=now){timers.delete(id);t.f();}
 const callbacks=raf;raf=[];callbacks.forEach(f=>f(now));
}}
function key(code,on){win.emit(on?'keydown':'keyup',{code,repeat:false,target:node('frame')});}
function start(stage=0){api.start('RUNTIME QA',stage);api.god();advance(4.5);}
advance(.1);
start();assert.equal(api.state().stage,1);assert.ok(api.game.enemies.length);
assert.equal(node('go-arrow').hidden,true,'no side-scroller GO instruction');
const x=api.game.player.wx;key('KeyD',true);advance(.4);key('KeyD',false);assert.ok(api.game.player.wx>x);
key('Space',true);advance(.1);key('Space',false);assert.ok(api.game.player.z>0);advance(.9);assert.equal(api.game.player.z,0);
key('KeyJ',true);advance(1.2);key('KeyJ',false);assert.ok(api.game.player.atkId>=3,'holding attack chains swings');
for(const skill of ['dash','power','ult']){api.setEn(100);api.game.player.cd[skill]=0;api.press(skill);advance(.2);assert.ok(api.game.player.en<100);advance(1.5);}
node('pause-btn').emit('click');const t=api.game.t;advance(.5);assert.equal(api.game.t,t);node('resume-btn').emit('click');advance(.2);assert.ok(api.game.t>t);
// Use actual combat callbacks to verify that weapon energy is awarded once.
const target=api.game.enemies[0];assert.ok(target);
const fighter=api.game.player;
Object.assign(target,{wx:fighter.wx+60,wy:fighter.wy,hp:500,maxHp:500,state:'recover',stateT:0,inv:0});api.game.enemies=[target];
fighter.state='free';fighter.stateT=0;fighter.dir={x:1,y:0};fighter.comboUntil=0;api.setEn(20);
api.press('attack');advance(.2);assert.ok(fighter.en>=22&&fighter.en<23,'weapon hit grants exactly 2 energy plus passive regen');
fighter.state='free';fighter.stateT=0;fighter.cd.power=0;api.setEn(100);
api.press('power');advance(.4);assert.ok(fighter.en>=70&&fighter.en<71,'power does not refund energy for every target');
start();
// Clear the first two complete stages through the real kill/score/timer paths.
for(let i=0;i<20&&api.game.stageIdx<2;i++){api.killAll();advance(3.5);}
assert.equal(api.game.stageIdx,2);advance(3);assert.equal(api.game.boss.type,'anhaa');
api.defeatBoss();advance(6);assert.equal(api.game.stageIdx,3);assert.equal(api.game.player.weaponUpgrade,true);
advance(4);assert.equal(api.game.boss.type,'tekaBoss');
for(const ratio of [.6,.3]){api.bossHp(ratio);advance(2);assert.equal(api.game.boss.phase,ratio===.6?2:3);}
advance(6);api.defeatBoss();advance(4);assert.equal(api.game.mode,'victory');assert.ok(api.game.score>0);
start();assert.equal(api.game.player.weaponUpgrade,undefined,'new run clears weapon reward');assert.equal(api.game.player.style.weapon,'saber');
api.god(false);api.setHp(1);api.hurt(5);const deathTime=api.game.runTime;advance(2.5);assert.equal(api.game.mode,'gameover');assert.equal(api.game.runTime,deathTime,'death cinematic excluded from time');
start(1);const p=api.game.player,y=p.wy;node('t-move').emit('pointerdown',{pointerId:7,clientX:50,clientY:0});advance(.3);assert.ok(p.wy<y);
node('t-move').emit('pointercancel',{pointerId:7});const stopped=p.wx;advance(.3);assert.equal(p.wx,stopped,'touch cancel clears movement');
assert.deepEqual(errors,[],'no runtime/render exceptions');
console.log('PASS: full JS bundle, finite rendering, held combo, skills, pause, all stages, boss phases, reward, victory, restart, death and touch cancellation.');
