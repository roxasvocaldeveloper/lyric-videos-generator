/*
 * beat-detect.js — BPM e posizione dei battiti di una canzone, nel browser (nessuna libreria).
 *
 *   const a = BeatDetect.analyze(audioBuffer);     // una volta per canzone
 *   a.bpm          → es. 128
 *   a.confident    → false se il ritmo non è chiaro (meglio usare i secondi)
 *   BeatDetect.grid(a, start, end)  → istanti dei battiti tra start ed end (secondi assoluti)
 *
 * Metodo: inviluppo degli attacchi (energia dei bassi + energia totale, crescite frame per frame),
 * tempo dall'autocorrelazione (preferendo 90–160 BPM) rifinito sui battiti di tutta la canzone, fase scelta sulla parte selezionata e
 * ogni battito agganciato all'attacco più vicino.
 */
const BeatDetect=(()=>{
  const HOP=512,CLARITY_MIN=5;   // sotto questa soglia il ritmo è considerato poco chiaro

  function analyze(buf){
    const sr=buf.sampleRate,a=buf.getChannelData(0),b=buf.numberOfChannels>1?buf.getChannelData(1):null;
    const n=Math.floor(a.length/HOP),fps=sr/HOP,k=Math.exp(-2*Math.PI*150/sr);   // passa-basso 150 Hz (cassa/basso)
    const low=new Float32Array(n),all=new Float32Array(n);let lp=0;
    for(let f=0;f<n;f++){
      let el=0,ea=0;
      for(let j=f*HOP,e=j+HOP;j<e;j++){const x=b?(a[j]+b[j])*.5:a[j];lp=k*lp+(1-k)*x;el+=lp*lp;ea+=x*x;}
      low[f]=Math.log(1e-9+el);all[f]=Math.log(1e-9+ea);
    }
    // attacchi: solo le crescite di energia, poi tolta la media locale
    const raw=new Float32Array(n);
    for(let f=1;f<n;f++)raw[f]=Math.max(0,low[f]-low[f-1])+.6*Math.max(0,all[f]-all[f-1]);
    const on=new Float32Array(n),W=16;let acc=0;
    for(let f=0;f<n;f++){acc+=raw[f]-(f>=W?raw[f-W]:0);on[f]=Math.max(0,raw[f]-acc/Math.min(f+1,W));}

    // tempo: autocorrelazione tra 60 e 200 BPM, pesata verso ~120 BPM per evitare metà/doppio
    const minL=Math.floor(fps*60/200),maxL=Math.ceil(fps*60/60),sc=new Float32Array(maxL+2);
    let bestL=minL,best=-1,sum=0,cnt=0;
    for(let L=minL;L<=maxL;L++){
      let s=0;for(let f=0;f+L<n;f++)s+=on[f]*on[f+L];s/=Math.max(1,n-L);sc[L]=s;sum+=s;cnt++;
      const bpm=60*fps/L,w=Math.exp(-.5*Math.pow(Math.log2(bpm/120)/.9,2));
      if(s*w>best){best=s*w;bestL=L;}
    }
    const y0=sc[bestL-1]||0,y1=sc[bestL],y2=sc[bestL+1]||0,den=y0-2*y1+y2;
    let period=bestL+(den?Math.max(-.5,Math.min(.5,(y0-y2)/(2*den))):0);   // in frame, con interpolazione
    // rifinitura: il periodo (al centesimo di frame) i cui battiti cadono meglio sugli attacchi di tutta la canzone
    let bestComb=-1,P0=period;
    for(let P=P0-1.5;P<=P0+1.5;P+=.02){
      let bs=0;
      for(let ph=0;ph<P;ph+=1){let s=0,c=0;for(let f=ph;f<n;f+=P){s+=on[Math.round(f)];c++;}if(s/c>bs)bs=s/c;}
      if(bs>bestComb){bestComb=bs;period=P;}
    }
    // chiarezza del ritmo: quanto gli attacchi sui battiti superano la media degli attacchi
    let mean=0;for(let f=0;f<n;f++)mean+=on[f];mean/=n||1;
    const clarity=bestComb/(mean||1e-9);
    return{bpm:60*fps/period,period,fps,on,clarity,confident:clarity>CLARITY_MIN};
  }

  function grid(an,start,end){
    const {on,period,fps}=an,f0=Math.floor(start*fps),f1=Math.min(on.length,Math.ceil(end*fps));
    let ph=0,bs=-1;   // fase che fa cadere i battiti sugli attacchi più forti della parte selezionata
    for(let p=0;p<period;p++){let s=0;for(let f=f0+p;f<f1;f+=period)s+=on[Math.round(f)]||0;if(s>bs){bs=s;ph=p;}}
    const out=[];
    for(let f=f0+ph;f<f1;f+=period){
      let bf=Math.round(f),bv=on[bf]||0;   // aggancia all'attacco più vicino (±2 frame ≈ ±25 ms)
      for(let d=-2;d<=2;d++){const v=on[Math.round(f)+d]||0;if(v>bv){bv=v;bf=Math.round(f)+d;}}
      out.push(bf/fps);
    }
    return out;
  }

  return{analyze,grid};
})();
