// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-016 · "A riposo il programma ha zero strumenti caricati."
//
// The criterion existed in `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11 with a
// stated method ("misura del contesto a sessione appena aperta") and no measurement. It
// is the acceptance half of invention V, and it is also the whole reason MCP can be
// admitted as a connector transport at all: the published objection to MCP is that tool
// schemas consume up to 72% of a context window *before the work starts*, which is true
// of a product that mounts every installed server's schemas when a session opens.
//
// This one cannot, and the reason is one line in `enforceToolScope`: the allowed set is
// the intersection of what the caller *named* with what the installation has granted.
// Nothing is admitted for merely existing. So the resting cost of an installed tool is
// zero no matter how many are installed — a property of the code, not a habit of the
// caller — and adding MCP servers cannot change it.
//
// Written as a measurement rather than an inspection: it builds real requests through the
// real function and counts what would be sent.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { enforceToolScope } from '../src/ai-workspace/untrusted-content.mjs';

/** A catalogue big enough that "we only installed a few" cannot be the reason it passes. */
const INSTALLED = Array.from({ length: 200 }, (_, index) => `tool-${index}`);

describe('CE-016 · zero tools at rest', () => {
  test('a session that names no tool carries no tool, however many are installed', () => {
    const scope = enforceToolScope({ grantedToolIds: INSTALLED, requestedToolIds: [] });
    assert.deepEqual(scope.allowedToolIds, [],
      'an installed tool entered the request without being named — invention V is gone and the MCP context objection applies to this product too');
    assert.equal(scope.escalationAttempted, false, 'nothing was attempted, so nothing should be reported as attempted');
  });

  test('the resting cost does not grow with the catalogue', () => {
    // The shape of the claim, not one instance of it: ten installations, from empty to
    // large, all resting at zero. A constant that only holds at one size is a coincidence.
    for (const size of [0, 1, 5, 20, 50, 100, 200, 500, 1000, 5000]) {
      const granted = Array.from({ length: size }, (_, index) => `tool-${index}`);
      const scope = enforceToolScope({ grantedToolIds: granted, requestedToolIds: [] });
      assert.equal(scope.allowedToolIds.length, 0, `a catalogue of ${size} tools put ${scope.allowedToolIds.length} into a session that asked for none`);
    }
  });

  test('naming a tool is what admits it, and only if the installation granted it', () => {
    // The complement. Without this, a function that returned the empty set unconditionally
    // would pass everything above — the criterion would be met by a product with no tools
    // at all, which is not what CE-016 is about.
    const scope = enforceToolScope({ grantedToolIds: INSTALLED, requestedToolIds: ['tool-7', 'tool-not-installed'] });
    assert.deepEqual(scope.allowedToolIds, ['tool-7']);
    assert.deepEqual(scope.deniedToolIds, ['tool-not-installed']);
    assert.equal(scope.escalationAttempted, true, 'a request for a tool the installation never granted is an escalation attempt and must be visible');
  });

  test('a tool named by the content instead of by the caller is never admitted', () => {
    // The MCP-shaped attack, kept in view here because this is the file about what tool
    // schemas may enter a request: a retrieved page or a repository file that asks for a
    // tool is untrusted content, and its request is recorded, never honoured.
    const scope = enforceToolScope({
      grantedToolIds: INSTALLED,
      requestedToolIds: [],
      contentRequestedToolNames: ['tool-7', 'shell'],
    });
    assert.deepEqual(scope.allowedToolIds, [], 'content-requested tools reached the model');
    assert.deepEqual(scope.ignoredContentRequests, ['tool-7', 'shell']);
    assert.equal(scope.escalationAttempted, true);
  });
});
