#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ML-BOM · phase 7 step 31 ("Il mondo esterno", 09_PIANO.md §2), one fifth of "SBOM,
// ML-BOM, CBOM, build riproducibili, firme".
//
// The honest content here is short, and shortness is the finding, not a shortcut:
// local-model-runtime.mjs's own module comment states plainly what this product is —
// "this product does not link CUDA, does not load tensors and does not decode tokens" —
// it detects hardware and attaches to an OPERATOR-CONFIGURED external OpenAI-compatible
// server (mode defaults to `disabled`). No model weights, tokenizer, dataset, or model
// card ship in this image or this repository. A CycloneDX ML-BOM inventories exactly
// those things, so the honest output of this tool is a document that says there is
// nothing to inventory here, and names precisely why — rather than a template with a
// title and an empty components array that reads as an oversight.
//
//   node tools/generate-mlbom.mjs <output.json>
import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ?? 'mlbom.json';

// A model artifact would be a .gguf/.safetensors/.onnx/.bin file large enough to be a
// weight file, not a config or a tiny fixture. Checked, not assumed: if one is ever
// added to the shipped tree, this tool should notice rather than keep declaring zero.
const MODEL_EXTENSIONS = new Set(['.gguf', '.safetensors', '.onnx', '.pt', '.pth', '.bin', '.ggml']);
const SHIPPED_ROOTS = ['services/reference-control-plane/src', 'apps/webui-static'];

function findModelArtifacts(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes:true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findModelArtifacts(full, out);
    else if ([...MODEL_EXTENSIONS].some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const foundArtifacts = SHIPPED_ROOTS.flatMap((r) => findModelArtifacts(join(root, r)));

const mlbom = {
  documentType: 'ml-bill-of-materials',
  conformance: foundArtifacts.length === 0 ? 'DECLARED_EMPTY' : 'PARTIAL_UNEXPECTED_ARTIFACT_FOUND',
  conformanceNote: foundArtifacts.length === 0
    ? 'Not a CycloneDX ML-BOM in the formal sense (no syft/cyclonedx-cli on this host, '
      + 'CLAUDE10 rule 45) — but there is also nothing here for one to describe. Verified, '
      + 'not assumed: the two directories the Dockerfile actually copies '
      + `(${SHIPPED_ROOTS.join(', ')}) were walked for model-shaped file extensions `
      + `(${[...MODEL_EXTENSIONS].join(', ')}) and none were found.`
    : `${foundArtifacts.length} model-shaped file(s) found where none were expected — this `
      + 'tool\'s own premise (no model ships in this image) no longer holds and needs '
      + 're-examination before this document is trusted.',
  generatedBy: 'tools/generate-mlbom.mjs',
  generatedAt: new Date().toISOString(),
  shippedModelComponents: foundArtifacts,
  architecture: {
    inferenceEngine: 'none — this product links no ML inference library (no CUDA, no tensor loading, no token decoding; see local-model-runtime.mjs\'s own module comment)',
    externalAttachment: 'operator-configured local OpenAI-compatible server (e.g. Ollama), default mode "disabled"',
    modelProvenanceResponsibility: 'the operator, for whatever server they attach to — not tracked by this document, because this product never receives or stores the model itself',
  },
};

writeFileSync(output, `${JSON.stringify(mlbom, null, 2)}\n`);
process.stdout.write(`wrote ${output}\n`);
process.stdout.write(`  shipped model artifacts   ${foundArtifacts.length}\n`);
process.stdout.write(`  conformance               ${mlbom.conformance}\n`);
