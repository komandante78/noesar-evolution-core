// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0281 follow-up. A NOESAR module presents no authentication of its own (D-0280,
// Owner instruction: "basta solo quella di noesar") and no longer sits on a
// LAN-reachable network (D-0281 closed that exposure once the module's own login gate
// was gone). The sidebar's `externalUrl` link still has to land somewhere a real
// browser on the LAN can open -- this is that path: a second listener on NOESAR itself,
// gated on NOESAR's own session cookie before a single byte of the module's response
// reaches the browser.
//
// Root-path proxy, deliberately with NO path prefix stripped. Debug Evolution's own
// HTML/JS reference absolute paths (`href="/styles.css"`, `fetch('/api/v2/...')`) --
// mounting this under a prefix like `/modules/debug-evolution/` would silently break
// every one of those (the browser resolves them against the current origin's root,
// which `<base href>` does not override for root-relative URLs). A dedicated port at
// the module's own root sidesteps the problem instead of trying to rewrite HTML/JS on
// the fly, which would be one string-replace away from a defect every time the module's
// own markup changes.

import http from 'node:http';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);

/**
 * @param {object} opts
 * @param {string} opts.targetBaseUrl - e.g. http://debug-evolution:8787
 * @param {(req: import('node:http').IncomingMessage) => boolean} opts.isAuthorized
 * @param {string} [opts.moduleName]
 */
export function createModuleConsoleProxyServer({ targetBaseUrl, isAuthorized, moduleName = 'this module' }) {
  const target = new URL(targetBaseUrl);
  return http.createServer((req, res) => {
    if (!isAuthorized(req)) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Sign in required</title><p>Sign in to NOESAR, then open ${moduleName} again.</p>`);
      return;
    }
    const headers = { ...req.headers };
    for (const key of HOP_BY_HOP) delete headers[key];
    // The module has no auth of its own to read this, and it never needs to leave
    // this side -- the proxy's own gate above is the only credential check that matters.
    delete headers.cookie;
    const upstream = http.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...headers, host: target.host } },
      (upstreamRes) => { res.writeHead(upstreamRes.statusCode, upstreamRes.headers); upstreamRes.pipe(res); },
    );
    upstream.on('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Could not reach ${moduleName}.`, detail: error.message }));
    });
    req.pipe(upstream);
  });
}
