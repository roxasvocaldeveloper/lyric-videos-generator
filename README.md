# Submit to Virality · Lyrics — guida per l'integrazione

Prototipo funzionante dell'editor **"Submit to Virality"** di Soundvertise, con l'aggiunta di:

- lyrics animati sul video (17 stili);
- sync automatico (Whisper nel browser) o manuale;
- cambi video a tempo di musica (BPM);
- fino a 7 varianti dello stesso video;
- template;
- modal di programmazione (post al giorno, fasce orarie, pagina TikTok).

Il prototipo è **solo frontend**: niente backend, niente account, niente render del video finale. Questa guida spiega cosa riusare così com'è, cosa sostituire con i dati reali del sito (le parti segnate `PROTOTIPO` nel codice) e cosa va costruito lato server.

---

## Indice

1. [Avvio rapido](#1-avvio-rapido)
2. [File](#2-file)
3. [Tecnologie e dipendenze esterne](#3-tecnologie-e-dipendenze-esterne)
4. [Architettura del frontend](#4-architettura-del-frontend)
5. [Funzionalità, una per una](#5-funzionalità-una-per-una)
6. [Modello dati](#6-modello-dati)
7. [API dei moduli riutilizzabili](#7-api-dei-moduli-riutilizzabili)
8. [Integrazione nel sito: checklist](#8-integrazione-nel-sito-checklist)
9. [Render del video finale](#9-render-del-video-finale)
10. [Compatibilità browser e performance](#10-compatibilità-browser-e-performance)
11. [Limiti noti](#11-limiti-noti)

---

## 1. Avvio rapido

Non c'è nessun build step e nessun `npm install`: sono file statici. Serve però un server HTTP, perché da `file://` il browser blocca l'import dinamico di Transformers.js e il caricamento di audio e video.

```bash
python3 -m http.server 8765
```

Poi apri `http://localhost:8765` con Chrome (consigliato) o con Edge, Safari o Firefox.

Per provare tutto:

1. Carica una canzone con l'icona ↑ nell'editor audio.
2. Apri le clip con il quadrato in alto a destra nella preview, poi *My videos* → "+" per caricare i tuoi video.
3. Premi *Add lyrics*, scrivi una frase per riga e premi *Sync automatico*.
4. Premi *+ 6 video* e poi *SUBMIT*.

## 2. File

| File | Righe | Cosa contiene | Riuso nel sito |
|---|---|---|---|
| `index.html` | ~970 | L'editor completo: HTML, CSS e script inline (UI, stato, anteprima, più video, modal clip, modal submit, template). | Va portato nel framework del sito (React, Vue, ecc.). La logica è in funzioni piccole e commentate. |
| `lyrics-engine.js` | ~300 | Motore che disegna una riga di lyrics su un canvas 2D, in tutti gli stili, con le animazioni. Non dipende dall'editor. | **Così com'è.** Va usato sia nell'anteprima sia nel render finale. |
| `lyrics-sync.js` | ~90 | Sync automatico: Whisper (Transformers.js) trascrive la parte selezionata con i tempi di ogni parola, poi un allineamento abbina le parole scritte a quelle riconosciute. | Così com'è (o spostabile su server, vedi §7.2). |
| `beat-detect.js` | ~70 | Rilevamento BPM e griglia dei battiti, in JavaScript puro. | **Così com'è.** |

Gli script sono globali, non moduli ES:

- `lyrics-engine.js` espone `LyricsEngine`;
- `lyrics-sync.js` espone `whisperAlign`;
- `beat-detect.js` espone `BeatDetect`.

Per usarli come moduli basta aggiungere un `export` alla fine di ciascun file.

## 3. Tecnologie e dipendenze esterne

**Stack**: HTML, CSS e JavaScript vanilla (ES2020). Il rendering usa Canvas 2D, l'audio usa Web Audio API. Non ci sono framework né bundler.

| Dipendenza | Dove | A cosa serve | Note |
|---|---|---|---|
| **Google Fonts** | `<link>` in `index.html` | UI: Montserrat (testo) e Schoolbell (titoli, come nel sito). Stili dei lyrics: Archivo Black, Syne 800, Gaegu, Playfair Display 700/700 italic, Cormorant Garamond 700, UnifrakturCook 700, Shadows Into Light, Sedgwick Ave Display, Reenie Beanie. | Tutti con licenza OFL, quindi si possono anche ospitare sul vostro server. Il canvas usa un font solo se è già caricato: per questo `LyricsEngine.loadFonts()` va chiamato prima di disegnare. **Nel render lato server servono gli stessi font installati.** |
| **Transformers.js 2.17.2** (`@xenova/transformers`) | `import()` dinamico da `https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2` in `lyrics-sync.js` | Esegue Whisper nel browser (ONNX Runtime Web, WASM). | Si carica solo al primo *Sync automatico*. Licenza Apache-2.0. Versione fissata: non aggiornarla senza testare, perché la v3 (`@huggingface/transformers`) ha un'API leggermente diversa. |
| **Modello `Xenova/whisper-small`** (quantizzato) | Scaricato da Hugging Face Hub da Transformers.js | Riconoscimento vocale con i tempi di ogni parola (`return_timestamps:'word'`). | **~150 MB** al primo uso, poi resta nella cache del browser (Cache API). Licenza MIT (OpenAI Whisper). Si può ospitare su un vostro CDN: vedi `env.remoteHost` di Transformers.js. |
| **Mixkit** (video gratuiti) | `sampleUrl()` in `index.html` | **Solo prototipo**: un video di esempio a caso in ogni "pianeta" della finestra Video Templates. | URL `https://assets.mixkit.co/videos/{id}/{id}-720.mp4` con id casuali (se l'id non esiste ne prova un altro). Il server non manda CORS, quindi il canvas diventa "tainted" (vedi §11). **Da rimuovere nel sito.** |

Le icone sono SVG inline. Non ci sono altre librerie, non servono chiavi API e non ci sono chiamate a servizi a pagamento.

## 4. Architettura del frontend

### 4.1 Stato

Tutto lo stato vive in pochi oggetti globali dentro lo script di `index.html`:

| Oggetto | Contenuto |
|---|---|
| `UI` | Impostazioni del **video aperto** nell'editor: lyrics, stili, sync, caption, barre, cambi video, clip; inoltre lo stato di riproduzione e del sync manuale. |
| `AUD` | Canzone: `file`, durata `dur`, selezione `rs`/`re` (secondi assoluti), `peaks` della waveform, analisi `beat` e `grid` dei battiti nella selezione. |
| `CLIPS` | Tutte le clip caricate: `{name, url, el, mine}`. `el` è un `<video>` muto in loop; i video fanno riferimento alle clip con il loro **indice** in questo array. |
| `VIDS` | Le varianti: `{list:[video,…], cur}`. Vuoto finché non si preme *+ 6 video*. |
| `COLLS` | Collezioni dell'utente in *My videos*: `{name, clips:[indici in CLIPS]}`. |
| `TEMPLATES` | Template salvati: `{name, videos:[impostazioni senza clip]}`. |
| `SUB` | Modal di submit: `perDay` (1/2/3), `slots` (fasce orarie), `page` (pagina TikTok), `open`. |
| `MV` | Stato della finestra clip: vista (`templates`/`myvideos`), collezione aperta, selezione multipla, template scelto. |

### 4.2 Un video = un oggetto

L'editor lavora sempre sul video aperto, che sta in `UI`. Le funzioni di passaggio sono:

- `liveV()` fotografa `UI` in un oggetto video (vedi §6);
- `applyV(v)` carica un oggetto video nell'editor;
- `cloneV(v, firstClip)` crea una variante con le stesse impostazioni e una prima clip diversa;
- `allVideos()` restituisce tutti i video del progetto, con quello aperto aggiornato.

Le varianti si salvano in automatico: a ogni frame `VIDS.list[VIDS.cur] = liveV()`.

### 4.3 Funzioni pure sul video (riusabili nel render)

| Funzione | Restituisce |
|---|---|
| `segmentsOf(v)` | Le righe con `{text, time, dur, wt, style}`: inizio della riga, durata, tempi di ogni parola e stile (con *Mix* gli stili si alternano per riga). Applica già la correzione `off`. Le righe non ancora sincronizzate vengono distribuite in modo uniforme. |
| `lyricsY(v)` | Posizione verticale dei lyrics in %, scelta per non coprire la caption e per stare nella banda del video con le barre cinematic. |
| `beatCuts(N)` | Istanti dei cambi video "ogni N battiti", in secondi dall'inizio della selezione. |
| `clipAt(v, t)` | Indice della clip visibile al tempo `t`. |

Nel render finale servono le stesse regole. Il modo più semplice è riusare queste funzioni (§9).

### 4.4 Loop di disegno

`frame()` gira con `requestAnimationFrame` e, a ogni frame:

1. legge il tempo `t` con `curT()`: secondi dall'inizio della selezione, già compensati per la latenza dell'audio (§10);
2. disegna la clip con `drawClip()` su `#bgCanvas`, in modalità "cover";
3. disegna i lyrics con `drawLyrics()` su `#lyrCanvas`, che chiama `LyricsEngine.drawLine`;
4. ridisegna le miniature delle varianti e del riepilogo con `drawThumb()`, quando sono visibili.

La caption è un `contenteditable` HTML (`#cap`) sopra i canvas. Nelle miniature viene ridisegnata sul canvas.

`REF_H` è l'altezza in px CSS della preview (~502). Tutte le dimensioni dei font sono proporzionali a questa altezza.

## 5. Funzionalità, una per una

### Canzone e selezione
- L'icona ↑ carica il file (qualsiasi formato decodificabile dal browser: mp3, wav, m4a…).
- La selezione parte da 8 s (`SEL_LEN`). Si può trascinare, spostare cliccando sulla waveform e ridimensionare dai cursori laterali, da 2 a 15 s (`SEL_MIN`/`SEL_MAX`). L'anteprima va in loop sulla selezione.
- Cambiare la selezione azzera il sync (`rangeChanged()`), perché i tempi sono relativi alla selezione.

### BPM
- Al caricamento `BeatDetect.analyze()` analizza la canzone intera (meno di 1 s per 3–4 minuti).
- Accanto alla selezione compare per esempio "129 BPM", con un "?" se il ritmo è poco chiaro.
- Cliccandolo si corregge a mano con un numero, ½ o ×2 (`setBpm()`). Dopo la correzione il valore è considerato affidabile.

### Lyrics
- *Add lyrics* (pulsante viola) apre il blocco.
- *Solo lyrics* nasconde la caption; *Lyrics + caption* la tiene come hook.
- Il testo va scritto **una frase per riga**: ogni riga appare da sola sul video.
- **Sync automatico**: Whisper sulla selezione dà il tempo di ogni riga e di ogni parola. Le parole non riconosciute vengono interpolate.
- **Sync manuale**: la selezione riparte e l'utente batte SPAZIO, o tocca il video, all'inizio di ogni frase. ESC annulla. Si ottengono solo i tempi delle righe; le parole vengono distribuite nella riga.
- **Lyrics in anticipo o in ritardo?** −/+ sposta tutto di 0,05 s alla volta. Il valore è salvato in `off`.
- **Stili**: griglia con 17 stili. Con *Mix* se ne scelgono più di uno, alternati una riga per stile.
- I lyrics restano dentro la zona sicura di TikTok (`SAFE` in `lyrics-engine.js`): non finiscono sotto le icone a destra né sotto la descrizione in basso.

### Caption
- La caption è testo libero, modificabile direttamente sul video.
- Il pulsante blu attaccato alla caption cicla tra 3 testi preimpostati (`CAPTIONS`).
- Le barre a sinistra del telefono scelgono la dimensione (`CAP_PX`); a destra si sceglie la posizione: alto, centro o basso (`CAP_Y`).

### Video
- **Barre cinematic**: bande nere sopra e sotto (video 16:9 dentro il 9:16).
- **Cambio video a tempo**: OFF → ogni 1, 2, 4 o 8 battiti (×1…×8). Se il ritmo non è chiaro, o non c'è una canzone, si usa un passo fisso di N × 0,5 s.
- **Cambio video a ogni riga dei lyrics**: si attiva da solo con le lyrics. È alternativo al cambio a tempo: i due si escludono.
- **Shuffle** (fuori dalla preview): rimescola l'ordine delle clip del video aperto, cambiando sempre la prima.

### Finestra clip ("Video Templates")
- Si apre con il quadrato in alto a destra della preview. Lo stile è quello della modal già online: pianeti dei generi più una griglia.
- **Pianeti** (`PLANETS`): non sono cliccabili e mostrano un video di esempio a caso (Mixkit, prototipo). Nella griglia, un clic su un video lo rende la prima clip del video aperto. *Select all* / *Manual select* + *Usa N video* usano più video insieme.
- **My videos**: i pianeti diventano le collezioni dell'utente (`COLLS`). Il nome si modifica cliccandolo, "+" crea una nuova collezione e l'upload aggiunge video alla collezione aperta.
- **Template**: il menu sopra *My videos* sceglie un template (o mostra "No template"). Con un template scelto, i video selezionati vengono applicati al template (`applyTemplate()`): il progetto diventa i video del template con quelle clip.
- Usare più clip (`useClips()`): il video aperto usa quelle clip e le altre varianti le usano partendo da una clip diversa.

### Più video
- *+ 6 video* crea fino a 7 varianti in totale (`MAX_VIDEOS`) con le stesse impostazioni e una prima clip diversa.
- Clic su una miniatura = la apre nell'editor. Il cestino la elimina; "+" ne aggiunge una.

### Submit
- La modal mostra il riepilogo animato di tutti i video, con lo stile di ognuno.
- **Post al giorno**: 1, 2 o 3.
- **Fasce orarie**: Mattina (8–12), Pomeriggio (12–18) e Sera (18–24). Se ne possono scegliere "fino a N", dove N sono i post al giorno, e anche una sola, così tutti i post finiscono in quella fascia. Ne resta sempre almeno una selezionata; oltre il limite viene sostituita la più vecchia.
- **Pagina TikTok**: una delle pagine collegate.
- **Save as template**: salva le impostazioni di tutti i video, senza le clip.
- **Programma N video**: è attivo quando sono scelte almeno una fascia e una pagina. Oggi mostra solo la conferma con il numero di giorni, cioè `ceil(video / post al giorno)`.

## 6. Modello dati

### 6.1 Video (`liveV()`)

```js
{
  clips: [3, 0, 5],                 // ordine delle clip: indici in CLIPS (nel sito: id delle clip)
  capSize: 's' | 'm' | 'l',         // dimensione caption → CAP_PX = {s:10, m:12, l:14} px su preview alta 502
  capPos: 'top' | 'center' | 'bottom', // posizione caption → CAP_Y = {top:.21, center:.48, bottom:.70} (frazione altezza)
  caption: 'POV: …',                // testo della caption
  capI: -1,                         // indice della caption preimpostata in uso (-1 = testo libero)
  bars: false,                      // barre cinematic
  cutBeats: 0 | 1 | 2 | 4 | 8,      // cambio video ogni N battiti (0 = off)
  cutLyrics: true,                  // cambio video a ogni riga (vale solo se on && cutBeats === 0)
  on: true,                         // lyrics attive
  show: 'lyrics' | 'both',          // solo lyrics / lyrics + caption
  mix: false,                       // più stili alternati
  set: ['brat'],                    // stili scelti (chiavi di LyricsEngine.STYLES); riga i → set[i % set.length]
  text: 'riga 1\nriga 2',           // lyrics, una frase per riga (le righe vuote sono ignorate)
  times: [0.12, 1.85] | null,       // inizio di ogni riga, in SECONDI DALL'INIZIO DELLA SELEZIONE (null = non sincronizzate)
  wts: [[0.12, 0.40], [1.85, 2.1, 2.3]] | null, // inizio di ogni parola (solo sync automatico)
  sync: 'auto' | 'man' | null,
  off: 0                            // correzione utente in secondi, da sommare a times e wts
}
```

### 6.2 Progetto da inviare al backend (proposta)

Oggi `#mConfirm` non invia nulla. Il payload naturale è questo:

```js
{
  song: { file: AUD.file /* da caricare */, start: AUD.rs, end: AUD.re, bpm: AUD.beat?.bpm, beatsConfident: AUD.beat?.confident },
  beatGrid: AUD.grid,               // istanti assoluti dei battiti nella selezione (servono se un video ha cutBeats)
  videos: allVideos(),              // array di oggetti video (§6.1) con clips → id reali delle clip
  schedule: { perDay: SUB.perDay, slots: SUB.slots /* ['Mattina','Sera'] */, page: SUB.page }
}
```

È meglio inviare `beatGrid` già calcolata invece di rifare l'analisi sul server: così i cambi video del video finale coincidono esattamente con l'anteprima.

### 6.3 Template

```js
{ name: 'Template 1', videos: [ /* oggetti video §6.1 SENZA il campo clips */ ] }
```

Oggi sono salvati in `localStorage` con la chiave `virality.templates`. **Vanno salvati sull'account** (`TEMPLATES`, `saveTemplates()`).

> Nota: un template contiene anche `times`/`wts` e `text`. Applicato a una canzone o a una selezione diversa, quei tempi non corrispondono più. Decidete se in quel caso azzerare il sync (`times = wts = null`, `sync = null`) o mantenerlo.

### 6.4 Clip e collezioni

- Clip: `{name, url, mine}`. Nel sito diventano `{id, url, …}` dalla libreria dell'utente o dai template di genere.
- Collezioni: `{name, clips:[…]}`, da salvare sull'account. Oggi esistono solo in memoria e i file caricati sono URL `blob:` locali.

## 7. API dei moduli riutilizzabili

### 7.1 `LyricsEngine` (`lyrics-engine.js`)

```js
await LyricsEngine.loadFonts();               // una volta, prima di disegnare

LyricsEngine.drawLine(ctx, W, H, {
  text: 'you look so pretty',  // una riga
  style: 'brat',               // chiave di LyricsEngine.STYLES
  y: 46,                       // centro verticale in % dell'altezza
  wordTimes: [0, .2, .4, .6],  // inizio di ogni parola (stessa unità di time). Omesso/null → riga intera, ferma
  time: t,                     // tempo corrente
  refHeight: 502,              // altezza di riferimento per le dimensioni (vedi §9)
  fontSize: 20,                // opzionale, dimensione base
  safeZone: true,              // tiene il testo fuori dalle icone di TikTok
});

LyricsEngine.STYLES  // { key: { label, btn, family?, font?, … } } — `label` e `btn` (CSS del chip) servono alla UI
```

- `drawLine` non pulisce il canvas: lo fa chi chiama.
- Il risultato è deterministico: lo stesso `time` dà lo stesso frame, perché le variazioni casuali usano un seed ricavato dal testo. Per questo si può usare per renderizzare frame per frame.
- **Stili disponibili** (chiavi): `bratbig`, `bratdyn`, `brat`, `simple`, `inked`, `bold`, `hollow`, `subtitle`, `elegant`, `glitch`, `handwritten`, `cursive`, `edgy`, `neon`, `graffiti`, `serif`, `scribble`.
- **Famiglie interne**:
  - `brat`: parole su più righe con spaziature casuali, testo battuto lettera per lettera; `bratdyn` ridimensiona le parole;
  - `neon`: scritta a mano luminosa;
  - `gen`: motore generico parola per parola, con rivelazione `type`, `ink` o `glitch`, contorno, glow, gradiente, ecc.
- **INKED** usa un filtro SVG "gooey" (`feGaussianBlur` + `feColorMatrix`), che il motore inserisce nel DOM una volta sola, applicato con `ctx.filter = 'url(#lyrInkGoo)'`. Altri bagliori usano `ctx.filter = 'blur()'`.

### 7.2 `whisperAlign` (`lyrics-sync.js`)

```js
const r = await whisperAlign(file, start, end, ['riga 1', 'riga 2'], {
  onStatus: msg => …,   // testi di stato (caricamento, download %, ascolto)
  language: 'italian',  // opzionale; se omesso Whisper rileva la lingua
});
// r.lineTimes  = [sec, …]          inizio di ogni riga, SECONDI ASSOLUTI nella canzone
// r.wordTimes  = [[sec, …], …]     inizio di ogni parola
// r.recognized = N                 parole riconosciute da Whisper
```

L'editor converte i tempi in relativi alla selezione (`- AUD.rs`) prima di salvarli in `times`/`wts`.

Come funziona:

1. Decodifica l'audio e ricampiona solo la selezione a 16 kHz mono (`OfflineAudioContext`).
2. Esegue Whisper con `return_timestamps:'word'`.
3. Normalizza le parole (minuscole, senza accenti né punteggiatura).
4. Allinea parole scritte e parole riconosciute con programmazione dinamica (tipo Needleman-Wunsch).
5. Interpola le righe e le parole mancanti e garantisce tempi crescenti.

**Alternativa server**: lo stesso allineamento si può fare in Python con `openai-whisper`/`faster-whisper` (`word_timestamps=True`) e lo stesso algoritmo di `lsAlign`. Così si evitano i 150 MB di download per l'utente, al costo della GPU/CPU sul server.

### 7.3 `BeatDetect` (`beat-detect.js`)

```js
const a = BeatDetect.analyze(audioBuffer); // AudioBuffer della canzone intera (decodeAudioData)
a.bpm        // es. 128.4
a.confident  // false se il ritmo non è chiaro (clarity < 2.5)
a.clarity    // forza del ritmo (brani ritmati ≈ 3–7)
a.period     // durata di un battito in frame (HOP = 512 campioni)

BeatDetect.grid(a, start, end) // → [sec, …] istanti dei battiti tra start ed end (assoluti)
```

Il metodo, senza librerie:

1. Calcola l'inviluppo degli attacchi: energia dei bassi (passa-basso 150 Hz) più energia totale, contando solo le crescite.
2. Stima il tempo con l'autocorrelazione tra 60 e 200 BPM, pesata verso ~120 BPM.
3. Rifinisce il periodo al centesimo di frame su tutta la canzone.
4. Sceglie la fase sulla parte selezionata e aggancia ogni battito all'attacco più vicino (±25 ms).

Per cambiare il BPM a mano (come fa `setBpm()`):

```js
a.bpm = v;
a.period = 60 * a.fps / v;
a.confident = true;
```

## 8. Integrazione nel sito: checklist

Cerca `PROTOTIPO` nel codice per trovare i punti esatti.

| # | Cosa | Oggi | Nel sito |
|---|---|---|---|
| 1 | **Video dei pianeti** | `sampleUrl()` e `TPL`: video Mixkit a caso. | I template reali di ogni genere dal vostro backend. Rimuovere Mixkit. |
| 2 | **Upload clip** | `URL.createObjectURL(file)`, solo in locale. | Upload sullo storage (S3 o simile), poi `registerClips([{name, url}])` con l'URL remoto. Servire le clip con header CORS (`Access-Control-Allow-Origin`) e impostare `el.crossOrigin = 'anonymous'` in `registerClips()` (vedi §11). |
| 3 | **Collezioni** (`COLLS`) | In memoria. | CRUD sull'account: crea, rinomina, aggiungi video. |
| 4 | **Template** (`TEMPLATES`) | `localStorage`. | Salvati sull'account. Sostituire `saveTemplates()` e il caricamento iniziale. |
| 5 | **Pagine TikTok** | 3 esempi fissi in `.pages` (`@soundvertise`, ecc.). | Le pagine TikTok collegate all'account. |
| 6 | **Canzone** | File locale caricato dall'utente. | Se nel sito la canzone c'è già (campagna), passare `File`/`Blob`/URL ad `audIn` (stessa logica: `decodeAudioData`, picchi, `BeatDetect.analyze`). Titolo e artista vanno in `#songT`/`#songA`. |
| 7 | **Programma** (`#mConfirm`) | Mostra solo la conferma. | Inviare il payload del §6.2 al backend, che renderizza i video (§9) e li pubblica secondo `perDay`/`slots`/`page`. |
| 8 | **Testi UI** | In italiano, scritti nell'HTML. | Passarli all'i18n del sito se serve. |

Non c'è da modificare nulla in `lyrics-engine.js`, `beat-detect.js` e `lyrics-sync.js`.

## 9. Render del video finale

Il render va costruito. L'obiettivo è che il video finale sia **identico all'anteprima**. Per ogni video del payload, a `fps` (es. 30) e a 1080×1920 (o 720×1280):

```js
for (let f = 0; f < (end - start) * fps; f++) {
  const t = f / fps;                       // secondi dall'inizio della selezione
  ctx.clearRect(0, 0, W, H);
  drawClip(ctx, clipAt(v, t), W, H);       // frame della clip, modalità cover
  if (v.bars) { /* bande nere: altezza (H - W*9/16)/2 sopra e sotto */ }
  if (!(v.on && v.show === 'lyrics')) { /* caption: font Montserrat 700, size CAP_PX[v.capSize] * H/502, y = CAP_Y[v.capPos]*H */ }
  if (v.on) {
    const seg = segmentsOf(v).filter(s => t >= s.time).pop();
    if (seg) LyricsEngine.drawLine(ctx, W, H, {
      text: seg.text, style: seg.style,
      y: (STYLES[seg.style].y != null && v.show === 'lyrics') ? STYLES[seg.style].y : lyricsY(v),
      wordTimes: seg.wt, time: t,
      refHeight: H,                         // vedi sotto
      safeZone: true,
    });
  }
  // → encoder (WebCodecs/MediaRecorder nel browser, oppure ffmpeg sul server)
}
// audio: la canzone da start a end, mixata nel video
```

Cose da rispettare:

- **`refHeight`** è l'altezza alla quale corrispondono le dimensioni dei font. In anteprima è l'altezza della preview, ~502 px CSS, con il canvas a `502 × devicePixelRatio`. Nel render a 1920 px di altezza bisogna passare `refHeight: 1920`, così le proporzioni restano identiche. In generale va passata la stessa altezza del canvas su cui si disegna. Lo stesso vale per la caption: `CAP_PX × H / 502`.
- **Tempi**: `times`, `wts` e `segmentsOf()` sono in secondi **dall'inizio della selezione**, con `off` già sommato da `segmentsOf()`. **Non** va applicata `OUT_LAT`: è una compensazione dei soli altoparlanti in anteprima.
- **Cambi video**: `clipAt()` usa `beatCuts()`, che legge `AUD.grid` e `AUD.beat`. Nel render bisogna usare la `beatGrid` del payload (stessa logica: `grid.filter((_, i) => i % N === 0).map(x => x - start)`) oppure il passo fisso N × 0,5 s se `beatsConfident` è false.
- **Clip**: le clip vanno in loop. L'anteprima mostra ogni clip dal punto in cui si trova il suo `<video>` in loop; nel render conviene far ripartire ogni clip da 0 al suo cambio, o da un punto scelto.
- **Dove renderizzare**:
  - **Browser** (canvas + WebCodecs/`MediaRecorder`): riusa tutto il codice com'è, ma è lento e dipende dal dispositivo dell'utente.
  - **Server**: per esempio headless Chrome con Puppeteer o Playwright che apre una pagina di render con questi stessi script e cattura i frame, oppure Node con `skia-canvas`/`node-canvas`, poi ffmpeg. È la strada consigliata per la programmazione automatica.
  - Con `node-canvas`, `ctx.filter` non è supportato: INKED e i glow non verrebbero disegnati. **Con headless Chrome il risultato è identico all'anteprima.**

## 10. Compatibilità browser e performance

- **Browser**: provato su Chrome desktop. Richiede Canvas 2D, Web Audio (`decodeAudioData`, `OfflineAudioContext`), `document.fonts`, `import()` dinamico e WebAssembly (Whisper).
- **`ctx.filter`** (INKED, glow, blur) è supportato su Chrome/Edge/Firefox. Su Safari dipende dalla versione: dove manca, il testo resta visibile ma senza quegli effetti.
- **Latenza audio in anteprima**: casse e cuffie, soprattutto Bluetooth, riproducono il suono in ritardo rispetto ad `audio.currentTime`. `measureLatency()` legge `AudioContext.outputLatency + baseLatency` (fino a 0,5 s) e `curT()` lo sottrae, così i lyrics non appaiono in anticipo. Riguarda solo l'anteprima.
- **Performance**:
  - `BeatDetect.analyze` impiega meno di 1 s per una canzone di 3–4 minuti; `grid` è istantaneo.
  - Whisper: download del modello (~150 MB) solo la prima volta. L'analisi di 8–15 s di audio richiede qualche secondo su un laptop recente; su dispositivi lenti può arrivare a 10–20 s.
  - L'anteprima disegna ogni frame la preview più fino a 7 miniature: è leggera su desktop. Sui telefoni economici conviene ridurre la frequenza delle miniature.
- **Mobile**: il layout attuale è pensato per desktop, come l'editor del sito.

## 11. Limiti noti

- **BPM**: l'analisi automatica può sbagliare di metà o doppio, oppure confondersi con ritmi ternari, swing o brani senza percussioni. Per questo:
  - se il ritmo è poco chiaro viene mostrato "?" e si usa il passo fisso;
  - l'utente può correggere a mano (numero, ½, ×2).
- **Whisper sulla musica**: con voce molto effettata, rap veloce o strumenti forti alcune parole non vengono riconosciute. Le righe e le parole mancanti vengono interpolate, quindi possono avere un piccolo scarto, che l'utente corregge con −/+ (`off`) o con il sync manuale. Sul test con voce chiara la precisione è di circa ±30 ms.
- **Sync e selezione**: i tempi valgono per la selezione corrente. Se la selezione cambia, il sync viene azzerato.
- **CORS e canvas "tainted"**: i video Mixkit non mandano `Access-Control-Allow-Origin`, quindi dopo averli disegnati il canvas non si può leggere (`toDataURL`, `getImageData`, `captureStream`). Per il prototipo non è un problema, ma lo diventa se si fa il render nel browser. **Le clip reali vanno servite con CORS e caricate con `crossOrigin='anonymous'`.**
- **Video di esempio Mixkit**: sono scelti a caso a ogni apertura e possono non essere coerenti con il genere del pianeta. Vanno sostituiti (§8).
- **Persistenza**: progetti, varianti, collezioni e clip caricate si perdono ricaricando la pagina. Solo i template sopravvivono, in `localStorage`.
- **Font nel render**: se un font non è caricato, il canvas usa un font di ripiego senza segnalare errori. Prima di renderizzare bisogna sempre attendere `LyricsEngine.loadFonts()`, o avere i font installati sul server.
