// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';

const DIMENSIONS = 192;
const STOP = new Set(['the','and','for','with','this','that','from','sono','della','delle','degli','che','con','per','una','uno','gli','le','dei','del']);

export function tokenize(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .split(/[^a-z0-9_]+/).filter((word) => word.length > 1 && !STOP.has(word)).slice(0, 20_000);
}

export function featureVector(text) {
  const vector = new Float64Array(DIMENSIONS);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt16BE(0) % DIMENSIONS;
    const sign = digest[2] & 1 ? 1 : -1;
    vector[index] += sign * (1 + Math.log1p(token.length));
  }
  let norm = 0; for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return [...vector].map((value) => value / norm);
}

export function cosine(a, b) {
  let score = 0; const n = Math.min(a.length, b.length);
  for (let i=0;i<n;i += 1) score += a[i] * b[i];
  return score;
}

function lexicalScore(queryTokens, documentTokens) {
  if (!queryTokens.length || !documentTokens.length) return 0;
  const counts = new Map(); for (const token of documentTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let score = 0; for (const token of queryTokens) score += counts.has(token) ? 1 + Math.log1p(counts.get(token)) : 0;
  return score / Math.sqrt(documentTokens.length);
}

export function hybridSearch(query, records, { limit=25, semanticWeight=0.55, lexicalWeight=0.45 } = {}) {
  const qTokens = tokenize(query); const qVector = featureVector(query);
  return records.map((record) => {
    const text = String(record.searchText ?? record.text ?? '');
    const semantic = cosine(qVector, record.vector ?? featureVector(text));
    const lexical = lexicalScore(qTokens, tokenize(text));
    return { ...record, score:(semanticWeight * semantic) + (lexicalWeight * lexical), semanticScore:semantic, lexicalScore:lexical };
  }).filter((item) => item.score > 0).sort((a,b) => b.score - a.score).slice(0, limit);
}
