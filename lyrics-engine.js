/*
 * lyrics-engine.js — motore di rendering dei lyrics su canvas (anteprima ed export usano lo stesso codice).
 *
 * Dipendenze dalla pagina che lo include:
 *   - un oggetto globale `S` con: textStyle, fontSize, capPos, txColor, olColor, olOn, capFont, wordFx, karaoke,
 *     textMode ('lyrics'|'hook'|'both'|'off'), hookText, hookSize, bars, tk (zona sicura TikTok)
 *   - (opzionale) un elemento #videoCon: la sua altezza è la "dimensione di riferimento" dei font
 *
 * API principale:
 *   drawOverlay(ctx, W, H, {text, p, ta, kp, wt, tNow, preview, style})   disegna lyrics (+ hook) su un canvas
 *   STYLES                                                                elenco stili
 *   ensureFonts()                                                         precarica i font usati
 */
let _segDur=0,_segEndAbs=null;
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function lyrRefH(){const v=document.getElementById('videoCon');return (v&&v.clientHeight)||428;}
function ensureInkFilter(){
  if(document.getElementById('inkGoo'))return;
  const d=document.createElement('div');
  d.innerHTML='<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="inkGoo" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur id="inkBlur" in="SourceGraphic" stdDeviation="3"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"/></filter></svg>';
  document.body.appendChild(d.firstChild);
}

