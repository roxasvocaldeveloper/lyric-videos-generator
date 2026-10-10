# Submit to Virality · Lyrics

Prototipo dell'editor "Submit to Virality" di Soundvertise con l'aggiunta dei lyrics animati sul video.

## File

| File | Cosa contiene |
|---|---|
| `index.html` | L'editor completo: UI, stato, anteprima, più video, modal di submit. |
| `lyrics-engine.js` | Motore che disegna i lyrics su un `<canvas>` (tutti gli stili). Va usato sia in anteprima sia nel render del video finale. |
| `lyrics-sync.js` | Sync automatico: allinea le righe scritte alla voce della canzone con Whisper, direttamente nel browser. |

Per provarlo serve un server locale (i moduli e l'audio non funzionano da `file://`):

```bash
python3 -m http.server 8765
```

Poi apri `http://localhost:8765`.

## Cosa fa l'editor

- **Canzone**: l'icona ↑ nell'editor audio carica il file. La selezione parte da 8 s: si trascina, si sposta cliccando sulla waveform e si allarga/restringe dai cursori laterali (da 2 a 15 s). L'anteprima va in loop sulla selezione.
- **Add lyrics**: apre il blocco lyrics.
  - *Solo lyrics / Lyrics + caption*: la caption esistente fa da hook.
  - *Sync automatico*: Whisper sulla parte selezionata (al primo uso scarica ~150 MB, poi resta in cache).
  - *Sync manuale*: la selezione riparte e l'utente batte SPAZIO (o tocca il video) all'inizio di ogni frase. ESC annulla.
  - *Stili*: griglia; *Mix* permette di sceglierne più di uno, alternati una frase per stile.
- **Barre a sinistra del telefono**: dimensione della caption (TT piccola/media/grande).
- **Barre a destra del telefono**:
  - posizione della caption (alto/centro/basso);
  - barre nere cinematic;
  - cambio video automatico (OFF → 4s → 2s → 1s → 0.5s);
  - cambio video a ogni riga dei lyrics: si attiva da solo con le lyrics ed è alternativo al cambio automatico.
- **Pulsante blu attaccato alla caption**: cicla 3 caption preimpostate. Sta sotto la caption, o sopra se la caption è in basso.
- **Clip**: il quadrato in alto a destra nella preview apre "Video Templates" per vedere e caricare le clip; il pulsante shuffle fuori dalla preview rimescola le clip del video.
- **+ 6 video**: crea fino a 7 varianti con le stesse impostazioni e clip diverse.
  - Clic su una miniatura = la apre nell'editor (salvataggio automatico).
  - Il cestino elimina una variante; "+" ne aggiunge una.
- **SUBMIT**: modal con il riepilogo dei video, la fascia oraria (Mattina / Pomeriggio / Sera) e la pagina TikTok.
- **Anteprima TikTok**: il telefono mostra le icone di TikTok. I lyrics restano automaticamente fuori dalle zone coperte (`safeZone`).

## Parti da collegare nel sito (segnate `PROTOTIPO` nel codice)

1. **Clip**: non ci sono clip di esempio. Il quadratino in alto a destra della preview apre la finestra "Video Templates", come quella già online, dove l'utente vede e carica le clip; cliccandone una diventa la prima clip del video aperto. I pianeti dei generi e la tendina "Pop / Commercial" sono solo grafica: nel sito vanno sostituiti con le immagini e i template reali. Le clip sono in `CLIPS` come `{name,url,el}`, con `el` un `<video>` muto in loop, e sono disegnate su `#bgCanvas` da `drawClip()` in modalità "cover".
2. **Clip per video**: ogni video ha il suo ordine di clip (`clips`) con una prima clip diversa; lo shuffle lo rimescola. La clip visibile al tempo `t` è `clipAt(video, t)`.
3. **Pagine TikTok** nel modal: oggi sono 3 esempi fissi.
4. **Programma** (`#mConfirm`): oggi mostra solo la conferma. I dati da inviare sono `allVideos()` (impostazioni di ogni video), `SUB.slot` e `SUB.page`, più la canzone e la selezione (`AUD.file`, `AUD.rs`, `AUD.re`).
5. **Render del video finale**: per ogni frame si disegna la clip, poi si chiama `LyricsEngine.drawLine(...)` con lo stesso stile e gli stessi tempi dell'anteprima. Il `refHeight` resta l'altezza della preview (502 px), così le proporzioni sono identiche.

## Dati di un video

Oggetto restituito da `liveV()`:

```js
{
  clips:[...],            // ordine delle clip (indici)
  capSize:'s'|'m'|'l', capPos:'top'|'center'|'bottom', caption:'…', capI:-1,
  bars:false,             // barre cinematic
  cutEvery:0|4|2|1|0.5,   // cambio video automatico (secondi, 0 = off)
  cutLyrics:true,         // cambio video a ogni riga
  on:true,                // lyrics attive
  show:'lyrics'|'both',   // solo lyrics / lyrics + caption
  mix:false, set:['brat'],// stili (con Mix: alternati per riga)
  text:'riga 1\nriga 2',  // lyrics
  times:[s,…],            // inizio di ogni riga (secondi dall'inizio della selezione) o null
  wts:[[s,…],…],          // inizio di ogni parola (solo con sync automatico) o null
  sync:'auto'|'man'|null,
  off:0                   // correzione anticipo/ritardo dei lyrics (secondi), sommata a times e wts
}
```

## API del motore

```js
await LyricsEngine.loadFonts();
LyricsEngine.drawLine(ctx, W, H, {
  text:'you look so pretty', style:'brat', y:46,      // y = centro verticale in %
  wordTimes:[0,.2,.4,.6], time:t,                       // senza → riga completa e ferma
  refHeight:502, safeZone:true,
});
LyricsEngine.STYLES   // stili disponibili: { key: {label, btn, …} }
```

```js
const r = await whisperAlign(file, start, end, ['riga 1','riga 2'], {onStatus: s => …});
// r.lineTimes = inizio di ogni riga, r.wordTimes = inizio di ogni parola (secondi assoluti nella canzone)
```

## Note

- **Sincronia audio/testo nell'anteprima**: casse e cuffie (soprattutto Bluetooth) fanno sentire il suono con un ritardo rispetto ad `audio.currentTime`. L'anteprima lo compensa con `OUT_LAT`, misurato da `AudioContext.outputLatency`. Nel render del video finale questa compensazione **non** va applicata: lì valgono i tempi puri più la correzione `off` del video.
- Dopo il sync l'utente può spostare tutti i lyrics di ±0,05 s alla volta ("Lyrics in anticipo o in ritardo?"). Il valore è salvato in `off`.

- I font degli stili sono Google Fonts, caricati in `index.html`.
- Gli effetti INKED (inchiostro) e alcuni bagliori usano `ctx.filter` del canvas. Sui browser che non lo supportano il testo resta visibile ma senza quegli effetti. È provato su Chrome.
- Il sync automatico usa Transformers.js da CDN (`cdn.jsdelivr.net`) e il modello `Xenova/whisper-small`.
