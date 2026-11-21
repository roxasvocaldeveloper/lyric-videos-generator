/*
 * lyrics-worker.js — Whisper in un Web Worker (modulo), così l'editor non si blocca mentre trascrive.
 * Usato da lyrics-sync.js: riceve {id, audio (Float32Array 16 kHz mono), language} e risponde con
 * {status} / {progress} durante il lavoro e alla fine {done, language, chunks:[{text, timestamp:[start,end]}]} (secondi dall'inizio di audio).
 *
 * Lingua: Whisper small in Transformers.js v2 senza lingua indicata non restituisce nulla, quindi se non è passata
 * la rileva il modello stesso (primo token dopo <|startoftranscript|>) sulle 3 finestre più forti, a maggioranza.
 *
 * L'audio lungo è diviso qui in finestre da 30 s (il massimo di Whisper) che si sovrappongono di 5 s:
 * ogni parola viene presa dalla finestra in cui cade più al centro, così non ci sono buchi né doppioni.
 */
import {pipeline,env,Tensor} from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
env.allowLocalModels=false;env.useBrowserCache=true;

const SR=16000,WIN=30,STEP=25,EDGE=(WIN-STEP)/2;
let pipe=null;

// lingua più probabile per un pezzo di audio (es. 'en')
async function detectLang(seg){
  const gc=pipe.model.generation_config,f=await pipe.processor(seg);
  const o=await pipe.model({input_features:f.input_features,decoder_input_ids:new Tensor('int64',BigInt64Array.from([BigInt(gc.decoder_start_token_id)]),[1,1])});
  let best=null,bv=-Infinity;
  for(const [tok,id] of Object.entries(gc.lang_to_id)){const v=o.logits.data[id];if(v>bv){bv=v;best=tok;}}
  return best.replace(/[<|>]/g,'');
}

self.onmessage=async e=>{
  const {id,audio,language}=e.data,post=m=>self.postMessage({id,...m});
  try{
    if(!pipe){
      post({status:'Scarico il modello (~150MB, solo la prima volta)…'});
      pipe=await pipeline('automatic-speech-recognition','Xenova/whisper-small',{quantized:true,
        progress_callback:p=>{if(p.status==='progress'&&p.total)post({status:'Download modello… '+Math.round(p.loaded/p.total*100)+'%'});}});
    }
    const n=Math.max(1,Math.ceil(Math.max(0,audio.length/SR-WIN)/STEP)+1),out=[];
    const segOf=k=>audio.subarray(k*STEP*SR,Math.min(audio.length,(k*STEP+WIN)*SR));
    let lang=language;
    if(!lang){
      post({status:'Riconosco la lingua…'});
      const rms=[...Array(n).keys()].map(k=>{const a=segOf(k);let e=0;for(let i=0;i<a.length;i+=16)e+=a[i]*a[i];return[k,e/(a.length/16||1)];});
      const votes={};
      for(const [k] of rms.sort((x,y)=>y[1]-x[1]).slice(0,3)){const l=await detectLang(segOf(k));votes[l]=(votes[l]||0)+1;}
      lang=Object.entries(votes).sort((x,y)=>y[1]-x[1])[0][0];
    }
    post({progress:0});
    for(let k=0;k<n;k++){
      const off=k*STEP,seg=segOf(k);
      const r=await pipe(seg,{return_timestamps:'word',task:'transcribe',language:lang});
      const lo=k?off+EDGE:-1,hi=k<n-1?off+STEP+EDGE:1e9;
      for(const c of r.chunks||[]){
        const t=c.timestamp;if(!t||t[0]==null)continue;
        const s=t[0]+off;if(s<lo||s>=hi)continue;
        out.push({text:c.text,timestamp:[s,t[1]!=null?t[1]+off:null]});
      }
      post({progress:Math.round((k+1)/n*100)});
    }
    post({done:true,language:lang,chunks:out});
  }catch(err){post({error:String(err&&err.message||err)});}
};
