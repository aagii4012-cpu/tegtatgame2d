/* TEGTAT isometric arena engine. World movement/combat stay in ground-space;
   projection is only used for rendering. No third-party assets or libraries. */
function TegtatIso(B) {
  'use strict';
  const {ctx,game,input,settings,STAGES,ENEMY_DEFS,AudioFx,Voice,ui}=B;
  let W=1600,H=1250;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const distance=(a,b)=>Math.hypot(a.wx-b.wx,a.wy-b.wy);
  // A flatter 2.5D projection keeps ground depth while making fighters easier to read.
  const PX=.82,PY=.25;
  const project=(x,y)=>({x:(x-y)*PX,y:(x+y)*PY});
  const roles={
    tuvshuu:{windup:.44,recover:.55,reach:105,label:'ХУРДАН ЦОХИЛТ'},
    ganaa:{windup:.65,recover:.85,reach:135,label:'БОРООХОЙ'},
    erhmee:{windup:1,recover:1.15,reach:145,label:'ГАЗАР ЦОХИЛТ'},
    teka:{windup:.7,recover:.65,reach:320,label:'ХАРВАА'},
    anhaa:{windup:.9,recover:1.1,reach:175,label:'ЖАДНЫ ДАЛАЙЛТ'},
    tekaBoss:{windup:1,recover:1.1,reach:175,label:'МОРЬТ ДАЙРАЛТ'}
  };
  const role=e=>roles[e.type]||{windup:.55,recover:.7,reach:110,label:'ДАЙРАЛТ'};
  let stage=null, clock=0, waveWait=1, camera={x:0,y:0}, shots=[], marks=[], props=[],vfx=[],terrain=null,terrainDetail=null;
  function screen(x,y) { const q=project(x,y);return {x:q.x-camera.x+480,y:q.y-camera.y+320}; }
  function sync(e) {const q=screen(e.wx,e.wy);e.x=q.x;e.y=q.y-(e.z||0);}
  function reset() {
    stage=game.stage;clock=0;waveWait=1;shots=[];marks=[];vfx=[];
    W=stage.def.id===4?2000:1600;H=stage.def.id===4?1550:1250;
    stage.lock=0;stage.waveIdx=0;stage.cleared=false;stage.goHint=0;stage.waveActive=false;
    const p=game.player;
    p.wx=450;p.wy=430;p.z=0;p.zv=0;p.dir={x:1,y:0};p.inv=.8;p.scale=1.08;
    p.animT=0;p.onGround=true;
    p.comboStep=0;p.comboUntil=0;p.attackBuffer=0;p.dodgeReward=false;p.skillHits=new Set();p.skillTarget=null;
    camera=project(p.wx,p.wy);
    props=stage.def.key==='ger' ? [
      {wx:160,wy:150,r:65,type:'house'}, {wx:760,wy:140,r:60,type:'house'},
      {wx:160,wy:660,r:50,type:'ger'}, {wx:780,wy:650,r:50,type:'house'}
    ] : [
      {wx:150,wy:180,r:46,type:stage.def.key==='steppe'?'ger':'ovoo'},
      {wx:810,wy:680,r:42,type:stage.def.key==='steppe'?'ger':'ovoo'},
      {wx:820,wy:170,r:32,type:'tree'}, {wx:150,wy:680,r:32,type:'tree'}
    ];
    const mountain=stage.def.key==='mountain',town=stage.def.key==='ger';
    props.push(...[
      {wx:1150,wy:210,r:town?60:32,type:town?'house':'tree'},
      {wx:1330,wy:580,r:town?50:42,type:town?'ger':mountain?'ovoo':'ger'},
      {wx:520,wy:1030,r:town?60:32,type:town?'house':'tree'},
      {wx:1120,wy:1010,r:42,type:mountain?'ovoo':'ger'},
      {wx:1420,wy:1050,r:32,type:'tree'},
      {wx:250,wy:1030,r:32,type:'tree'}
    ]);
    if(stage.def.id===4)props.push({wx:1750,wy:1260,r:65,type:'ovoo'},{wx:1600,wy:250,r:32,type:'tree'},{wx:350,wy:1370,r:32,type:'tree'});
    props.push({wx:980,wy:220,r:26,type:'rock'},{wx:850,wy:1080,r:30,type:'rock'});
    // Exploration supplies persist until collected instead of expiring as combat drops.
    for(const [wx,wy,type] of [[1100,440,'hp'],[730,970,'en'],[W-170,H-160,'score']])
      game.items.push({wx,wy,type,tt:0,placed:true});
    ui.goArrow.hidden=true;
    terrain=null;
    sync(p);
  }
  function move(e,dx,dy,dt) {
    e.wx=clamp(e.wx+dx*dt,45,W-45);e.wy=clamp(e.wy+dy*dt,45,H-45);
    for(const o of props) {
      const d=Math.hypot(e.wx-o.wx,e.wy-o.wy),r=o.r+(e.def?.mounted?35:18);
      if(d<r) { const nx=d?(e.wx-o.wx)/d:1,ny=d?(e.wy-o.wy)/d:0;e.wx=o.wx+nx*r;e.wy=o.wy+ny*r; }
    }
    e.vx=dx;e.vy=0;e.gaitDistance=(e.gaitDistance||0)+Math.hypot(dx,dy)*dt;
    e.worldVx=dx;e.worldVy=dy;
    if(Math.abs(dx-dy)>5)e.face=dx-dy>=0?1:-1;
    sync(e);
  }
  function steer(e,dx,dy,speed,dt){
    let n=Math.hypot(dx,dy)||1,nx=dx/n,ny=dy/n;
    for(const o of props){
      const ox=o.wx-e.wx,oy=o.wy-e.wy,ahead=ox*nx+oy*ny,side=ox*(-ny)+oy*nx,r=o.r+(e.def.mounted?45:28);
      if(ahead>0&&ahead<Math.min(n,150)&&Math.abs(side)<r){
        const turn=Math.abs(side)>8?(side>0?-1:1):(e.lane%2?1:-1);
        dx=ox-ny*turn*(r+25);dy=oy+nx*turn*(r+25);n=Math.hypot(dx,dy)||1;break;
      }
    }
    move(e,dx/n*speed,dy/n*speed,dt);
  }
  function spawn(type,i=0) {
    const e=B.makeEnemy(type,0);
    const p=game.player;
    const corners=[[p.wx-350,p.wy],[p.wx+350,p.wy],[p.wx,p.wy-340],[p.wx,p.wy+340]];
    const at=corners[i%4];e.wx=clamp(at[0],65,W-65);e.wy=clamp(at[1],65,H-65);e.z=0;e.vx=0;
    e.state=e.def.boss?'intro':'chase';e.stateT=0;e.entered=true;e.onGround=true;e.lane=i;
    e.scale=e.def.mounted?1.18:e.def.boss?1.1:(e.def.scale||1)*.95;e.anim='idle';e.animT=0;e.think=1;
    move(e,0,0,0);
    sync(e);game.enemies.push(e);
    if(e.def.boss) {
      game.boss=e;game.bossShown=true;game.inputLock=true;
      B.showBanner(e.def.miniBoss?'MINI BOSS':'FINAL BOSS',e.def.name,e.def.mounted?'Морьт баатар · Уулын оргил':'Anhaa-ийн зэвсгийг ав!',3,true);
      AudioFx.music(null);AudioFx.play('warn');
      if(e.def.mounted){AudioFx.play('thunder');AudioFx.play('neigh');game.lightning=.6;}
    }
  }
  function effect(x,y,r,color='rgba(100,200,255,') {const q=screen(x,y);B.ring(q.x,q.y-12,r,color,.45,5);}
  function burst(x,y,r,type){vfx.push({wx:x,wy:y,r,type,t:0,max:type==='storm'?1:.65});}
  function locateItem(item){
    if(item.wx!=null)return;
    const sx=item.x-480+camera.x,sy=item.y-320+camera.y+40;
    item.wx=(sx/PX+sy/PY)/2;item.wy=(sy/PY-sx/PX)/2;item.tt=0;
  }
  function hit(e,dmg,opt={}) {
    sync(e);sync(game.player);
    const landed=B.damageEnemy(e,dmg*(e.state==='recover'?1.2:1),{...opt,energyGain:opt.skill?0:2});
    if(landed){
      const p=game.player,d=distance(p,e)||1,force=(opt.heavy?260:110)*(e.def.kbMul??1);
      e.push={x:(e.wx-p.wx)/d*force,y:(e.wy-p.wy)/d*force,t:.16};
    }
    return landed;
  }
  function swingShape(p){return {range:p.atkStep===2?135:110,cos:p.atkStep===2?.05:.25};}
  function beginAttack(p,dir) {
    if(dir)p.dir=dir;
    else {
      const target=game.enemies.filter(e=>e.state!=='dead'&&distance(p,e)<140)
        .sort((a,b)=>distance(p,a)-distance(p,b))[0];
      if(target){const d=distance(p,target)||1;p.dir={x:(target.wx-p.wx)/d,y:(target.wy-p.wy)/d};}
    }
    if(game.t>p.comboUntil)p.comboStep=0;
    B.startAttack(p,p.comboStep%3);p.comboStep=(p.comboStep+1)%3;
    p.face=p.dir.x-p.dir.y>=0?1:-1;
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
  function aimedDirection(p,fallback=null) {
    const aim=input.aim;
    let sx=0,sy=0,active=false;
    if(aim?.touch&&aim.until>=game.t){sx=aim.vx;sy=aim.vy;active=true;}
    else if(aim?.mouse){const q=screen(p.wx,p.wy);sx=aim.x-q.x;sy=aim.y-q.y;active=Math.hypot(sx,sy)>18;}
    if(!active)return fallback||p.dir;
    const wx=(sx/PX+sy/PY)/2,wy=(sy/PY-sx/PX)/2,n=Math.hypot(wx,wy)||1;
    return {x:wx/n,y:wy/n};
  }
  function prepareSkill(p,skill){
    p.skillHit=false;p.skillHits=new Set();p.dodgeReward=false;p.attackBuffer=0;
    p.face=p.dir.x-p.dir.y>=0?1:-1;
    if(skill==='ult')p.skillTarget={wx:clamp(p.wx+p.dir.x*240,60,W-60),wy:clamp(p.wy+p.dir.y*240,60,H-60)};
  }
  function player(dt) {
    const p=game.player;
    p.worldVx=p.worldVy=0;
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
    if(input.attackHeld&&['free','attack'].includes(p.state))p.attackBuffer=.22;
    // A paid dodge can cancel a normal swing after its active hit starts.
    if(p.state==='attack'&&p.stateT>=.1&&input.consume('dash')) {
      if(dir)p.dir=dir;
      if(B.trySkill(p,'dash'))prepareSkill(p,'dash');
    }
    if(dir && ['free','block'].includes(p.state))p.dir=dir;
    if(['free','block'].includes(p.state)) {
      for(const skill of ['ult','power','dash'])if(input.consume(skill)){
        if(skill==='ult'||skill==='power')p.dir=aimedDirection(p,dir);
        if(B.trySkill(p,skill))prepareSkill(p,skill);break;
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
      const shape=swingShape(p);
      if(p.stateT>.08&&p.stateT<.24)for(const e of game.enemies) {
        if(e.state==='dead'||p.isoHits.has(e)||distance(p,e)>shape.range)continue;
        const dot=((e.wx-p.wx)*p.dir.x+(e.wy-p.wy)*p.dir.y)/(distance(p,e)||1);
        if(dot>shape.cos){p.isoHits.add(e);hit(e,[12,13,24][p.atkStep]*(p.counterAttack?1.5:1),{heavy:p.atkStep===2||p.counterAttack});effect(e.wx,e.wy,28,'rgba(255,210,110,');}
      }
      if(p.k>=1){p.state='free';p.stateT=0;if(p.attackBuffer>0)beginAttack(p,dir);}
    } else if(p.state==='dash') {
      move(p,p.dir.x*620,p.dir.y*620,dt);p.anim='dash';p.inv=Math.max(p.inv,.1);
      p.skillHits??=new Set();
      for(const e of game.enemies)if(e.state!=='dead'&&distance(p,e)<85&&!p.skillHits.has(e)){
        p.skillHits.add(e);hit(e,22,{skill:true});effect(e.wx,e.wy,35,'rgba(110,225,255,');
      }
      p.trailT=(p.trailT||0)-dt;
      if(settings.detail&&p.trailT<=0){vfx.push({wx:p.wx,wy:p.wy,type:'ghost',t:0,max:.25,face:p.face,style:p.style,scale:p.scale||1});p.trailT=.045;}
      if(settings.detail&&Math.random()<.3)effect(p.wx,p.wy,22);
      if(p.stateT>.25){p.state='free';p.stateT=0;}
    } else if(p.state==='power'||p.state==='ult') {
      const ult=p.state==='ult';p.anim=ult?'ult':'power';p.k=p.stateT/(ult?1:.65);
      if(!ult&&p.stateT>.16&&p.stateT<.32)move(p,p.dir.x*420,p.dir.y*420,dt);
      if(!p.skillHit&&p.stateT>(ult?.42:.25)) {
        p.skillHit=true;AudioFx.play(ult?'thunder':'power');
        if(ult){
          const target=p.skillTarget||p;
          marks.push({wx:target.wx,wy:target.wy,t:0,max:2.1,r:220,heroStorm:true,pulses:0});
          burst(target.wx,target.wy,220,'storm');
        }else{
          burst(p.wx+p.dir.x*140,p.wy+p.dir.y*140,100,'shock');
          for(const e of game.enemies){const d=distance(p,e),dot=((e.wx-p.wx)*p.dir.x+(e.wy-p.wy)*p.dir.y)/(d||1);
            if(e.state!=='dead'&&d<360&&dot>.82&&hit(e,58,{heavy:true,skill:true})){
              e.armorBreak=4;B.floatText(e.x,e.y-e.h,'ARMOR BREAK','#9FD3FF',14);effect(e.wx,e.wy,50,'rgba(255,210,110,');
            }
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
    const p=game.player;if(distance(e,p)>role(e).reach||p.z>35)return;
    if(e.attackKind!=='charge'&&e.attackDir){
      const dot=((p.wx-e.wx)*e.attackDir.x+(p.wy-e.wy)*e.attackDir.y)/(distance(e,p)||1);
      if(dot<(e.type==='anhaa'?.05:.35))return;
    }
    dodgeReward();
    sync(e);sync(p);
    // Keep directional guard consistent with isometric world-facing.
    const facing=((e.wx-p.wx)*p.dir.x+(e.wy-p.wy)*p.dir.y)>0;
    const result=B.hurtPlayer(dmg,facing?p.x+p.face*30:p.x-p.face*30,{src:e,heavy:!!(e.def.boss||e.def.armor||e.type==='ganaa'),unblockable});
    if(result===true&&p.state!=='dead'){
      const d=distance(e,p)||1;move(p,(p.wx-e.wx)/d*180,(p.wy-e.wy)/d*180,.14);
    }
  }
  function directionalHurt(dmg,wx,wy,opt){
    const p=game.player;
    const facing=(wx-p.wx)*p.dir.x+(wy-p.wy)*p.dir.y>=0;
    return B.hurtPlayer(dmg,p.x+p.face*(facing?30:-30),opt);
  }
  function bossAttack(e,p,d,dx,dy){
    const phase=e.phase||1,sequence=e.attackCycle||0;
    e.attackCycle=sequence+1;
    e.attackKind=d>330?(sequence%2?'storm':'charge'):sequence%3===1?'sweep':sequence%3===2?'storm':'charge';
    e.attackDir={x:dx/d,y:dy/d};e.chargeDir=e.attackDir;
    e.windup=e.attackKind==='charge'?.85:e.attackKind==='sweep'?.72:.95;
    e.chargeSpeed=600+phase*35;e.chargeTime=clamp((d+180)/e.chargeSpeed,.65,1.35);
    e.state='windup';e.stateT=0;e.think=.6;
    e.recoverTime=e.attackKind==='charge'?.65:e.attackKind==='sweep'?.8:.9;
    if(Voice.say('tekaTaunt',game.t)&&Voice.bubble)Voice.bubble.speaker=e;
    B.floatText(e.x,e.y-e.h-30,e.attackKind==='charge'?'МОРЬТ ДАЙРАЛТ':e.attackKind==='sweep'?'СЭЛМИЙН ТОЙРОГ':'АЯНГЫН АН', '#ffba92',14);
  }
  function bossStorm(e,p){
    const phase=e.phase||1,n=phase>=3?5:phase>=2?3:2;
    const vx=p.worldVx||0,vy=p.worldVy||0;
    for(let i=0;i<n;i++){
      const a=i*2.399,offset=i>1?150:0;
      marks.push({wx:clamp(p.wx+vx*(i===1?.55:0)+Math.cos(a)*offset,60,W-60),wy:clamp(p.wy+vy*(i===1?.55:0)+Math.sin(a)*offset,60,H-60),t:0,max:1.9+i*.13,r:80,danger:true,done:false,delay:.8+i*.13,dmg:18});
    }
    if(phase>=2)for(const angle of [-.3,0,.3]){
      const a=Math.atan2(e.attackDir.y,e.attackDir.x)+angle;
      shots.push({wx:e.wx,wy:e.wy,dx:Math.cos(a),dy:Math.sin(a),t:3,dmg:13,src:e,speed:400,storm:true});
    }
  }
  function enemy(e,dt) {
    e.vx=0;
    e.animT+=dt;e.stateT+=dt;e.flash=Math.max(0,e.flash-dt);e.inv=Math.max(0,e.inv-dt);e.armorBreak=Math.max(0,(e.armorBreak||0)-dt);
    if(e.state==='dead'){e.alpha=Math.max(0,1-e.stateT/1.3);e.anim='dead';if(e.stateT>1.5)e.removed=true;return;}
    if(e.push?.t>0){const t=Math.min(dt,e.push.t);move(e,e.push.x,e.push.y,t);e.push.t-=t;}
    const p=game.player,dx=p.wx-e.wx,dy=p.wy-e.wy,d=Math.hypot(dx,dy)||1;
    if(!['windup','strike','charge'].includes(e.state))e.face=dx-dy>0?1:-1;
    if(e.state==='intro') {
      e.anim=e.def.mounted?'roar':'idle';game.inputLock=true;
      if(e.def.mounted){game.darken=.45;if(e.stateT<.15)game.shake=10;}
      if(e.stateT>(e.def.mounted?3:1.8)){e.state='chase';e.stateT=0;game.inputLock=false;AudioFx.music('boss');}
      return;
    }
    if(['phase','stun','hurt'].includes(e.state)){
      const duration=e.state==='phase'?1.6:e.state==='stun'?(e.stunDur||.85):(e.hurtDur||.28);
      e.anim=e.state==='phase'?'roar':'stun';
      if(e.state==='phase'&&e.isoPhase!==e.phase){e.isoPhase=e.phase;shots=[];marks=marks.filter(m=>!m.danger);burst(e.wx,e.wy,180,'storm');}
      if(e.stateT>duration){e.state='chase';e.stateT=0;}return;
    }
    if(game.inputLock||p.state==='dead'){e.anim='idle';return;}
    if(e.state==='windup') {
      e.anim='windup';e.k=e.stateT/(e.def.mounted?e.windup||.85:role(e).windup);
      // Track during the first part of the warning, then commit visibly before impact.
      if(e.def.mounted&&e.attackKind==='charge'&&e.stateT<(e.windup||.85)-.25){
        const tx=dx+(p.worldVx||0)*.28,ty=dy+(p.worldVy||0)*.28,n=Math.hypot(tx,ty)||1;
        e.attackDir={x:tx/n,y:ty/n};e.chargeDir=e.attackDir;
      }
      if(e.type==='ganaa'&&e.stateT<.18)move(e,e.attackDir.x*110,e.attackDir.y*110,dt);
      if(e.k>=1) {
        e.state=e.attackKind==='charge'?'charge':'strike';e.stateT=0;e.struck=false;
        AudioFx.play(e.def.boss?'blade':'swing',e.type==='ganaa'||e.type==='erhmee');
        if(e.def.ranged){AudioFx.play('shoot');shots.push({wx:e.wx,wy:e.wy,dx:e.attackDir.x,dy:e.attackDir.y,t:3,dmg:e.def.dmg,src:e});}
      }
    } else if(e.state==='charge') {
      e.anim='lunge';move(e,e.chargeDir.x*(e.chargeSpeed||635),e.chargeDir.y*(e.chargeSpeed||635),dt);
      if(!e.struck&&distance(e,p)<100){harm(e,e.def.dmg+2);e.struck=true;}
      e.hoofT=(e.hoofT||0)-dt;if(e.hoofT<=0){AudioFx.play('hoof',true);e.hoofT=.15;}
      if(e.stateT>(e.chargeTime||.9)){e.state='recover';e.stateT=0;}
    } else if(e.state==='strike') {
      e.anim='strike';e.k=Math.min(1,e.stateT/.35);
      if(!e.struck){e.struck=true;if(e.def.mounted&&e.attackKind==='storm')bossStorm(e,p);
      else if(e.def.mounted&&e.attackKind==='sweep'){
        burst(e.wx,e.wy,220,'shock');
        if(d<220&&p.z<35){dodgeReward();directionalHurt(e.def.dmg+3,e.wx,e.wy,{src:e,heavy:true});}
      }else if(!e.def.ranged){
        if(e.type==='erhmee'){
          const target={wx:e.wx+e.attackDir.x*55,wy:e.wy+e.attackDir.y*55};
          burst(target.wx,target.wy,90,'shock');AudioFx.play('power');
          if(distance(target,p)<90)harm(e,e.def.dmg);
        }else harm(e,e.def.dmg);
      }
      }
      if(e.stateT>.35){e.state='recover';e.stateT=0;}
    } else if(e.state==='recover') {
      e.anim='idle';if(e.stateT>(e.def.mounted?e.recoverTime||.8:role(e).recover)){e.state='chase';e.stateT=0;}
    } else {
      e.anim='walk';e.think-=dt;
      const range=e.def.ranged?role(e).reach:Math.min(120,role(e).reach-15);
      const speed=e.def.mounted?345+25*((e.phase||1)-1):e.def.speed;
      if(e.def.ranged&&d<190)steer(e,-dx,-dy,speed*.9,dt);
      else if(d>range){
        // Each melee enemy approaches a different side of the arena player.
        const angle=(e.lane||0)*Math.PI/2+.4;
        const flank=!e.def.ranged&&!e.def.boss&&d<260;
        const tx=dx+(flank?Math.cos(angle)*78:0),ty=dy+(flank?Math.sin(angle)*78:0),n=Math.hypot(tx,ty)||1;
        steer(e,tx,ty,speed*.75,dt);
      }
      else if(e.think<=0&&canAttack(e)){
        if(e.def.mounted)bossAttack(e,p,d,dx,dy);
        else {e.state='windup';e.stateT=0;e.attackKind='slash';e.attackDir={x:dx/d,y:dy/d};e.think=.8;}
      }
      else if(e.def.ranged&&d>=190){
        const side=(e.lane||0)%2?1:-1;move(e,-dy/d*e.def.speed*.45*side,dx/d*e.def.speed*.45*side,dt);
      }
      if(e.def.mounted&&e.state==='chase'&&e.think<=0&&d>160&&canAttack(e))bossAttack(e,p,d,dx,dy);
      if(e.def.mounted&&Math.abs(e.vx)>30){e.hoofT=(e.hoofT||0)-dt;if(e.hoofT<=0){AudioFx.play('hoof');e.hoofT=.3;}}
    }
    sync(e);
  }
  function canAttack(e) {
    return game.enemies.filter(other=>other!==e&&['windup','strike','charge'].includes(other.state)).length<2;
  }
  function tick(dt) {
    if(stage!==game.stage)reset();
    game.t+=dt;clock+=dt;game.runTime+=game.inputLock||game.player.state==='dead'||stage.cleared?0:dt;
    const due=[];for(const timer of game.timers){timer.t-=dt;if(timer.t<=0)due.push(timer);}
    game.timers=game.timers.filter(t=>t.t>0);for(const timer of due)timer.fn();
    if(game.mode!=='play')return;
    if(stage!==game.stage){reset();return;}
    game.shake=Math.max(0,game.shake-dt*30);game.lightning=Math.max(0,game.lightning-dt);
    game.flashWhite=Math.max(0,game.flashWhite-dt*2);game.hurtFlash=Math.max(0,game.hurtFlash-dt*2);
    game.fade+=( (game.fadeTo||0)-game.fade)*Math.min(1,dt*5);game.darken=Math.max(0,game.darken-dt*.8);
    if(Voice.bubble){Voice.bubble.t+=dt;if(Voice.bubble.t>Voice.bubble.dur)Voice.bubble=null;}
    if(game.combo>0){game.comboT-=dt;if(game.comboT<=0)game.combo=0;}
    if(game.hitstop>0){game.hitstop-=dt;B.updateParticles(dt);return;}
    player(dt);for(const e of game.enemies)enemy(e,dt);
    if(game.boss?.state==='dead'||game.player.state==='dead'||stage.cleared){shots=[];marks=marks.filter(m=>!m.danger);}
    const alive=game.enemies.filter(e=>e.state!=='dead');
    for(let i=0;i<alive.length;i++)for(let j=i+1;j<alive.length;j++){
      const a=alive[i],b=alive[j],d=distance(a,b),min=a.def.mounted||b.def.mounted?65:35;
      if(d<min){const nx=(b.wx-a.wx)/(d||1),ny=d?(b.wy-a.wy)/d:1,push=(min-d)*.5;
        a.wx=clamp(a.wx-nx*push,45,W-45);a.wy=clamp(a.wy-ny*push,45,H-45);
        b.wx=clamp(b.wx+nx*push,45,W-45);b.wy=clamp(b.wy+ny*push,45,H-45);
      }
    }
    game.enemies=game.enemies.filter(e=>!e.removed);
    for(const s of shots){s.wx+=s.dx*(s.speed||340)*dt;s.wy+=s.dy*(s.speed||340)*dt;s.t-=dt;
      if(props.some(o=>distance(s,o)<o.r)){s.t=0;effect(s.wx,s.wy,18);continue;}
      if(distance(s,game.player)<24&&game.player.z<35){
      dodgeReward();
      const result=directionalHurt(s.dmg||9,game.player.wx-s.dx*40,game.player.wy-s.dy*40,{src:s.src});
      if(result==='parry')effect(s.wx,s.wy,45);s.t=0;
    }}shots=shots.filter(s=>s.t>0);
    for(const m of marks){m.t+=dt;if(m.heroStorm){
      if(m.pulses<3&&m.t>=.15+m.pulses*.6){m.pulses++;AudioFx.play('thunder');burst(m.wx,m.wy,m.r,'storm');
        for(const e of game.enemies)if(e.state!=='dead'&&distance(m,e)<m.r){hit(e,e.def.boss?48:38,{skill:true,ult:true});effect(e.wx,e.wy,35);}
      }
    }else if(m.danger&&m.t>(m.delay||1.15)&&!m.done){m.done=true;AudioFx.play('thunder');
      if(distance(m,game.player)<m.r&&game.player.z<35){dodgeReward();B.hurtPlayer(m.dmg||15,game.player.x,{unblockable:true});}effect(m.wx,m.wy,m.r);
    }}marks=marks.filter(m=>m.t<m.max);
    // Convert existing item drops back to ground-space, then allow radial pickup.
    for(const item of game.items){locateItem(item);
      if(!item.placed)item.tt+=dt;
      const p=game.player,needed=item.type==='hp'?p.hp<p.maxHp:item.type==='en'?p.en<p.maxEn:true;
      if(p.state!=='dead'&&!game.inputLock&&needed&&distance(item,p)<45){
        let label='';
        if(item.type==='hp'){const old=p.hp;p.hp=Math.min(p.maxHp,p.hp+20);label='+'+(p.hp-old)+' HP';}
        else if(item.type==='en'){const old=p.en;p.en=Math.min(p.maxEn,p.en+20);label='+'+Math.round(p.en-old)+' ENERGY';}
        else if(item.type==='power'){p.boost=8;label='POWER ×1.6';}
        else {const score=item.type==='star'?150:50;game.score+=score;label='+'+score+' SCORE';}
        B.floatText(p.x,p.y-p.h-24,label,item.type==='hp'?'#ffa4b4':'#a2e4ff',16);
        AudioFx.play('pickup',item.type);item.tt=99;
      }}game.items=game.items.filter(i=>i.placed?i.tt<99:i.tt<14);
    B.updateParticles(dt);
    for(const f of vfx)f.t+=dt;vfx=vfx.filter(f=>f.t<f.max);
    if(!stage.cleared&&game.player.state!=='dead'){
      if(stage.def.boss&&!stage.bossTriggered&&clock>.7){stage.bossTriggered=true;spawn(stage.def.boss.type);}
      if(stage.def.waves&&!game.enemies.some(e=>e.state!=='dead')){
        if(stage.waveActive){
          stage.waveActive=false;
          const p=game.player;
          game.items.push({wx:clamp(p.wx+75,60,W-60),wy:p.wy,type:p.hp<p.maxHp*.7?'hp':'en',tt:0});
          B.showBanner('WAVE '+stage.waveIdx+' CLEAR','ТУЛААНЫ ЗАВСАР','Нөөцөө аваад дараагийн тулаанд бэлтгэ',1.5);
          AudioFx.play('pickup','star');
        }
        waveWait-=dt;if(waveWait<=0){
          if(stage.waveIdx<stage.def.waves.length){stage.def.waves[stage.waveIdx].list.forEach(([type],i)=>spawn(type,i));stage.waveIdx++;waveWait=2.5;stage.waveActive=true;
            B.showBanner('WAVE '+stage.waveIdx,stage.def.title,'Дайснуудыг ял!',1.5);
          }else B.stageClear();
        }
      }
    }
    const oldCamera={...camera};
    const cam=project(game.player.wx+(game.player.worldVx||0)*.12,game.player.wy+(game.player.worldVy||0)*.12);camera.x+=(cam.x-camera.x)*Math.min(1,dt*5);camera.y+=(cam.y-camera.y)*Math.min(1,dt*5);
    for(const list of [game.particles,game.texts])for(const fx of list||[]){fx.x+=oldCamera.x-camera.x;fx.y+=oldCamera.y-camera.y;}
    game.camX=0;sync(game.player);for(const e of game.enemies)sync(e);
  }
  function paintTerrain(g,locate){
    const key=stage.def.key;
    const colors=key==='steppe'?['#3b5144','#405647','#455a49','#3e5346']:key==='ger'?['#41464b','#454a4f','#494c51','#42484d']:['#293a46','#2d3f4a','#31424c','#2b3c47'];
    const hash=n=>{const t=Math.sin(n*127.1+311.7)*43758.5453;return t-Math.floor(t);};
    g.save();g.beginPath();[[0,0],[W,0],[W,H],[0,H]].forEach(([x,y],i)=>{const q=locate(x,y);i?g.lineTo(q.x,q.y):g.moveTo(q.x,q.y);});g.closePath();g.clip();
    for(let y=0;y<=H+70;y+=70)for(let x=0;x<=W+70;x+=70){const q=locate(x,y);g.fillStyle=colors[Math.floor(hash(x+y*7)*4)];g.beginPath();g.moveTo(q.x,q.y-17.5);g.lineTo(q.x+57.4,q.y);g.lineTo(q.x,q.y+17.5);g.lineTo(q.x-57.4,q.y);g.closePath();g.fill();}
    g.strokeStyle=key==='mountain'?'rgba(154,178,197,.17)':'rgba(175,151,111,.22)';g.lineWidth=42;g.lineJoin='round';g.beginPath();
    [[80,430],[600,430],[950,750],[W-100,H-180]].forEach(([x,y],i)=>{const q=locate(x,y);i?g.lineTo(q.x,q.y):g.moveTo(q.x,q.y);});g.stroke();
    if(settings.detail)for(let i=0;i<1000;i++){
      const wx=hash(i*3.1)*W,wy=hash(i*6.7)*H,q=locate(wx,wy);
      g.fillStyle=i%3?'rgba(8,20,22,.22)':'rgba(183,195,162,.13)';g.fillRect(q.x,q.y,1+hash(i)*3,1+hash(i*2)*1.5);
      if(key==='steppe'&&i%7===0){g.strokeStyle='rgba(169,174,122,.22)';g.lineWidth=1;g.beginPath();g.moveTo(q.x-3,q.y);g.lineTo(q.x,q.y-5);g.lineTo(q.x+3,q.y-1);g.stroke();}
    }
    g.restore();g.strokeStyle='rgba(172,194,198,.25)';g.lineWidth=3;g.beginPath();[[0,0],[W,0],[W,H],[0,H],[0,0]].forEach(([x,y],i)=>{const q=locate(x,y);i?g.lineTo(q.x,q.y):g.moveTo(q.x,q.y);});g.stroke();
  }
  function drawTerrain(){
    if(typeof document!=='undefined'&&document.createElement){
      if(!terrain||terrainDetail!==settings.detail){
        terrain=document.createElement('canvas');terrain.width=Math.ceil((W+H)*PX)+160;terrain.height=Math.ceil((W+H)*PY)+160;
        const g=terrain.getContext('2d');g.translate(H*PX+80,80);paintTerrain(g,project);terrainDetail=settings.detail;
      }
      ctx.drawImage(terrain,480-camera.x-H*PX-80,320-camera.y-80);
    }else paintTerrain(ctx,screen);
  }
  function prop(o) {
    const p=screen(o.wx,o.wy);ctx.save();ctx.translate(p.x,p.y);
    const hero=screen(game.player.wx,game.player.wy);
    if(o.wx+o.wy>game.player.wx+game.player.wy&&Math.abs(p.x-hero.x)<o.r*1.4&&hero.y>p.y-140&&hero.y<p.y+10)ctx.globalAlpha=.4;
    ctx.fillStyle='rgba(0,0,0,.23)';ctx.beginPath();ctx.ellipse(12,8,o.r*1.15,o.r*.42,0,0,Math.PI*2);ctx.fill();
    if(o.type==='ger') {
      ctx.fillStyle='#c9bd9f';ctx.beginPath();ctx.ellipse(0,-24,52,25,0,0,Math.PI*2);ctx.fill();ctx.fillRect(-52,-24,104,28);
      ctx.fillStyle='#ebe1c9';ctx.beginPath();ctx.moveTo(-53,-25);ctx.quadraticCurveTo(-28,-80,0,-85);ctx.quadraticCurveTo(30,-76,53,-25);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#89725c';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,-24,52,25,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#76513b';ctx.fillRect(-11,-28,22,35);
      ctx.strokeStyle='#634b38';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,-10,52,18,0,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#a35837';ctx.fillRect(-9,-24,18,30);ctx.strokeStyle='#d8b269';ctx.lineWidth=1;ctx.strokeRect(-8,-23,16,28);
      for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-7,-18+i*7);ctx.lineTo(7,-12+i*7);ctx.moveTo(7,-18+i*7);ctx.lineTo(-7,-12+i*7);ctx.stroke();}
      ctx.fillStyle='#8b4d36';ctx.beginPath();ctx.ellipse(0,-80,9,4,0,0,Math.PI*2);ctx.fill();
    } else if(o.type==='house') {
      ctx.fillStyle='#755751';ctx.beginPath();ctx.moveTo(-60,-65);ctx.lineTo(0,-42);ctx.lineTo(0,10);ctx.lineTo(-60,-15);ctx.closePath();ctx.fill();
      ctx.fillStyle='#4c555f';ctx.beginPath();ctx.moveTo(0,-42);ctx.lineTo(60,-65);ctx.lineTo(60,-15);ctx.lineTo(0,10);ctx.closePath();ctx.fill();
      ctx.fillStyle='#a07c66';ctx.beginPath();ctx.moveTo(-65,-65);ctx.lineTo(0,-100);ctx.lineTo(65,-65);ctx.lineTo(0,-40);ctx.closePath();ctx.fill();ctx.fillStyle='#edc77d';ctx.fillRect(20,-48,16,15);
      ctx.strokeStyle='#57433d';ctx.lineWidth=2;for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(-60,-65+i*10);ctx.lineTo(-4,-43+i*10);ctx.stroke();}
      ctx.fillStyle='#43352e';ctx.fillRect(-33,-49,18,33);ctx.fillStyle='#988170';ctx.fillRect(25,-103,10,20);
      if(settings.detail){const glow=ctx.createRadialGradient(29,-36,2,29,-36,55);glow.addColorStop(0,'rgba(240,177,83,.15)');glow.addColorStop(1,'rgba(240,177,83,0)');ctx.fillStyle=glow;ctx.fillRect(-26,-91,110,110);}
    } else if(o.type==='tree') {
      ctx.fillStyle='#634c3e';ctx.fillRect(-5,-60,10,65);for(let i=0;i<3;i++){ctx.fillStyle=['#35584e','#426c59','#568168'][i];ctx.beginPath();ctx.moveTo(-36+i*7,-24-i*23);ctx.lineTo(0,-104-i*12);ctx.lineTo(36-i*7,-24-i*23);ctx.fill();}
    }else if(o.type==='rock'){
      ctx.fillStyle='#7d8790';ctx.beginPath();ctx.moveTo(-30,4);ctx.lineTo(-22,-22);ctx.lineTo(4,-34);ctx.lineTo(28,-18);ctx.lineTo(34,6);ctx.closePath();ctx.fill();
      ctx.fillStyle='#a2abb1';ctx.beginPath();ctx.moveTo(-22,-22);ctx.lineTo(4,-34);ctx.lineTo(28,-18);ctx.lineTo(2,-11);ctx.closePath();ctx.fill();
    }else{
      for(let i=0;i<3;i++){ctx.fillStyle=['#65737c','#7b8992','#9aabb2'][i];ctx.beginPath();ctx.moveTo(-44+i*10,4-i*15);ctx.lineTo(-8,-27-i*15);ctx.lineTo(16-i*3,-30-i*13);ctx.lineTo(44-i*10,4-i*15);ctx.closePath();ctx.fill();}
      ctx.strokeStyle='#a1b4bb';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-78);ctx.stroke();
      ctx.strokeStyle='#6caee2';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,-65);ctx.quadraticCurveTo(35,-75,45,-55+Math.sin(game.t*3)*6);ctx.stroke();
      ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-56);ctx.quadraticCurveTo(-22,-52,-30,-38+Math.sin(game.t*2)*5);ctx.stroke();
    }
    ctx.restore();
  }
  function render(K) {
    const shake=settings.shake?game.shake:0;
    ctx.setTransform(K,0,0,K,(Math.random()-.5)*shake*K,(Math.random()-.5)*shake*K);ctx.globalAlpha=1;
    const key=game.stage.def.key;
    ctx.fillStyle=key==='mountain'?'#0c1923':'#17282a';ctx.fillRect(0,0,960,540);
    drawTerrain();
    const light=ctx.createRadialGradient(440,270,40,440,270,620);
    light.addColorStop(0,key==='steppe'?'rgba(233,204,128,.08)':'rgba(152,190,217,.08)');light.addColorStop(1,'rgba(2,10,17,.28)');ctx.fillStyle=light;ctx.fillRect(0,0,960,540);
    for(const m of marks){const q=screen(m.wx,m.wy);ctx.strokeStyle=m.danger?'#ff7c6f':'#8ad6ff';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(q.x,q.y,m.r*Math.SQRT2*.7,m.r*Math.SQRT2*.35,0,0,Math.PI*2);ctx.stroke();
      if(m.danger){ctx.fillStyle='rgba(255,90,75,.18)';ctx.beginPath();ctx.ellipse(q.x,q.y,m.r*Math.SQRT2*.7*Math.min(1,m.t/(m.delay||1.15)),m.r*Math.SQRT2*.35*Math.min(1,m.t/(m.delay||1.15)),0,0,Math.PI*2);ctx.fill();}
      if(m.heroStorm){ctx.fillStyle='rgba(90,190,255,.1)';ctx.beginPath();ctx.ellipse(q.x,q.y,m.r*.99,m.r*.495,0,0,Math.PI*2);ctx.fill();
        ctx.save();ctx.translate(q.x,q.y);ctx.scale(1,.5);
        for(let ring=0;ring<3;ring++){ctx.strokeStyle=`rgba(${ring?'115,215,255':'225,250,255'},${.9-ring*.2})`;ctx.lineWidth=3-ring*.6;ctx.beginPath();ctx.arc(0,0,m.r*(.38+ring*.25),game.t*(ring%2?-.8:1.1),game.t*(ring%2?-.8:1.1)+Math.PI*1.72);ctx.stroke();}
        for(let i=0;i<12;i++){const a=i*Math.PI/6+game.t*.45,r0=m.r*.72,r1=r0+(i%2?13:25);ctx.beginPath();ctx.moveTo(Math.cos(a)*r0,Math.sin(a)*r0);ctx.lineTo(Math.cos(a)*r1,Math.sin(a)*r1);ctx.stroke();}
        ctx.restore();
        ctx.strokeStyle='#c3f3ff';for(let i=0;i<3;i++){const a=game.t*2+i*2.094;const b=screen(m.wx+Math.cos(a)*m.r*.65,m.wy+Math.sin(a)*m.r*.65);ctx.beginPath();ctx.moveTo(b.x,b.y-100);ctx.lineTo(b.x+14,b.y-55);ctx.lineTo(b.x-9,b.y-30);ctx.lineTo(b.x,b.y);ctx.stroke();}}
      if(m.bolt){ctx.strokeStyle='#d3f5ff';ctx.beginPath();ctx.moveTo(q.x-20,-20);ctx.lineTo(q.x+15,q.y-100);ctx.lineTo(q.x-12,q.y-55);ctx.lineTo(q.x,q.y);ctx.stroke();}}
    drawEffects();
    for(const e of game.enemies)if(e.state==='windup'&&e.attackDir){
      if(e.def.mounted&&e.attackKind==='sweep'){
        const q=screen(e.wx,e.wy);ctx.fillStyle='rgba(255,100,80,.15)';ctx.strokeStyle='#ff927e';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(q.x,q.y,220*.99,220*.495,0,0,Math.PI*2);ctx.fill();ctx.stroke();continue;
      }
      if(e.def.mounted&&e.attackKind==='storm'){
        const q=screen(e.wx,e.wy);ctx.fillStyle='#ffb47d';ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.fillText('⚡ АЯНГЫН АН',q.x,q.y-e.h-20);continue;
      }
      if(e.type==='erhmee'){
        const q=screen(e.wx+e.attackDir.x*55,e.wy+e.attackDir.y*55);
        ctx.strokeStyle='#ffb47d';ctx.fillStyle='rgba(255,145,70,.18)';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(q.x,q.y,90*.99,90*.495,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      }
      const d=e.attackDir,length=e.attackKind==='charge'?(e.chargeSpeed||635)*(e.chargeTime||.9):role(e).reach;
      const width=e.attackKind==='charge'?100:70;
      const points=[[e.wx-d.y*width,e.wy+d.x*width],[e.wx+d.x*length-d.y*width,e.wy+d.y*length+d.x*width],
        [e.wx+d.x*length+d.y*width,e.wy+d.y*length-d.x*width],[e.wx+d.y*width,e.wy-d.x*width]];
      ctx.fillStyle='rgba(255,100,80,.22)';ctx.strokeStyle='#ff927e';ctx.lineWidth=2;ctx.beginPath();
      points.forEach(([x,y],i)=>{const q=screen(x,y);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.fill();ctx.stroke();
    }
    const p=game.player;
    if(p.state!=='dead'){
      const q=screen(p.wx,p.wy),tip=screen(p.wx+p.dir.x*55,p.wy+p.dir.y*55);
      ctx.strokeStyle='#a8e6ff';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(q.x,q.y,25,12,0,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(tip.x,tip.y);ctx.stroke();
      const aim=input.aim,showAim=(aim?.mouse)||(aim?.touch&&aim.until>=game.t);
      if(showAim&&!game.inputLock){
        const ad=aimedDirection(p,p.dir),far=screen(p.wx+ad.x*230,p.wy+ad.y*230);
        ctx.save();ctx.setLineDash([7,7]);ctx.strokeStyle='rgba(150,230,255,.62)';ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(q.x,q.y-5);ctx.lineTo(far.x,far.y-5);ctx.stroke();ctx.setLineDash([]);
        ctx.strokeStyle='#b9f2ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(far.x,far.y-5,10,0,Math.PI*2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(far.x-15,far.y-5);ctx.lineTo(far.x+15,far.y-5);ctx.moveTo(far.x,far.y-20);ctx.lineTo(far.x,far.y+10);ctx.stroke();ctx.restore();
      }
      if(p.state==='attack'){
        const shape=swingShape(p),angle=Math.atan2(p.dir.y,p.dir.x),half=Math.acos(shape.cos);
        ctx.fillStyle='rgba(255,210,110,.16)';ctx.strokeStyle='rgba(255,220,145,.7)';ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(q.x,q.y);
        for(let i=0;i<=16;i++){const a=angle-half+half*2*i/16,r=screen(p.wx+Math.cos(a)*shape.range,p.wy+Math.sin(a)*shape.range);ctx.lineTo(r.x,r.y);}
        ctx.closePath();ctx.fill();ctx.stroke();
      }else if(p.state==='power'||p.state==='ult'){
        const aura=ctx.createRadialGradient(q.x,q.y-34,4,q.x,q.y-34,p.state==='ult'?125:90);
        aura.addColorStop(0,p.state==='ult'?'rgba(205,245,255,.5)':'rgba(255,221,145,.48)');aura.addColorStop(1,'rgba(100,190,255,0)');
        ctx.fillStyle=aura;ctx.fillRect(q.x-130,q.y-165,260,210);
        ctx.strokeStyle='rgba(140,220,255,.6)';ctx.lineWidth=3;
        if(p.state==='power'){
          const a=Math.atan2(p.dir.y,p.dir.x),half=Math.acos(.82);ctx.beginPath();ctx.moveTo(q.x,q.y);
          for(let i=0;i<=12;i++){const t=a-half+2*half*i/12,s=screen(p.wx+Math.cos(t)*360,p.wy+Math.sin(t)*360);ctx.lineTo(s.x,s.y);}
          ctx.closePath();ctx.fillStyle='rgba(255,210,110,.16)';ctx.fill();ctx.stroke();
          for(let arc=0;arc<3;arc++){ctx.strokeStyle=`rgba(255,${215+arc*10},${120+arc*35},${.82-arc*.2})`;ctx.lineWidth=8-arc*2;
            ctx.beginPath();ctx.ellipse(q.x+p.dir.x*(75+arc*24),q.y+p.dir.y*(38+arc*12),82+arc*28,24+arc*7,Math.atan2(p.dir.y*.5,p.dir.x),-.9,.9);ctx.stroke();}
        }else{
          const target=p.skillTarget||p,s=screen(target.wx,target.wy);ctx.beginPath();ctx.ellipse(s.x,s.y,220*.99,220*.495,0,0,Math.PI*2);ctx.stroke();
          ctx.beginPath();ctx.moveTo(q.x,q.y-30);ctx.lineTo(s.x,s.y);ctx.stroke();
        }
        if(settings.detail)for(let i=0;i<8;i++){
          const a=i*Math.PI/4+game.t*2,rr=45+Math.min(1,p.k||0)*35;
          const a0=screen(p.wx+Math.cos(a)*rr,p.wy+Math.sin(a)*rr),a1=screen(p.wx+Math.cos(a+.18)*rr,p.wy+Math.sin(a+.18)*rr);
          ctx.strokeStyle=p.state==='power'?'#ffd27c':'#9fe9ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(a0.x,a0.y);ctx.lineTo(a1.x,a1.y);ctx.stroke();
        }
      }
    }
    const ordered=[...props.map(o=>({depth:o.wx+o.wy,draw:()=>prop(o)})),...game.enemies.map(e=>({depth:e.wx+e.wy,draw:()=>entity(e)})),{depth:game.player.wx+game.player.wy,draw:()=>entity(game.player)}];
    ordered.sort((a,b)=>a.depth-b.depth).forEach(o=>o.draw());
    for(const s of shots){const q=screen(s.wx,s.wy);ctx.strokeStyle=s.storm?'#a3eaff':'#e7d4ae';ctx.lineWidth=s.storm?5:3;ctx.beginPath();ctx.moveTo(q.x,q.y-35);ctx.lineTo(q.x-s.dx*25,q.y-35-s.dy*14);ctx.stroke();}
    for(const item of game.items){locateItem(item);const q=screen(item.wx,item.wy);ctx.fillStyle=item.type==='hp'?'#f7828f':item.type==='en'?'#8ad6ff':'#ffd57b';ctx.beginPath();ctx.arc(q.x,q.y-12,6,0,Math.PI*2);ctx.fill();}
    B.drawParticles(0);B.drawTexts(0);B.drawBubble(Voice.bubble?.speaker||game.player,0);
    threatPointers();
    if(game.hurtFlash>0){ctx.fillStyle=`rgba(173,35,59,${game.hurtFlash*.18})`;ctx.fillRect(0,0,960,540);}
    if(game.darken>0){ctx.fillStyle=`rgba(4,12,28,${game.darken*.5})`;ctx.fillRect(0,0,960,540);}
    if(game.lightning>0||game.flashWhite>0){ctx.fillStyle=`rgba(170,218,255,${Math.max(game.lightning*.3,game.flashWhite*.3)})`;ctx.fillRect(0,0,960,540);}
    if(game.fade>0){ctx.fillStyle=`rgba(5,10,18,${game.fade})`;ctx.fillRect(0,0,960,540);}
    minimap();
  }
  function threatPointers(){
    for(const e of game.enemies){if(e.state==='dead'||e.state==='intro')continue;
      const q=screen(e.wx,e.wy);if(q.x>=40&&q.x<=920&&q.y>=110&&q.y<=450)continue;
      const dx=q.x-480,dy=q.y-280,n=Math.max(Math.abs(dx)/422,Math.abs(dy)/160,1),x=480+dx/n,y=280+dy/n,a=Math.atan2(dy,dx);
      ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.fillStyle=e.def.boss?'#e8c478':'#d7897e';ctx.beginPath();ctx.moveTo(11,0);ctx.lineTo(-5,-5);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.restore();
    }
  }
  function drawEffects(){
    ctx.save();ctx.globalCompositeOperation='lighter';
    for(const f of vfx){const q=screen(f.wx,f.wy),k=f.t/f.max;
      ctx.globalAlpha=1-k;
      if(f.type==='ghost'){
        B.drawFigure({x:q.x,y:q.y,face:f.face,style:f.style,scale:f.scale,anim:'dash',animT:0,k:0,flash:0,onGround:true},0);continue;
      }
      const color=f.type==='shock'?'255,185,75':'105,205,255',r=f.r*(.1+k*.9);
      ctx.strokeStyle=`rgba(${color},.8)`;ctx.lineWidth=6*(1-k)+1;ctx.beginPath();ctx.ellipse(q.x,q.y,r*.99,r*.495,0,0,Math.PI*2);ctx.stroke();
      if(f.type==='shock'){
        ctx.strokeStyle=`rgba(255,235,185,${.85*(1-k)})`;ctx.lineWidth=3;
        for(let i=0;i<8;i++){const a=i*Math.PI/4+.2,r0=r*.35,r1=r*(.8+(i%3)*.12);ctx.beginPath();ctx.moveTo(q.x+Math.cos(a)*r0,q.y+Math.sin(a)*r0*.5);ctx.lineTo(q.x+Math.cos(a+.12)*r1,q.y+Math.sin(a+.12)*r1*.5);ctx.stroke();}
        ctx.fillStyle=`rgba(125,91,58,${.9*(1-k)})`;
        for(let i=0;i<7;i++){const a=i*.9,rubble=r*(.25+i*.08);ctx.save();ctx.translate(q.x+Math.cos(a)*rubble,q.y+Math.sin(a)*rubble*.5-22*Math.sin(k*Math.PI));ctx.rotate(a+k*3);ctx.fillRect(-4,-3,8,6);ctx.restore();}
      }
      if(settings.detail)for(let i=0;i<16;i++){
        const a=i*Math.PI/8+k*.3,pt=screen(f.wx+Math.cos(a)*r,f.wy+Math.sin(a)*r);
        ctx.fillStyle=`rgba(${color},.85)`;ctx.beginPath();ctx.arc(pt.x,pt.y-12*Math.sin(k*Math.PI),2+3*(1-k),0,Math.PI*2);ctx.fill();
      }
      if(f.type==='storm'){
        ctx.save();ctx.translate(q.x,q.y);ctx.scale(1,.5);ctx.strokeStyle=`rgba(150,225,255,${.75*(1-k*.5)})`;ctx.lineWidth=4;
        for(let j=0;j<3;j++){ctx.beginPath();ctx.arc(0,0,f.r*(.28+j*.22),-game.t*(1+j*.25),-game.t*(1+j*.25)+Math.PI*1.55);ctx.stroke();}ctx.restore();
        for(let i=0;i<(settings.detail?6:2);i++){
          const a=i*Math.PI/3,pt=screen(f.wx+Math.cos(a)*f.r*.45,f.wy+Math.sin(a)*f.r*.45);
          ctx.strokeStyle='#d4f4ff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pt.x-18,pt.y-170);ctx.lineTo(pt.x+12,pt.y-100);ctx.lineTo(pt.x-8,pt.y-70);ctx.lineTo(pt.x,pt.y);ctx.stroke();
        }
      }
    }ctx.restore();
  }
  function minimap(){
    const x=16,y=126,w=133,h=86;
    ctx.save();ctx.globalAlpha=.85;ctx.fillStyle='#0b1723';ctx.fillRect(x-7,y-7,w+14,h+28);
    ctx.strokeStyle='#708d9b';ctx.lineWidth=1;ctx.strokeRect(x,y,w,h);
    for(const o of props){ctx.fillStyle='#7f948d';ctx.fillRect(x+o.wx/W*w-2,y+o.wy/H*h-2,4,4);}
    for(const item of game.items)if(item.wx!=null){ctx.fillStyle=item.type==='hp'?'#ff9fba':item.type==='en'?'#8bf0ff':'#ffe48d';ctx.fillRect(x+item.wx/W*w-1.5,y+item.wy/H*h-1.5,3,3);}
    for(const e of game.enemies)if(e.state!=='dead'){ctx.fillStyle=e.def.boss?'#ffcf72':'#ff7777';ctx.beginPath();ctx.arc(x+e.wx/W*w,y+e.wy/H*h,e.def.boss?4:2.5,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#82e6ff';ctx.beginPath();ctx.arc(x+game.player.wx/W*w,y+game.player.wy/H*h,3.5,0,Math.PI*2);ctx.fill();
    ctx.font='10px sans-serif';ctx.textAlign='left';ctx.fillText('MAP · '+W+' × '+H,x,y+h+13);ctx.restore();
  }
  function entity(e) {
    sync(e);if(e.removed)return;
    if(e.x<-150||e.x>1110||e.y<-100||e.y>740)return;
    const ground=screen(e.wx,e.wy);
    ctx.save();ctx.globalAlpha=e.alpha??1;ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(ground.x,ground.y,e.def?.mounted?55:23,e.def?.mounted?16:8,0,0,Math.PI*2);ctx.fill();
    if(e.def?.mounted){B.drawWarhorse(e,0);B.drawFigure(Object.assign({},e,{y:e.y-45,scale:.92}),0);}
    else B.drawFigure(e,0);
    if(e.kind==='player'){B.drawSkillAura(e,0);B.drawSlash(e,0);B.drawGuard(e,0);}
    if(e.kind!=='player'&&e.state==='recover'){
      ctx.fillStyle='#ffe5a3';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.fillText('OPEN',e.x,e.y-e.h-12);
    }
    if(e.kind!=='player'&&e.state==='windup'){
      ctx.fillStyle='#ffd59c';ctx.font='bold 11px sans-serif';ctx.textAlign='center';
      ctx.fillText(role(e).label,e.x,e.y-e.h*e.scale-29);
    }
    if(e.kind!=='player'&&!e.def.boss&&e.state!=='dead'){
      const top=e.y-e.h*e.scale-14;
      ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillStyle=e.style?.trim||'#eee0c7';
      ctx.fillText(e.def.name,e.x,top-5);
      ctx.fillStyle='#243342';ctx.fillRect(e.x-23,top,46,4);ctx.fillStyle='#e87970';ctx.fillRect(e.x-23,top,46*Math.max(0,e.hp/e.maxHp),4);
    }ctx.restore();
  }
  return {tick,render,get active(){return stage===game.stage&&!!stage;},project,distance,get bounds(){return {width:W,height:H};}};
}
if(typeof module!=='undefined')module.exports=TegtatIso;
