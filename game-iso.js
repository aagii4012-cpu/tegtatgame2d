/* TEGTAT isometric arena engine. World movement/combat stay in ground-space;
   projection is only used for rendering. No third-party assets or libraries. */
function TegtatIso(B) {
  'use strict';
  const {ctx,game,input,settings,STAGES,ENEMY_DEFS,AudioFx,Voice,ui}=B;
  const W=1000,H=850;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const distance=(a,b)=>Math.hypot(a.wx-b.wx,a.wy-b.wy);
  const project=(x,y)=>({x:(x-y)*.7,y:(x+y)*.35});
  let stage=null, clock=0, waveWait=1, camera={x:0,y:0}, shots=[], marks=[], props=[];
  function screen(x,y) { const q=project(x,y);return {x:q.x-camera.x+480,y:q.y-camera.y+310}; }
  function sync(e) {const q=screen(e.wx,e.wy);e.x=q.x;e.y=q.y-(e.z||0);}
  function reset() {
    stage=game.stage;clock=0;waveWait=1;shots=[];marks=[];
    stage.lock=0;stage.waveIdx=0;stage.cleared=false;
    const p=game.player;
    p.wx=450;p.wy=430;p.z=0;p.zv=0;p.dir={x:1,y:0};p.inv=.8;
    p.animT=0;p.onGround=true;
    p.comboStep=0;p.comboUntil=0;p.attackBuffer=0;p.dodgeReward=false;
    camera=project(p.wx,p.wy);
    props=stage.def.key==='ger' ? [
      {wx:160,wy:150,r:65,type:'house'}, {wx:760,wy:140,r:60,type:'house'},
      {wx:160,wy:660,r:50,type:'ger'}, {wx:780,wy:650,r:50,type:'house'}
    ] : [
      {wx:150,wy:180,r:46,type:stage.def.key==='steppe'?'ger':'ovoo'},
      {wx:810,wy:680,r:42,type:stage.def.key==='steppe'?'ger':'ovoo'},
      {wx:820,wy:170,r:32,type:'tree'}, {wx:150,wy:680,r:32,type:'tree'}
    ];
    ui.goArrow.hidden=true;
    sync(p);
  }
  function move(e,dx,dy,dt) {
    e.wx=clamp(e.wx+dx*dt,45,W-45);e.wy=clamp(e.wy+dy*dt,45,H-45);
    for(const o of props) {
      const d=Math.hypot(e.wx-o.wx,e.wy-o.wy),r=o.r+(e.def?.mounted?35:18);
      if(d<r) { const nx=(e.wx-o.wx)/(d||1),ny=(e.wy-o.wy)/(d||1);e.wx=o.wx+nx*r;e.wy=o.wy+ny*r; }
    }
    e.vx=dx;e.vy=0;e.gaitDistance=(e.gaitDistance||0)+Math.hypot(dx,dy)*dt;
    if(Math.abs(dx-dy)>5)e.face=dx-dy>=0?1:-1;
    sync(e);
  }
  function spawn(type,i=0) {
    const e=B.makeEnemy(type,0);
    const corners=[[100,430],[900,430],[500,90],[500,760]];
    const at=corners[i%4];e.wx=at[0];e.wy=at[1];e.z=0;e.vx=0;
    e.state=e.def.boss?'intro':'chase';e.stateT=0;e.entered=true;e.onGround=true;
    e.scale=e.def.mounted?1.15:e.def.boss?1.05:.85;e.anim='idle';e.animT=0;e.think=1;
    sync(e);game.enemies.push(e);
    if(e.def.boss) {
      game.boss=e;game.bossShown=true;game.inputLock=true;
      B.showBanner(e.def.miniBoss?'MINI BOSS':'FINAL BOSS',e.def.name,e.def.mounted?'Морьт баатар · Уулын оргил':'Anhaa-ийн зэвсгийг ав!',3,true);
      AudioFx.music(null);AudioFx.play('warn');
      if(e.def.mounted){AudioFx.play('thunder');AudioFx.play('neigh');game.lightning=.6;}
    }
  }
  function effect(x,y,r,color='rgba(100,200,255,') {const q=screen(x,y);B.ring(q.x,q.y-12,r,color,.45,5);}
  function hit(e,dmg,opt={}) {
    sync(e);sync(game.player);
    const landed=B.damageEnemy(e,dmg*(e.state==='recover'?1.2:1),opt);
    if(landed&&!opt.skill)game.player.en=Math.min(game.player.maxEn,game.player.en+2);
    return landed;
  }
  function beginAttack(p,dir) {
    if(dir)p.dir=dir;
    else {
      const target=game.enemies.filter(e=>e.state!=='dead'&&distance(p,e)<140)
        .sort((a,b)=>distance(p,a)-distance(p,b))[0];
      if(target){const d=distance(p,target)||1;p.dir={x:(target.wx-p.wx)/d,y:(target.wy-p.wy)/d};}
    }
    if(game.t>p.comboUntil)p.comboStep=0;
    B.startAttack(p,p.comboStep%3);p.comboStep=(p.comboStep+1)%3;
    p.comboUntil=game.t+.9;p.isoHits=new Set();p.attackBuffer=0;
  }
  function dodgeReward() {
    const p=game.player;
    if(p.state!=='dash'||p.stateT>.16||p.dodgeReward)return;
    p.dodgeReward=true;p.en=Math.min(p.maxEn,p.en+8);p.counterT=1.4;
    B.floatText(p.x,p.y-p.h-30,'PERFECT DODGE','#9FD3FF',16);effect(p.wx,p.wy,55);
  }
  function direction() {
    const sx=(input.right?1:0)-(input.left?1:0);
    const sy=(input.k.down||input.t.down?1:0)-(input.k.up||input.t.up?1:0);
    const x=sx+sy*2,y=-sx+sy*2,n=Math.hypot(x,y);
    return n?{x:x/n,y:y/n}:null;
  }
  function player(dt) {
    const p=game.player;
    p.stateT+=dt;p.animT+=dt;p.inv=Math.max(0,p.inv-dt);p.flash=Math.max(0,p.flash-dt);
    p.counterT=Math.max(0,(p.counterT||0)-dt);p.parryFlash=Math.max(0,(p.parryFlash||0)-dt);
    p.boost=Math.max(0,(p.boost||0)-dt);
    for(const k in p.cd)p.cd[k]=Math.max(0,p.cd[k]-dt);
    if(p.state==='dead')return;
    p.en=Math.min(p.maxEn,p.en+2.4*dt);
    if(p.z>0||p.zv>0){p.zv-=1250*dt;p.z=Math.max(0,p.z+p.zv*dt);if(p.z===0)p.zv=0;}
    p.onGround=p.z===0;
    if(game.inputLock){move(p,0,0,dt);return;}
    const dir=direction();
    p.attackBuffer=Math.max(0,(p.attackBuffer||0)-dt);
    if(input.consume('attack'))p.attackBuffer=.22;
    // A paid dodge can cancel a normal swing after its active hit starts.
    if(p.state==='attack'&&p.stateT>=.1&&input.consume('dash')) {
      if(dir)p.dir=dir;
      if(B.trySkill(p,'dash')){p.attackBuffer=0;p.dodgeReward=false;}
    }
    if(dir && ['free','block'].includes(p.state))p.dir=dir;
    if(['free','block'].includes(p.state)) {
      for(const skill of ['ult','power','dash'])if(input.consume(skill)){
        if(B.trySkill(p,skill)){p.skillHit=false;p.dodgeReward=false;p.attackBuffer=0;}break;
      }
      if(['free','block'].includes(p.state)&&p.attackBuffer>0)beginAttack(p,dir);
      if(input.consume('jump')&&p.onGround){p.zv=460;AudioFx.play('jump');}
      if(input.blockHeld&&p.state==='free'){
        p.state='block';p.stateT=0;p.blockT=0;p.parryReady=game.t-(p.lastBlockAt??-9)>.45;p.lastBlockAt=game.t;
      }
    }
    if(p.state==='block'){p.blockT+=dt;if(!input.blockHeld){p.state='free';p.stateT=0;}}
    if(p.state==='attack') {
      p.anim='attack';p.k=p.stateT/(p.atkStep===2?.44:.3);
      if(p.stateT>.08&&p.stateT<.24)for(const e of game.enemies) {
        if(e.state==='dead'||p.isoHits.has(e)||distance(p,e)>110)continue;
        const dot=((e.wx-p.wx)*p.dir.x+(e.wy-p.wy)*p.dir.y)/(distance(p,e)||1);
        if(dot>.15){p.isoHits.add(e);hit(e,[12,13,24][p.atkStep]*(p.counterAttack?1.5:1),{heavy:p.atkStep===2||p.counterAttack});effect(e.wx,e.wy,28,'rgba(255,210,110,');}
      }
      if(p.k>=1){p.state='free';p.stateT=0;if(p.attackBuffer>0)beginAttack(p,dir);}
    } else if(p.state==='dash') {
      move(p,p.dir.x*620,p.dir.y*620,dt);p.anim='dash';p.inv=Math.max(p.inv,.1);
      if(settings.detail&&Math.random()<.3)effect(p.wx,p.wy,22);
      if(p.stateT>.25){p.state='free';p.stateT=0;}
    } else if(p.state==='power'||p.state==='ult') {
      const ult=p.state==='ult';p.anim=ult?'ult':'power';p.k=p.stateT/(ult?1.2:.6);
      if(!p.skillHit&&p.stateT>(ult?.42:.25)) {
        p.skillHit=true;AudioFx.play(ult?'thunder':'power');
        effect(p.wx,p.wy,ult?190:130,ult?'rgba(100,200,255,':'rgba(255,210,110,');
        for(const e of game.enemies)if(e.state!=='dead'&&distance(p,e)<(ult?530:165)) {
          if(hit(e,ult?(e.def.boss?150:105):46,{heavy:true,skill:true,ult})) {
            if(!ult){e.armorBreak=4;B.floatText(e.x,e.y-e.h,'ARMOR BREAK','#9FD3FF',14);}
            else marks.push({wx:e.wx,wy:e.wy,t:.35,max:.35,r:40,bolt:true});
          }
        }
      }
      if(p.k>=1){p.state='free';p.stateT=0;}
    } else if(p.state==='hurt') {
      p.anim='hurt';if(p.stateT>.34){p.state='free';p.stateT=0;}
    } else {
      p.anim=p.state==='block'?'block':dir?'run':'idle';
      move(p,dir?dir.x*(p.state==='block'?70:215):0,dir?dir.y*(p.state==='block'?70:215):0,dt);
    }
    sync(p);
  }
  function harm(e,dmg,unblockable=false) {
    const p=game.player;if(distance(e,p)>140||p.z>35)return;
    if(e.attackKind!=='charge'&&e.attackDir){
      const dot=((p.wx-e.wx)*e.attackDir.x+(p.wy-e.wy)*e.attackDir.y)/(distance(e,p)||1);
      if(dot<.35)return;
    }
    dodgeReward();
    sync(e);sync(p);
    // Keep directional guard consistent with isometric world-facing.
    const facing=((e.wx-p.wx)*p.dir.x+(e.wy-p.wy)*p.dir.y)>0;
    B.hurtPlayer(dmg,facing?p.x+p.face*30:p.x-p.face*30,{src:e,heavy:!!e.def.boss,unblockable});
  }
  function enemy(e,dt) {
    e.animT+=dt;e.stateT+=dt;e.flash=Math.max(0,e.flash-dt);e.inv=Math.max(0,e.inv-dt);e.armorBreak=Math.max(0,(e.armorBreak||0)-dt);
    if(e.state==='dead'){e.alpha=Math.max(0,1-e.stateT/1.3);e.anim='dead';if(e.stateT>1.5)e.removed=true;return;}
    const p=game.player,dx=p.wx-e.wx,dy=p.wy-e.wy,d=Math.hypot(dx,dy)||1;
    if(!['windup','strike','charge'].includes(e.state))e.face=dx-dy>0?1:-1;
    if(e.state==='intro') {
      e.anim=e.def.mounted?'roar':'idle';game.inputLock=true;
      if(e.def.mounted){game.darken=.45;if(e.stateT<.15)game.shake=10;}
      if(e.stateT>(e.def.mounted?3:1.8)){e.state='chase';e.stateT=0;game.inputLock=false;AudioFx.music('boss');}
      return;
    }
    if(['phase','stun','hurt'].includes(e.state)){e.anim='stun';if(e.stateT>1.2){e.state='chase';e.stateT=0;}return;}
    if(game.inputLock||p.state==='dead'){e.anim='idle';return;}
    if(e.state==='windup') {
      e.anim='windup';e.k=e.stateT/(e.def.boss?.8:.55);
      if(e.k>=1) {
        e.state=e.attackKind==='charge'?'charge':'strike';e.stateT=0;e.struck=false;
        AudioFx.play('blade');
        if(e.def.ranged)shots.push({wx:e.wx,wy:e.wy,dx:e.attackDir.x,dy:e.attackDir.y,t:3});
      }
    } else if(e.state==='charge') {
      e.anim='lunge';move(e,e.chargeDir.x*470,e.chargeDir.y*470,dt);
      if(!e.struck&&distance(e,p)<100){harm(e,e.def.dmg+2);e.struck=true;}
      e.hoofT=(e.hoofT||0)-dt;if(e.hoofT<=0){AudioFx.play('hoof',true);e.hoofT=.15;}
      if(e.stateT>.7){e.state='recover';e.stateT=0;}
    } else if(e.state==='strike') {
      e.anim='strike';e.k=Math.min(1,e.stateT/.35);
      if(!e.struck){e.struck=true;if(!e.def.ranged)harm(e,e.def.dmg);
        if(e.def.mounted&&e.phase>=2)marks.push({wx:p.wx,wy:p.wy,t:0,max:1.8,r:90,danger:true,done:false});
      }
      if(e.stateT>.35){e.state='recover';e.stateT=0;}
    } else if(e.state==='recover') {
      e.anim='idle';if(e.stateT>(e.def.boss?.9:.7)){e.state='chase';e.stateT=0;}
    } else {
      e.anim='walk';e.think-=dt;
      const range=e.def.ranged?300:100;
      if(d>range)move(e,dx/d*e.def.speed*.75,dy/d*e.def.speed*.75,dt);
      else if(e.think<=0&&canAttack(e)){
        e.state='windup';e.stateT=0;e.attackKind='slash';e.attackDir={x:dx/d,y:dy/d};e.think=.8;
      }
      if(e.def.mounted&&e.think<=0&&d>160&&canAttack(e)){
        e.attackKind='charge';e.chargeDir={x:dx/d,y:dy/d};e.attackDir=e.chargeDir;e.state='windup';e.stateT=0;e.think=2;
        if(Voice.say('tekaTaunt',game.t)&&Voice.bubble)Voice.bubble.speaker=e;
      }
      if(e.def.mounted&&Math.abs(e.vx)>30){e.hoofT=(e.hoofT||0)-dt;if(e.hoofT<=0){AudioFx.play('hoof');e.hoofT=.3;}}
    }
    sync(e);
  }
  function canAttack(e) {
    return game.enemies.filter(other=>other!==e&&['windup','strike','charge'].includes(other.state)).length<2;
  }
  function tick(dt) {
    if(stage!==game.stage)reset();
    game.t+=dt;clock+=dt;game.runTime+=game.inputLock?0:dt;
    const due=[];for(const timer of game.timers){timer.t-=dt;if(timer.t<=0)due.push(timer);}
    game.timers=game.timers.filter(t=>t.t>0);for(const timer of due)timer.fn();
    if(stage!==game.stage){reset();return;}
    game.shake=Math.max(0,game.shake-dt*30);game.lightning=Math.max(0,game.lightning-dt);
    game.flashWhite=Math.max(0,game.flashWhite-dt*2);game.hurtFlash=Math.max(0,game.hurtFlash-dt*2);
    game.fade+=( (game.fadeTo||0)-game.fade)*Math.min(1,dt*5);game.darken=Math.max(0,game.darken-dt*.8);
    if(Voice.bubble){Voice.bubble.t+=dt;if(Voice.bubble.t>Voice.bubble.dur)Voice.bubble=null;}
    if(game.combo>0){game.comboT-=dt;if(game.comboT<=0)game.combo=0;}
    if(game.hitstop>0){game.hitstop-=dt;B.updateParticles(dt);return;}
    player(dt);for(const e of game.enemies)enemy(e,dt);
    const alive=game.enemies.filter(e=>e.state!=='dead');
    for(let i=0;i<alive.length;i++)for(let j=i+1;j<alive.length;j++){
      const a=alive[i],b=alive[j],d=distance(a,b),min=a.def.mounted||b.def.mounted?65:35;
      if(d<min){const nx=(b.wx-a.wx)/(d||1),ny=d?(b.wy-a.wy)/d:1,push=(min-d)*.5;
        a.wx=clamp(a.wx-nx*push,45,W-45);a.wy=clamp(a.wy-ny*push,45,H-45);
        b.wx=clamp(b.wx+nx*push,45,W-45);b.wy=clamp(b.wy+ny*push,45,H-45);
      }
    }
    game.enemies=game.enemies.filter(e=>!e.removed);
    for(const s of shots){s.wx+=s.dx*340*dt;s.wy+=s.dy*340*dt;s.t-=dt;if(distance(s,game.player)<24&&game.player.z<35){
      dodgeReward();
      const q=screen(s.wx,s.wy);const result=B.hurtPlayer(9,q.x,{src:null});
      if(result==='parry')effect(s.wx,s.wy,45);s.t=0;
    }}shots=shots.filter(s=>s.t>0);
    for(const m of marks){if(m.danger){m.t+=dt;if(m.t>1.15&&!m.done){m.done=true;AudioFx.play('thunder');
      if(distance(m,game.player)<m.r&&game.player.z<35){dodgeReward();B.hurtPlayer(15,game.player.x,{unblockable:true});}effect(m.wx,m.wy,m.r);
    }}else m.t+=dt;}marks=marks.filter(m=>m.t<m.max);
    // Convert existing item drops back to ground-space, then allow radial pickup.
    for(const item of game.items){if(item.wx==null){const sx=item.x-480+camera.x,sy=item.y-310+camera.y+40;item.wx=sx/1.4+sy/.7;item.wy=sy/.7-sx/1.4;item.tt=0;}
      item.tt+=dt;if(distance(item,game.player)<45){const p=game.player;
        if(item.type==='hp')p.hp=Math.min(p.maxHp,p.hp+20);else if(item.type==='en')p.en=Math.min(p.maxEn,p.en+20);else if(item.type==='power')p.boost=8;else game.score+=50;
        AudioFx.play('pickup',item.type);item.tt=99;
      }}game.items=game.items.filter(i=>i.tt<14);
    B.updateParticles(dt);
    if(!stage.cleared){
      if(stage.def.boss&&!stage.bossTriggered&&clock>.7){stage.bossTriggered=true;spawn(stage.def.boss.type);}
      if(stage.def.waves&&!game.enemies.some(e=>e.state!=='dead')){
        waveWait-=dt;if(waveWait<=0){
          if(stage.waveIdx<stage.def.waves.length){stage.def.waves[stage.waveIdx].list.forEach(([type],i)=>spawn(type,i));stage.waveIdx++;waveWait=2;
            B.showBanner('WAVE '+stage.waveIdx,stage.def.title,'Дайснуудыг ял!',1.5);
          }else B.stageClear();
        }
      }
    }
    const cam=project(game.player.wx,game.player.wy);camera.x+=(cam.x-camera.x)*Math.min(1,dt*5);camera.y+=(cam.y-camera.y)*Math.min(1,dt*5);
    game.camX=0;sync(game.player);for(const e of game.enemies)sync(e);
  }
  function diamond(x,y,size,fill) {
    const p=screen(x,y);ctx.fillStyle=fill;ctx.beginPath();ctx.moveTo(p.x,p.y-size*.35);ctx.lineTo(p.x+size*.7,p.y);ctx.lineTo(p.x,p.y+size*.35);ctx.lineTo(p.x-size*.7,p.y);ctx.closePath();ctx.fill();
  }
  function prop(o) {
    const p=screen(o.wx,o.wy);ctx.save();ctx.translate(p.x,p.y);
    ctx.fillStyle='rgba(0,0,0,.23)';ctx.beginPath();ctx.ellipse(12,8,o.r*1.15,o.r*.42,0,0,Math.PI*2);ctx.fill();
    if(o.type==='ger') {
      ctx.fillStyle='#c9bd9f';ctx.beginPath();ctx.ellipse(0,-24,52,25,0,0,Math.PI*2);ctx.fill();ctx.fillRect(-52,-24,104,28);
      ctx.fillStyle='#ebe1c9';ctx.beginPath();ctx.moveTo(-53,-25);ctx.quadraticCurveTo(-28,-80,0,-85);ctx.quadraticCurveTo(30,-76,53,-25);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#89725c';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,-24,52,25,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#76513b';ctx.fillRect(-11,-28,22,35);
    } else if(o.type==='house') {
      ctx.fillStyle='#755751';ctx.beginPath();ctx.moveTo(-60,-65);ctx.lineTo(0,-42);ctx.lineTo(0,10);ctx.lineTo(-60,-15);ctx.closePath();ctx.fill();
      ctx.fillStyle='#4c555f';ctx.beginPath();ctx.moveTo(0,-42);ctx.lineTo(60,-65);ctx.lineTo(60,-15);ctx.lineTo(0,10);ctx.closePath();ctx.fill();
      ctx.fillStyle='#a07c66';ctx.beginPath();ctx.moveTo(-65,-65);ctx.lineTo(0,-100);ctx.lineTo(65,-65);ctx.lineTo(0,-40);ctx.closePath();ctx.fill();ctx.fillStyle='#edc77d';ctx.fillRect(20,-48,16,15);
    } else if(o.type==='tree') {
      ctx.fillStyle='#634c3e';ctx.fillRect(-5,-60,10,65);for(let i=0;i<3;i++){ctx.fillStyle=['#35584e','#426c59','#568168'][i];ctx.beginPath();ctx.moveTo(-36+i*7,-24-i*23);ctx.lineTo(0,-104-i*12);ctx.lineTo(36-i*7,-24-i*23);ctx.fill();}
    }else{ctx.fillStyle='#8c9197';ctx.beginPath();ctx.moveTo(-44,4);ctx.lineTo(0,-58);ctx.lineTo(44,4);ctx.fill();ctx.strokeStyle='#6caee2';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,-65);ctx.quadraticCurveTo(35,-75,45,-55+Math.sin(game.t*3)*6);ctx.stroke();}
    ctx.restore();
  }
  function render(K) {
    const shake=settings.shake?game.shake:0;
    ctx.setTransform(K,0,0,K,(Math.random()-.5)*shake*K,(Math.random()-.5)*shake*K);ctx.globalAlpha=1;
    const key=game.stage.def.key,ground=key==='steppe'?'#727e57':key==='ger'?'#6d6260':'#485563';
    ctx.fillStyle=key==='mountain'?'#101d2b':'#263744';ctx.fillRect(0,0,960,540);
    for(let y=0;y<=H;y+=70)for(let x=0;x<=W;x+=70){const q=screen(x,y);if(q.x<-80||q.x>1040||q.y<-80||q.y>620)continue;diamond(x,y,70,(Math.floor(x/70)+Math.floor(y/70))%2?ground:key==='steppe'?'#78835a':key==='ger'?'#766967':'#515d6a');}
    ctx.strokeStyle='rgba(214,224,235,.3)';ctx.lineWidth=3;ctx.beginPath();[[0,0],[W,0],[W,H],[0,H],[0,0]].forEach(([x,y],i)=>{const q=screen(x,y);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();
    for(const m of marks){const q=screen(m.wx,m.wy);ctx.strokeStyle=m.danger?'#ff7c6f':'#8ad6ff';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(q.x,q.y,m.r*.9,m.r*.45,0,0,Math.PI*2);ctx.stroke();
      if(m.danger){ctx.fillStyle='rgba(255,90,75,.18)';ctx.beginPath();ctx.ellipse(q.x,q.y,m.r*.9*Math.min(1,m.t/1.15),m.r*.45*Math.min(1,m.t/1.15),0,0,Math.PI*2);ctx.fill();}
      if(m.bolt){ctx.strokeStyle='#d3f5ff';ctx.beginPath();ctx.moveTo(q.x-20,-20);ctx.lineTo(q.x+15,q.y-100);ctx.lineTo(q.x-12,q.y-55);ctx.lineTo(q.x,q.y);ctx.stroke();}}
    for(const e of game.enemies)if(e.state==='windup'&&e.attackDir){
      const d=e.attackDir,length=e.attackKind==='charge'?330:e.def.ranged?300:140;
      const width=e.attackKind==='charge'?42:70;
      const points=[[e.wx-d.y*width,e.wy+d.x*width],[e.wx+d.x*length-d.y*width,e.wy+d.y*length+d.x*width],
        [e.wx+d.x*length+d.y*width,e.wy+d.y*length-d.x*width],[e.wx+d.y*width,e.wy-d.x*width]];
      ctx.fillStyle='rgba(255,100,80,.22)';ctx.strokeStyle='#ff927e';ctx.lineWidth=2;ctx.beginPath();
      points.forEach(([x,y],i)=>{const q=screen(x,y);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.fill();ctx.stroke();
    }
    const ordered=[...props.map(o=>({depth:o.wx+o.wy,draw:()=>prop(o)})),...game.enemies.map(e=>({depth:e.wx+e.wy,draw:()=>entity(e)})),{depth:game.player.wx+game.player.wy,draw:()=>entity(game.player)}];
    ordered.sort((a,b)=>a.depth-b.depth).forEach(o=>o.draw());
    for(const s of shots){const q=screen(s.wx,s.wy);ctx.strokeStyle='#e7d4ae';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(q.x,q.y-35);ctx.lineTo(q.x-s.dx*15,q.y-35-s.dy*8);ctx.stroke();}
    for(const item of game.items){const q=screen(item.wx,item.wy);ctx.fillStyle=item.type==='hp'?'#f7828f':'#8ad6ff';ctx.beginPath();ctx.arc(q.x,q.y-12,6,0,Math.PI*2);ctx.fill();}
    B.drawParticles(0);B.drawTexts(0);B.drawBubble(Voice.bubble?.speaker||game.player,0);
    if(game.darken>0){ctx.fillStyle=`rgba(4,12,28,${game.darken*.5})`;ctx.fillRect(0,0,960,540);}
    if(game.lightning>0||game.flashWhite>0){ctx.fillStyle=`rgba(170,218,255,${Math.max(game.lightning*.3,game.flashWhite*.3)})`;ctx.fillRect(0,0,960,540);}
    if(game.fade>0){ctx.fillStyle=`rgba(5,10,18,${game.fade})`;ctx.fillRect(0,0,960,540);}
  }
  function entity(e) {
    sync(e);if(e.removed)return;
    const ground=screen(e.wx,e.wy);
    ctx.save();ctx.globalAlpha=e.alpha??1;ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(ground.x,ground.y,e.def?.mounted?55:23,e.def?.mounted?16:8,0,0,Math.PI*2);ctx.fill();
    if(e.def?.mounted){B.drawWarhorse(e,0);B.drawFigure(Object.assign({},e,{y:e.y-45,scale:.92}),0);}
    else B.drawFigure(e,0);
    if(e.kind==='player'){B.drawSkillAura(e,0);B.drawSlash(e,0);B.drawGuard(e,0);}
    else if(!e.def.boss&&e.state!=='dead'){
      ctx.fillStyle='#243342';ctx.fillRect(e.x-23,e.y-105,46,4);ctx.fillStyle='#e87970';ctx.fillRect(e.x-23,e.y-105,46*Math.max(0,e.hp/e.maxHp),4);
    }ctx.restore();
  }
  return {tick,render,get active(){return stage===game.stage&&!!stage;},project,distance};
}
if(typeof module!=='undefined')module.exports=TegtatIso;
