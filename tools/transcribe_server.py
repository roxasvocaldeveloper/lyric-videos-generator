"""
transcribe_server.py — trascrizione dei lyrics in locale con whisper-large-v3-turbo (mlx-whisper, chip Apple).

Avvio (dalla cartella del progetto):
    .venv/bin/python tools/transcribe_server.py            # http://127.0.0.1:8766

L'editor (index.html, TRANSCRIBE_API) gli manda la canzone e riceve le parole con i tempi.
Se il server è spento, l'editor usa Whisper small nel browser.

API (è anche il formato che deve avere l'endpoint del backend nel sito):
    POST /transcribe   multipart/form-data, campo "audio" = file della canzone
    → {"language": "en", "duration": 154.3, "words": [{"w": "parola", "start": 12.34, "end": 12.71}, ...]}
    GET  /health       → {"ok": true, "model": "..."}

Modello: variabile d'ambiente WHISPER_MODEL (default mlx-community/whisper-large-v3-turbo, ~1,6 GB al primo avvio,
poi resta nella cache di Hugging Face). Più leggero: mlx-community/whisper-large-v3-turbo-q4 (~460 MB).
"""
import email.parser
import email.policy
import json
import os
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import mlx_whisper
from huggingface_hub import snapshot_download

# Tempi precisi (voce separata + allineatore): facoltativo, vedi tools/align_words.py. ALIGN=0 per spegnerlo.
try:
    if os.environ.get("ALIGN", "1") == "0":
        raise ImportError("spento con ALIGN=0")
    import align_words
except ImportError as e:
    align_words = None
    print(f"Allineamento preciso non attivo ({e}): uso i tempi di Whisper.", flush=True)

MODEL = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")
HOST, PORT = "127.0.0.1", int(os.environ.get("PORT", "8766"))


def transcribe(path):
    r = mlx_whisper.transcribe(
        path,
        path_or_hf_repo=MODEL,
        word_timestamps=True,
        condition_on_previous_text=False,     # nella musica evita che un errore si ripeta per tutta la canzone
        hallucination_silence_threshold=2.0,  # scarta il testo "inventato" nelle parti solo strumentali
    )
    words = []
    for seg in r.get("segments", []):
        for w in seg.get("words", []):
            t = w.get("word", "").strip()
            if t:
                words.append({"w": t, "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3)})
    dur = r["segments"][-1]["end"] if r.get("segments") else 0
    if align_words is not None:
        try:
            words = align_words.align(path, words)
        except Exception as e:   # se qualcosa va storto restano i tempi di Whisper
            print("  allineamento non riuscito:", e, file=sys.stderr, flush=True)
    return {"language": r.get("language"), "duration": dur, "words": words}


def audio_from_request(handler):
    n = int(handler.headers.get("Content-Length", 0))
    body = handler.rfile.read(n)
    ctype = handler.headers.get("Content-Type", "")
    if ctype.startswith("multipart/form-data"):
        msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
            b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + body)
        for part in msg.iter_parts():
            if part.get_param("name", header="content-disposition") == "audio":
                return part.get_payload(decode=True), part.get_filename() or "audio"
        raise ValueError('campo "audio" mancante')
    return body, "audio"   # anche il file "nudo" nel corpo della richiesta


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        # permette le chiamate anche dalla pagina pubblica (GitHub Pages) verso questo server sul Mac
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            return self.reply(200, {"ok": True, "model": MODEL})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/transcribe"):
            return self.reply(404, {"error": "not found"})
        try:
            data, name = audio_from_request(self)
            suffix = os.path.splitext(name)[1] or ".audio"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(data)
                path = f.name
            try:
                t0 = time.time()
                out = transcribe(path)
                print(f"  {name}: {len(out['words'])} parole, lingua {out['language']}, {time.time() - t0:.1f} s", flush=True)
            finally:
                os.unlink(path)
            self.reply(200, out)
        except Exception as e:
            print("  errore:", e, file=sys.stderr, flush=True)
            self.reply(500, {"error": str(e)})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"Scarico/controllo il modello {MODEL}…", flush=True)
    snapshot_download(MODEL)
    print(f"Pronto: http://{HOST}:{PORT}  (POST /transcribe)", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
