/*
 * lyrics-engine.js — disegna una riga di lyrics animata su un <canvas>.
 * Stesso codice per l'anteprima nell'editor e per il render del video finale.
 *
 * API (oggetto globale LyricsEngine):
 *
 *   LyricsEngine.STYLES                     elenco stili: { key: {label, btn, ...} }
 *   LyricsEngine.loadFonts()                Promise: precarica i Google Fonts usati (chiamarla prima di disegnare)
 *   LyricsEngine.drawLine(ctx, W, H, opt)   disegna la riga sul canvas (W×H in pixel)
 *
 *   opt = {
 *     text       : 'you look so pretty'     la riga da mostrare
 *     style      : 'brat'                   chiave di STYLES
 *     y          : 46                       centro verticale del testo, in % dell'altezza
 *     wordTimes  : [s, s, ...]              (opzionale) istante di ogni parola, stessa scala di `time`;
 *                                           senza, la riga è mostrata completa e ferma
 *     time       : 1.23                     (opzionale) tempo attuale in secondi
 *     refHeight  : 508                      altezza in px della preview: i font sono pensati per questa altezza
 *                                           e scalano in proporzione (es. render 1280px di altezza)
 *     fontSize   : 20                       (opzionale) dimensione base
 *     safeZone   : true                     (opzionale) tiene il testo fuori dalle icone/caption di TikTok
 *   }
 *
 * Font esterni usati (Google Fonts): Archivo Black, Syne 800, Gaegu, Playfair Display (700, 700 italic),
 * Cormorant Garamond 700, UnifrakturCook 700, Shadows Into Light, Sedgwick Ave Display, Reenie Beanie, Montserrat.
 */