function parseEmphasis(text){
  const tokens=[];let i=0,cur='';
  while(i<text.length){
    if(text[i]==='*'){
      const close=text.indexOf('*',i+1);
      if(close>i+1){if(cur){tokens.push({t:cur,em:false});cur='';}tokens.push({t:text.slice(i+1,close),em:true});i=close+1;continue;}
    }
    cur+=text[i];i++;
  }
  if(cur)tokens.push({t:cur,em:false});
  return tokens;
}
function tokenizeWords(text){
  const words=[];parseEmphasis(text).forEach(tk=>{tk.t.split(/(\s+)/).forEach(p=>{if(p)words.push({t:p,em:tk.em});});});
  return words;
}
function hexToRgba(hex,a){const h=hex.replace('#','');const n=parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;}
function esc(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function karaokeStates(words,kp){
  const ws=words.map(w=>Math.max(w.t.length,1));
  const total=ws.reduce((a,b)=>a+b,0)||1;
  const pos=Math.min(Math.max(kp,0),1)*total;
  let acc=0;
  return words.map((w,i)=>{const s=acc,e=acc+ws[i];acc=e;return{sung:e<=pos,active:s<=pos&&pos<e,start:s,end:e};});
}
function hashStr(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// Stili ispirati a viryl.studio (family:'gen' = motore generico a parole/chunk; le altre famiglie sono quelle storiche)
const STYLES={
  bratbig: {label:'brat BIG',family:'brat',font:'fnt-condensed',big:true,btn:"font:700 16px 'Arial Narrow',Arial,sans-serif;letter-spacing:-.05em;"},
  bratdyn: {label:'brat dynamic',family:'brat',font:'fnt-condensed',dyn:true,btn:"font:700 14px 'Arial Narrow',Arial,sans-serif;letter-spacing:-.05em;"},
  brat:    {label:'brat',family:'brat',font:'fnt-condensed',btn:"font:700 15px 'Arial Narrow',Arial,sans-serif;letter-spacing:-.06em;"},
  simple:  {label:'Simple',family:'gen',cf:s=>`500 ${s}px Montserrat,sans-serif`,case:'lower',size:.62,chunk:2,drop:.3,btn:"font:500 13px Montserrat,sans-serif;"},
  inked:   {label:'INKED',family:'gen',cf:s=>`400 ${s}px "Archivo Black",sans-serif`,case:'upper',size:1.25,chunk:1,reveal:'ink',ink:true,ls:.01,btn:"font:400 13px 'Archivo Black',sans-serif;"},
  bold:    {label:'BOLD',family:'gen',cf:s=>`400 ${s}px "Archivo Black",sans-serif`,case:'upper',size:1.4,chunk:1,drop:.2,ls:-.02,btn:"font:400 15px 'Archivo Black',sans-serif;"},
  hollow:  {label:'HOLLOW',family:'gen',cf:s=>`800 ${s}px Syne,sans-serif`,case:'upper',size:1.1,chunk:1,hollow:.035,ls:.02,btn:"font:800 12px Syne,sans-serif;"},
  subtitle:{label:'subtitle',family:'gen',cf:s=>`600 ${s}px Montserrat,sans-serif`,case:'lower',size:.5,chunk:3,stroke:.16,color:'#ffe14a',y:76,btn:"font:600 11px Montserrat,sans-serif;color:#ffe14a;"},
  elegant: {label:'ELEGANT',family:'gen',cf:s=>`700 ${s}px "Cormorant Garamond",serif`,case:'upper',size:1.8,chunk:0,xs:.92,ls:.02,lh:1.0,maxw:.92,gap:.26,grad:['rgba(255,255,255,.95)','rgba(232,222,200,.42)','rgba(255,255,255,.7)'],stroke:.012,strokeColor:'rgba(255,255,255,.8)',btn:"font:700 15px 'Cormorant Garamond',serif;letter-spacing:.1em;"},
  glitch:  {label:'GLITCH',family:'gen',cf:s=>`800 ${s}px Montserrat,sans-serif`,case:'upper',size:.9,chunk:2,reveal:'glitch',sliceFx:true,glow:.4,glowColor:'#ffffff',ls:.04,btn:"font:800 12px Montserrat,sans-serif;letter-spacing:.08em;text-shadow:-2px 0 #ff2d55,2px 0 #2dd4ff;"},
  handwritten:{label:'handwritten',family:'gen',cf:s=>`400 ${s}px Gaegu,cursive`,case:'lower',size:1.25,chunk:2,reveal:'type',btn:"font:400 15px Gaegu,cursive;"},
  cursive: {label:'cursive',family:'brat',font:'fnt-playfair',cf:s=>`italic 700 ${s}px "Playfair Display",serif`,ls:0,size:.62,wide:1.15,color:'#f0c64a',btn:"font:italic 700 14px 'Playfair Display',serif;"},
  edgy:    {label:'EDGY',family:'gen',cf:s=>`700 ${s}px UnifrakturCook,cursive`,case:'none',size:1.25,chunk:2,glow:.6,btn:"font:700 15px UnifrakturCook,cursive;"},
  neon:    {label:'Neon',family:'neon',font:'fnt-handneon',upper:true,btn:"font:400 15px 'Shadows Into Light',cursive;text-shadow:0 0 8px #fff;"},
  // ── dai video TikTok ──
  graffiti:{label:'GRAFFITI',family:'gen',cf:s=>`400 ${s}px "Sedgwick Ave Display",cursive`,case:'upper',size:1.7,chunk:1,btn:"font:400 16px 'Sedgwick Ave Display',cursive;"},
  serif:   {label:'SERIF GLOW',family:'gen',cf:s=>`700 ${s}px "Playfair Display",serif`,case:'upper',size:1.5,chunk:0,xs:.78,ls:-.01,lh:1.0,maxw:.94,gap:.25,glow:.5,glowColor:'#c9d8ff',btn:"font:700 13px 'Playfair Display',serif;letter-spacing:.04em;text-shadow:0 0 8px #c9d8ff;"},
  scribble:{label:'scribble',family:'gen',cf:s=>`400 ${s}px "Reenie Beanie",cursive`,case:'lower',size:2,chunk:3,scatter:true,drop:.25,btn:"font:400 20px 'Reenie Beanie',cursive;"},
  classic: {hidden:1,label:'Classico',family:'classic',font:'fnt-montserrat'},
};
function styleCfg(){return STYLES[S.textStyle]||STYLES.classic;}
function activeFamily(){return styleCfg().family;}
function bratWords(text){
  const cfg=styleCfg();
  const t=cfg.upper?text.toUpperCase():text.toLowerCase();
  return tokenizeWords(t).filter(w=>w.t.trim());
}
let _mc=null;
// brat dynamic: lettere visibili di una parola in base al tempo (scrittura lettera per lettera)
function dynChars(i,len,useTime,wt,tNow,kst,kpos){
  if(useTime){const tt=wt[i];if(tt==null)return len;const el=tNow-tt;if(el<0)return 0;return Math.min(len,Math.floor(el/.02)+1);}
  if(kst){const s=kst[i];if(s.sung)return len;if(s.active){const f=Math.min(1,Math.max(0,(kpos-s.start)/((s.end-s.start)||1)));return Math.min(len,Math.max(1,Math.ceil(f*len)));}return 0;}
  return len;
}
function emWidth(t,big){
  if(!_mc)_mc=document.createElement('canvas').getContext('2d');
  _mc.font=getCanvasFont(100);
  return (_mc.measureText(t).width/100)*(big||1);
}
const BRAT_MW_EM=8.2;
function bratMW(){const c=styleCfg();return BRAT_MW_EM/(c.size||1)*(c.wide||1);}
function bratLayout(text){
  const cfg=styleCfg();
  const words=bratWords(text);
  const rnd=mulberry32(hashStr(text.toLowerCase()));
  words.forEach((w,i)=>{w.i=i;w.sc=cfg.big?[.8,1,1,1.3,1.65,2.1][Math.floor(rnd()*6)]:1;});
  const lines=[];let i=0;
  while(i<words.length){
    const target=2+Math.floor(rnd()*2); // 2 or 3 words
    const line=[];let wsum=0;
    while(i<words.length&&line.length<target){
      const w=words[i],ew=emWidth(w.t,w.sc);
      if(line.length>0&&wsum+0.35+ew>bratMW())break;
      line.push(w);wsum+=ew+(line.length>1?0.35:0);i++;
    }
    if(!line.length){line.push(words[i]);i++;}
    let tot=0;line.forEach(w=>tot+=emWidth(w.t,w.sc));
    // spaziatura diversa in base al numero di parole per riga (più casualità)
    const desired=line.length===2?(0.8+rnd()*0.5):line.length===3?(0.3+rnd()*0.4):(0.45+rnd()*0.2);
    const maxGap=line.length>1?(bratMW()-tot)/(line.length-1):0;
    const gap=line.length>1?Math.max(0.12,Math.min(desired,maxGap)):0;
    lines.push({words:line,gap,yJit:(rnd()-.5)*.08});
  }
  return {words,lines};
}
function neonWords(text){
  const words=bratWords(text);
  const rnd=mulberry32(hashStr(text));
  words.forEach((w,i)=>{w.i=i;const r=rnd();w.big=r<0.22;w.small=r>0.72;w.cyan=rnd()<0.35;w.dy=(rnd()-.5)*0.06;w.blink=rnd()<0.45;w.freq=1.2+rnd()*2.6;w.phase=rnd()*Math.PI*2;w.period=2/w.freq;});
  return words;
}
function darkWords(text){return bratWords(text);}

async function ensureFonts(){
  const list=['800 20px Montserrat','500 20px Montserrat','900 20px Montserrat','400 20px Anton','900 20px Orbitron','400 20px "Share Tech Mono"','600 20px "Cormorant Garamond"','400 20px "Shadows Into Light"','700 20px UnifrakturCook','italic 700 20px "Playfair Display"','700 20px "Playfair Display"','400 20px Gaegu','800 20px Syne','400 20px "Archivo Black"','400 20px "Sedgwick Ave Display"','400 20px "Permanent Marker"','400 20px "Reenie Beanie"','400 20px Bangers','400 20px "Lilita One"','400 20px "Press Start 2P"','700 20px "Courier Prime"'];
  try{await Promise.all(list.map(f=>document.fonts.load(f,'Aa')));}catch(e){}
}

let _origH=null;
function tkRect(W,H){return{x:W*.17,y:H*.11,w:W*.66,h:H*.65};}   // centrata: ~17% liberi su entrambi i lati   // area libera da icone/caption di TikTok
function drawOverlay(ctx,W,H,o){
  ctx.globalAlpha=1;
  const tm=S.textMode;
  if((tm==='lyrics'||tm==='both')&&o.text&&o.text.trim()){
    const R=S.tk?tkRect(W,H):null,sv={s:S.textStyle,c:S.txColor,f:S.capFont,y:S.capPos};
    ctx.save();
    let w=W,h=H;
    try{
      if(o.style&&STYLES[o.style]&&o.style!==S.textStyle){   // stile per-riga (alternanza)
        const cf=STYLES[o.style];
        S.textStyle=o.style;S.txColor=cf.color||'#ffffff';if(cf.font)S.capFont=cf.font;if(cf.y!=null)S.capPos=cf.y;
      }
      if(R){ctx.translate(R.x,R.y);w=R.w;h=R.h;_origH=H;S.capPos=clamp((S.capPos/100*H-R.y)/R.h*100,6,94);}
      drawCapCanvas(ctx,o.text,w,h,o.p,o.ta,o.kp,o.wt,o.tNow);
    }finally{S.textStyle=sv.s;S.txColor=sv.c;S.capFont=sv.f;S.capPos=sv.y;_origH=null;ctx.restore();}
  }
  if(tm==='hook'||tm==='both')drawHook(ctx,W,H,o.preview);
}
function drawHook(ctx,W,H,preview){
  let text=(S.hookText||'').trim(),a=1;
  if(!text){if(!preview)return;text='il tuo hook qui';a=.4;}
  const phoneH=lyrRefH();
  const sf=Math.round(S.hookSize*(H/phoneH));
  ctx.save();
  ctx.globalAlpha=a;ctx.font=`800 ${sf}px Montserrat,sans-serif`;ctx.letterSpacing='0px';ctx.textAlign='center';ctx.textBaseline='middle';
  const maxW=W*.86,lines=[];
  text.split('\n').forEach(par=>{
    let cur='';
    par.split(/\s+/).filter(Boolean).forEach(w=>{const t=cur?cur+' '+w:w;if(ctx.measureText(t).width>maxW&&cur){lines.push(cur);cur=w;}else cur=t;});
    if(cur)lines.push(cur);
  });
  const lh=sf*1.25,yc=Math.max(S.tk?.14:0,(S.bars?.2:.16))*H,y0=yc-(lines.length-1)*lh/2;
  ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=sf*.25;ctx.shadowOffsetY=sf*.05;
  ctx.fillStyle='#fff';
  lines.forEach((l,i)=>ctx.fillText(l,W/2,y0+i*lh));
  ctx.restore();
}

// ── GEN family ──
function easeOutBack(t){const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);}
const SCR_CH='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=<>';
function scrambleTxt(t,el,seed){
  let o='';
  for(let j=0;j<t.length;j++){
    const rs=.04+(j/Math.max(1,t.length))*.3;
    if(el>rs||t[j]===' ')o+=t[j];
    else o+=SCR_CH[Math.floor(mulberry32(seed*131+j*17+Math.floor(el*28))()*SCR_CH.length)];
  }
  return o;
}
function genTA(ctx,ta,pr,W,cy,H){
  const q=1-pr;
  if(ta==='fade'||ta==='glitch')ctx.globalAlpha*=pr;
  else if(ta==='up'){ctx.translate(0,q*22);ctx.globalAlpha*=pr;}
  else if(ta==='left'){ctx.translate(q*48,0);ctx.globalAlpha*=pr;}
  else if(ta==='drop'){ctx.translate(0,-q*22);ctx.globalAlpha*=pr;}
  else if(ta==='zoom'){const sc=.55+pr*.45;ctx.translate(W/2,cy);ctx.scale(sc,sc);ctx.translate(-W/2,-cy);ctx.globalAlpha*=pr;}
  else if(ta==='pop'){const sc=1.4-pr*.4;ctx.translate(W/2,cy);ctx.scale(sc,sc);ctx.translate(-W/2,-cy);ctx.globalAlpha*=pr;}
  else if(ta==='bounce'){ctx.translate(0,q*q*46);ctx.globalAlpha*=Math.min(1,pr*1.6);}
  else if(ta==='flip'){ctx.translate(W/2,cy);ctx.scale(1,Math.max(pr,.05));ctx.translate(-W/2,-cy);ctx.globalAlpha*=pr;}
  else if(ta==='shake'){ctx.translate(Math.sin(q*Math.PI*7)*q*14,0);ctx.globalAlpha*=pr;}
  else if(ta==='swipe'){ctx.beginPath();ctx.rect(0,cy-H*.25,pr*W,H*.5);ctx.clip();}
}
function mixCol(a,b,k){const f=h=>{h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h,16);return[(n>>16)&255,(n>>8)&255,n&255];};const A=f(a),B=f(b);return'rgb('+A.map((v,i)=>Math.round(v+(B[i]-v)*k)).join(',')+')';}
let _inkA=null,_inkB=null;
function paintInk(ctx,txt,tx,y,w0,size,el,gi,tt,col){
  // INCHIOSTRO: testo su canvas trasparente -> filtro SVG "gooey" (sfocatura + soglia sull'alpha) = bordi a goccia,
  // il bordo si allarga come inchiostro che si spande e dalle lettere colano gocce. Nessun riquadro nero.
  if(!_inkA){_inkA=document.createElement('canvas');_inkB=document.createElement('canvas');}
  const pad=Math.ceil(size*.7),W=Math.ceil(w0+pad*2),Hh=Math.ceil(size*3.2);
  if(_inkA.width!==W||_inkA.height!==Hh){_inkA.width=_inkB.width=W;_inkA.height=_inkB.height=Hh;}
  const a=_inkA.getContext('2d'),b=_inkB.getContext('2d');
  a.setTransform(1,0,0,1,0,0);a.clearRect(0,0,W,Hh);a.filter='none';
  a.font=ctx.font;a.letterSpacing=ctx.letterSpacing;a.textBaseline='middle';a.textAlign='left';a.lineJoin='round';
  const spread=Math.min(1,el/.4),st=Math.floor(tt*10),ox=pad,oy=Hh/2;
  a.fillStyle=col;a.strokeStyle=col;a.lineWidth=size*(.005+.02*spread);
  for(let k=0;k<2;k++){const rr=mulberry32(st*53+gi*7+k),jx=(rr()-.5)*size*.03,jy=(rr()-.5)*size*.03;a.strokeText(txt,ox+jx,oy+jy);a.fillText(txt,ox+jx,oy+jy);}
  const rd=mulberry32(gi*977+11);
  for(let k=0;k<3;k++){
    const dx=ox+(.12+rd()*.76)*w0,full=size*(.12+rd()*.4),len=full*Math.min(1,Math.max(0,(el-.12-k*.1)/.9)),r=size*.03;
    if(len>1){a.beginPath();a.roundRect(dx-r,oy+size*.3,r*2,len,r);a.fill();a.beginPath();a.arc(dx,oy+size*.3+len,r*1.6,0,6.283);a.fill();}
  }
  ensureInkFilter();const fe=document.getElementById('inkBlur');if(fe)fe.setAttribute('stdDeviation',(size*(.055-.02*spread)).toFixed(2));
  b.setTransform(1,0,0,1,0,0);b.clearRect(0,0,W,Hh);b.filter='url(#inkGoo)';b.drawImage(_inkA,0,0);b.filter='none';
  ctx.drawImage(_inkB,tx-pad,y-Hh/2);
}
function paintGenWord(ctx,cfg,t,x,y,wd,size,el,gi,tNow,act,pending,rotIn){
  const u=Math.min(1,el/.28),rv=cfg.reveal||'none';
  let alpha=1,scale=1,dx=0,dy=0,blur=0,glowFx=0,txt=t,clipF=1,extraLs=0,darkT=1;
  if(rv==='fade')alpha=Math.min(1,el/.2);
  else if(rv==='blur'){alpha=Math.min(1,el/.16);blur=(1-u)*size*.3;}
  else if(rv==='pop'){alpha=Math.min(1,el/.08);scale=.55+.45*easeOutBack(u);}
  else if(rv==='scramble'){alpha=Math.min(1,el/.05);if(el<.45)txt=scrambleTxt(t,el,gi+1);}
  else if(rv==='glitch')alpha=Math.min(1,el/.06);
  else if(rv==='slam'){alpha=Math.min(1,el/.05);scale=1+.9*Math.pow(Math.max(0,1-el/.16),2);if(el<.24)dy+=Math.sin(el*95)*(1-el/.24)*size*.05;}
  else if(rv==='wipe'){alpha=1;clipF=Math.min(1,el/.3);}
  else if(rv==='track'){alpha=Math.min(1,el/.35);extraLs=(1-Math.min(1,el/.9))*.12;}
  else if(rv==='rise'){alpha=Math.min(1,el/.25);dy+=(1-Math.min(1,el/.3))*size*.45;}
  else if(rv==='type'){alpha=1;txt=t.slice(0,Math.min(t.length,Math.floor(el/.05)+1));}
  else if(rv==='ink'){alpha=Math.min(1,el/.04);darkT=Math.min(1,el/.2);}
  else if(rv==='flick'){alpha=el<.45?(Math.sin(el*75)>-.2?1:.2):1;}
  const le=Math.min(1,el/.4);
  if(S.wordFx==='bump')scale*=1+.3*Math.pow(1-le,2);
  else if(S.wordFx==='glow')glowFx=(1-le)*size*.85;
  else if(S.wordFx==='shake'){dx=Math.sin(el*30)*(1-le)*size*.06;dy=Math.cos(el*34)*(1-le)*size*.05;}
  if(pending){alpha=cfg.dim;scale=1;dx=0;dy=0;blur=0;glowFx=0;txt=t;}
  if(alpha<=0)return;
  const cx=x+wd/2,xs=cfg.xs||1;let col=(act&&cfg.hi)?cfg.hi:S.txColor,tx=cx-(wd/xs)/2;
  if(darkT<1)col=mixCol(cfg.ink?'#5a5a5a':'#161616',col,darkT);
  const tt0=tNow!=null?tNow:performance.now()/1000;
  if(cfg.jitter){const r1=mulberry32(Math.floor(tt0*12)*313+gi)(),r2=mulberry32(Math.floor(tt0*12)*571+gi)();dx+=(r1-.5)*size*.04;dy+=(r2-.5)*size*.04;}
  if(cfg.flicker)alpha*=.9+.1*Math.sin(tt0*38+gi)*Math.sin(tt0*17);
  if(cfg.float)dy+=Math.sin(tt0*2.2+gi)*size*cfg.float;
  ctx.save();
  ctx.globalAlpha*=alpha*(cfg.alpha||1);
  if(extraLs){ctx.letterSpacing=(((cfg.ls||0)+extraLs)*size)+'px';tx=cx-(ctx.measureText(txt).width)/2;}
  const rot=rotIn!=null?rotIn:(cfg.box?((gi%2)?.045:-.045):0);
  if(scale!==1||dx||dy||rot||xs!==1||cfg.skew){ctx.translate(cx+dx,y+dy);if(rot)ctx.rotate(rot);if(cfg.skew)ctx.transform(1,0,cfg.skew,1,0,0);ctx.scale(scale*xs,scale);ctx.translate(-cx,-y);}
  if(blur>.3)ctx.filter=`blur(${blur.toFixed(1)}px)`;
  ctx.textAlign='left';ctx.lineJoin='round';
  if(clipF<1){ctx.beginPath();ctx.rect(tx-size*.4,y-size*1.1,(wd/xs)*clipF+size*.4,size*2.2);ctx.clip();}
  if(cfg.sliceFx){   // GLITCH: intro allungato in verticale + raffiche a strisce
    const r=mulberry32(Math.floor(tt0*9)*7919+gi*13)(),intro=el<.2,burst=intro||r>.9;
    if(intro){const k=1+(1-el/.2)*2.4;ctx.translate(cx,y);ctx.scale(1,k);ctx.translate(-cx,-y);}
    if(burst&&r>.2){
      const n=7,hh=size*1.4/n,rr=mulberry32(Math.floor(tt0*20)*31+gi);
      ctx.shadowColor='#fff';ctx.shadowBlur=size*.3;ctx.fillStyle=col;
      for(let k=0;k<n;k++){ctx.save();ctx.beginPath();ctx.rect(tx-size*3,y-size*.7+k*hh,wd+size*6,hh);ctx.clip();
        const o=(rr()-.5)*size*1.3,sx=.6+rr()*1.4;ctx.translate(cx+o,y);ctx.scale(sx,1);ctx.translate(-cx,-y);
        if(rr()>.18)ctx.fillText(txt,tx,y);ctx.restore();}
      ctx.restore();return;
    }
  }
  if(cfg.ink){paintInk(ctx,txt,tx,y,wd/xs,size,el,gi,tt0,col);ctx.restore();return;}
  const strokeOn=cfg.stroke&&(S.olOn||cfg.strokeColor);
  if(cfg.dbl){ctx.save();ctx.globalAlpha*=cfg.dbl.a;ctx.fillStyle=col;ctx.shadowColor=cfg.glowColor||col;ctx.shadowBlur=(cfg.glow||0)*size*.6;ctx.fillText(txt,tx,y+cfg.dbl.dy*size*(.25+.75*Math.min(1,el/.9))+Math.sin(tt0*9)*size*.01);ctx.restore();}
  if(cfg.box){const pad=size*.28,bh=size*1.3;ctx.fillStyle=S.txColor;ctx.beginPath();ctx.roundRect(x-pad,y-bh/2,wd+pad*2,bh,size*.2);ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=size*.3;ctx.shadowOffsetY=size*.08;ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;}
  if(cfg.hard&&S.olOn){
    ctx.fillStyle=cfg.hard.c;ctx.strokeStyle=cfg.hard.c;ctx.lineWidth=(cfg.stroke||0)*size;
    ctx.strokeText(txt,tx+cfg.hard.dx*size,y+cfg.hard.dy*size);ctx.fillText(txt,tx+cfg.hard.dx*size,y+cfg.hard.dy*size);
  }
  if(cfg.drop&&!cfg.hollow){ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=cfg.drop*size;ctx.shadowOffsetY=cfg.drop*size*.25;}
  if(strokeOn){ctx.strokeStyle=(darkT<1&&cfg.strokeColor)?col:(cfg.strokeColor||S.olColor);ctx.lineWidth=cfg.stroke*size;ctx.strokeText(txt,tx,y);}
  if(cfg.hollow){
    ctx.shadowColor=S.txColor;ctx.shadowBlur=glowFx;ctx.shadowOffsetY=0;
    ctx.strokeStyle=S.txColor;ctx.lineWidth=cfg.hollow*size;ctx.strokeText(txt,tx,y);
  }else{
    if(cfg.glow){ctx.shadowColor=cfg.glowColor||col;ctx.shadowBlur=cfg.glow*size+glowFx;ctx.shadowOffsetY=0;}
    else if(glowFx>0){ctx.shadowColor=S.txColor;ctx.shadowBlur=glowFx;ctx.shadowOffsetY=0;}
    else if(strokeOn){ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;}
    if(cfg.grad){const g=ctx.createLinearGradient(0,y-size*.55,0,y+size*.55);cfg.grad.forEach((c,i)=>g.addColorStop(i/(cfg.grad.length-1),c));ctx.fillStyle=g;}
    else ctx.fillStyle=cfg.box?(cfg.boxText||'#000'):col;
    ctx.fillText(txt,tx,y);
    if(cfg.glow){ctx.shadowBlur=cfg.glow*size*.45;ctx.fillText(txt,tx,y);}
  }
  ctx.restore();
}
function drawGen(ctx,cfg,text,W,H,pr,ta,kp,wt,tNow,sf){
  const words=tokenizeWords(text).filter(w=>w.t.trim()).map(w=>({t:cfg.case==='upper'?w.t.toUpperCase():cfg.case==='lower'?w.t.toLowerCase():w.t}));
  const n=words.length;if(!n)return;
  const timed=!!(wt&&wt.length===n&&tNow!=null);
  const cs=cfg.chunk>0?cfg.chunk:n;
  let idx=Math.min(n-1,cs-1),st=null;   // senza timing (anteprima statica): mostra il primo chunk
  if(timed){idx=-1;for(let i=0;i<n;i++)if(wt[i]!=null&&tNow>=wt[i])idx=i;}
  else if(kp!=null){st=karaokeStates(words,kp);idx=-1;for(let i=0;i<n;i++){if(st[i].sung||st[i].active)idx=i;else break;}}
  if(idx<0)return;
  const elOf=i=>{
    if(timed)return wt[i]!=null?Math.max(0,tNow-wt[i]):9;
    if(st&&_segDur>0){const tot=st[n-1].end;return Math.max(0,(kp*tot-st[i].start)/tot*_segDur);}
    return 9;
  };
  const a=Math.floor(idx/cs)*cs,b=Math.min(n,a+cs),vis=words.slice(a,b);
  let size=sf;
  ctx.font=getCanvasFont(size);ctx.letterSpacing=((cfg.ls||0)*size)+'px';ctx.textBaseline='middle';ctx.textAlign='left';
  if(cfg.scatter){
    const rnd=mulberry32(hashStr(vis.map(w=>w.t).join(' ')));
    const it=vis.map(w=>({w,m:.7+rnd()*.95,off:(rnd()-.5)*W*.24,rot:(rnd()-.5)*.1}));
    const hs=it.map(o=>size*o.m*1.0),tot=hs.reduce((s,h)=>s+h,0),cy0=S.capPos/100*H;
    ctx.save();if(ta&&ta!=='none')genTA(ctx,ta,pr,W,cy0,H);
    let yy=cy0-tot/2;
    it.forEach((o,i)=>{const sz=size*o.m,gi=a+i;yy+=hs[i]/2;
      ctx.font=getCanvasFont(sz);const w0=ctx.measureText(o.w.t).width;
      if(gi<=idx)paintGenWord(ctx,cfg,o.w.t,W/2+o.off-w0/2,yy,w0,sz,elOf(gi),gi,tNow,gi===idx,false,o.rot);
      else if(cfg.dim!=null)paintGenWord(ctx,cfg,o.w.t,W/2+o.off-w0/2,yy,w0,sz,9,gi,tNow,false,true,o.rot);
      yy+=hs[i]/2;});
    ctx.restore();ctx.letterSpacing='0px';return;
  }
  const maxW=W*(cfg.maxw||.86);
  let ww=vis.map(w=>ctx.measureText(w.t).width*(cfg.xs||1));
  {const mw=Math.max(...ww);if(mw>maxW){size*=maxW/mw;ctx.font=getCanvasFont(size);ctx.letterSpacing=((cfg.ls||0)*size)+'px';ww=vis.map(w=>ctx.measureText(w.t).width*(cfg.xs||1));}}   // una parola troppo larga viene rimpicciolita
  const gap=size*(cfg.gap!=null?cfg.gap:.3);
  const lines=[];let cur=[],cw=0;
  vis.forEach((w,i)=>{const add=cur.length?gap+ww[i]:ww[i];if(cw+add>maxW&&cur.length){lines.push(cur);cur=[i];cw=ww[i];}else{cur.push(i);cw+=add;}});
  if(cur.length)lines.push(cur);
  const lh=size*(cfg.lh||1.2),cy=S.capPos/100*H,y0=cy-(lines.length-1)*lh/2;
  let tLeft=null;
  if(cfg.exit){
    if(timed){const endAbs=(b<n&&wt[b]!=null)?wt[b]:_segEndAbs;if(endAbs!=null)tLeft=endAbs-tNow;}
    else if(st&&_segDur>0){const tot=st[n-1].end;tLeft=((b<n?st[b].start/tot:1)-kp)*_segDur;}
  }
  ctx.save();
  if(ta&&ta!=='none')genTA(ctx,ta,pr,W,cy,H);
  if(tLeft!=null&&tLeft<.16){const u=clamp(1-tLeft/.16,0,1);ctx.translate(W/2,cy);ctx.scale(1+u*2.6,Math.max(.03,1-u*.97));ctx.translate(-W/2,-cy);}
  lines.forEach((ln,li)=>{
    const tot=ln.reduce((s,i)=>s+ww[i],0)+(ln.length-1)*gap;
    let x=W/2-tot/2;const y=y0+li*lh;
    ln.forEach(i=>{
      const gi=a+i;
      if(gi<=idx)paintGenWord(ctx,cfg,vis[i].t,x,y,ww[i],size,elOf(gi),gi,tNow,gi===idx,false);
      else if(cfg.dim!=null)paintGenWord(ctx,cfg,vis[i].t,x,y,ww[i],size,9,gi,tNow,false,true);
      x+=ww[i]+gap;
    });
  });
  ctx.restore();ctx.letterSpacing='0px';
}

