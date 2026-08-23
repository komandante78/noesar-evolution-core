# Files, RAG and multimodal input

## Direct extraction

- UTF-8 text, code, configuration, CSV/TSV, JSON/JSONL and datasets;
- PDF through `pdftotext`;
- DOCX/XLSX/PPTX/ODF/EPUB through bounded ZIP/XML extraction;
- images through Tesseract OCR;
- ZIP archives through path-safe bounded text extraction;
- audio/video metadata through FFprobe, transcribed through the product's own voice engine
  (`D-0650`) when a transcription endpoint is configured — the SAME `voice-engine.mjs`
  `transcribe()` the live microphone route uses, so there is one quality judgment
  (repetition/no-speech thresholds) for audio in this product, not two.

Uploads are size-limited, stored with mode 0600, named independently from the client path and hashed with SHA-256. Archive traversal, excessive entry count and excessive extracted output are rejected.

Audio/video transcription requires a configured transcription endpoint (`NOESAR_VOICE_TRANSCRIBE_ENDPOINT`, see `docs/VOICE.md`) — a local speech tool or an explicitly approved multimodal provider. Without one, extraction still indexes the media's own metadata and reports `transcription_required`; it never invents text. A configured endpoint that is unreachable or refuses the request reports `transcription_failed` without losing the metadata already indexed; a configured endpoint that heard nothing usable (silence, or only a repetition/hallucination the engine itself flagged) reports `transcription_empty`. The core never pretends metadata extraction is transcription, and never falls back to a browser-side engine — the same posture `voice-engine.mjs` already holds for the live microphone.

## Browser capture

The WebUI supports file selection, camera capture, screen capture and microphone recording. Browser permissions are scoped to the same origin; geolocation, payment and USB remain denied.
