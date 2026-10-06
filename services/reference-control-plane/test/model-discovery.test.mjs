// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Finding the model server a person already runs — 2026-10-06.
//
// The property that matters is not that it finds things; it is what it refuses to do. It never
// takes an address from a request, it only reports candidates the provider gateway would accept,
// and a host that is down, slow or answers with something else is simply not there. Each is driven
// here with a fake `fetch`, so no network is touched.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DISCOVERY_PORTS, parseHosts, defaultGateway, discoveryHosts, discoverModelServers } from '../src/model-discovery.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const answer = (body, { ok = true } = {}) => ({ ok, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const list = (...ids) => ({ data: ids.map((id) => ({ id })) });

// The first lines of a real `/proc/net/route` in a container: the default route goes through
// 172.19.0.1 (little-endian 010013AC), and a second line is a local network with no gateway.
const ROUTE = [
  'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'eth0\t00000000\t010013AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
  'eth0\t000013AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
].join('\n');

describe('the hosts it asks', () => {
  test('names and IPv4 addresses are kept; anything with a scheme, a path, a port or credentials is dropped', () => {
    assert.deepEqual(parseHosts('192.168.1.20, my-server.local  10.0.0.5'), ['192.168.1.20', 'my-server.local', '10.0.0.5']);
    for (const bad of ['http://evil', 'a/b', 'user@host', 'host:80', '-x', 'x-', '', ' ', undefined, '../etc']) {
      assert.deepEqual(parseHosts(bad), [], JSON.stringify(bad));
    }
  });

  test('the default gateway is read from /proc/net/route, little-endian', () => {
    assert.equal(defaultGateway(ROUTE), '172.19.0.1');
  });

  test('no default route, or text that is not a route table, gives null', () => {
    assert.equal(defaultGateway('Iface\tDestination\tGateway\tFlags\neth0\t000013AC\t00000000\t0001'), null);
    assert.equal(defaultGateway('eth0\t00000000\t00000000\t0003'), null, 'a gateway of 0.0.0.0 is no gateway');
    assert.equal(defaultGateway(null), null);
    assert.equal(defaultGateway('not a route table'), null);
  });

  test('built-in hosts, then the gateway, then the installer\'s own, without repeats', () => {
    assert.deepEqual(
      discoveryHosts({ env: { NOESAR_MODEL_DISCOVERY_HOSTS: '10.1.2.3 127.0.0.1' }, routeText: ROUTE }),
      ['127.0.0.1', 'host.docker.internal', '172.19.0.1', '10.1.2.3'],
    );
    assert.deepEqual(discoveryHosts(), ['127.0.0.1', 'host.docker.internal']);
  });
});