// ═══════════════════════════════════
// CANVAS CAPTION
// ═══════════════════════════════════
function getCanvasFont(fs){
  const _c=styleCfg();if(_c.cf)return _c.cf(fs);
  const m={'fnt-montserrat':`900 ${fs}px Montserrat,sans-serif`,'fnt-brat':`800 ${fs}px Arial,"Helvetica Neue",Helvetica,sans-serif`,'fnt-condensed':`700 ${fs}px "Arial Narrow","Helvetica Neue",Helvetica,Arial,sans-serif`,'fnt-anton':`400 ${fs}px Anton,sans-serif`,'fnt-pixel':`400 ${fs}px "Press Start 2P",monospace`,'fnt-handneon':`400 ${fs}px "Shadows Into Light",cursive`,'fnt-tech':`400 ${fs}px "Share Tech Mono",monospace`,'fnt-orbit':`700 ${fs}px "Orbitron",sans-serif`,'fnt-playfair':`italic 700 ${fs}px "Playfair Display",serif`,'fnt-bebas':`400 ${fs}px "Bebas Neue",sans-serif`,'fnt-bangers':`400 ${fs}px Bangers,cursive`,'fnt-lilita':`400 ${fs}px "Lilita One",cursive`,'fnt-boogaloo':`400 ${fs}px Boogaloo,cursive`,'fnt-retro':`700 ${fs}px "Courier Prime",monospace`,'fnt-hand':`700 ${fs}px "Dancing Script",cursive`,'fnt-marker':`400 ${fs}px "Permanent Marker",cursive`};
  return m[S.capFont]||`900 ${fs}px Montserrat,sans-serif`;
}
function drawCapCanvas(ctx,text,W,H,p,ta,kp,wt,tNow){
  if(!text||!text.trim())return;
  const phoneH=lyrRefH();
  const cfg0=styleCfg();
  const sf=Math.round(S.fontSize*(cfg0.size||1)*((_origH||H)/phoneH)*(_origH?.88:1));
  const pr=(ta&&ta!=='none')?(p!=null?Math.min(p,1):1):1;   // senza animazione di entrata niente dissolvenza

  // ── BRAT / SINGLE STYLE ──
  if(activeFamily()!=='classic'){
    const cfg=styleCfg();
    const lsPx=size=>(cfg.ls!=null?cfg.ls*size:((S.capFont==='fnt-condensed')?(-0.085*size):0))+'px';
    ctx.textBaseline='middle';

    if(cfg.family==='gen'){drawGen(ctx,cfg,text,W,H,pr,ta,kp,wt,tNow,sf);return;}

    // SINGLE: una parola alla volta
    if(cfg.family==='single'){
      const words=bratWords(text);
      const useTime=!!(wt&&wt.length===words.length&&tNow!=null);
      let idx=-1;
      if(useTime){for(let i=0;i<words.length;i++){if(wt[i]!=null&&tNow>=wt[i])idx=i;}}
      else if(kp!=null){const st=karaokeStates(words,kp);for(let i=0;i<st.length;i++){if(st[i].sung||st[i].active)idx=i;else break;}}
      else idx=0;
      if(idx<0){return;}
      const w=words[idx],y=S.capPos/100*H;
      const el=(useTime&&wt[idx]!=null)?(tNow-wt[idx]):9;
      let alpha=Math.min(1,el/0.18),scale=1,dx=0,dy=0,blur=0;
      const le=Math.min(1,el/0.45);
      if(S.wordFx==='bump')scale=1+.3*Math.pow(1-le,2);
      else if(S.wordFx==='glow')blur=(1-le)*sf*.9;
      else if(S.wordFx==='shake'){dx=Math.sin(el*30)*(1-le)*sf*.06;dy=Math.cos(el*34)*(1-le)*sf*.05;}
      ctx.font=getCanvasFont(sf);ctx.letterSpacing=lsPx(sf);ctx.textAlign='center';
      ctx.save();ctx.globalAlpha*=alpha*pr;
      if(scale!==1||dx||dy){ctx.translate(W/2+dx,y+dy);ctx.scale(scale,scale);ctx.translate(-W/2,-y);}
      if(blur>0){ctx.shadowColor=S.txColor;ctx.shadowBlur=blur;}
      ctx.fillStyle=S.txColor;ctx.fillText(w.t,W/2,y);
      ctx.restore();ctx.letterSpacing='0px';return;
    }

    // NEON family (handwritten, glow, cyan words, blur-in)
    if(cfg.family==='neon'){
      const words=neonWords(text);
      const useTime=!!(wt&&wt.length===words.length&&tNow!=null);
      const mW=W*.88,gapW=sf*.38;
      const sizes=words.map(w=>sf*(w.big?1.35:w.small?0.72:1));
      const wsW=words.map((w,i)=>{ctx.font=getCanvasFont(sizes[i]);return ctx.measureText(w.t).width;});
      const lines=[];let cur=[],curW=0;
      for(let i=0;i<words.length;i++){
        const add=cur.length?gapW+wsW[i]:wsW[i];
        if(curW+add>mW&&cur.length){lines.push(cur);cur=[i];curW=wsW[i];}
        else{cur.push(i);curW+=add;}
      }
      if(cur.length)lines.push(cur);
      const lh=sf*1.55,sy0=S.capPos/100*H-(lines.length-1)*lh/2;
      ctx.textAlign='left';
      lines.forEach((line,li)=>{
        const tot=line.reduce((a,b)=>a+wsW[b],0)+(line.length-1)*gapW;
        let x=W/2-tot/2;
        const y=sy0+li*lh;
        line.forEach(wi=>{
          const w=words[wi],ww=wsW[wi],size=sizes[wi];
          ctx.font=getCanvasFont(size);ctx.letterSpacing=lsPx(size);
          let alpha=0,el=9;
          if(useTime){const t=wt[w.i];if(t==null){el=9;}else if(tNow>=t){el=tNow-t;alpha=Math.min(1,el/0.18);}else alpha=0;}
          else if(kp!=null){const st=karaokeStates(words,kp);alpha=st[wi].sung?1:(st[wi].active?1:0);}
          else alpha=1;
          if(alpha<=0){x+=ww+gapW;return;}
          if(w.blink){
            const bt=useTime?tNow:((kp!=null)?kp*10:0);
            if(Math.sin(bt*w.freq*Math.PI*2+w.phase)>0)alpha*=.12;else alpha*=1;
          }
          ctx.save();ctx.globalAlpha*=alpha*pr;
          const blurPx=(useTime&&wt[w.i]!=null)?Math.max(0,(1-Math.min(1,el/0.35))*size*0.5):0;
          if(w.big){ctx.translate(x+ww/2,y);ctx.scale(1.05,1.05);ctx.translate(-(x+ww/2),-y);}
          const col=w.cyan?'#3ae6ff':S.txColor;
          // cyan double/glitch copy
          if(w.cyan){ctx.filter=`blur(${size*0.18}px)`;ctx.shadowColor='rgba(58,230,255,.8)';ctx.shadowBlur=size*0.4;ctx.fillStyle=col;ctx.fillText(w.t,x+sf*.05,y+sf*.05);ctx.filter='none';ctx.shadowBlur=0;}
          if(blurPx>0)ctx.filter=`blur(${blurPx.toFixed(1)}px)`;
          ctx.shadowColor=w.cyan?'rgba(58,230,255,.85)':S.txColor;ctx.shadowBlur=size*0.45;
          ctx.fillStyle=col;ctx.fillText(w.t,x,y);
          ctx.restore();
          x+=ww+gapW;
        });
      });
      ctx.filter='none';ctx.shadowBlur=0;ctx.letterSpacing='0px';return;
    }

    // DARK family (futuristic / dystopian HUD)
    if(cfg.family==='dark'){
      const words=darkWords(text);
      const useTime=!!(wt&&wt.length===words.length&&tNow!=null);
      const mW=W*.88,gapW=sf*.42;
      ctx.font=getCanvasFont(sf);ctx.letterSpacing=lsPx(sf);
      const wsW=words.map(w=>ctx.measureText(w.t).width);
      const lines=[];let cur=[],curW=0;
      for(let i=0;i<words.length;i++){const add=cur.length?gapW+wsW[i]:wsW[i];if(curW+add>mW&&cur.length){lines.push(cur);cur=[i];curW=wsW[i];}else{cur.push(i);curW+=add;}}
      if(cur.length)lines.push(cur);
      const lh=sf*1.5,sy0=S.capPos/100*H-(lines.length-1)*lh/2;
      // HUD panel
      let maxW=0;lines.forEach(line=>{let tw=line.reduce((a,b)=>a+wsW[b],0)+(line.length-1)*gapW;if(tw>maxW)maxW=tw;});
      const padX=sf*.5,padY=sf*.55,top=sy0-lh*.62-padY,bot=sy0+(lines.length-1)*lh+lh*.55+padY;
      ctx.save();
      ctx.fillStyle='rgba(3,12,14,.62)';ctx.strokeStyle='rgba(95,251,241,.35)';ctx.lineWidth=Math.max(1,sf*.02);
      ctx.beginPath();ctx.roundRect(W/2-maxW/2-padX,top,maxW+padX*2,bot-top,sf*.22);ctx.fill();ctx.stroke();
      ctx.clip();
      ctx.strokeStyle='rgba(95,251,241,.05)';ctx.lineWidth=1;
      for(let sy=top;sy<bot;sy+=sf*.14){ctx.beginPath();ctx.moveTo(W/2-maxW/2-padX,sy);ctx.lineTo(W/2+maxW/2+padX,sy);ctx.stroke();}
      ctx.restore();
      ctx.textAlign='left';
      lines.forEach((line,li)=>{
        const tot=line.reduce((a,b)=>a+wsW[b],0)+(line.length-1)*gapW;
        let x=W/2-tot/2;const y=sy0+li*lh;
        line.forEach(wi=>{
          const w=words[wi],ww=wsW[wi];
          let alpha=0,el=9;
          if(useTime){const t=wt[w.i];if(t==null){el=9;}else if(tNow>=t){el=tNow-t;alpha=Math.min(1,el/0.16);}else alpha=0;}
          else if(kp!=null){const st=karaokeStates(words,kp);alpha=(st[wi].sung||st[wi].active)?1:0;}
          else alpha=1;
          if(alpha<=0){x+=ww+gapW;return;}
          const gOff=(useTime&&wt[w.i]!=null)?Math.max(0,(1-Math.min(1,el/0.28)))*sf*.14:0;
          ctx.save();ctx.globalAlpha*=alpha*pr;
          if(gOff>0){
            ctx.fillStyle='#ff2b4e';ctx.fillText(w.t,x-gOff,y);
            ctx.fillStyle='#00fff0';ctx.fillText(w.t,x+gOff,y);
          }
          ctx.shadowColor='rgba(111,252,242,.8)';ctx.shadowBlur=sf*.35;
          ctx.fillStyle='#6ffcf2';ctx.fillText(w.t,x,y);
          ctx.restore();
          x+=ww+gapW;
        });
      });
      ctx.shadowBlur=0;ctx.letterSpacing='0px';return;
    }

    // BRAT family (brat, bratbig, echo, hype)
    const lh=sf*1.42;
    const {words,lines}=bratLayout(text);
    const useTime=!!(wt&&wt.length===words.length&&tNow!=null);
    const kst=(!useTime&&S.karaoke&&kp!=null)?karaokeStates(words,kp):null;
    const ktot=kst?kst[kst.length-1].end:1;
    const kpos=kst?Math.min(Math.max(kp,0),1)*ktot:0;
    if(cfg.dyn){   // BRAT DYNAMIC: parte grande su una riga e si rimpicciolisce; quando non ci sta più passa al layout brat
      const ch=words.map((w,i)=>dynChars(i,w.t.length,useTime,wt,tNow,kst,kpos));
      const shown=words.map((w,i)=>w.t.slice(0,ch[i])).filter((s,i)=>ch[i]>0).join(' ');
      if(shown){
        const maxW1=W*.6,x0=(W-maxW1)/2;
        ctx.font=getCanvasFont(100);ctx.letterSpacing='-3px';
        const wEm=ctx.measureText(shown).width/100,fit=Math.min(sf*1.5,maxW1/wEm);
        if(fit>=sf*1.02){
          ctx.font=getCanvasFont(fit);ctx.letterSpacing=(-.03*fit)+'px';ctx.textAlign='left';ctx.textBaseline='middle';
          ctx.fillStyle=S.txColor;ctx.shadowColor=S.txColor;ctx.shadowBlur=fit*.1;ctx.fillText(shown,x0,S.capPos/100*H);ctx.shadowBlur=fit*.3;ctx.globalAlpha*=.45;ctx.fillText(shown,x0,S.capPos/100*H);ctx.shadowBlur=0;ctx.letterSpacing='0px';return;
        }
      }
    }
    const lhs=lines.map(l=>lh*Math.max(1,l.words.reduce((m,w)=>Math.max(m,w.sc||1),1)*.85)),ycs=[];
    {let acc=S.capPos/100*H-lhs.reduce((a,b)=>a+b,0)/2;lhs.forEach(h=>{ycs.push(acc+h/2);acc+=h;});}
    ctx.textAlign='left';
    lines.forEach((l,li)=>{
      const y=ycs[li]+l.yJit*sf;
      const n=l.words.length;
      const sizes=l.words.map(w=>sf*(w.sc||1));
      const wsW=l.words.map((w,i)=>{ctx.font=getCanvasFont(sizes[i]);return ctx.measureText(w.t).width;});
      const tot=wsW.reduce((a,b)=>a+b,0);
      const gap=n>1?l.gap*sf:0;
      let x=W/2-(tot+(n-1)*gap)/2;
      for(let wi=0;wi<n;wi++){
        const w=l.words[wi],ww=wsW[wi],size=sizes[wi];
        ctx.font=getCanvasFont(size);ctx.letterSpacing=lsPx(size);
        let alpha=1,scale=1,dx=0,dy=0,blur=0;
        if(useTime){
          const t=wt[w.i];
          if(t==null||tNow>=t){const el=t==null?9:(tNow-t);alpha=1;const le=Math.min(1,el/0.4);
            if(S.wordFx==='bump')scale=1+.3*Math.pow(1-le,2);
            else if(S.wordFx==='glow')blur=(1-le)*sf*.85;
            else if(S.wordFx==='shake'){dx=Math.sin(el*30)*(1-le)*sf*.06;dy=Math.cos(el*34)*(1-le)*sf*.04;}}
          else alpha=0;
        }else if(kst){
          const s=kst[w.i];
          if(s.sung)alpha=1;
          else if(s.active){const le=Math.min(Math.max((kpos-s.start)/((s.end-s.start)||1),0),1);
            if(S.wordFx==='bump'){alpha=1;scale=1+.3*Math.pow(1-le,2);}
            else if(S.wordFx==='glow'){alpha=1;blur=(1-le)*sf*.85;}
            else if(S.wordFx==='shake'){alpha=1;dx=Math.sin(le*Math.PI*10)*(1-le)*sf*.06;dy=Math.cos(le*Math.PI*12)*(1-le)*sf*.04;}
            else alpha=1;}
          else alpha=0;
        }
        if(alpha<=0){x+=ww+gap;continue;}
        ctx.save();
        ctx.globalAlpha*=alpha*pr;
        if(scale!==1||dx||dy){ctx.translate(x+ww/2+dx,y+dy);ctx.scale(scale,scale);ctx.translate(-(x+ww/2),-y);}
        if(cfg.box){const pad=size*.16,bh=size*1.24;ctx.fillStyle=cfg.box;ctx.beginPath();ctx.roundRect(x-pad,y-bh/2,ww+pad*2,bh,size*.12);ctx.fill();}
        if(cfg.echo){ctx.shadowColor=S.txColor;ctx.shadowBlur=sf*.55;ctx.shadowOffsetX=sf*.05;ctx.shadowOffsetY=sf*.05;}
        else if(cfg.dyn){ctx.shadowColor=S.txColor;ctx.shadowBlur=sf*.1;}
        else if(blur>0){ctx.shadowColor=S.txColor;ctx.shadowBlur=blur;}
        ctx.fillStyle=cfg.box?'#000':S.txColor;const dtxt=cfg.dyn?w.t.slice(0,dynChars(w.i,w.t.length,useTime,wt,tNow,kst,kpos)):w.t;ctx.fillText(dtxt,x,y);if(cfg.dyn){ctx.shadowBlur=sf*.3;ctx.globalAlpha*=.45;ctx.fillText(dtxt,x,y);}
        ctx.restore();
        x+=ww+gap;
      }
    });
    ctx.letterSpacing='0px';
    return;
  }

  // ── CLASSIC STYLE ──
  ctx.font=getCanvasFont(sf);
  ctx.letterSpacing=(S.capFont==='fnt-condensed'?(-0.085*sf):0)+'px';
  const mW=W*.88,lh=sf*1.16;
  const words=tokenizeWords(text);
  const measureLine=ws=>{let s='';ws.forEach(w=>s+=w.t);return ctx.measureText(s).width;};
  const lines=[];let cur=[];
  for(const w of words){
    if(!w.t.trim()){if(cur.length)cur.push(w);continue;}
    const test=cur.concat([w]);
    if(measureLine(test)>mW&&cur.some(x=>x.t.trim())){lines.push(cur);cur=[w];}
    else cur=test;
  }
  if(cur.some(x=>x.t.trim()))lines.push(cur);
  const sy=S.capPos/100*H-(lines.length-1)*lh/2;
  ctx.textBaseline='middle';
  lines.forEach((line,li)=>{
    const y=sy+li*lh;ctx.save();
    if(ta==='fade')ctx.globalAlpha=pr;
    else if(ta==='up'){ctx.translate(0,(1-pr)*22);ctx.globalAlpha=pr;}
    else if(ta==='left'){ctx.translate((1-pr)*48,0);ctx.globalAlpha=pr;}
    else if(ta==='drop'){ctx.translate(0,-(1-pr)*22);ctx.globalAlpha=pr;}
    else if(ta==='zoom'){const sc=.55+pr*.45;ctx.translate(W/2,y);ctx.scale(sc,sc);ctx.translate(-W/2,-y);ctx.globalAlpha=pr;}
    else if(ta==='pop'){const sc=1.4-pr*.4;ctx.translate(W/2,y);ctx.scale(sc,sc);ctx.translate(-W/2,-y);ctx.globalAlpha=pr;}
    else if(ta==='bounce'){const q=1-pr;ctx.translate(0,q*q*46);ctx.globalAlpha=Math.min(1,pr*1.6);}
    else if(ta==='flip'){ctx.translate(W/2,y);ctx.scale(1,Math.max(pr,.05));ctx.translate(-W/2,-y);ctx.globalAlpha=pr;}
    else if(ta==='shake'){ctx.translate(Math.sin((1-pr)*Math.PI*7)*(1-pr)*14,0);ctx.globalAlpha=pr;}
    else if(ta==='swipe'){ctx.beginPath();ctx.rect(0,y-lh*.65,pr*W,lh*1.1);ctx.clip();}
    else if(ta==='glitch')ctx.globalAlpha=pr;
    const lineTxt=line.map(w=>w.t).join('');
    const lw=measureLine(line);
    ctx.textAlign='center';
    if(S.glow){ctx.shadowColor=S.txColor;ctx.shadowBlur=sf*.35;}
    if(ta==='glitch'){
      const off=(1-pr)*16*(li%2?1:-1);
      ctx.globalAlpha=Math.min(1,(1-pr)*1.1);
      ctx.fillStyle='#ff2d55';ctx.fillText(lineTxt,W/2+off,y);
      ctx.fillStyle='#2dd4ff';ctx.fillText(lineTxt,W/2-off,y);
      ctx.globalAlpha=pr;
    }
    if(S.olOn){const o=S.olColor,ol=Math.max(Math.round(sf*.04),1);ctx.strokeStyle=o;ctx.lineWidth=ol;ctx.lineJoin='round';ctx.strokeText(lineTxt,W/2,y);}
    ctx.fillStyle=S.txColor;ctx.fillText(lineTxt,W/2,y);
    ctx.restore();
  });
  ctx.letterSpacing='0px';
}
