// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal HTTP client for the Phase 4 acceptance suite.
//
// Deliberately dependency-free and deliberately dumb: it does not retry, does not
// follow redirects and does not normalise errors, because an acceptance test that
// silently papers over a 500 is worse than no test at all. Every call returns the
// raw status, headers and body so the test decides what "correct" means.
import { request } from 'node:http';

export class Client {
  constructor(base) {
    const url = new URL(base);
    this.host = url.hostname;
    this.port = Number(url.port);
    this.cookies = new Map();
    this.csrf = null;
  }

  #cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorbCookies(headers) {
    const set = headers['set-cookie'] ?? [];
    for (const line of set) {
      const [pair] = String(line).split(';');
      const index = pair.indexOf('=');
      if (index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    if (this.cookies.has('noesar_csrf')) this.csrf = this.cookies.get('noesar_csrf');
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {object} [options]
   * @param {any}    [options.body]      JSON body (or a Buffer/string sent verbatim)
   * @param {object} [options.headers]
   * @param {boolean}[options.csrf]      attach x-noesar-csrf (default true for writes)
   * @param {boolean}[options.cookies]   send stored cookies (default true)
   * @param {boolean}[options.raw]       do not JSON-encode the body
   */
  call(method, path, options = {}) {
    const {
      body, headers = {}, csrf = true, cookies = true, raw = false, timeoutMs = 30_000,
    } = options;
    const outHeaders = { ...headers };
    let payload = null;
    if (body !== undefined && body !== null) {
      if (raw) payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      else {
        payload = Buffer.from(JSON.stringify(body));
        outHeaders['content-type'] ??= 'application/json';
      }
      outHeaders['content-length'] = String(payload.length);
    }
    if (cookies && this.cookies.size) outHeaders.cookie = this.#cookieHeader();
    if (csrf && this.csrf && method !== 'GET' && method !== 'HEAD') {
      outHeaders['x-noesar-csrf'] ??= this.csrf;
    }

    return new Promise((resolve, reject) => {
      const req = request(
        { host: this.host, port: this.port, method, path, headers: outHeaders },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const text = buffer.toString('utf8');
            let json = null;
            try { json = JSON.parse(text); } catch { /* not json, fine */ }
            this.absorbCookies(res.headers);
            resolve({ status: res.statusCode, headers: res.headers, text, json, buffer });
          });
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  get(path, options) { return this.call('GET', path, { csrf: false, ...options }); }
  post(path, body, options) { return this.call('POST', path, { body, ...options }); }
  put(path, body, options) { return this.call('PUT', path, { body, ...options }); }
  del(path, options) { return this.call('DELETE', path, options); }
}

/** Collects an SSE / chunked stream, with a hard cap so a runaway stream cannot hang the suite. */
export function stream(base, method, path, { body, headers = {}, cookies = '', csrf = null, maxMs = 20_000, onChunk } = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const outHeaders = { ...headers };
    let payload = null;
    if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      outHeaders['content-type'] = 'application/json';
      outHeaders['content-length'] = String(payload.length);
    }
    if (cookies) outHeaders.cookie = cookies;
    if (csrf) outHeaders['x-noesar-csrf'] = csrf;
    const req = request({ host: url.hostname, port: Number(url.port), method, path, headers: outHeaders }, (res) => {
      const chunks = [];
      const timer = setTimeout(() => { req.destroy(); finish(); }, maxMs);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), chunkCount: chunks.length });
      };
      res.on('data', (chunk) => {
        chunks.push(chunk);
        onChunk?.(chunk.toString('utf8'), req, finish);
      });
      res.on('end', finish);
      res.on('error', finish);
    });
    req.on('error', (error) => (/socket hang up|aborted|ECONNRESET/i.test(error.message) ? resolve({ status: 0, headers: {}, text: '', chunkCount: 0, aborted: true }) : reject(error)));
    if (payload) req.write(payload);
    req.end();
  });
}

/** Tiny result recorder. Prints as it goes so a hang is visible, and refuses to invent a verdict. */
export class Results {
  constructor(section) { this.section = section; this.rows = []; }

  record(id, name, verdict, evidence) {
    if (!['PASS', 'FAIL', 'BLOCKED', 'PARTIAL'].includes(verdict)) throw new Error(`invalid verdict ${verdict}`);
    const row = { section: this.section, id, name, verdict, evidence: String(evidence).replace(/\s+/g, ' ').slice(0, 400) };
    this.rows.push(row);
    process.stdout.write(`${verdict.padEnd(7)} ${id.padEnd(8)} ${name} :: ${row.evidence}\n`);
    return row;
  }

  async check(id, name, fn) {
    try {
      const { verdict = 'PASS', evidence } = await fn();
      return this.record(id, name, verdict, evidence);
    } catch (error) {
      return this.record(id, name, 'FAIL', `threw: ${error.message}`);
    }
  }

  summary() {
    const counts = this.rows.reduce((acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }), {});
    process.stdout.write(`\n== ${this.section}: ${JSON.stringify(counts)} of ${this.rows.length}\n`);
    return counts;
  }

  tsv() { return this.rows.map((r) => [r.section, r.id, r.name, r.verdict, r.evidence].join('\t')).join('\n'); }
}
