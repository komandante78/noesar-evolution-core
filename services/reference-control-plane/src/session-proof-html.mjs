// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A signed Session Proof as ONE self-contained HTML file. Nothing is fetched and nothing is
// uploaded: the page checks the Ed25519 signature and the SHA-256 of the ten fields itself
// (WebCrypto) before it shows them, and says on the page what that check does and does not
// prove. It can be saved, attached to an e-mail, or opened offline on another machine.
//
// Every string that comes from the run (a request, a path, a model answer) reaches the page as
// TEXT in a JSON block and is put on screen with `textContent`. None of it is ever markup.
import { createHash, createPublicKey } from 'node:crypto';

/**
 * The verification code. It is a string so the SAME text runs in the page and in the tests
 * (`session-proof-signature.test.mjs` evaluates it in Node): the page cannot drift from what is
 * tested. It carries its own copy of `canonicalJson`, and a test pins the two copies together.
 */
export const VERIFY_JS = String.raw`
const enc = new TextEncoder();
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map((x) => canonicalJson(x)).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function verifyProof(envelope, spkiB64) {
  const refuse = (reason) => ({ valid: false, reason });
  try {
    if (!envelope || envelope.payloadType !== 'application/vnd.in-toto+json') return refuse('not an in-toto DSSE envelope');
    const body = unb64(envelope.payload);
    const der = unb64(spkiB64);
    const keyid = hex(await crypto.subtle.digest('SHA-256', der));
    const sig = (envelope.signatures || []).find((s) => s.keyid === keyid);
    if (!sig) return refuse('no signature by the key shown on this page');
    const type = envelope.payloadType;
    const head = enc.encode('DSSEv1 ' + enc.encode(type).length + ' ' + type + ' ' + body.length + ' ');
    const pae = new Uint8Array(head.length + body.length);
    pae.set(head); pae.set(body, head.length);
    const key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
    if (!(await crypto.subtle.verify({ name: 'Ed25519' }, key, unb64(sig.sig), pae))) return refuse('the signature does not match the content');
    const st = JSON.parse(new TextDecoder().decode(body));
    if (st.predicateType !== 'https://noesar.com/attestation/session-proof/v1') return refuse('not a NOESAR session proof');
    const digest = hex(await crypto.subtle.digest('SHA-256', enc.encode(canonicalJson(st.predicate.fields))));
    if (digest !== st.subject[0].digest.sha256) return refuse('the digest written in the proof does not match its ten fields');
    return { valid: true, keyid, statement: st, digest };
  } catch (e) { return refuse('could not verify: ' + e.message); }
}
`;

