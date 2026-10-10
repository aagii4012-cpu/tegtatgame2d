/* Original TEGTAT VERSUS. Fixed-step combat; art drawn locally, no sprite downloads. */
'use strict';
const Versus=(()=>{
 const roster=[
  {id:'galbarah',name:'ГАЛБАРАХ',alias:'FLAME HEART',gender:'ЭРЭГТЭЙ',color:'#df6747',dark:'#562e31',weapon:'blade',power:'flame',hp:330,speed:285,damage:13,range:114,desc:'Галын сэлэм · газраас дараалан 3 галын багана гаргана.'},
  {id:'tuvshuu',name:'ТӨВШӨӨ',alias:'HUD FOCUS',gender:'ЭРЭГТЭЙ',color:'#65c5ce',dark:'#24384f',weapon:'dual',power:'focus',hp:300,speed:325,damage:11,range:100,desc:'Хос ир · хурдан комбо · чиглэсэн сүүдрийн дайралт.'},
  {id:'erhmee',name:'ЭРХМЭЭ',alias:'BABY SHARK',gender:'ЭРЭГТЭЙ',color:'#559ada',dark:'#24366a',weapon:'fist',power:'shark',hp:350,speed:265,damage:14,range:105,desc:'Усан нударга · аварга загасан долгион дайсныг хөөргөнө.'},
  {id:'anhaa',name:'АНХАА',alias:'МУНДАГ',gender:'ЭРЭГТЭЙ',color:'#ba9a68',dark:'#453448',weapon:'glaive',power:'spin',hp:340,speed:275,damage:14,range:147,desc:'Урт жад · удаан ч хүчтэй комбо · ойр хавийг хамарсан 3 эргэлт.'},
  {id:'teka',name:'ТЕКА',alias:'ТЭМҮ',gender:'ЭРЭГТЭЙ',color:'#9d8be0',dark:'#292d50',weapon:'blade',power:'thunder',hp:315,speed:300,damage:12,range:123,desc:'Аянгын сэлэм · дайсны байрлалд анхааруулгатай 3 аянга.'},
  {id:'tugldur',name:'ТӨГӨЛДӨР',alias:'IRON WILL',gender:'ЭРЭГТЭЙ',color:'#b9bac7',dark:'#313c4f',weapon:'hammer',power:'meteor',hp:365,speed:250,damage:16,range:125,desc:'Хүнд алх · өндөр HP · тэнгэрээс буух хүчтэй солир.'},
  {id:'uyanga',name:'УЯНГАА',alias:'WIND DANCER',gender:'ЭМЭГТЭЙ',color:'#89d3b0',dark:'#254651',weapon:'fan',power:'wind',hp:300,speed:325,damage:11,range:122,desc:'Салхин дэвүүр · салхины шуурга өрсөлдөгчийг татаж, зайг өөрчилнө.'},
  {id:'azu',name:'АЗУ',alias:'FROST EDGE',gender:'ЭМЭГТЭЙ',color:'#a4dfec',dark:'#34455e',weapon:'dual',power:'ice',hp:300,speed:310,damage:12,range:110,desc:'Мөсөн хос ир · 3 салаа мөсөн сум · дайсны хөдөлгөөнийг түр удаашруулна.'},
  {id:'tungaa',name:'ТУНГАА',alias:'EARTH WARDEN',gender:'ЭМЭГТЭЙ',color:'#d5a479',dark:'#583c39',weapon:'fist',power:'earth',hp:355,speed:265,damage:15,range:110,desc:'Чулуун бээлий · газраар дараалан ургах шовх хад, үсэрч зайлна.'},
  {id:'enerel',name:'ЭНЭРЭЛ',alias:'DAWN LIGHT',gender:'ЭМЭГТЭЙ',color:'#f0b6cd',dark:'#543759',weapon:'staff',power:'light',hp:305,speed:295,damage:11,range:138,desc:'Гэрлийн таяг · нарийн гэрлийн туяа · special ашиглахдаа 18 HP нөхнө.'}
 ];
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const platforms=[{x:300,w:180,y:365},{x:650,w:180,y:320}];
 const empty=()=>({left:false,right:false,guard:false,attack:false,jump:false,dash:false,shot:false,special:false,assist:false});
 class Battle{
  constructor(a,b,opt={}){this.mode=opt.mode||'cpu';this.difficulty=opt.difficulty||'normal';this.arena=opt.arena||'steppe';this.random=opt.random||Math.random;this.sound=opt.sound||(()=>{});this.time=0;this.round=1;this.wins=[0,0];this.roundClock=75;this.phase='intro';this.phaseT=0;this.fx=[];this.projectiles=[];this.zones=[];this.shake=0;this.hitstop=0;this.message='ROUND 1';this.inputs=[empty(),empty()];this.series=opt.series||0;this.fighters=[this.make(a,0),this.make(b,1)];}
  make(def,side){return {def,side,x:side?880:220,y:500,vx:0,vy:0,face:side?-1:1,hp:def.hp,en:35,state:'idle',t:0,inv:0,flash:0,ground:true,cd:{shot:0,dash:0,special:0,assist:0},step:0,combo:0,comboT:0,chainUntil:0,slow:0,hits:new Set(),buffer:0,aiT:.7,ai:empty(),guardT:0,guardLock:0};}
  action(side,key){this.inputs[side][key]=true;}
  hit(attacker,target,damage,o={}){
   if(target.hp<=0||target.inv>0||this.phase!=='fight')return false;
   const front=(attacker.x-target.x)*target.face>=-10;
   if(target.state==='guard'&&front&&!o.unblockable){
    if(target.guardT<.18&&target.guardLock<=0){target.guardLock=.9;target.en=clamp(target.en+8,0,100);attacker.state='stun';attacker.t=0;this.text(target,'PARRY','#e8d78e');this.spark(target.x,target.y-65,'#f6edbd',14);this.sound('parry');return 'parry';}
    target.en=Math.max(0,target.en-7);target.hp=Math.max(1,target.hp-Math.max(1,Math.floor(damage*.13)));target.vx=attacker.face*80;this.spark(target.x,target.y-65,'#aee5ef',6);this.sound('block');
    if(target.en<1){target.state='stun';target.t=0;this.text(target,'GUARD BREAK','#ffa7a7');}return 'block';
   }
   target.hp=Math.max(0,target.hp-damage);target.inv=.16;target.flash=.12;target.state=target.hp?'hurt':'dead';target.t=0;target.vx=attacker.face*(o.heavy?245:125);if(o.launch){target.vy=-440;target.ground=false;}target.slow=Math.max(target.slow,o.slow||0);
   attacker.en=clamp(attacker.en+(o.skill?2:6),0,100);attacker.combo=attacker.comboT>0?attacker.combo+1:1;attacker.comboT=1.2;target.combo=0;target.comboT=0;
   this.text(target,String(damage),o.heavy?'#ffe0a1':'#fff');this.spark(target.x,target.y-62,attacker.def.color,o.heavy?14:8);this.shake=Math.max(this.shake,o.heavy?7:3);this.hitstop=Math.max(this.hitstop,o.heavy?.05:.028);this.sound(o.heavy?'heavy':'hit');return true;
  }
  text(f,text,color){this.fx.push({kind:'text',x:f.x,y:f.y-145,text,color,t:0,max:.85});}
  spark(x,y,color,n){for(let i=0;i<n;i++)this.fx.push({kind:'spark',x,y,vx:(this.random()-.5)*450,vy:-this.random()*330,color,t:0,max:.3+this.random()*.2});}
  begin(f,state){f.state=state;f.t=0;f.hits=new Set();f.fired=false;}
  skill(f,key){const cost={shot:18,special:60,assist:35,dash:0}[key];if(f.cd[key]>0||f.en<cost){this.text(f,f.cd[key]>0?'COOLDOWN':'ENERGY ДУТУУ','#afbcd4');return false;}f.en-=cost;f.cd[key]={shot:1.1,special:5,assist:9,dash:1.15}[key];this.begin(f,key);if(key==='dash'){f.inv=.21;f.vx=f.face*720;this.sound('dash');}if(key==='special'){this.text(f,{flame:'ГАЛЫН ЗҮРХ!',focus:'FOCUS!',shark:'BABY SHARK!',spin:'МУНДАГ ДАЛАЙЛТ!',thunder:'ТЭНГЭРИЙН АЯНГА!',meteor:'ТӨМӨР ЗОРИГ!',wind:'САЛХИН БҮЖИГ!',ice:'МӨСӨН ИР!',earth:'ГАЗРЫН ХҮЧ!',light:'ҮҮРИЙН ГЭРЭЛ!'}[f.def.power],f.def.color);this.sound('charge');}return true;}
  projectile(f,opt={}){this.projectiles.push({owner:f,x:f.x+f.face*35,y:f.y-65,vx:f.face*(opt.speed||560),vy:opt.vy||0,r:opt.r||17,damage:opt.damage||18,t:0,max:opt.max||2.1,kind:opt.kind||f.def.power,slow:opt.slow||0,launch:!!opt.launch,pierce:!!opt.pierce,hit:new Set(),color:f.def.color});}
  zone(f,x,y,opt={}){this.zones.push({owner:f,x:clamp(x,40,1060),y,r:opt.r||70,delay:opt.delay??.3,t:0,max:(opt.delay??.3)+.45,damage:opt.damage||22,kind:opt.kind||f.def.power,ground:!!opt.ground,pull:!!opt.pull,launch:!!opt.launch,hit:false});}
  special(f,target){const kind=f.def.power;
   if(kind==='flame'||kind==='earth')for(let i=0;i<3;i++)this.zone(f,f.x+f.face*(105+i*110),500,{delay:.12+i*.18,r:58,damage:kind==='earth'?25:23,kind,ground:true,launch:i===2});
   else if(kind==='focus'){f.vx=f.face*850;f.inv=.18;this.projectile(f,{speed:900,r:34,damage:58,max:.42,kind:'focus',pierce:true});}
   else if(kind==='shark')this.projectile(f,{speed:450,r:45,damage:54,launch:true,kind});
   else if(kind==='spin')for(let i=0;i<3;i++)this.zone(f,f.x,f.y-60,{delay:i*.28,r:160,damage:19,kind});
   else if(kind==='thunder')for(let i=0;i<3;i++)this.zone(f,target.x+(i-1)*65,500,{delay:.38+i*.2,r:64,damage:22,kind,ground:true});
   else if(kind==='meteor')this.zone(f,target.x,500,{delay:.65,r:115,damage:64,kind,ground:true,launch:true});
   else if(kind==='wind')for(let i=0;i<3;i++)this.zone(f,f.x+f.face*190,440,{delay:i*.25,r:145,damage:18,kind,pull:true});
   else if(kind==='ice')for(const vy of [-100,0,100])this.projectile(f,{speed:520,vy,r:19,damage:22,slow:2,kind});
   else if(kind==='light'){f.hp=Math.min(f.def.hp,f.hp+18);this.projectile(f,{speed:950,r:25,damage:45,pierce:true,kind});this.text(f,'+18 HP','#d6ffde');}
  }
  ai(f,target,dt){f.aiT-=dt;if(f.aiT>0)return f.ai;const level=this.difficulty;f.aiT=level==='easy'?.5:level==='hard'?.16:.28;const a=empty(),dx=target.x-f.x,d=Math.abs(dx),chance=this.random();
   if(d>f.def.range*.9){a.left=dx<0;a.right=dx>0;}else if(d<58&&chance<.2){a.left=dx>0;a.right=dx<0;}
   const danger=target.state==='attack'||target.state==='special'||this.projectiles.some(p=>p.owner!==f&&Math.abs(p.x-f.x)<210);
   if(danger&&chance<(level==='hard'?.72:level==='easy'?.2:.48)){a.guard=true;a.left=a.right=false;if(chance<.18)a.jump=true;}
   else if(d<f.def.range+25&&Math.abs(target.y-f.y)<90)a.attack=true;
   if(target.y<f.y-100&&chance<.6)a.jump=true;
   if(d>240&&d<650&&chance<.38)a.shot=true;
   if(f.en>=60&&d<520&&chance<.34)a.special=true;
   if(f.en>=35&&f.hp<f.def.hp*.5&&chance<.2)a.assist=true;
   if(d>430&&chance<.3)a.dash=true;
   f.ai=a;return a;
  }
  fighter(f,target,dt,a){f.t+=dt;f.inv=Math.max(0,f.inv-dt);f.flash=Math.max(0,f.flash-dt);f.slow=Math.max(0,f.slow-dt);f.guardLock=Math.max(0,f.guardLock-dt);f.comboT=Math.max(0,f.comboT-dt);if(!f.comboT)f.combo=0;f.buffer=Math.max(0,f.buffer-dt);for(const k in f.cd)f.cd[k]=Math.max(0,f.cd[k]-dt);f.en=Math.min(100,f.en+3*dt);
   if(a.attack)f.buffer=.18;
   if(f.hp<=0){f.state='dead';return;}
   const ready=f.state==='idle'||f.state==='run'||f.state==='guard';
   if(ready){
    if(a.left!==a.right)f.face=a.left?-1:1;else f.face=target.x>=f.x?1:-1;
    if(a.jump&&f.ground){f.vy=-680;f.ground=false;this.sound('jump');}
    for(const key of ['special','assist','shot','dash'])if(a[key]){this.skill(f,key);a[key]=false;break;}
    if(['idle','run','guard'].includes(f.state)){
     if(a.guard&&f.ground){if(f.state!=='guard'){this.begin(f,'guard');f.guardT=0;}f.guardT+=dt;f.vx=0;}
     else if(f.buffer>0){f.step=this.time<f.chainUntil?(f.step+1)%3:0;f.chainUntil=this.time+.95;f.buffer=0;this.begin(f,'attack');f.vx=f.face*(f.step===2?120:45);this.sound('swing');}
     else{f.state=a.left!==a.right?'run':'idle';f.vx=(a.right-a.left)*f.def.speed*(f.slow>0?.6:1);}
    }
   }
   if(f.state==='attack'){
    const duration=f.def.weapon==='hammer'?.5:f.step===2?.43:.32;
    if(f.t>.09&&f.t<.22&&!f.hits.has(target)&&Math.abs(target.y-f.y)<(f.ground?90:110)){
     const dx=(target.x-f.x)*f.face,reach=f.def.range+(f.step===2?25:0);
     if(dx>-25&&dx<reach){f.hits.add(target);this.hit(f,target,Math.round(f.def.damage*(f.step===2?1.65:1)),{heavy:f.step===2,launch:f.step===2&&!f.ground});}
    }
    f.vx*=Math.exp(-dt*7);if(f.t>duration)this.begin(f,'idle');
   }else if(f.state==='shot'){if(f.t>.2&&!f.fired){f.fired=true;this.projectile(f);this.sound('shot');}f.vx=0;if(f.t>.5)this.begin(f,'idle');}
   else if(f.state==='special'){if(f.t>.28&&!f.fired){f.fired=true;this.special(f,target);this.sound('special');}if(f.def.power!=='focus')f.vx=0;else f.vx*=Math.exp(-dt*5);if(f.t>.85)this.begin(f,'idle');}
   else if(f.state==='assist'){if(f.t>.25&&!f.fired){f.fired=true;this.zone(f,target.x-f.face*70,target.y-55,{delay:.25,r:125,damage:26,kind:'assist'});this.sound('special');}f.vx=0;if(f.t>.65)this.begin(f,'idle');}
   else if(f.state==='dash'){if(f.t>.2){f.vx=0;this.begin(f,'idle');}else this.fx.push({kind:'ghost',x:f.x,y:f.y,def:f.def,face:f.face,t:0,max:.2});}
   else if(f.state==='hurt'||f.state==='stun'){f.vx*=Math.exp(-dt*9);if(f.t>(f.state==='stun'?.6:.3))this.begin(f,'idle');}
   const oldY=f.y;f.x=clamp(f.x+f.vx*dt,45,1055);f.vy+=1450*dt;f.y+=f.vy*dt;f.ground=false;
   if(f.vy>=0){for(const p of platforms)if(f.x>p.x-10&&f.x<p.x+p.w+10&&oldY<=p.y+1&&f.y>=p.y){f.y=p.y;f.vy=0;f.ground=true;break;}if(f.y>=500){f.y=500;f.vy=0;f.ground=true;}}
   a.jump=false;
  }
  effects(dt){for(const f of this.fx){f.t+=dt;if(f.kind==='spark'){f.x+=f.vx*dt;f.y+=f.vy*dt;f.vy+=650*dt;}if(f.kind==='text')f.y-=40*dt;}this.fx=this.fx.filter(f=>f.t<f.max);this.shake=Math.max(0,this.shake-35*dt);}
  step(dt){dt=Math.min(dt,1/30);this.time+=dt;this.effects(dt);
   if(this.phase==='finished')return;
   if(this.phase==='intro'){this.phaseT+=dt;this.message=this.phaseT<.9?'ROUND '+this.round:'FIGHT!';if(this.phaseT>1.5){this.phase='fight';this.message='';}return;}
   if(this.phase==='roundEnd'){this.phaseT+=dt;if(this.phaseT>2.4){if(this.wins.some(w=>w>=2)){this.phase='finished';return;}const defs=this.fighters.map(f=>f.def);this.fighters=defs.map((d,i)=>this.make(d,i));this.round++;this.roundClock=75;this.phase='intro';this.phaseT=0;this.inputs=[empty(),empty()];this.projectiles=[];this.zones=[];this.fx=[];}return;}
   if(this.hitstop>0){this.hitstop-=dt;return;}
   this.roundClock=Math.max(0,this.roundClock-dt);
   const [a,b]=this.fighters;
   const ai=this.mode==='local'?this.inputs[1]:this.ai(b,a,dt);
   this.fighter(a,b,dt,this.inputs[0]);this.fighter(b,a,dt,ai);
   if(Math.abs(a.x-b.x)<48&&Math.abs(a.y-b.y)<70){const mid=(a.x+b.x)/2,dir=a.x<=b.x?1:-1;a.x=clamp(mid-dir*24,45,1055);b.x=clamp(mid+dir*24,45,1055);}
   for(const p of this.projectiles){const target=p.owner===a?b:a,old=p.x;p.x+=p.vx*dt;p.y+=p.vy*dt;p.t+=dt;
    const crossed=Math.min(old,p.x)<target.x+24&&Math.max(old,p.x)>target.x-24;
    if(!p.hit.has(target)&&crossed&&Math.abs(p.y-(target.y-65))<p.r+48){p.hit.add(target);this.hit(p.owner,target,p.damage,{skill:true,slow:p.slow,launch:p.launch,heavy:p.damage>30});if(!p.pierce)p.t=p.max;}
   }this.projectiles=this.projectiles.filter(p=>p.t<p.max&&p.x>-80&&p.x<1180);
   for(const z of this.zones){z.t+=dt;if(z.t>=z.delay&&!z.hit){z.hit=true;const t=z.owner===a?b:a;
    const near=Math.abs(t.x-z.x)<z.r+20&&(z.ground?t.y>z.y-100:Math.abs(t.y-60-z.y)<z.r);
    if(near){const landed=this.hit(z.owner,t,z.damage,{skill:true,heavy:true,launch:z.launch,unblockable:z.ground});if(z.pull&&landed===true)t.vx=(z.x-t.x)*4;}this.shake=Math.max(this.shake,5);this.sound('heavy');}
   }this.zones=this.zones.filter(z=>z.t<z.max);
   if(a.hp<=0||b.hp<=0||this.roundClock<=0){const av=a.hp/a.def.hp,bv=b.hp/b.def.hp;let winner=av===bv?-1:av>bv?0:1;if(winner>=0)this.wins[winner]++;else{this.wins[0]++;this.wins[1]++;}this.message=winner<0?'DRAW':this.fighters[winner].def.name+' · WINS';this.phase='roundEnd';this.phaseT=0;this.projectiles=[];this.zones=[];}
  }
 }
 return {roster,Battle,empty,platforms,clamp};
})();
if(typeof module!=='undefined')module.exports=Versus;
if(typeof document!=='undefined')(()=>{
 const $=id=>document.getElementById(id),canvas=$('arena-canvas'),ctx=canvas.getContext('2d');
 let battle=null,picks=[],paused=false,doneShown=false,soundOn=false,audio=null,series=[],seriesIndex=0,last=0,acc=0,particlesDetail=!matchMedia('(prefers-reduced-motion: reduce)').matches;
 function tone(type){if(!soundOn)return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();const n=audio.currentTime,freq={hit:140,heavy:65,parry:850,block:240,swing:330,dash:420,jump:580,shot:700,charge:180,special:90}[type]||300;osc.type=['heavy','hit'].includes(type)?'sawtooth':'triangle';osc.frequency.setValueAtTime(freq,n);osc.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.3),n+.15);gain.gain.setValueAtTime(.045,n);gain.gain.exponentialRampToValueAtTime(.001,n+.18);osc.connect(gain);gain.connect(audio.destination);osc.start(n);osc.stop(n+.2);}catch{soundOn=false;}}
 const path=(c,pts,fill,stroke)=>{c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}};
 function limb(c,x,y,x2,y2,w,color){c.strokeStyle=color;c.lineWidth=w;c.lineCap='round';c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();}
 function drawFighter(c,f,scale=1,portrait=false){const d=f.def,t=battle?.time||0,run=f.state==='run',attack=['attack','special','shot'].includes(f.state),dash=f.state==='dash',hurt=f.state==='hurt'||f.state==='stun',dead=f.state==='dead',air=!f.ground;
  c.save();c.translate(f.x,f.y);c.scale(f.face*scale,scale);if(dead){c.rotate(-1.1);c.translate(20,-5);}const bob=run?Math.sin(t*18)*3:Math.sin(t*3)*1.5;
  c.translate(0,bob);c.globalAlpha=f.flash>0?.45:1;
  const leg=run?Math.sin(t*18)*26:air?18:8,lean=dash?19:attack?9:hurt?-10:0;
  // Flowing sash and cape, silhouette distinct from skin and metallic trim.
  path(c,[[-14+lean,-105],[-58-(run?Math.sin(t*12)*9:0),-50],[-34,-25],[-17,-73]],d.dark);
  limb(c,-8,-45,-19-leg, -13,16,d.dark);limb(c,9,-44,18+leg,-10,17,d.dark);limb(c,-19-leg,-13,-23-leg,0,17,'#202636');limb(c,18+leg,-10,28+leg,0,18,'#252a39');
  path(c,[[-18+lean,-110],[17+lean,-110],[24,-65],[29,-39],[2,-28],[-27,-41],[-19,-70]],d.color,d.dark);
  path(c,[[-16+lean,-108],[-3+lean,-89],[15+lean,-105],[9,-55],[-4,-49]],d.dark);
  c.strokeStyle='#e9d2a1';c.lineWidth=2;c.beginPath();c.moveTo(-5+lean,-102);c.lineTo(11,-64);c.stroke();
  c.fillStyle='#ddbb79';c.fillRect(-22,-61,44,8);c.fillStyle='#654744';c.fillRect(-6,-62,12,10);
  for(let i=0;i<5;i++)path(c,[[-21+i*10,-44],[-17+i*10,-48],[-13+i*10,-44],[-17+i*10,-40]],null,'#e8d29b');
  path(c,[[18,-60],[42,-56],[56+Math.sin(t*9)*5,-45],[33,-48]],d.color);
  limb(c,lean-16,-99,lean-28,-76,14,d.dark);
  const extent=attack?Math.sin(Math.min(1,(f.t||.2)*4)*Math.PI)*35:0,arm=lean+23+extent;
  limb(c,lean+13,-99,arm,-80+(f.state==='guard'?-16:0),14,d.color);limb(c,arm,-80+(f.state==='guard'?-16:0),arm+17,-84,10,'#d9ab89');
  path(c,[[lean-16,-104],[lean-9,-114],[lean+4,-103],[lean-5,-95]],'#7a879e','#e7c98c');
  const hy=-133+(hurt?5:0);c.fillStyle='#ddb18f';c.beginPath();c.ellipse(lean,hy,15,20,-.08,0,Math.PI*2);c.fill();
  if(d.gender==='ЭМЭГТЭЙ'){path(c,[[lean-16,hy-17],[lean+10,hy-22],[lean+19,hy],[lean+22,hy+48],[lean+8,hy+28],[lean-15,hy+8]],'#202437');c.fillStyle='#e7b593';c.beginPath();c.ellipse(lean+3,hy+1,11,15,0,0,Math.PI*2);c.fill();path(c,[[lean-14,hy-12],[lean+10,hy-22],[lean+15,hy-5],[lean-2,hy-9]],'#212338');}
  else path(c,[[lean-17,hy-4],[lean-19,hy-19],[lean-5,hy-30],[lean+1,hy-23],[lean+15,hy-25],[lean+18,hy-5],[lean+5,hy-13]],d.id==='galbarah'?'#863d37':d.id==='teka'?'#c5c4d5':'#222638');
  if(d.id==='anhaa'){path(c,[[lean-23,hy-16],[lean-10,hy-33],[lean,hy-56],[lean+12,hy-32],[lean+23,hy-16]],d.dark,'#d5be8d');limb(c,lean,hy-52,lean+17,hy-65,4,d.color);}
  if(d.id==='tugldur'){path(c,[[lean-20,hy-7],[lean-18,hy-25],[lean,hy-38],[lean+18,hy-22],[lean+20,hy-6],[lean+8,hy-10],[lean-3,hy-8]],'#65758c','#ccd3dc');limb(c,lean,hy-34,lean,hy-14,3,'#e0c48d');}
  if(d.id==='tuvshuu'){path(c,[[lean-20,hy+9],[lean-21,hy-18],[lean-10,hy-32],[lean+13,hy-27],[lean+20,hy-6],[lean+9,hy-15],[lean-10,hy-13]],d.dark,d.color);}
  c.strokeStyle=d.color;c.lineWidth=4;c.beginPath();c.moveTo(lean-15,hy-7);c.lineTo(lean+14,hy-8);c.stroke();limb(c,lean-16,hy-7,lean-43,hy-3+Math.sin(t*9)*7,3,d.color);
  limb(c,lean+5,hy,lean+11,hy,2,'#272d3b');c.fillStyle='#e4d4b8';c.fillRect(lean+8,hy-3,2,2);
  const wx=arm+16,wy=-86;
  if(d.weapon==='blade'||d.weapon==='dual'){limb(c,wx,wy,wx+6,wy-12,5,'#ddbc75');path(c,[[wx+2,wy-12],[wx+15+extent,wy-89],[wx+21+extent,wy-81],[wx+10,wy-11]],'#e0e9f1','#899fb5');if(d.weapon==='dual')path(c,[[-25,-81],[-50,-129],[-47,-135],[-19,-84]],'#dae9ee');}
  if(d.weapon==='glaive'||d.weapon==='staff'){limb(c,wx-50,wy+20,wx+72,wy-48,5,d.weapon==='staff'?'#c3a88e':'#7b644a');if(d.weapon==='glaive')path(c,[[wx+54,wy-38],[wx+84,wy-78],[wx+96,wy-42],[wx+72,wy-34]],'#dce5ec','#e3c88a');else{c.fillStyle=d.color;c.beginPath();c.arc(wx+75,wy-49,10,0,Math.PI*2);c.fill();}}
  if(d.weapon==='hammer'){limb(c,wx-10,wy+12,wx+23,wy-65,7,'#9a7957');path(c,[[wx+1,wy-83],[wx+49,wy-64],[wx+39,wy-39],[wx-9,wy-58]],'#8393a7','#d3d8dd');}
  if(d.weapon==='fist'){c.fillStyle=d.dark;c.fillRect(wx-5,wy-10,25,21);c.strokeStyle='#edcd87';c.lineWidth=2;c.strokeRect(wx-5,wy-10,25,21);}
  if(d.weapon==='fan'){c.fillStyle=d.color;c.beginPath();c.moveTo(wx,wy);c.arc(wx,wy,37,-2.2,-.2);c.closePath();c.fill();for(let i=0;i<5;i++){const a=-2.2+i*.5;limb(c,wx,wy,wx+Math.cos(a)*36,wy+Math.sin(a)*36,2,'#f2ddba');}}
  if(f.state==='guard'){c.strokeStyle='#a0dbe7';c.lineWidth=3;c.beginPath();c.ellipse(38,-79,17,48,0,0,Math.PI*2);c.stroke();}
  if(attack&&f.state!=='shot'){c.strokeStyle=d.color;c.lineWidth=4;c.globalAlpha=.65;c.beginPath();c.arc(12,-83,d.range*.65,-1.8,1.2);c.stroke();c.lineWidth=2;c.strokeStyle='#f6ead1';c.beginPath();c.arc(12,-83,d.range*.7,-1.3,.8);c.stroke();}
  c.restore();
 }
 function background(){const key=battle?.arena||'steppe',t=battle?.time||0;const g=ctx.createLinearGradient(0,0,0,620);g.addColorStop(0,key==='city'?'#10152c':key==='temple'?'#191c38':'#233e53');g.addColorStop(1,key==='city'?'#32405b':key==='temple'?'#6c525b':'#c0ad8b');ctx.fillStyle=g;ctx.fillRect(0,0,1100,620);
  ctx.fillStyle=key==='city'?'#cb829c':'#efce9f';ctx.beginPath();ctx.arc(850,135,48,0,Math.PI*2);ctx.fill();
  for(let layer=0;layer<3;layer++){const y=250+layer*75;ctx.fillStyle=['#283953','#31475b','#41556a'][layer];path(ctx,[[-20,440],[-20,y+40],[110,y-80],[220,y+20],[360,y-120],[500,y],[650,y-90],[800,y+30],[970,y-110],[1120,y+20],[1120,500]],ctx.fillStyle);}
  if(key==='city')for(let i=0;i<12;i++){const x=i*102,h=90+(i*47%130);ctx.fillStyle='#182337';ctx.fillRect(x,430-h,78,h);for(let j=0;j<5;j++)for(let k=0;k<3;k++){ctx.fillStyle=(i+j+k)%3?'#887775':'#bf93a9';ctx.fillRect(x+12+k*20,440-h+j*19,5,8);}}
  if(key==='temple'){ctx.fillStyle='#3b354b';ctx.fillRect(790,300,140,175);path(ctx,[[750,302],[860,245],[967,302]],'#262b40','#b28d7d');for(let x=802;x<932;x+=40){ctx.fillStyle='#98735f';ctx.fillRect(x,305,10,165);}}
  if(key==='steppe')for(const x of [90,870]){path(ctx,[[x,465],[x+5,405],[x+68,367],[x+130,405],[x+134,465]],'#d7c7ae','#847b72');ctx.fillStyle='#795d4e';ctx.fillRect(x+58,426,24,39);limb(ctx,x+8,421,x+127,421,2,'#83745e');}
  ctx.fillStyle='#273b40';ctx.fillRect(0,500,1100,120);path(ctx,[[0,500],[1100,500],[1100,519],[0,531]],'#66756a');for(let i=0;i<50;i++){ctx.strokeStyle='#a1a17a44';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(i*24,514);ctx.lineTo(i*24+Math.sin(t*2+i)*5,502);ctx.stroke();}
  for(const p of Versus.platforms){path(ctx,[[p.x-12,p.y],[p.x+p.w+12,p.y],[p.x+p.w,p.y+13],[p.x+12,p.y+22]],'#4f5961','#a5a99a');ctx.fillStyle='#c9b98c';ctx.fillRect(p.x,p.y-4,p.w,5);}
  // Foreground decorative border keeps the ring readable.
  ctx.fillStyle='#101f2a';ctx.fillRect(0,585,1100,35);ctx.strokeStyle='#b49d6c44';ctx.beginPath();ctx.moveTo(0,585);ctx.lineTo(1100,585);ctx.stroke();
 }
 function draw(){ctx.save();if(battle?.shake&&particlesDetail)ctx.translate((Math.random()-.5)*battle.shake,(Math.random()-.5)*battle.shake);background();if(!battle){ctx.restore();return;}
  for(const z of battle.zones){const col=z.owner.def.color;ctx.globalAlpha=z.t<z.delay?.5:1;ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=3;
   if(z.t<z.delay){ctx.beginPath();ctx.ellipse(z.x,z.y,z.r,9,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(z.x-z.r,z.y);ctx.lineTo(z.x-z.r+z.r*2*z.t/Math.max(.01,z.delay),z.y);ctx.stroke();}
   else if(z.kind==='thunder'){ctx.beginPath();ctx.moveTo(z.x-30,0);ctx.lineTo(z.x+20,z.y-140);ctx.lineTo(z.x-22,z.y-105);ctx.lineTo(z.x,z.y);ctx.stroke();}
   else if(z.kind==='earth')path(ctx,[[z.x-z.r,z.y],[z.x-20,z.y-130],[z.x+12,z.y-70],[z.x+z.r*.7,z.y-110],[z.x+z.r,z.y]],col,'#ffe1b4');
   else if(z.kind==='flame'){for(let i=0;i<3;i++)path(ctx,[[z.x-z.r+i*35,z.y],[z.x-z.r+i*35+10,z.y-100-i*20],[z.x-z.r+i*35+34,z.y]],col,'#ffdc9c');}
   else if(z.kind==='meteor'){ctx.beginPath();ctx.arc(z.x,z.y-45,70,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ffdda4';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(z.x-140,z.y-280);ctx.lineTo(z.x,z.y-50);ctx.stroke();}
   else if(z.kind==='assist'){drawFighter(ctx,{def:z.owner.def,x:z.x,y:z.y+55,face:z.owner.face,state:'attack',t:.2,ground:true},.9);}
   else{ctx.lineWidth=z.kind==='spin'?8:4;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(z.x,z.y,z.r*(.5+i*.2),25+i*19,(z.kind==='wind'?-.2:0),-Math.PI*.8,Math.PI*.8);ctx.stroke();}}
  }ctx.globalAlpha=1;
  for(const f of battle.fighters){ctx.fillStyle='#06111955';ctx.beginPath();ctx.ellipse(f.x,501,35,9,0,0,Math.PI*2);ctx.fill();drawFighter(ctx,f,1.22);if(f.slow>0){ctx.strokeStyle='#bde8ff';ctx.lineWidth=2;ctx.strokeRect(f.x-24,f.y-65,48,60);}}
  for(const p of battle.projectiles){ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.vx>0?1:-1,1);ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=14;
   if(p.kind==='shark'){path(ctx,[[-40,15],[-55,-17],[-12,-17],[3,-48],[13,-18],[49,-2],[14,21],[-22,23]],p.color,'#d5edff');ctx.fillStyle='#1d243b';ctx.fillRect(30,-4,4,4);}
   else if(p.kind==='ice')path(ctx,[[-24,0],[0,-16],[25,0],[0,16]],p.color,'#e4f5ff');
   else{ctx.beginPath();ctx.ellipse(0,0,p.kind==='light'?80:p.r*1.7,p.r,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f4e5c5';ctx.beginPath();ctx.ellipse(6,0,p.r,.4*p.r,0,0,Math.PI*2);ctx.fill();}ctx.restore();}
  for(const fx of battle.fx){ctx.globalAlpha=1-fx.t/fx.max;if(fx.kind==='text'){ctx.fillStyle=fx.color;ctx.strokeStyle='#182339';ctx.lineWidth=4;ctx.font='800 22px Arial';ctx.textAlign='center';ctx.strokeText(fx.text,fx.x,fx.y);ctx.fillText(fx.text,fx.x,fx.y);}else if(fx.kind==='ghost')drawFighter(ctx,{...fx,state:'dash',ground:true},1.22);else if(particlesDetail){ctx.fillStyle=fx.color;ctx.fillRect(fx.x,fx.y,4,4);}}ctx.globalAlpha=1;
  for(const f of battle.fighters)if(f.combo>1){ctx.font='italic 800 30px Arial';ctx.textAlign=f.side?'right':'left';ctx.fillStyle=f.def.color;ctx.fillText(f.combo+' HITS',f.side?1020:80,185);}
  ctx.restore();
 }
 function cards(){for(const d of Versus.roster){const btn=document.createElement('button');btn.className='card';btn.dataset.id=d.id;btn.setAttribute('aria-label',d.name+' '+d.alias);btn.innerHTML='<span class="badge">'+d.gender+'</span><canvas width="230" height="170"></canvas><div class="caption"><b>'+d.name+'</b><small>'+d.alias+'</small></div>';const c=btn.querySelector('canvas').getContext('2d');const g=c.createRadialGradient(110,80,10,110,80,140);g.addColorStop(0,d.dark);g.addColorStop(1,'#111725');c.fillStyle=g;c.fillRect(0,0,230,170);drawFighter(c,{def:d,x:113,y:172,face:1,state:'idle',ground:true},.99,true);btn.addEventListener('click',()=>pick(d));$('roster').append(btn);}}
 function pick(d){if(picks.length>=2)picks=[];picks.push(d);$('profile').innerHTML='<strong>'+d.name+' · '+d.alias+'</strong><br>'+d.desc+'<br><span>HP '+d.hp+' · Хурд '+d.speed+' · Цохилт '+d.damage+' · Зэвсэг '+d.weapon+'</span>';$('pick-title').textContent=picks.length===1?'02 · ӨРСӨЛДӨГЧӨӨ СОНГО':'ТУЛААНД БЭЛЭН';$('picked').textContent=picks.map(x=>x.name).join(' VS ');$('start').disabled=picks.length<2;$('start').textContent=picks.length<2?'ДАЙСНАА СОНГО →':'ТУЛААН ЭХЛҮҮЛЭХ →';document.querySelectorAll('.card').forEach(c=>{c.classList.toggle('p1',c.dataset.id===picks[0]?.id);c.classList.toggle('p2',c.dataset.id===picks[1]?.id);});}
 function resetPick(){picks=[];$('pick-title').textContent='01 · ТАНЫ ДҮР';$('picked').textContent='Дүрийн картаа дарж сонго';$('start').disabled=true;$('start').textContent='ДАЙСНАА СОНГО →';$('profile').textContent='Карт дээр дарж зэвсэг, special, үзүүлэлтийг хар.';document.querySelectorAll('.card').forEach(c=>c.classList.remove('p1','p2'));}
 function start(next=false){if(picks.length<2)return;if(!next){seriesIndex=0;series=[picks[1],...Versus.roster.filter(d=>!picks.some(p=>p.id===d.id)).sort(()=>Math.random()-.5).slice(0,2)];}battle=new Versus.Battle(picks[0],$('mode').value==='arcade'?series[seriesIndex]:picks[1],{mode:$('mode').value,difficulty:$('difficulty').value,arena:$('arena').value,sound:tone,series:seriesIndex});paused=false;doneShown=false;last=0;acc=0;$('select').hidden=true;$('play').hidden=false;$('overlay').hidden=true;$('move-info').textContent=picks[0].name+' · '+picks[0].desc;window.scrollTo(0,0);clearInput();}
 function clearInput(){if(battle){battle.inputs=[Versus.empty(),Versus.empty()];battle.fighters.forEach(f=>f.buffer=0);}document.querySelectorAll('#touch button').forEach(b=>b.classList.remove('active'));}
 function overlay(title,copy,kind='pause'){paused=true;clearInput();$('overlay').hidden=false;$('overlay-title').textContent=title;$('overlay-copy').textContent=copy;$('resume').hidden=kind==='finish';$('rematch').hidden=kind!=='finish';if(kind==='finish')$('rematch').textContent=$('mode').value==='arcade'&&battle.wins[0]>=2&&seriesIndex<2?'ДАРААГИЙН ӨРСӨЛДӨГЧ':'ДАХИН ТУЛАЛДАХ';}
 function hud(){battle.fighters.forEach((f,i)=>{const p='p'+(i+1);$(p+'-name').textContent=f.def.name;$(p+'-hp').style.width=Math.max(0,f.hp/f.def.hp*100)+'%';$(p+'-energy').style.width=f.en+'%';$(p+'-stats').textContent=Math.ceil(f.hp)+' / '+f.def.hp+' HP · '+Math.floor(f.en)+' EN · '+'●'.repeat(battle.wins[i])+'○'.repeat(Math.max(0,2-battle.wins[i]));});$('timer').textContent=Math.ceil(battle.roundClock);$('round').textContent='ROUND '+battle.round;$('announcer').textContent=battle.message;for(const button of document.querySelectorAll('#touch button')){const key=button.dataset.action,cost={shot:18,special:60,assist:35}[key]||0;button.disabled=!!battle.fighters[0].cd[key]||battle.fighters[0].en<cost;}}
 function frame(ts){if(!last)last=ts;const delta=Math.min(.1,(ts-last)/1000);last=ts;if(battle&&!paused){acc+=delta;while(acc>=1/60){battle.step(1/60);acc-=1/60;}hud();if(battle.phase==='finished'&&!doneShown){doneShown=true;const win=battle.wins[0]>=2&&battle.wins[0]>battle.wins[1];overlay(win?'ЯЛАЛТ!':battle.wins[0]===battle.wins[1]?'ТЭНЦЛЭЭ':'ДАХИН ОРОЛДООРОЙ',battle.fighters[win?0:1].def.name+' · '+battle.wins.join(' : ')+($('mode').value==='arcade'?' · Цуврал '+(seriesIndex+1)+'/3':''),'finish');}}draw();requestAnimationFrame(frame);}
 const mapping={a:[0,'left'],d:[0,'right'],s:[0,'guard'],j:[0,'attack'],k:[0,'jump'],l:[0,'dash'],u:[0,'shot'],i:[0,'special'],o:[0,'assist'],ArrowLeft:[1,'left'],ArrowRight:[1,'right'],ArrowDown:[1,'guard'],'1':[1,'attack'],'2':[1,'shot'],'3':[1,'jump'],'4':[1,'dash'],'5':[1,'special'],'6':[1,'assist']};
 document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.key==='Escape'&&!$('play').hidden){e.preventDefault();if(paused&&!doneShown){paused=false;$('overlay').hidden=true;}else if(!paused)overlay('ТҮР ЗОГСООЛОО','Тулаанаа үргэлжлүүлэх эсвэл дүр сонголт руу буц.');return;}const m=mapping[e.key.length===1?e.key.toLowerCase():e.key];if(!m||!battle||paused)return;e.preventDefault();if(e.repeat&&!['left','right','guard','attack'].includes(m[1]))return;if(m[0]===1&&battle.mode!=='local')return;battle.inputs[m[0]][m[1]]=true;});
 document.addEventListener('keyup',e=>{const m=mapping[e.key.length===1?e.key.toLowerCase():e.key];if(m&&battle)battle.inputs[m[0]][m[1]]=false;});
 document.querySelectorAll('#touch button').forEach(b=>{const held=new Set();b.addEventListener('pointerdown',e=>{if(!battle||paused)return;e.preventDefault();b.setPointerCapture(e.pointerId);held.add(e.pointerId);b.classList.add('active');battle.inputs[0][b.dataset.action]=true;});for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,e=>{held.delete(e.pointerId);if(held.size)return;b.classList.remove('active');if(battle)battle.inputs[0][b.dataset.action]=false;});});
 $('start').onclick=()=>start();$('reset-pick').onclick=resetPick;$('pause').onclick=()=>overlay('ТҮР ЗОГСООЛОО','Тулаанаа үргэлжлүүлэх эсвэл дүр сонголт руу буц.');$('resume').onclick=()=>{paused=false;$('overlay').hidden=true;clearInput();};$('rematch').onclick=()=>{if($('mode').value==='arcade'&&battle.wins[0]>=2&&battle.wins[0]>battle.wins[1]&&seriesIndex<2){seriesIndex++;start(true);}else start();};$('menu').onclick=()=>{battle=null;paused=false;clearInput();$('play').hidden=true;$('select').hidden=false;$('overlay').hidden=true;};$('help').onclick=()=>overlay('УДИРДЛАГА','A/D хөдөлгөөн · S guard · J combo · K jump · L dash · U shot (18) · I special (60) · O assist (35). Хамгаалалтыг эхний 0.18 секундэд тааруулахад parry. Газрын багана, аянга, солироос үсэрч эсвэл dash-аар зайл.');$('sound').onclick=()=>{soundOn=!soundOn;$('sound').textContent='ДУУ '+(soundOn?'ON':'OFF');$('sound').setAttribute('aria-pressed',String(soundOn));tone('parry');};
 window.addEventListener('blur',()=>{clearInput();if(battle&&!paused&&!doneShown)overlay('ТҮР ЗОГСООЛОО','Табын focus өөрчлөгдсөн тул тулаан түр зогслоо.');});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(battle&&!paused&&!doneShown)overlay('ТҮР ЗОГСООЛОО','Тулаанаа үргэлжлүүл.');}});
 cards();resetPick();requestAnimationFrame(frame);
})();
