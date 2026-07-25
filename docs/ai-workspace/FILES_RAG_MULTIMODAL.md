# Files, RAG and multimodal input

## Direct extraction

- UTF-8 text, code, configuration, CSV/TSV, JSON/JSONL and datasets;
- PDF through `pdftotext`;
- DOCX/XLSX/PPTX/ODF/EPUB through bounded ZIP/XML extraction;
- images through Tesseract OCR;
- ZIP archives through path-safe bounded text extraction;
- audio/video metadata through FFprobe.

Uploads are size-limited, stored with mode 0600, named independently from the client path and hashed with SHA-256. Archive traversal, excessive entry count and excessive extracted output are rejected.

Audio/video transcription is performed by a separately configured local speech tool or an explicitly approved multimodal provider. The core never pretends metadata extraction is transcription.

## Browser capture

The WebUI supports file selection, camera capture, screen capture and microphone recording. Browser permissions are scoped to the same origin; geolocation, payment and USB remain denied.
