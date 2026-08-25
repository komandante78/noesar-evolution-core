# Files, RAG and multimodal input

## Direct extraction

- UTF-8 text, code, configuration, CSV/TSV, JSON/JSONL and datasets;
- PDF through `pdftotext`;
- DOCX/XLSX/PPTX/ODF/EPUB through bounded ZIP/XML extraction;
- images through Tesseract OCR, with a caption fallback (`D-0651`) through a provider the
  operator has declared `visionCapable` (Settings → Providers) when OCR finds no printed text —
  the description becomes the image's searchable text, the same shape every other extractor uses;
- ZIP archives through path-safe bounded text extraction;
- audio/video metadata through FFprobe, and metadata only — this build has no speech-to-text,
  so audio and video are stored and described, never read.

Uploads are size-limited, stored with mode 0600, named independently from the client path and hashed with SHA-256. Archive traversal, excessive entry count and excessive extracted output are rejected.

**Audio and video are not transcribed.** Transcription left with the voice layer when it was removed, and it was not rebuilt here: serving uploads with a private speech-to-text would quietly restore the part that was deliberately taken out. Extraction indexes the media's own metadata through FFprobe and reports `transcription_required` with the reason stated in the warning — the status name is kept because it is on the wire, but nothing in this build can satisfy it. Metadata that could not be read at all reports `metadata_failed`, and a host with no FFprobe reports `extractor_unavailable`. What the core does not do is the point: it never invents text, never presents metadata as if it were speech, and never falls back to a browser-side engine.

Image captioning requires at least one enabled provider profile marked `visionCapable` (a checkbox on its settings card) whose `apiStyle` is `openai-chat` or `anthropic-messages` — the two wire shapes for a multipart image message this product has verified against documented API contracts. `openai-responses` is not yet supported: its own multimodal input shape has never been exercised by this product and is not guessed at. Without a configured provider, an image with no OCR text reports `caption_required`, never a silently empty `complete`. Every configured provider failing reports `caption_failed` without losing the OCR attempt already made. Providers are tried in priority order, the same fallback shape chat completion already has.

## Browser capture

The WebUI supports file selection, camera capture, screen capture and microphone recording. Browser permissions are scoped to the same origin; geolocation, payment and USB remain denied.