const LyricsEngine=(()=>{

// ─────────────────────────── STILI ───────────────────────────
// family 'brat' : parole distribuite su righe con spaziature casuali (brat, brat BIG, brat dynamic, cursive)
// family 'neon' : scritta a mano luminosa, parole di misure diverse, alcune azzurre che lampeggiano
// family 'gen'  : motore generico a parole/gruppi di parole (tutti gli altri)
//
// Campi 'gen': font(s) · case 'upper'|'lower' · size (moltiplicatore) · chunk (parole per schermata, 0 = riga intera)
//   color · y (posizione consigliata %) · ls (spaziatura lettere, em) · xs (larghezza lettere) · lh (interlinea)
//   maxw (larghezza max, frazione del canvas) · gap (spazio tra parole, em) · drop (ombra) · stroke/strokeColor
//   hollow (solo contorno) · glow/glowColor · grad (riempimento a gradiente) · scatter (parole sparse)
//   reveal: 'type' (lettera per lettera) | 'ink' (inchiostro) | 'glitch' (intro + raffiche a strisce)
const STYLES={
  bratbig:    {label:'brat BIG',family:'brat',big:true,btn:"font:700 16px 'Arial Narrow',Arial,sans-serif;letter-spacing:-.05em;"},
  bratdyn:    {label:'brat dynamic',family:'brat',dyn:true,btn:"font:700 14px 'Arial Narrow',Arial,sans-serif;letter-spacing:-.05em;"},
  brat:       {label:'brat',family:'brat',btn:"font:700 15px 'Arial Narrow',Arial,sans-serif;letter-spacing:-.06em;"},
  simple:     {label:'Simple',font:s=>`500 ${s}px Montserrat,sans-serif`,case:'lower',size:.62,chunk:2,drop:.3,btn:"font:500 13px Montserrat,sans-serif;"},
  inked:      {label:'INKED',font:s=>`400 ${s}px "Archivo Black",sans-serif`,case:'upper',size:1.25,chunk:1,reveal:'ink',ls:.01,btn:"font:400 13px 'Archivo Black',sans-serif;"},
  bold:       {label:'BOLD',font:s=>`400 ${s}px "Archivo Black",sans-serif`,case:'upper',size:1.4,chunk:1,drop:.2,ls:-.02,btn:"font:400 15px 'Archivo Black',sans-serif;"},
  hollow:     {label:'HOLLOW',font:s=>`800 ${s}px Syne,sans-serif`,case:'upper',size:1.1,chunk:1,hollow:.035,ls:.02,btn:"font:800 12px Syne,sans-serif;"},
  subtitle:   {label:'subtitle',font:s=>`600 ${s}px Montserrat,sans-serif`,case:'lower',size:.5,chunk:3,stroke:.16,color:'#ffe14a',y:76,btn:"font:600 11px Montserrat,sans-serif;color:#ffe14a;"},
  elegant:    {label:'ELEGANT',font:s=>`700 ${s}px "Cormorant Garamond",serif`,case:'upper',size:1.8,chunk:0,xs:.92,ls:.02,lh:1.0,maxw:.92,gap:.26,
               grad:['rgba(255,255,255,.95)','rgba(232,222,200,.42)','rgba(255,255,255,.7)'],stroke:.012,strokeColor:'rgba(255,255,255,.8)',btn:"font:700 15px 'Cormorant Garamond',serif;letter-spacing:.1em;"},
  glitch:     {label:'GLITCH',font:s=>`800 ${s}px Montserrat,sans-serif`,case:'upper',size:.9,chunk:2,reveal:'glitch',glow:.4,glowColor:'#ffffff',ls:.04,btn:"font:800 12px Montserrat,sans-serif;letter-spacing:.08em;text-shadow:-2px 0 #ff2d55,2px 0 #2dd4ff;"},
  handwritten:{label:'handwritten',font:s=>`400 ${s}px Gaegu,cursive`,case:'lower',size:1.25,chunk:2,reveal:'type',btn:"font:400 15px Gaegu,cursive;"},
  cursive:    {label:'cursive',family:'brat',font:s=>`italic 700 ${s}px "Playfair Display",serif`,ls:0,size:.62,wide:1.15,color:'#f0c64a',btn:"font:italic 700 14px 'Playfair Display',serif;"},
  edgy:       {label:'EDGY',font:s=>`700 ${s}px UnifrakturCook,cursive`,size:1.25,chunk:2,glow:.6,btn:"font:700 15px UnifrakturCook,cursive;"},
  neon:       {label:'Neon',family:'neon',font:s=>`400 ${s}px "Shadows Into Light",cursive`,btn:"font:400 15px 'Shadows Into Light',cursive;text-shadow:0 0 8px #fff;"},
  graffiti:   {label:'GRAFFITI',font:s=>`400 ${s}px "Sedgwick Ave Display",cursive`,case:'upper',size:1.7,chunk:1,btn:"font:400 16px 'Sedgwick Ave Display',cursive;"},
  serif:      {label:'SERIF GLOW',font:s=>`700 ${s}px "Playfair Display",serif`,case:'upper',size:1.5,chunk:0,xs:.78,ls:-.01,lh:1.0,maxw:.94,gap:.25,glow:.5,glowColor:'#c9d8ff',btn:"font:700 13px 'Playfair Display',serif;letter-spacing:.04em;text-shadow:0 0 8px #c9d8ff;"},
  scribble:   {label:'scribble',font:s=>`400 ${s}px "Reenie Beanie",cursive`,case:'lower',size:2,chunk:3,scatter:true,drop:.25,btn:"font:400 20px 'Reenie Beanie',cursive;"},
};
const BRAT_FONT=s=>`700 ${s}px "Arial Narrow","Helvetica Neue",Helvetica,Arial,sans-serif`;   // condensato di sistema

function loadFonts(){
  const list=['500 20px Montserrat','600 20px Montserrat','800 20px Montserrat','400 20px "Archivo Black"','800 20px Syne','400 20px Gaegu',
    '700 20px "Playfair Display"','italic 700 20px "Playfair Display"','700 20px "Cormorant Garamond"','700 20px UnifrakturCook',
    '400 20px "Shadows Into Light"','400 20px "Sedgwick Ave Display"','400 20px "Reenie Beanie"'];
  return Promise.all(list.map(f=>document.fonts.load(f,'Aa'))).catch(()=>{});
}

// ─────────────────────────── utilità ───────────────────────────
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function hashStr(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function mixCol(a,b,k){const f=h=>{h=h.replace('#','');const n=parseInt(h,16);return[(n>>16)&255,(n>>8)&255,n&255];};const A=f(a),B=f(b);return'rgb('+A.map((v,i)=>Math.round(v+(B[i]-v)*k)).join(',')+')';}
const splitWords=t=>t.split(/\s+/).filter(Boolean);

// ─────────────────────────── API ───────────────────────────
const SAFE={x:.17,y:.11,w:.66,h:.65};   // area libera da icone e caption di TikTok (frazioni del frame)

function drawLine(ctx,W,H,opt){
  const cfg=STYLES[opt.style]||STYLES.brat;
  if(!opt.text||!opt.text.trim())return;
  let y=opt.y!=null?opt.y:(cfg.y!=null?cfg.y:46),w=W,h=H;
  const sizeScale=(opt.fontSize||20)*(cfg.size||1)*(H/(opt.refHeight||H));
  ctx.save();
  if(opt.safeZone!==false){   // il testo viene impaginato dentro l'area libera, un po' più piccolo
    ctx.translate(W*SAFE.x,H*SAFE.y);w=W*SAFE.w;h=H*SAFE.h;
    y=clamp((y/100*H-H*SAFE.y)/(H*SAFE.h)*100,6,94);
  }
  const L={ctx,cfg,W:w,H:h,cy:y/100*h,sf:Math.round(sizeScale*(opt.safeZone!==false?.88:1)),color:cfg.color||'#ffffff',
    wt:opt.wordTimes&&opt.time!=null?opt.wordTimes:null,t:opt.time};
  ctx.textBaseline='middle';
  if(cfg.family==='brat')drawBrat(L,opt.text);
  else if(cfg.family==='neon')drawNeon(L,opt.text);
  else drawGen(L,opt.text);
  ctx.restore();
}
// secondi passati da quando la parola i è comparsa (9 = comparsa da tempo / nessun timing); <0 = non ancora
function elapsed(L,i){if(!L.wt)return 9;const t=L.wt[i];return t==null?9:L.t-t;}
// indice dell'ultima parola già comparsa
function lastShown(L,n){if(!L.wt||L.wt.length!==n)return n-1;let k=-1;for(let i=0;i<n;i++)if(L.wt[i]!=null&&L.t>=L.wt[i])k=i;return k;}

// ─────────────────────────── BRAT ───────────────────────────
function bratLayout(L,text){
  const cfg=L.cfg,font=cfg.font||BRAT_FONT,words=splitWords(text.toLowerCase()).map((t,i)=>({t,i}));
  const rnd=rng(hashStr(text.toLowerCase())),mw=8.2/(cfg.size||1)*(cfg.wide||1);   // larghezza riga in em
  const c=document.createElement('canvas').getContext('2d');c.font=font(100);
  const em=w=>c.measureText(w.t).width/100*w.sc;
  words.forEach(w=>{w.sc=cfg.big?[.8,1,1,1.3,1.65,2.1][Math.floor(rnd()*6)]:1;});   // brat BIG: misure casuali
  const lines=[];let i=0;
  while(i<words.length){
    const target=2+Math.floor(rnd()*2),line=[];let sum=0;   // 2 o 3 parole per riga
    while(i<words.length&&line.length<target){const ew=em(words[i]);if(line.length&&sum+.35+ew>mw)break;line.push(words[i]);sum+=ew+(line.length>1?.35:0);i++;}
    if(!line.length){line.push(words[i]);i++;}
    const tot=line.reduce((s,w)=>s+em(w),0);
    const want=line.length===2?.8+rnd()*.5:line.length===3?.3+rnd()*.4:.45+rnd()*.2;
    const gap=line.length>1?Math.max(.12,Math.min(want,(mw-tot)/(line.length-1))):0;
    lines.push({words:line,gap,yJit:(rnd()-.5)*.08});
  }
  return{words,lines};
}
// brat dynamic: lettere visibili della parola i (scrittura lettera per lettera)
function typed(L,i,len){const el=elapsed(L,i);if(el===9)return len;if(el<0)return 0;return Math.min(len,Math.floor(el/.02)+1);}
function drawBrat(L,text){
  const {ctx,cfg,W,sf}=L,font=cfg.font||BRAT_FONT,ls=s=>(cfg.ls!=null?cfg.ls*s:-.085*s)+'px';
  const {words,lines}=bratLayout(L,text);
  if(L.wt&&L.wt.length!==words.length)L.wt=null;
  if(cfg.dyn){   // BRAT DYNAMIC: parte grande su una riga e si rimpicciolisce; quando non ci sta più passa al layout brat
    const shown=words.map((w,i)=>w.t.slice(0,typed(L,i,w.t.length))).filter(Boolean).join(' ');
    if(!shown)return;
    const maxW=W*.6;ctx.font=font(100);ctx.letterSpacing='-3px';
    const fit=Math.min(sf*1.5,maxW/(ctx.measureText(shown).width/100));
    if(fit>=sf*1.02){
      ctx.font=font(fit);ctx.letterSpacing=(-.03*fit)+'px';ctx.textAlign='left';ctx.fillStyle=L.color;
      ctx.shadowColor=L.color;ctx.shadowBlur=fit*.1;ctx.fillText(shown,(W-maxW)/2,L.cy);
      ctx.shadowBlur=fit*.3;ctx.globalAlpha*=.45;ctx.fillText(shown,(W-maxW)/2,L.cy);
      return;
    }
  }
  const lh=sf*1.42,lhs=lines.map(l=>lh*Math.max(1,Math.max(...l.words.map(w=>w.sc))*.85)),ys=[];
  let acc=L.cy-lhs.reduce((a,b)=>a+b,0)/2;lhs.forEach(h=>{ys.push(acc+h/2);acc+=h;});
  ctx.textAlign='left';
  lines.forEach((l,li)=>{
    const y=ys[li]+l.yJit*sf,sizes=l.words.map(w=>sf*w.sc);
    const ws=l.words.map((w,k)=>{ctx.font=font(sizes[k]);ctx.letterSpacing=ls(sizes[k]);return ctx.measureText(w.t).width;});
    const gap=l.words.length>1?l.gap*sf:0;
    let x=W/2-(ws.reduce((a,b)=>a+b,0)+(l.words.length-1)*gap)/2;
    l.words.forEach((w,k)=>{
      if(elapsed(L,w.i)>=0){
        const txt=cfg.dyn?w.t.slice(0,typed(L,w.i,w.t.length)):w.t;
        ctx.save();ctx.font=font(sizes[k]);ctx.letterSpacing=ls(sizes[k]);ctx.fillStyle=L.color;
        if(cfg.dyn){ctx.shadowColor=L.color;ctx.shadowBlur=sf*.1;}
        ctx.fillText(txt,x,y);
        if(cfg.dyn){ctx.shadowBlur=sf*.3;ctx.globalAlpha*=.45;ctx.fillText(txt,x,y);}   // leggero bloom
        ctx.restore();
      }
      x+=ws[k]+gap;
    });
  });
}

// ─────────────────────────── NEON ───────────────────────────
function drawNeon(L,text){
  const {ctx,cfg,W,sf}=L,words=splitWords(text.toUpperCase()),rnd=rng(hashStr(text));
  if(L.wt&&L.wt.length!==words.length)L.wt=null;
  const meta=words.map(()=>{const r=rnd();return{big:r<.22,small:r>.72,cyan:rnd()<.35,blink:rnd()<.45,freq:1.2+rnd()*2.6,phase:rnd()*Math.PI*2};});
  const sizes=meta.map(m=>sf*(m.big?1.35:m.small?.72:1));
  const ws=words.map((t,i)=>{ctx.font=cfg.font(sizes[i]);return ctx.measureText(t).width;});
  const gap=sf*.38,lines=[];let cur=[],cw=0;
  words.forEach((_,i)=>{const add=cur.length?gap+ws[i]:ws[i];if(cw+add>W*.88&&cur.length){lines.push(cur);cur=[i];cw=ws[i];}else{cur.push(i);cw+=add;}});
  if(cur.length)lines.push(cur);
  const lh=sf*1.55,y0=L.cy-(lines.length-1)*lh/2,now=L.t!=null?L.t:performance.now()/1000;
  ctx.textAlign='left';
  lines.forEach((ln,li)=>{
    let x=W/2-(ln.reduce((a,i)=>a+ws[i],0)+(ln.length-1)*gap)/2;const y=y0+li*lh;
    ln.forEach(i=>{
      const el=elapsed(L,i),m=meta[i],size=sizes[i];
      if(el>=0){
        let alpha=Math.min(1,el/.18);
        if(m.blink&&Math.sin(now*m.freq*Math.PI*2+m.phase)>0)alpha*=.12;   // lampeggio
        const col=m.cyan?'#3ae6ff':L.color,blur=el<.35?(1-el/.35)*size*.5:0;
        ctx.save();ctx.globalAlpha*=alpha;ctx.font=cfg.font(size);
        if(m.big){ctx.translate(x+ws[i]/2,y);ctx.scale(1.05,1.05);ctx.translate(-(x+ws[i]/2),-y);}
        if(m.cyan){ctx.filter=`blur(${size*.18}px)`;ctx.shadowColor='rgba(58,230,255,.8)';ctx.shadowBlur=size*.4;ctx.fillStyle=col;ctx.fillText(words[i],x+sf*.05,y+sf*.05);ctx.filter='none';}
        if(blur>0)ctx.filter=`blur(${blur.toFixed(1)}px)`;
        ctx.shadowColor=m.cyan?'rgba(58,230,255,.85)':col;ctx.shadowBlur=size*.45;ctx.fillStyle=col;ctx.fillText(words[i],x,y);
        ctx.restore();
      }
      x+=ws[i]+gap;
    });
  });
}

// ─────────────────────────── GEN ───────────────────────────
function drawGen(L,text){
  const {ctx,cfg,W}=L;
  const words=splitWords(text).map(t=>cfg.case==='upper'?t.toUpperCase():cfg.case==='lower'?t.toLowerCase():t),n=words.length;
  if(!n)return;
  if(L.wt&&L.wt.length!==n)L.wt=null;
  const cs=cfg.chunk>0?cfg.chunk:n;
  const idx=L.wt?lastShown(L,n):Math.min(n-1,cs-1);   // senza timing: mostra il primo gruppo
  if(idx<0)return;
  const a=Math.floor(idx/cs)*cs,vis=words.slice(a,Math.min(n,a+cs));   // gruppo di parole a schermo
  let size=L.sf;
  const setFont=s=>{ctx.font=cfg.font(s);ctx.letterSpacing=((cfg.ls||0)*s)+'px';};
  setFont(size);ctx.textAlign='left';

  if(cfg.scatter){   // parole una sotto l'altra, misure/spostamenti/rotazioni casuali
    const rnd=rng(hashStr(vis.join(' '))),it=vis.map(()=>({m:.7+rnd()*.95,off:(rnd()-.5)*W*.24,rot:(rnd()-.5)*.1}));
    let yy=L.cy-it.reduce((s,o)=>s+size*o.m,0)/2;
    it.forEach((o,k)=>{
      const sz=size*o.m,gi=a+k;yy+=sz/2;setFont(sz);const w0=ctx.measureText(vis[k]).width;
      if(gi<=idx)paintWord(L,vis[k],W/2+o.off-w0/2,yy,w0,sz,elapsed(L,gi),gi,o.rot);
      yy+=sz/2;
    });
    return;
  }
  const maxW=W*(cfg.maxw||.86),xs=cfg.xs||1;
  let ws=vis.map(t=>ctx.measureText(t).width*xs);
  const widest=Math.max(...ws);
  if(widest>maxW){size*=maxW/widest;setFont(size);ws=vis.map(t=>ctx.measureText(t).width*xs);}   // parola troppo larga → più piccola
  const gap=size*(cfg.gap!=null?cfg.gap:.3),lines=[];let cur=[],cw=0;
  vis.forEach((_,k)=>{const add=cur.length?gap+ws[k]:ws[k];if(cw+add>maxW&&cur.length){lines.push(cur);cur=[k];cw=ws[k];}else{cur.push(k);cw+=add;}});
  if(cur.length)lines.push(cur);
  const lh=size*(cfg.lh||1.2),y0=L.cy-(lines.length-1)*lh/2;
  lines.forEach((ln,li)=>{
    let x=W/2-(ln.reduce((s,k)=>s+ws[k],0)+(ln.length-1)*gap)/2;
    ln.forEach(k=>{const gi=a+k;if(gi<=idx)paintWord(L,vis[k],x,y0+li*lh,ws[k],size,elapsed(L,gi),gi,0);x+=ws[k]+gap;});
  });
}

function paintWord(L,t,x,y,wd,size,el,gi,rot){
  const {ctx,cfg}=L,xs=cfg.xs||1,cx=x+wd/2,now=L.t!=null?L.t:performance.now()/1000;
  let txt=t,col=L.color,tx=cx-(wd/xs)/2;
  if(cfg.reveal==='type')txt=t.slice(0,Math.min(t.length,Math.floor(el/.05)+1));
  if(cfg.reveal==='ink'&&el<.2)col=mixCol('#5a5a5a',col,el/.2);   // inchiostro: da grigio a bianco
  ctx.save();
  if(cfg.reveal==='glitch')ctx.globalAlpha*=Math.min(1,el/.06);
  if(rot||xs!==1){ctx.translate(cx,y);if(rot)ctx.rotate(rot);ctx.scale(xs,1);ctx.translate(-cx,-y);}
  ctx.lineJoin='round';

  if(cfg.reveal==='glitch'){   // GLITCH: entra allungato in verticale, poi ogni tanto si spezza in strisce spostate
    const r=rng(Math.floor(now*9)*7919+gi*13)(),intro=el<.2;
    if(intro){const k=1+(1-el/.2)*2.4;ctx.translate(cx,y);ctx.scale(1,k);ctx.translate(-cx,-y);}
    if((intro||r>.9)&&r>.2){
      const n=7,hh=size*1.4/n,rr=rng(Math.floor(now*20)*31+gi);
      ctx.shadowColor='#fff';ctx.shadowBlur=size*.3;ctx.fillStyle=col;
      for(let k=0;k<n;k++){
        ctx.save();ctx.beginPath();ctx.rect(tx-size*3,y-size*.7+k*hh,wd+size*6,hh);ctx.clip();
        const o=(rr()-.5)*size*1.3,sx=.6+rr()*1.4;ctx.translate(cx+o,y);ctx.scale(sx,1);ctx.translate(-cx,-y);
        if(rr()>.18)ctx.fillText(txt,tx,y);ctx.restore();
      }
      ctx.restore();return;
    }
  }
  if(cfg.reveal==='ink'){paintInk(ctx,txt,tx,y,wd/xs,size,el,gi,now,col);ctx.restore();return;}

  if(cfg.drop&&!cfg.hollow){ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=cfg.drop*size;ctx.shadowOffsetY=cfg.drop*size*.25;}
  if(cfg.stroke){ctx.strokeStyle=cfg.strokeColor||'#000';ctx.lineWidth=cfg.stroke*size;ctx.strokeText(txt,tx,y);}
  if(cfg.hollow){ctx.strokeStyle=col;ctx.lineWidth=cfg.hollow*size;ctx.strokeText(txt,tx,y);ctx.restore();return;}
  if(cfg.glow){ctx.shadowColor=cfg.glowColor||col;ctx.shadowBlur=cfg.glow*size;ctx.shadowOffsetY=0;}
  else if(cfg.stroke){ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;}
  if(cfg.grad){const g=ctx.createLinearGradient(0,y-size*.55,0,y+size*.55);cfg.grad.forEach((c,i)=>g.addColorStop(i/(cfg.grad.length-1),c));ctx.fillStyle=g;}
  else ctx.fillStyle=col;
  ctx.fillText(txt,tx,y);
  if(cfg.glow){ctx.shadowBlur=cfg.glow*size*.45;ctx.fillText(txt,tx,y);}
  ctx.restore();
}

// INKED: testo su canvas trasparente → filtro SVG "gooey" (sfocatura + soglia sull'alpha) = bordi a goccia
// che si allargano come inchiostro; dalle lettere colano gocce.
let inkA=null,inkB=null;
function inkFilter(){
  if(document.getElementById('lyrInkGoo'))return;
  const d=document.createElement('div');
  d.innerHTML='<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="lyrInkGoo" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur id="lyrInkBlur" in="SourceGraphic" stdDeviation="3"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"/></filter></svg>';
  document.body.appendChild(d.firstChild);
}
function paintInk(ctx,txt,tx,y,w0,size,el,gi,now,col){
  if(!inkA){inkA=document.createElement('canvas');inkB=document.createElement('canvas');inkFilter();}
  const pad=Math.ceil(size*.7),W=Math.ceil(w0+pad*2),Hh=Math.ceil(size*3.2);
  if(inkA.width!==W||inkA.height!==Hh){inkA.width=inkB.width=W;inkA.height=inkB.height=Hh;}
  const a=inkA.getContext('2d'),b=inkB.getContext('2d'),spread=Math.min(1,el/.4),ox=pad,oy=Hh/2;
  a.clearRect(0,0,W,Hh);a.font=ctx.font;a.letterSpacing=ctx.letterSpacing;a.textBaseline='middle';a.textAlign='left';a.lineJoin='round';
  a.fillStyle=col;a.strokeStyle=col;a.lineWidth=size*(.005+.02*spread);
  for(let k=0;k<2;k++){const r=rng(Math.floor(now*10)*53+gi*7+k),jx=(r()-.5)*size*.03,jy=(r()-.5)*size*.03;a.strokeText(txt,ox+jx,oy+jy);a.fillText(txt,ox+jx,oy+jy);}
  const rd=rng(gi*977+11);
  for(let k=0;k<3;k++){   // gocce
    const dx=ox+(.12+rd()*.76)*w0,len=size*(.12+rd()*.4)*clamp((el-.12-k*.1)/.9,0,1),r=size*.03;
    if(len>1){a.beginPath();a.roundRect(dx-r,oy+size*.3,r*2,len,r);a.fill();a.beginPath();a.arc(dx,oy+size*.3+len,r*1.6,0,6.283);a.fill();}
  }
  document.getElementById('lyrInkBlur').setAttribute('stdDeviation',(size*(.055-.02*spread)).toFixed(2));
  b.clearRect(0,0,W,Hh);b.filter='url(#lyrInkGoo)';b.drawImage(inkA,0,0);b.filter='none';
  ctx.drawImage(inkB,tx-pad,y-Hh/2);
}

return{STYLES,loadFonts,drawLine};
})();
