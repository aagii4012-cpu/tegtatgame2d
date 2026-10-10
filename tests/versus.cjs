const assert=require('node:assert/strict');
const {Battle,roster,empty}=require('../versus.js');
const make=(a=0,b=1)=>{const g=new Battle(roster[a],roster[b],{mode:'local',random:()=>.5});g.phase='fight';return g;};
const advance=(g,t)=>{for(let i=0;i<Math.ceil(t*60);i++)g.step(1/60);};
assert.equal(roster.length,10);assert.equal(new Set(roster.map(r=>r.power)).size,10);assert.equal(roster.filter(r=>r.gender==='ЭМЭГТЭЙ').length,4);
{
 const g=make(),[a,b]=g.fighters;a.x=500;b.x=590;g.inputs[0].attack=true;advance(g,.25);assert.equal(b.hp,b.def.hp-a.def.damage);assert.equal(a.combo,1);
 advance(g,.8);assert.ok(b.hp<b.def.hp-a.def.damage,'held attack chains');assert.ok(a.en>35,'melee builds energy');
}
{
 const g=make(),[a,b]=g.fighters;a.x=500;b.x=650;a.face=-1;g.begin(a,'attack');advance(g,.25);assert.equal(b.hp,b.def.hp,'rear target outside melee arc');
 b.x=570;b.y=200;g.begin(a,'attack');a.face=1;advance(g,.25);assert.equal(b.hp,b.def.hp,'ground melee does not hit airborne opponent');
}
{
 const g=make(),[a,b]=g.fighters;a.x=500;b.x=580;b.face=-1;b.state='guard';b.guardT=.1;
 assert.equal(g.hit(a,b,20),'parry');assert.equal(b.hp,b.def.hp);assert.equal(a.state,'stun');
 b.guardT=.3;const hp=b.hp,en=b.en;assert.equal(g.hit(a,b,20),'block');assert.ok(b.hp<hp&&b.hp>hp-20);assert.equal(b.en,en-7);
 b.guardLock=0;b.guardT=.3;b.face=1;assert.equal(g.hit(a,b,20),true,'wrong-facing guard can be punished');
}
{
 const g=make(),a=g.fighters[0];a.en=17;assert.equal(g.skill(a,'shot'),false);assert.equal(a.en,17);
 a.en=100;assert.equal(g.skill(a,'special'),true);assert.equal(a.en,40);assert.equal(g.skill(a,'special'),false);assert.equal(a.en,40);
 assert.equal(g.skill(a,'dash'),true);assert.equal(a.en,40);assert.ok(a.inv>0);assert.equal(g.skill(a,'dash'),false);
}
{
 const g=make(),[a,b]=g.fighters;a.x=500;b.x=630;g.skill(a,'dash');advance(g,.1);assert.ok(a.x>550);assert.equal(g.hit(b,a,50),false,'dash has brief invulnerability');advance(g,.25);assert.equal(a.inv,0);
 a.x=350;a.y=500;g.inputs[0].jump=true;advance(g,.45);assert.ok(a.y<365);advance(g,.6);assert.equal(a.y,365,'descending jump lands on platform');assert.ok(a.ground);
}
// Every special must do meaningful damage when placed correctly.
for(let i=0;i<roster.length;i++){
 const g=make(i,(i+1)%10),[a,b]=g.fighters;a.x=420;b.x=550;a.en=100;if(a.def.power==='light')a.hp-=30;
 assert.equal(g.skill(a,'special'),true);advance(g,2);assert.ok(b.hp<b.def.hp,roster[i].id+' special deals damage');assert.ok(a.en<70,'special cannot refund its full cost');
 if(a.def.power==='light')assert.equal(a.hp,a.def.hp-12,'light heals only 18');
}
{
 const g=make(7,0),[a,b]=g.fighters;a.x=420;b.x=550;g.special(a,b);advance(g,1.3);assert.ok(b.hp<=b.def.hp-44,'staggered frost bolts do not all vanish in one invulnerability frame');assert.ok(b.slow>0);
}
{
 const g=make(4,0),[a,b]=g.fighters;a.x=400;b.x=650;a.en=100;g.skill(a,'special');advance(g,.31);b.x=940;advance(g,1.2);assert.equal(b.hp,b.def.hp,'telegraphed lightning locks positions and can be escaped');
}
{
 const g=make(8,0),[a,b]=g.fighters;a.x=400;b.x=505;b.y=290;b.vy=0;b.ground=false;g.special(a,b);advance(g,.12);assert.equal(b.hp,b.def.hp,'ground spikes can be jumped');
}
{
 const g=make(),[a,b]=g.fighters;a.hp=100;b.hp=1;g.hit(a,b,50);advance(g,.1);assert.equal(g.phase,'roundEnd');assert.equal(g.wins[0],1);advance(g,4.1);assert.equal(g.round,2);assert.equal(g.fighters[0].hp,roster[0].hp);
 const enemy=g.fighters[1];enemy.hp=0;g.step(1/60);advance(g,2.5);assert.equal(g.phase,'finished');assert.deepEqual(g.wins,[2,0]);
}
{
 const g=make();g.roundClock=.01;g.fighters[0].hp=roster[0].hp*.6;g.fighters[1].hp=roster[1].hp*.8;g.step(1/60);assert.equal(g.wins[1],1,'timer compares normalized HP, not tank advantage');
}
// CPU simulation catches stuck states, NaN physics and matches that never end.
for(const difficulty of ['easy','normal','hard']){
 const g=new Battle(roster[6],roster[5],{difficulty,random:()=>.42});
 for(let i=0;i<20000&&g.phase!=='finished';i++){
  const a=g.fighters[0],b=g.fighters[1];g.inputs[0]=g.ai(a,b,1/60);g.step(1/60);
  for(const f of g.fighters){assert.ok(Number.isFinite(f.x)&&Number.isFinite(f.y)&&Number.isFinite(f.en));assert.ok(f.en>=0&&f.en<=100);assert.ok(f.x>=45&&f.x<=1055);}
 }
 assert.equal(g.phase,'finished',difficulty+' CPU match reaches result');
}
console.log('PASS: 10 unique fighters, held combo, directional/aerial collision, parry/guard, cost/cooldowns, dash, platforms, all specials, dodgeable lightning, jumpable spikes, rounds, timer and CPU matches.');
