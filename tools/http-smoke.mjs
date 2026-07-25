// SPDX-License-Identifier: Apache-2.0
import { once } from 'node:events';
import { server } from '../services/reference-control-plane/src/server.mjs';
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const health = await fetch(`${base}/healthz`).then((r)=>r.json());
if (health.status !== 'healthy') throw new Error('health failed');
const privacy = await fetch(`${base}/api/v1/privacy`).then((r)=>r.json());
if (privacy.banner.detail !== 'No data is sent to external servers.') throw new Error('privacy failed');
const bootstrap = await fetch(`${base}/api/v1/bootstrap`).then((r)=>r.json());
if (!bootstrap.features.includes('CodeN Ultra')) throw new Error('bootstrap failed');
const page = await fetch(base).then((r)=>r.text());
if (!page.includes('Owner Bypass')) throw new Error('webui failed');
server.close();
console.log('HTTP_SMOKE=PASS');
