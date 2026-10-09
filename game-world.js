/* TEGTAT's procedural environment. Static textures are baked once per theme.
   All coordinates are logical 960 × 540 pixels; no network assets required. */
(() => {
  'use strict';
  const W = 960, H = 540, GROUND = 452;
  const cache = new Map();
  const hash = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const wrap = (n, size) => ((n % size) + size) % size;
  function surface(w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    paint(c.getContext('2d')); return c;
  }
  function textures(key) {
    if (cache.has(key)) return cache.get(key);
    const night = key === 'mountain', city = key === 'ger';
    const ground = surface(W, 120, g => {
      // Sparse mineral grains, soil, broken tire ruts. Never randomize per frame.
      for (let i = 0; i < 3800; i++) {
        const x = hash(i * 3.2) * W, y = hash(i * 7.8) * 120;
        g.fillStyle = i % 3 ? 'rgba(12,20,23,.13)' : 'rgba(255,238,199,.19)';
        g.fillRect(x, y, .5 + hash(i) * 2.5, .4 + y / 140);
      }
      for (let i = 0; i < 95; i++) {
        const x = hash(i * 2.4) * W, y = 12 + hash(i * 8.1) * 100, r = 1 + hash(i) * 3;
        g.fillStyle = 'rgba(10,16,22,.22)'; g.beginPath(); g.ellipse(x + 1, y + 1.5, r * 1.5, r * .55, 0, 0, 7); g.fill();
        g.fillStyle = night ? '#6b6c73' : '#8e8265';
        g.beginPath(); g.moveTo(x-r,y); g.lineTo(x-r*.3,y-r*.6); g.lineTo(x+r,y-r*.3); g.lineTo(x+r*.7,y+r*.35); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(243,227,191,.22)'; g.lineWidth = .65; g.stroke();
      }
      for (let row = 0; row < 2; row++) {
        g.strokeStyle = 'rgba(29,28,24,.14)'; g.lineWidth = 2;
        g.beginPath();
        for (let x = 0; x <= W; x += 4) { const y = 40 + row * 36 + Math.sin(x / W * Math.PI * 4) * 2; if (!x) g.moveTo(x,y); else g.lineTo(x,y); }
        g.stroke();
      }
    });
    const cloud = surface(300, 100, g => {
      for (let i = 0; i < 28; i++) {
        const x = 30 + hash(i * 3.4) * 230, y = 28 + hash(i * 2.7) * 32, r = 18 + hash(i) * 24;
        const a = g.createRadialGradient(x,y,1,x,y,r);
        const color = night ? '98,104,132' : city ? '242,190,161' : '240,241,222';
        a.addColorStop(0, `rgba(${color},.12)`); a.addColorStop(1, `rgba(${color},0)`);
        g.fillStyle = a; g.fillRect(x-r,y-r,r*2,r*2);
      }
    });
    const light = surface(W,H,g => {
      const x = city ? 280 : 790, y = night ? 130 : 95;
      const a = g.createRadialGradient(x,y,5,x,y,620);
      a.addColorStop(0, night ? 'rgba(181,204,227,.12)' : 'rgba(255,224,162,.23)');
      a.addColorStop(.45, night ? 'rgba(139,162,190,.035)' : 'rgba(255,210,146,.065)');
      a.addColorStop(1,'rgba(255,224,162,0)'); g.fillStyle=a; g.fillRect(0,0,W,H);
      const fog = g.createLinearGradient(0,315,0,440);
      fog.addColorStop(0,'rgba(204,212,201,0)'); fog.addColorStop(.55,night ? 'rgba(120,136,165,.075)' : 'rgba(217,210,182,.1)'); fog.addColorStop(1,'rgba(204,212,201,0)');
      g.fillStyle=fog; g.fillRect(0,315,W,125);
    });
    const result = { ground, cloud, light }; cache.set(key,result); return result;
  }
  function clouds(g,key,cam,t) {
    const img=textures(key).cloud;
    for (let i=0;i<7;i++) {
      const x=wrap(hash(i*4.2)*1500-cam*.06-t*(3+i*.7),1500)-300;
      const s=.7+hash(i)*.9;
      g.drawImage(img,x,36+hash(i*2.3)*130,300*s,80*s);
    }
  }
  function ground(g,key,cam) {
    const img=textures(key).ground, x=-wrap(cam,W);
    g.drawImage(img,x,GROUND-12); g.drawImage(img,x+W,GROUND-12);
  }
  function atmosphere(g,key,cam,t,rich) {
    if (!rich) return;
    g.drawImage(textures(key).light,0,0);
    const night=key==='mountain';
    for(let i=0;i<24;i++) {
      const x=wrap(hash(i*4.3)*1100 + t*(night?19:9)-cam*.25,1100)-70;
      const y=190+wrap(hash(i*8.7)*280-t*(night?7:2),280);
      g.fillStyle=night?'rgba(221,226,238,.3)':'rgba(255,229,171,.32)';
      g.beginPath(); g.ellipse(x,y,night?1.7:1,night?.65:1,0,0,7); g.fill();
    }
  }
  function grass(g,key,cam,t,foreground,rich) {
    if (!rich || key==='mountain') return;
    const rate=foreground?1.08:1, offset=cam*rate, spacing=foreground?22:13;
    const start=Math.floor(offset/spacing)-1;
    g.lineWidth=foreground?1.3:.8;
    for(let i=start;i<start+Math.ceil(W/spacing)+3;i++) {
      if(key==='ger' && hash(i*2.3)<.65) continue;
      const h=hash(i*3.7), x=i*spacing-offset, y=foreground?H-3+h*9:GROUND-8-h*12;
      const height=(foreground?15:7)+h*(foreground?23:10);
      const wind=Math.sin(t*1.65+i*.6)*2+Math.sin(t*.73+i*.14)*3;
      g.strokeStyle=foreground?'rgba(46,54,36,.8)':key==='ger'?'#79735c':'#747e50';
      g.beginPath();
      for(let k=-1;k<=1;k++) {g.moveTo(x+k*2,y);g.quadraticCurveTo(x+k*3+wind*.3,y-height*.5,x+k*5+wind,y-height*(k===0?1:.65));}
      g.stroke();
      if(!foreground && h>.7){g.strokeStyle='rgba(226,208,151,.6)';g.beginPath();g.moveTo(x+wind,y-height);g.lineTo(x+wind+1,y-height+4);g.stroke();}
    }
  }
  window.TegtatWorld = Object.freeze({clouds,ground,atmosphere,grass});
})();
