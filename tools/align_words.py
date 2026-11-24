"""
align_words.py — tempi precisi delle parole, usato da transcribe_server.py (facoltativo).

Whisper capisce bene le parole ma, con la musica sotto, spesso le mette in ritardo (fino a 1 s sulle note lunghe).
Qui:
  1. Demucs (htdemucs) separa la voce dalla musica;
  2. l'allineatore MMS di torchaudio mette le parole già trascritte sulla voce pulita, lettera per lettera.
Misurato su canzoni vere: le parole cadono sulla voce entro ~0,05 s.

Installazione (nella stessa .venv del server):
    .venv/bin/pip install "torch==2.8.0" "torchaudio==2.8.0" demucs soundfile
Senza questi pacchetti il server usa i tempi di Whisper come prima.
"""
import re
import subprocess

import numpy as np
import torch
import torchaudio
from demucs.apply import apply_model
from demucs.pretrained import get_model

MAX_SHIFT = 2.5   # una parola spostata più di così vuol dire che l'allineatore si è perso lì: resta il tempo di Whisper

_demucs = None
_aligner = None


def _device():
    if torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load_audio(path, rate):
    """Audio stereo a `rate` Hz, letto con ffmpeg (qualsiasi formato: mp3, m4a, wav…)."""
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(rate), "-"],
        check=True, capture_output=True,
    ).stdout
    return torch.from_numpy(np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy())


def _vocals(path):
    global _demucs
    if _demucs is None:
        _demucs = get_model("htdemucs")
        _demucs.eval()
    mix = _load_audio(path, _demucs.samplerate)
    ref = mix.mean(0)
    mean, scale = ref.mean(), ref.std() + 1e-8
    with torch.inference_mode():
        sources = apply_model(_demucs, ((mix - mean) / scale)[None], device=_device(), progress=False)[0]
    voice = sources[_demucs.sources.index("vocals")] * scale + mean
    return torchaudio.functional.resample(voice.mean(0), _demucs.samplerate, 16000)


def align(path, words):
    """
    words: [{"w": "parola", "start": s, "end": e}, …] da Whisper (secondi dall'inizio della canzone).
    Restituisce la stessa lista con "start" (ed "end", se serve) spostati sul momento in cui la parola è cantata,
    più "ws"/"we" = i tempi originali di Whisper.
    """
    global _aligner
    if not words:
        return words
    if _aligner is None:
        bundle = torchaudio.pipelines.MMS_FA
        _aligner = (bundle.get_model(with_star=False), bundle.get_dict(star=None))
    model, dictionary = _aligner

    voice = _vocals(path)
    letters = [[dictionary[c] for c in re.sub(r"[^a-z]", "", w["w"].lower()) if c in dictionary] for w in words]
    targets = [t for w in letters for t in w]
    if not targets:
        return words

    with torch.inference_mode():
        emission, _ = model(voice[None])
    per_frame = voice.shape[0] / emission.shape[1] / 16000
    ali, scores = torchaudio.functional.forced_align(emission, torch.tensor([targets], dtype=torch.int32), blank=0)
    spans = torchaudio.functional.merge_tokens(ali[0], scores[0].exp())

    out, i, last = [], 0, 0.0
    for w, word_letters in zip(words, letters):
        start = w["start"]
        if word_letters:
            aligned = spans[i].start * per_frame
            i += len(word_letters)
            if abs(aligned - start) <= MAX_SHIFT:
                start = aligned
        start = max(start, last)   # mai all'indietro
        last = start
        # "ws"/"we": i tempi di Whisper, che restano per dividere le righe (le sue pause seguono meglio le frasi)
        out.append({**w, "start": round(start, 3), "end": round(max(w["end"], start + 0.05), 3),
                    "ws": w["start"], "we": w["end"]})
    return out
