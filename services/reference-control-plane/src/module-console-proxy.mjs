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

// D-0291: the one path prefix this proxy answers itself instead of forwarding to the module.
// A request under it is rewritten (prefix stripped) and sent back to NOESAR's OWN listener
// with the browser's session cookie intact.
//
// It exists because of what D-0286 decided: Debug Evolution never sees an SSH credential --
// NOESAR runs `ssh-keyscan` and `scp`, and the module receives a tarball. Putting the remote
// target screens in the module's console without this would undo exactly that, since the
// private key the Owner pastes would travel through the module's process on its way to
// NOESAR. With this prefix the key goes browser -> NOESAR directly; the module renders the
// screen and never handles the secret. The console is same-origin here, so the module's
// `connect-src 'self'` allows the call without loosening its CSP.
//
// Deliberately NOT a general escape hatch: NOESAR's own router authorises every one of these
// requests exactly as it would on port 8088, and the session gate below has already run.
const NOESAR_API_PREFIX = '/noesar-api/';

/**
 * @param {object} opts
 * @param {string} opts.targetBaseUrl - e.g. http://debug-evolution:8787
 * @param {string} opts.noesarBaseUrl - this control plane's own listener, e.g. http://127.0.0.1:8088
 * @param {(req: import('node:http').IncomingMessage) => boolean} opts.isAuthorized
 * @param {string} [opts.moduleName]
 */
export function createModuleConsoleProxyServer({ targetBaseUrl, noesarBaseUrl, isAuthorized, moduleName = 'this module' }) {
  const target = new URL(targetBaseUrl);
  const noesar = noesarBaseUrl ? new URL(noesarBaseUrl) : null;
  return http.createServer((req, res) => {
    if (!isAuthorized(req)) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Sign in required</title><p>Sign in to NOESAR, then open ${moduleName} again.</p>`);
      return;
    }
    const toNoesar = Boolean(noesar) && req.url.startsWith(NOESAR_API_PREFIX);
    const headers = { ...req.headers };
    for (const key of HOP_BY_HOP) delete headers[key];
    // The module has no auth of its own to read this, and it never needs to leave
    // this side -- the proxy's own gate above is the only credential check that matters.
    // The NOESAR-bound branch is the exception: there the cookie IS the credential, and
    // stripping it would turn every one of those calls into a 401.
    if (!toNoesar) delete headers.cookie;
    const upstream = toNoesar ? noesar : target;
    const path = toNoesar ? req.url.slice(NOESAR_API_PREFIX.length - 1) : req.url;
    const request = http.request(
      { protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, method: req.method, path, headers: { ...headers, host: upstream.host } },
      (upstreamRes) => { res.writeHead(upstreamRes.statusCode, upstreamRes.headers); upstreamRes.pipe(res); },
    );
    request.on('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Could not reach ${toNoesar ? 'NOESAR' : moduleName}.`, detail: error.message }));
    });
    req.pipe(request);
  });
}
