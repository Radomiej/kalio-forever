# Local speech for agent summaries
Reviewed 2026-11-08; research, not a measured audio benchmark.

## First candidate: Piper
Use the current OHF Piper project with a Polish voice such as pl_PL-mc_speech-medium and a separate English voice such as en_US-lessac-medium. The Polish ONNX file is about 63 MB; the card identifies Polish, one speaker and 22,050 Hz output. Keep a local worker/model resident for repeated reading instead of reloading per sentence. Select the voice from the summary language. No GPU requirement or latency measurement was validated here.

The engine is GPL-3.0. The voice repository is marked MIT, while the Polish card identifies the training dataset as CC0 and notes fine-tuning from lessac; inspect the actual voice cards before redistributing weights. This is a technical candidate selection, not a licensing determination.

Sources:
- https://github.com/OHF-Voice/piper1-gpl
- https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md
- https://huggingface.co/rhasspy/piper-voices/blob/main/pl/pl_PL/mc_speech/medium/MODEL_CARD
- https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL/mc_speech/medium

## Larger alternative
Chatterbox Multilingual V3 documents Polish and English and a 500M-parameter model under MIT. Its current official README also says the research project was retired in August 2026, so it is not the default maintained dependency for this MVP. CPU performance and pronunciation must be measured on target hardware. English-only Turbo/Nano variants are not a substitute for documented Polish support.
Source: https://github.com/resemble-ai/chatterbox

## Integration proposal
The agent supplies a displayed plain-text summary; TTS reads it rather than inventing a second summary. Kalio's backend enqueues bounded utterances, chooses a PL/EN voice, streams audio chunks and supports cancellation. Playback starts on explicit user action; stop clears generation and queued audio. Keep provider keys, hidden prompts, tokens and unrelated logs out of spoken summaries. This does not yet add a synthesis API or bundle model downloads.

Next measurement: Polish diacritics, numbers, abbreviations, file names and mixed PL/EN terms; time to first audio, real-time factor, peak RSS, cancellation and a 1–2 minute summary. No synthetic timing claims are made.
