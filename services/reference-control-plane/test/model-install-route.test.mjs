// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-08-29: «a modelli dobbiamo mettere anche un tasto sfoglia … e una barra che
// possono mettere con comando da poter auto scaricare e implementare ma deve essere semplice
// non fare 1000 passaggi».
//
// Two routes were added for the first half of that. This file guards the three properties that
// would be expensive to discover later, in this codebase's established structural style
// (`chat-send-button-routes-commands.test.mjs`): server.mjs exposes no module boundary a route
// test could import through without standing a server up.
//
// Written with `includes` rather than regexes on purpose — a regex in a test of this shape lost
// its escapes twice in this project and asserted nothing while passing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const server = readFileSync(join(ROOT, 'services/reference-control-plane/src/server.mjs'), 'utf8');
const appJs = readFileSync(join(ROOT, 'apps/webui-static/app.js'), 'utf8');

test('installing a model asks for model.manage and a CSRF token', () => {
  // Listing is `model.read`, like the catalogue. Installing signs a descriptor with the owner
  // key, which is the same act `POST /api/v1/models/activate` treats as `model.manage`.
  const route = server.slice(server.indexOf("url.pathname === '/api/v1/models/install'"));
  assert.ok(route.includes("requireSession(req, res, 'model.manage')"), 'installing is not a read');
  assert.ok(route.includes('requireCsrf(req, res, authenticated)'), 'a state-changing route needs its token');
});

test('the file name cannot climb out of the model store', () => {
  // The name arrives from a browser and is joined onto a directory. Anchored at both ends and
  // with no slash or dot-dot admitted: `../../etc/passwd.gguf` must not be a valid name, and
  // the anchoring is the whole of why it is not.
  const pattern = '/^[A-Za-z0-9][A-Za-z0-9._-]*\\.gguf$/.test(name)';
  assert.ok(server.includes(pattern), 'the name must be validated by an anchored pattern, not by trimming');
  // And the same guard, exercised: the expression above is what this asserts about.
  const admits = (name) => /^[A-Za-z0-9][A-Za-z0-9._-]*\.gguf$/.test(name);
  assert.equal(admits('Qwen3.8-27B-UD-Q4_K_M.gguf'), true);
  assert.equal(admits('../../etc/passwd.gguf'), false);
  assert.equal(admits('/models/x.gguf'), false);
  assert.equal(admits('x.gguf/../../y'), false);
  assert.equal(admits('.hidden.gguf'), false, 'a leading dot is not a name we go looking for');
});

test('the browser is never asked for a number the file already states', () => {
  // The "1000 passaggi" the Owner asked not to have. `model-install.mjs` reads the layer count,
  // the context length and the architecture out of the GGUF header itself, and works the split
  // out with the same recommendPlacement() the page uses. A form that asked for any of them
  // would be a second source for a number that already has one — the exact defect repaired on
  // this page on 2026-08-29 (the placement a person reads and the one the process gets).
  const route = server.slice(
    server.indexOf("url.pathname === '/api/v1/models/install'"),
    server.indexOf("url.pathname === '/api/v1/models/catalog'"),
  );
  for (const field of ['gpu-layers', 'gpuLayers', 'context', 'port']) {
    assert.ok(!route.includes(`request.${field}`), `${field} must be read from the file, never taken from the browser`);
  }
});

test('the installer is run, not reimplemented', () => {
  // Two implementations of "what may be installed" is how a check comes to be enforced in one
  // place and not the other. The header read, the architecture refusal and the signature live
  // in the tool; this route spawns it.
  const route = server.slice(server.indexOf("url.pathname === '/api/v1/models/install'"));
  assert.ok(route.includes("join(repoRoot, 'tools', 'model-install.mjs')"));
  assert.ok(route.includes("action: 'model.install'"), 'installing a model is an act, and acts are recorded');
});

test('the page asks nothing beyond which file', () => {
  const panel = appJs.slice(appJs.indexOf('async function installModel('));
  assert.ok(panel.includes("body:JSON.stringify({file:name})"), 'the request carries the file name and nothing else');
  assert.ok(panel.includes('confirm('), 'signing a descriptor is confirmed, like every other act on this page');
});
