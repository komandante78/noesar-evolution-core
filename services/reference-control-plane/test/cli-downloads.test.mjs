// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The bootstrap route serves executable text to callers who have not authenticated. That is
// a deliberate decision (src/cli-downloads.mjs says why), and it is only defensible while
// two things hold: the set of files is a constant, and no fragment of a request can ever
// reach the filesystem. Both are asserted here on behaviour, not on the shape of the code.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  cliDownloadRoutes, resolveCliDownload, readCliArtifact, renderCliIndex, MAX_ARTIFACT_BYTES,
} from '../src/cli-downloads.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

describe('the served path can never come from the request', () => {
  // The point of this list is that none of these is DETECTED. They return null because
  // they are not keys in a table, which is a property no future edit can weaken without
  // deleting the table itself.
  const hostile = [
    '/cli/../../../etc/passwd',
    '/cli/../../package.json',
    '/cli/install.sh/../../../etc/shadow',
    '/cli//etc/passwd',
    '/cli/./install.sh',
    '/cli/install.sh%00.png',
    '/cli/../tools/tui-client.mjs',
    '/etc/passwd',
    '/cli/',
    '/cli/install.sh.sha256.sha256',
    '/cli/INSTALL.SH',
    '',
  ];

  for (const pathname of hostile) {
    test(`refuses ${JSON.stringify(pathname)}`, () => {
      assert.equal(resolveCliDownload(pathname), null);
    });
  }

  test('refuses a non-string', () => {
    for (const value of [null, undefined, 42, {}, ['/cli/install.sh']]) {
      assert.equal(resolveCliDownload(value), null);
    }
  });

  test('every basename in the table is a bare filename', () => {
    // If this ever fails, the table itself has become the traversal.
    for (const route of cliDownloadRoutes()) {
      const entry = resolveCliDownload(route);
      if (!entry) continue;
      assert.ok(!entry.basename.includes('/'), `${entry.basename} must not contain a separator`);
      assert.ok(!entry.basename.includes('\\'), `${entry.basename} must not contain a separator`);
      assert.ok(!entry.basename.includes('..'), `${entry.basename} must not contain ..`);
    }
  });
});

describe('what the table serves', () => {
  test('each artifact has a digest route beside it', () => {
    const routes = cliDownloadRoutes();
    for (const route of routes) {
      if (route === '/cli' || route === '/cli/' || route.endsWith('.sha256')) continue;
      assert.ok(routes.includes(`${route}.sha256`), `${route} must have a digest route`);
    }
  });

  test('a digest route resolves to the same file as the artifact it digests', () => {
    const artifact = resolveCliDownload('/cli/install.sh');
    const digest = resolveCliDownload('/cli/install.sh.sha256');
    assert.equal(digest.basename, artifact.basename);
    assert.equal(digest.digestOnly, true);
    assert.equal(artifact.digestOnly, false);
  });

  // The route is worthless if it points at files this repository does not have. This is the
  // check that would have caught `coden-evolution.ps1` being absent from the image.
  test('every file the table names exists in this checkout', () => {
    for (const route of cliDownloadRoutes()) {
      const entry = resolveCliDownload(route);
      if (!entry) continue;
      const source = join(repoRoot, 'tools', entry.basename);
      const alternative = join(repoRoot, 'deployment', 'container', entry.basename);
      assert.ok(existsSync(source) || existsSync(alternative),
        `${entry.basename} must exist in tools/ or deployment/container/`);
    }
  });
});

describe('reading an artifact', () => {
  function stagedRoot(files) {
    const root = mkdtempSync(join(tmpdir(), 'noesar-cli-downloads-'));
    mkdirSync(join(root, 'tools'), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(root, 'tools', name), body);
    }
    return root;
  }

  test('returns the bytes and their digest', () => {
    const body = '#!/usr/bin/env sh\necho coden_evolution\n';
    const root = stagedRoot({ 'install-coden-cli.sh': body });
    const read = readCliArtifact(root, resolveCliDownload('/cli/install.sh'));
    assert.equal(read.bytes.toString('utf8'), body);
    assert.equal(read.sha256, createHash('sha256').update(body).digest('hex'));
  });

  test('a file the installation does not ship is a null, not a throw', () => {
    const root = stagedRoot({});
    assert.equal(readCliArtifact(root, resolveCliDownload('/cli/install.sh')), null);
  });

  test('an empty file is refused rather than served as a valid empty script', () => {
    const root = stagedRoot({ 'install-coden-cli.sh': '' });
    assert.equal(readCliArtifact(root, resolveCliDownload('/cli/install.sh')), null);
  });

  test('a file past the cap is refused', () => {
    const root = stagedRoot({ 'install-coden-cli.sh': 'x'.repeat(MAX_ARTIFACT_BYTES + 1) });
    assert.equal(readCliArtifact(root, resolveCliDownload('/cli/install.sh')), null);
  });

  test('a directory wearing the name of an artifact is refused', () => {
    const root = mkdtempSync(join(tmpdir(), 'noesar-cli-downloads-'));
    mkdirSync(join(root, 'tools', 'install-coden-cli.sh'), { recursive: true });
    assert.equal(readCliArtifact(root, resolveCliDownload('/cli/install.sh')), null);
  });

  test('no runtime root means nothing is read', () => {
    assert.equal(readCliArtifact('', resolveCliDownload('/cli/install.sh')), null);
    assert.equal(readCliArtifact(repoRoot, null), null);
  });
});

describe('the page a person reads', () => {
  const page = renderCliIndex('http://example.test:8100');

  test('names the browser before it names any download', () => {
    // The person reading this has a terminal, which is exactly the person who never gets
    // told there was a way in that needed nothing at all.
    const browserAt = page.indexOf('in a browser');
    const firstDownload = page.indexOf('/cli/install.sh');
    assert.ok(browserAt >= 0, 'the page must name the browser');
    assert.ok(browserAt < firstDownload, 'the browser must be named before the downloads');
  });

  test('every download it shows is shown with its digest', () => {
    // The positive form of the rule, not "must not contain a pipe": a page that offers a
    // download without offering the digest is the defect, whatever else it also says.
    for (const artifact of ['/cli/install.sh', '/cli/install.ps1']) {
      assert.ok(page.includes(artifact), `${artifact} must be offered`);
      assert.ok(page.includes(`${artifact}.sha256`), `${artifact} must be offered with its digest`);
    }
  });

  test('it does not teach piping a download straight into a shell', () => {
    assert.ok(!/curl[^\n]*\|\s*(sh|bash)\b/.test(page), 'the page must not teach curl | sh');
    assert.ok(!/iwr[^\n]*\|\s*iex/i.test(page), 'the page must not teach iwr | iex');
  });

  test('it uses the address the caller actually reached', () => {
    assert.ok(page.includes('http://example.test:8100/cli/install.sh'));
    assert.ok(!page.includes('undefined'));
  });

  test('a trailing slash on the base address does not double up', () => {
    const withSlash = renderCliIndex('http://example.test:8100/');
    assert.ok(!withSlash.includes('8100//cli'));
  });
});
