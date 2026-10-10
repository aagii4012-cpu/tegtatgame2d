const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const noop=()=>{},cards=[],touch=[],listeners={},windowEvents={};let nextFrame;
let geometry=0;
const ctx=new Proxy({}, {set:(o,k,v)=>(o[k]=v,true),get:(o,k)=>o[k]||(['createLinearGradient','createRadialGradient'].includes(k)?()=>({addColorStop:noop}):(...args)=>{if(['arc','ellipse','fillRect','strokeRect','moveTo','lineTo','translate','scale','rotate'].includes(k)){for(const a of args)if(typeof a==='number')assert.ok(Number.isFinite(a),'finite '+k);geometry++;}})});
class Element{
 constructor(id='',tag='DIV'){this.id=id;this.tagName=tag;this.hidden=false;this.disabled=false;this.textContent='';this.value='';this.style={};this.dataset={};this.events={};this.classes=new Set();this.classList={add:(...s)=>s.forEach(x=>this.classes.add(x)),remove:(...s)=>s.forEach(x=>this.classes.delete(x)),toggle:(s,on)=>on?this.classes.add(s):this.classes.delete(s)};}
 getContext(){return ctx;}setAttribute(){}setPointerCapture(){}
 addEventListener(n,f){this.events[n]=f;}querySelector(s){return this.child??=new Element('','CANVAS');}
 append(e){cards.push(e);}
}
const html=fs.readFileSync('versus.html','utf8'),els={};for(const [,id] of html.matchAll(/id="([^"]+)"/g))els[id]=new Element(id);
els.mode.value='local';els.difficulty.value='normal';els.arena.value='steppe';els.play.hidden=true;els.overlay.hidden=true;
for(const [,action] of html.matchAll(/data-action="([^"]+)"/g)){const e=new Element('','BUTTON');e.dataset.action=action;touch.push(e);}
const document={hidden:false,getElementById:id=>{assert.ok(els[id],id);return els[id];},createElement:tag=>new Element('',tag.toUpperCase()),querySelectorAll:s=>s==='.card'?cards:touch,addEventListener:(n,f)=>listeners[n]=f};
const sandbox={document,window:{scrollTo:noop,addEventListener:(n,f)=>windowEvents[n]=f},matchMedia:()=>({matches:false}),requestAnimationFrame:f=>nextFrame=f,Math,console,Set};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync('versus.js','utf8'),sandbox);assert.equal(cards.length,10);assert.ok(geometry>200,'all character cards render');
cards[0].events.click();assert.ok(els.start.disabled);cards[1].events.click();assert.equal(els.start.disabled,false);els.start.onclick();assert.equal(els.play.hidden,false);
let now=1;const frames=seconds=>{for(let i=0;i<seconds*60;i++){now+=1000/60;const f=nextFrame;assert.equal(typeof f,'function');f(now);}};
const key=(kind,k)=>listeners[kind]({key:k,target:{tagName:'DIV'},preventDefault:noop,repeat:false});
frames(2);key('keydown','d');frames(1.8);key('keyup','d');key('keydown','j');frames(3);key('keyup','j');
assert.ok(!els['p2-stats'].textContent.startsWith('300 / 300'),'real keyboard callbacks damage opponent');
els.pause.onclick();assert.equal(els.overlay.hidden,false);const timer=els.timer.textContent;frames(2);assert.equal(els.timer.textContent,timer,'pause stops timer');els.resume.onclick();frames(.2);assert.equal(els.overlay.hidden,true);
const attack=touch.find(b=>b.dataset.action==='attack');attack.events.pointerdown({pointerId:1,preventDefault:noop});assert.ok(attack.classes.has('active'));attack.events.pointercancel({pointerId:1});assert.ok(!attack.classes.has('active'));
els.help.onclick();assert.equal(els.overlay.hidden,false);els.resume.onclick();windowEvents.blur();assert.equal(els.overlay.hidden,false,'losing focus pauses and clears held input');els.resume.onclick();
els.menu.onclick();assert.equal(els.select.hidden,false);assert.equal(els.play.hidden,true);els['reset-pick'].onclick();assert.equal(els.start.disabled,true);
for(const arena of ['city','temple']){els.arena.value=arena;cards[6].events.click();cards[7].events.click();els.start.onclick();frames(2);els.menu.onclick();els['reset-pick'].onclick();}
console.log('PASS: full browser bundle simulated, all portraits/arenas with finite drawing, selection, keyboard combat, pause/resume/help, pointer cancellation, focus pause and menu reset.');