describe('discovering', () => {
  test('it reports who answered with a list of models, in the order of the hosts and ports it was given', async () => {
    const seen = [];
    const found = await discoverModelServers({
      hosts: ['127.0.0.1', '10.0.0.9'],
      fetchImpl: async (url) => {
        seen.push(url);
        if (url === 'http://127.0.0.1:11434/v1/models') return answer(list('llama3.2', 'qwen3:8b'));
        if (url === 'http://10.0.0.9:8080/v1/models') return answer(list('gemma-4'));
        return answer({}, { ok: false });
      },
    });
    assert.deepEqual(found.map((s) => [s.name, s.baseUrl, s.models]), [
      ['Ollama', 'http://127.0.0.1:11434/v1', ['llama3.2', 'qwen3:8b']],
      ['llama.cpp', 'http://10.0.0.9:8080/v1', ['gemma-4']],
    ]);
    assert.equal(seen.length, 2 * DISCOVERY_PORTS.length, 'every host was asked on every port, once');
  });

  test('a host that is down, slow, refuses, or answers with something else is simply not there', async () => {
    const found = await discoverModelServers({
      hosts: ['127.0.0.1'],
      fetchImpl: async (url) => {
        if (url.includes(':11434')) throw new Error('ECONNREFUSED');
        if (url.includes(':1234')) return answer('<html>not json</html>');
        if (url.includes(':8080')) return answer({ data: 'not a list' });
        if (url.includes(':8000')) return answer('x'.repeat(2_000_000));
        return null;
      },
    });
    assert.deepEqual(found, []);
  });

  test('the timeout is real: a server that never answers does not hold the page', async () => {
    const started = Date.now();
    const found = await discoverModelServers({
      hosts: ['127.0.0.1'],
      timeoutMs: 60,
      // A real socket keeps the event loop alive while it waits; `AbortSignal.timeout` does not, so
      // the fake holds a timer open the way a connection would, until the abort arrives.
      fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
        const socket = setTimeout(() => resolve(null), 5000);
        signal.addEventListener('abort', () => { clearTimeout(socket); reject(new Error('aborted')); });
      }),
    });
    assert.deepEqual(found, []);
    assert.ok(Date.now() - started < 1500, 'all the candidates were asked at once, not one after another');
  });

  test('a server with no models is reported with an empty list: found it, nothing to run', async () => {
    const found = await discoverModelServers({ hosts: ['127.0.0.1'], fetchImpl: async (url) => (url.includes(':11434') ? answer({ data: [] }) : answer({}, { ok: false })) });
    assert.deepEqual(found.map((s) => [s.name, s.models]), [['Ollama', []]]);
  });

  test('a candidate the provider gateway would refuse is never asked', async () => {
    const asked = [];
    await discoverModelServers({
      hosts: ['127.0.0.1', '8.8.8.8'],
      validate: (url) => { if (url.includes('8.8.8.8')) throw new Error('Local providers must resolve to loopback or a private network address.'); },
      fetchImpl: async (url) => { asked.push(url); return answer({}, { ok: false }); },
    });
    assert.ok(asked.length > 0 && asked.every((url) => url.startsWith('http://127.0.0.1:')), asked.join(' '));
  });

  test('model names are strings, capped, and nothing else from the answer is passed on', async () => {
    const huge = Array.from({ length: 200 }, (_, index) => ({ id: `m${index}` }));
    const found = await discoverModelServers({
      hosts: ['127.0.0.1'],
      fetchImpl: async (url) => (url.includes(':11434')
        ? answer({ data: [{ id: 'ok', secret: 'token' }, { id: 5 }, { id: '' }, null, { name: 'by-name' }, ...huge], note: 'ignored' })
        : answer({}, { ok: false })),
    });
    assert.deepEqual(found[0].models.slice(0, 2), ['ok', 'by-name']);
    assert.equal(found[0].models.length, 50);
    assert.deepEqual(Object.keys(found[0]).sort(), ['baseUrl', 'host', 'models', 'name', 'port']);
  });
});

describe('the route that calls it', () => {
  const server = readFileSync(join(here, '../src/server.mjs'), 'utf8');
  const routeAt = server.indexOf("url.pathname==='/api/v1/models/discover'");
  // from the `if(` that opens the route, so the method check is part of what is read
  const route = server.slice(server.lastIndexOf('if(', routeAt), server.indexOf('\n    }\n', routeAt) + 7);

  test('it exists, takes no address from the request, and is for the people who may manage providers', () => {
    assert.ok(routeAt > 0, 'POST /api/v1/models/discover is in server.mjs');
    assert.match(route, /req\.method==='POST'/, 'a POST: it makes outbound connections, so it is not something a link can trigger');
    assert.match(route, /requireSession\(req,res,'provider\.manage'\)/);
    assert.match(route, /requireCsrf\(req,res,authenticated\)/);
    assert.ok(!/await body\(req\)/.test(route), 'the request body is never read: no address can come in through it');
    assert.match(route, /validateBaseUrl\(/, 'candidates pass the same check a provider base URL passes');
  });

  test('it leaves a line in the audit ledger', () => {
    assert.match(route, /ledger\.append\(/);
    assert.match(route, /models\.discover/);
  });
});
