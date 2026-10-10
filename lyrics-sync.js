/*
 * lyrics-sync.js — timing automatico dei lyrics con Whisper, direttamente nel browser (Transformers.js, nessuna chiave).
 * Al primo uso scarica il modello (~150MB), poi resta nella cache del browser.
 *
 * API:
 *   whisperAlign(file, start, end, lines, {onStatus, language})
 *     file   : File/Blob audio della canzone
 *     start/end : secondi della parte selezionata
 *     lines  : array di righe di testo (una frase per riga, senza righe vuote)
 *   → { lineTimes:[sec,...], wordTimes:[[sec,...],...], recognized:N }   tempi ASSOLUTI nella canzone
 */
let _lsPipe=null;
function lsNorm(s){return (s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');}
async function lsGetPipe(onStatus){
  if(_lsPipe)return _lsPipe;
  onStatus('Carico il motore di sincronizzazione…');
  const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
  env.allowLocalModels=false;env.useBrowserCache=true;
  onStatus('Scarico il modello (~150MB, solo la prima volta)…');
  _lsPipe=await pipeline('automatic-speech-recognition','Xenova/whisper-small',{quantized:true,
    progress_callback:p=>{if(p.status==='progress'&&p.total)onStatus('Download modello… '+Math.round(p.loaded/p.total*100)+'%');}});
  return _lsPipe;
}
async function lsDecode(file,start,end){
  const tmp=new (window.AudioContext||window.webkitAudioContext)();
  const dec=await tmp.decodeAudioData(await file.arrayBuffer());
  const sr=16000,len=Math.max(1,Math.ceil((end-start)*sr));
  const off=new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(1,len,sr);
  const src=off.createBufferSource();src.buffer=dec;src.connect(off.destination);
  try{src.start(0,start,Math.max(.01,end-start));}catch(e){src.start(0);}
  const out=await off.startRendering();if(tmp.close)tmp.close();
  return out.getChannelData(0);
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
async function whisperAlign(file,start,end,lines,opt){
  opt=opt||{};const onStatus=opt.onStatus||(()=>{});
  const pipe=await lsGetPipe(onStatus);
  onStatus('Ascolto la canzone…');
  const audio=await lsDecode(file,start,end);
  const out=await pipe(audio,{return_timestamps:'word',chunk_length_s:30,stride_length_s:5,task:'transcribe',...(opt.language?{language:opt.language}:{})});
  const chunks=(out.chunks||[]).filter(c=>c.timestamp&&c.timestamp[0]!=null);
  if(!chunks.length)throw new Error('Nessuna voce riconosciuta nella parte selezionata');
  const R=chunks.map(c=>({t:lsNorm(c.text),time:c.timestamp[0]+start})).filter(r=>r.t);
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
  return{lineTimes:first,wordTimes,recognized:chunks.length};
}
