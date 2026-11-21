/*
 * lyrics-sync.js — lyrics automatici con Whisper, direttamente nel browser (Transformers.js, nessuna chiave).
 * Al primo uso scarica il modello (~150MB), poi resta nella cache del browser.
 *
 * API:
 *   whisperTranscribe(file, {onStatus, onProgress, language})      (Whisper gira in lyrics-worker.js, un Web Worker)
 *     trascrive TUTTA la canzone una volta sola
 *   → { words:[{w, start, end}, …], language:'en', duration }   tempi ASSOLUTI nella canzone (secondi); lingua rilevata da sola
 *
 *   groupWords(words, {max, gap})
 *     divide le parole in caption brevi (2–5 parole), spezzando sulle pause della voce e sulla punteggiatura
 *   → [[word, …], …]
 *
 *   alignLines(lines, words, start, end)
 *     mette a tempo righe scritte (o corrette) dall'utente usando le parole già trascritte: istantaneo, senza rifare Whisper
 *   → { lineTimes:[sec,…], wordTimes:[[sec,…],…], matched }   tempi ASSOLUTI; matched = quota di parole ritrovate (0–1)
 *
 *   whisperAlign(file, start, end, lines, {onStatus, language})
 *     versione "tutto in uno" su una sola parte della canzone (trascrive + allinea)
 *   → { lineTimes, wordTimes, recognized }
 */