const RENDER_JS = String.raw`
const LABELS = {
  intento: ['Intent', 'what was asked'],
  ipotesi: ['Hypotheses', 'what the system assumed'],
  piano: ['Plan', 'what it proposed to do'],
  attesa: ['Expectation', 'what it expected to happen'],
  realta: ['Reality', 'what happened, measured in a throwaway copy'],
  autorita: ['Authority', 'which permissions were minted, used or refused'],
  egress: ['Egress', 'what could leave this machine'],
  provenienza: ['Provenance', 'which sources the run touched'],
  esito: ['Outcome', 'the result and how it was classified'],
  fixture: ['Fixture', 'the exact inputs, to repeat the run']
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
(async () => {
  const data = JSON.parse(document.getElementById('proof').textContent);
  const r = await verifyProof(data.envelope, data.publicKeySpkiB64);
  const verdict = document.getElementById('verdict');
  if (r.valid) {
    verdict.className = 'v ok';
    verdict.replaceChildren(el('b', '', 'Verified in your browser'), el('span', '', 'The signature is valid and the SHA-256 of the ten fields matches. Signer key fingerprint (SHA-256): ' + r.keyid + '. Compare it with the fingerprint NOESAR shows for your installation.'));
  } else {
    verdict.className = 'v bad';
    verdict.replaceChildren(el('b', '', 'NOT VERIFIED'), el('span', '', r.reason + '. Do not trust anything below.'));
  }
  // A proof that does not verify shows no content until the reader asks for it: a forged page must not read as a record.
  const showContent = () => {
  let st;
  try { st = r.valid ? r.statement : JSON.parse(new TextDecoder().decode(unb64(data.envelope.payload))); } catch (e) { return; }
  const p = st.predicate || {};
  document.getElementById('meta').textContent = 'Run ' + p.runId + ' | status ' + p.status + ' | generated ' + new Date((p.generatedAtUnix || 0) * 1000).toISOString() + ' | degradation: ' + JSON.stringify(p.degradation);
  const root = document.getElementById('fields');
  for (const key of Object.keys(LABELS)) {
    const f = (p.fields || {})[key] || {};
    const absent = f.value === null && f.source === null;
    const d = el('details', absent ? 'f absent' : 'f');
    const sum = el('summary', '', '');
    sum.append(el('b', '', LABELS[key][0]), el('span', 'm', ' - ' + LABELS[key][1] + (absent ? ' - NOT AVAILABLE' : '')));
    d.append(sum);
    if (absent) d.append(el('p', '', 'This field has no source for this run, and it was not filled with a guess. Reason: ' + (f.reason || 'none recorded')));
    else { d.append(el('p', 'm', 'Source: ' + (f.source || 'none recorded')), el('pre', '', show(f.value))); }
    if (!absent && key !== 'fixture') d.open = true;
    root.append(d);
  }
  };
  if (r.valid) showContent();
  else { const b = el('button', '', 'Show the content anyway (NOT verified)'); b.onclick = () => { b.remove(); showContent(); }; document.getElementById('fields').append(b); }
})();
`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `:root{--bg:#fbfbf9;--fg:#1c1d21;--m:#5d6068;--l:#dcdcd6;--c:#fff;--ok:#1a7f4b;--okb:#e4f4ea;--bad:#b3261e;--badb:#fbe3e1;--w:#b4580a}
@media(prefers-color-scheme:dark){:root{--bg:#121316;--fg:#e8e9ec;--m:#9a9da6;--l:#2c2e35;--c:#1a1c21;--ok:#5fd394;--okb:#14301f;--bad:#ff8f87;--badb:#3c1b19;--w:#f0a35a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 70px}h1{font-size:clamp(1.5rem,4vw,2.1rem);margin:.2em 0;letter-spacing:-.01em}
.m{color:var(--m)}.v{border-radius:10px;padding:12px 14px;margin:14px 0;border:1px solid var(--l);background:var(--c)}.v b{display:block;font-size:1.05rem}
.ok{background:var(--okb);color:var(--ok)}.bad{background:var(--badb);color:var(--bad)}.v span{color:var(--fg);word-break:break-all}
.box{background:var(--c);border:1px solid var(--l);border-left:4px solid var(--w);border-radius:8px;padding:10px 14px;margin:14px 0}
details.f{background:var(--c);border:1px solid var(--l);border-radius:10px;padding:10px 14px;margin:10px 0}details.absent{border-left:4px solid var(--w)}
summary{cursor:pointer}pre{background:var(--bg);border:1px solid var(--l);border-radius:8px;padding:10px 12px;overflow:auto;max-height:420px;font:12.5px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
footer{margin-top:34px;font-size:.85rem;color:var(--m)}`;

/** The proof page. `envelope` is a DSSE envelope from `signSessionProof`; `publicKeyPem` is the key that verifies it. */
export function renderSessionProofHtml({ envelope, publicKeyPem }) {
  const spki = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }).toString('base64');
  // `<` is escaped so no string in the proof can close the <script> block it travels in.
  const data = JSON.stringify({ envelope, publicKeySpkiB64: spki }).replace(/</g, '\\u003c');
  let runId = '';
  try { runId = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')).predicate.runId; } catch { /* the page will say it cannot verify */ }
  // The page's own policy: only THIS script and THIS style may run, nothing may be fetched. It is a
  // <meta>, not a header, so it still holds when the file is saved and opened on another machine.
  const script = `${VERIFY_JS}\n${RENDER_JS}`;
  const hash = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  const policy = `default-src 'none'; script-src ${hash(script)}; style-src ${hash(CSS)}; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NOESAR session proof ${esc(runId)}</title><style>${CSS}</style></head><body><main>
<h1>Session proof</h1><p class="m" id="meta"></p>
<div id="verdict" class="v">Checking the signature...</div>
<div class="box"><b>What this proves, and what it does not.</b><br>It proves that the ten fields below are exactly what the holder of the signing key signed, and your browser has just recomputed their digest. It does not prove that the key belongs to who you think (compare the fingerprint above with the one NOESAR shows for the installation), and it does not prove that what a model said is true. A field marked NOT AVAILABLE had no source for this run and was not filled with a guess.</div>
<noscript><p class="v bad">This page checks itself with JavaScript. Without it, nothing below can be shown or verified.</p></noscript>
<div id="fields"></div>
<footer>Produced by NOESAR EVOLUTION. Nothing on this page is fetched from the network.</footer></main>
<script id="proof" type="application/json">${data}</script>
<script>${script}</script></body></html>`;
}