// Whisper gira in un Web Worker (lyrics-worker.js, stessa cartella di questo file): l'editor resta fluido mentre trascrive.
const LS_WORKER_URL=new URL('lyrics-worker.js',(document.currentScript&&document.currentScript.src)||location.href);
let _lsW=null,_lsId=0;const _lsJobs={};
function lsNorm(s){return (s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');}
function lsWorker(){
  if(_lsW)return _lsW;
  _lsW=new Worker(LS_WORKER_URL,{type:'module'});
  _lsW.onmessage=e=>{const m=e.data,j=_lsJobs[m.id];if(!j)return;
    if(m.status)j.onStatus(m.status);
    if(m.progress!=null)j.onProgress(m.progress);
    if(m.done){delete _lsJobs[m.id];j.res(m);}
    if(m.error){delete _lsJobs[m.id];j.rej(new Error(m.error));}};
  _lsW.onerror=e=>{Object.keys(_lsJobs).forEach(id=>{_lsJobs[id].rej(new Error(e.message||'errore del worker'));delete _lsJobs[id];});};
  return _lsW;
}
// trascrive l'audio (16 kHz mono) → {language, chunks:[{text, timestamp:[s,e]}]} in secondi dall'inizio dell'audio
function lsRun(audio,opt){
  const w=lsWorker(),id=++_lsId;
  return new Promise((res,rej)=>{
    _lsJobs[id]={res,rej,onStatus:opt.onStatus||(()=>{}),onProgress:opt.onProgress||(()=>{})};
    const a=audio.slice();w.postMessage({id,audio:a,language:opt.language||null},[a.buffer]);
  });
}
// audio mono 16 kHz (quello che vuole Whisper), di tutta la canzone o di una parte
async function lsDecode(file,start,end){
  const tmp=new (window.AudioContext||window.webkitAudioContext)();
  const dec=await tmp.decodeAudioData(await file.arrayBuffer());
  if(end==null)end=dec.duration;
  const sr=16000,len=Math.max(1,Math.ceil((end-start)*sr));
  const off=new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(1,len,sr);
  const src=off.createBufferSource();src.buffer=dec;src.connect(off.destination);
  try{src.start(0,start,Math.max(.01,end-start));}catch(e){src.start(0);}
  const out=await off.startRendering();if(tmp.close)tmp.close();
  return{audio:out.getChannelData(0),duration:dec.duration};
}
// parole riconosciute → [{w, start, end, brk}] (brk = la parola chiude una frase: punteggiatura)
function lsWords(chunks,offset){
  const out=[];
  for(const c of chunks){
    if(!c.timestamp||c.timestamp[0]==null)continue;
    const raw=(c.text||'').trim();
    if(!raw||/^[\[(♪*].*|^[^\p{L}\p{N}]+$/u.test(raw))continue;   // [Music], (applausi), ♪ … : non sono parole cantate
    const w=raw.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu,'');
    if(!w)continue;
    const s=c.timestamp[0]+offset,e=(c.timestamp[1]!=null?c.timestamp[1]:c.timestamp[0]+.3)+offset;
    out.push({w,start:+s.toFixed(3),end:+Math.max(s+.05,e).toFixed(3),brk:/[.,!?;:…]$/.test(raw)});
  }
  return out;
}
async function whisperTranscribe(file,opt){
  opt=opt||{};const onStatus=opt.onStatus||(()=>{});
  onStatus('Ascolto la canzone…');
  const {audio,duration}=await lsDecode(file,0,null);
  const r=await lsRun(audio,opt);
  return{words:lsWords(r.chunks,0),language:r.language,duration};
}

function groupWords(words,opt){
  opt=opt||{};const MAX=opt.max||5,GAP=opt.gap!=null?opt.gap:.35;
  const G=[];let cur=[];
  words.forEach((w,i)=>{
    const prev=words[i-1];
    if(cur.length&&(cur.length>=MAX||w.start-prev.end>=GAP||prev.brk)){G.push(cur);cur=[];}
    cur.push(w);
  });
  if(cur.length)G.push(cur);
  // una parola da sola si unisce al gruppo vicino più "attaccato", se c'è spazio; altrimenti prende con sé l'ultima parola del gruppo prima
  for(let i=0;i<G.length;i++){
    if(G[i].length!==1||G.length<2)continue;
    const w=G[i][0],p=G[i-1],n=G[i+1];
    const gp=p?w.start-p[p.length-1].end:1e9,gn=n?n[0].start-w.end:1e9;
    if(p&&p.length<MAX&&gp<=gn&&gp<1){p.push(w);G.splice(i--,1);}
    else if(n&&n.length<MAX&&gn<1){n.unshift(w);G.splice(i--,1);}
    else if(p&&p.length>=3&&gp<1)G[i].unshift(p.pop());   // gruppo vicino pieno: gli prende l'ultima parola ("…chase | the stars")
  }
  return G;
}

// allineamento parole scritte ↔ parole riconosciute (programmazione dinamica)
function lsAlign(U,R){
  const n=U.length,m=R.length,dp=[];
  for(let i=0;i<=n;i++)dp.push(new Float32Array(m+1));
  for(let i=0;i<=n;i++)dp[i][0]=-.5*i;
  for(let j=0;j<=m;j++)dp[0][j]=-.5*j;
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){const s=(U[i-1]&&U[i-1]===R[j-1])?1:-.6;dp[i][j]=Math.max(dp[i-1][j-1]+s,dp[i-1][j]-.5,dp[i][j-1]-.5);}
  const map=new Array(n).fill(null);let i=n,j=m;
  while(i>0&&j>0){
    const s=(U[i-1]&&U[i-1]===R[j-1])?1:-.6;
    if(s>0&&Math.abs(dp[i][j]-(dp[i-1][j-1]+s))<1e-6){map[i-1]=j-1;i--;j--;}
    else if(Math.abs(dp[i][j]-(dp[i-1][j]-.5))<1e-6)i--;else j--;
  }
  return map;
}
function alignLines(lines,words,start,end){
  const R=words.filter(w=>w.start>=start-.05&&w.start<end).map(w=>({t:lsNorm(w.w),time:w.start})).filter(r=>r.t);
  const U=[],lineOf=[];
  lines.forEach((ln,li)=>ln.split(/\s+/).filter(Boolean).forEach(w=>{U.push(lsNorm(w));lineOf.push(li);}));
  const map=lsAlign(U,R.map(r=>r.t)),N=lines.length;
  const first=new Array(N).fill(null);
  for(let k=0;k<U.length;k++){const mi=map[k];if(mi!=null&&first[lineOf[k]]==null)first[lineOf[k]]=R[mi].time;}
  for(let i=0;i<N;i++){   // righe non riconosciute: interpolate tra le vicine
    if(first[i]!=null)continue;
    let p=i-1;while(p>=0&&first[p]==null)p--;let q=i+1;while(q<N&&first[q]==null)q++;
    const tp=p>=0?first[p]:null,tq=q<N?first[q]:null;
    if(tp!=null&&tq!=null)first[i]=tp+(tq-tp)*((i-p)/(q-p));
    else if(tp!=null)first[i]=Math.min(tp+.6*(i-p),end);
    else if(tq!=null)first[i]=Math.max(tq-.6*(q-i),start);
    else first[i]=start+(end-start)*i/N;
  }
  let last=start-.05;for(let i=0;i<N;i++){first[i]=Math.max(first[i],last+.05);last=first[i];}
  const wtU=U.map((_,k)=>map[k]!=null?R[map[k]].time:null),idx=lines.map(()=>[]);
  for(let k=0;k<U.length;k++)idx[lineOf[k]].push(k);
  const wordTimes=lines.map((_,i)=>{
    const n=idx[i].length;if(!n)return[];
    const times=idx[i].map(k=>wtU[k]),s0=first[i],e0=i+1<N?first[i+1]:end;
    if(!times.some(x=>x!=null))for(let a=0;a<n;a++)times[a]=s0+(e0-s0)*(a/(n+1));
    else for(let a=0;a<n;a++){
      if(times[a]!=null)continue;
      let p=a-1;while(p>=0&&times[p]==null)p--;let q=a+1;while(q<n&&times[q]==null)q++;
      const tp=p>=0?times[p]:s0,tq=q<n?times[q]:e0;times[a]=tp+(tq-tp)*((a-p)/(q-p));
    }
    let lw=s0-.02;for(let a=0;a<n;a++){times[a]=Math.max(times[a],lw+.02);lw=times[a];}
    return times;
  });
  const matched=map.filter(x=>x!=null).length/(U.length||1);   // quota di parole scritte ritrovate nella voce (0–1)
  return{lineTimes:first,wordTimes,recognized:R.length,matched};
}

async function whisperAlign(file,start,end,lines,opt){
  opt=opt||{};const onStatus=opt.onStatus||(()=>{});
  onStatus('Ascolto la canzone…');
  const {audio}=await lsDecode(file,start,end);
  const words=lsWords((await lsRun(audio,opt)).chunks,start);
  if(!words.length)throw new Error('Nessuna voce riconosciuta nella parte selezionata');
  return alignLines(lines,words,start,end);
}
