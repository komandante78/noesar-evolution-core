// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `/skills` — the surface `16` §4b.4 drew and nobody had built.
//
// The measurement this replaces, taken three times (s322, s326, s328) and once more before
// this file existed: zero skill surfaces in `services/reference-control-plane/src/`, and an
// `agent-commands.js` comment explaining that the menu entry was deliberately absent because
// there was nowhere for it to go.
//
// What is asserted here is mostly ONE property, because it is the property that makes a skill
// catalogue different from a second tool catalogue: **searching never loads a body**. `15`
// §3.V opens by naming the cost — tool schemas eating up to 72% of the context before the work
// starts — and a skill's payload is instructions, so a catalogue that hands them out on search
// has reintroduced exactly the thing it was built to avoid. The tests below try to get the
// instructions out through every door and are supposed to fail to.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  searchCatalog, validateSkillEntry, loadSkillCatalogSchema,
  AdoptedSkillRegistry, skillCatalogStatus, SkillCatalogError,
} from '../src/skill-catalog.mjs';
// Imported so the `enforced` claim can be checked against the thing it is a claim ABOUT,
// rather than against a copy of itself.
import { buildAuthoringPrompt } from '../src/author.mjs';
import { SESSION_METHOD_POLICY } from '../src/session-protocol.mjs';
import { parseCodenAddressBook } from '../src/coden-address-book.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SECRET_BODY = 'STEP 1: read the file. STEP 2: do not paste this into a context window.';

function catalogueWith(entries) {
  const root = mkdtempSync(join(tmpdir(), 'noesar-skills-'));
  for (const entry of entries) {
    mkdirSync(join(root, entry.id), { recursive: true });
    writeFileSync(join(root, entry.id, 'skill.json'), JSON.stringify(entry));
  }
  return root;
}

const validSkill = {
  id: 'refactor-safely',
  name: 'Refactor safely',
  version: '1.0.0',
  publisher: 'NOESAR',
  summary: 'Change structure without changing behaviour',
  instructions: SECRET_BODY,
};

describe('searching is not a load — the property the whole file exists for', () => {
  test('a search result carries no instructions, by any name', () => {
    const root = catalogueWith([validSkill]);
    try {
      const result = searchCatalog(repoRoot, root, {});
      assert.equal(result.matches.length, 1);
      const [match] = result.matches;
      assert.equal(match.skill.name, 'Refactor safely');
      assert.equal(match.skill.instructions, undefined);
      // Not just the field: the body must not appear anywhere in the serialised result, which
      // is the version of this assertion a future `summary: instructions.slice(0, 200)`
      // could not slip past.
      assert.doesNotMatch(JSON.stringify(result), /do not paste this/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('it says what adopting would COST, which is the honest thing to report about a body you withhold', () => {
    const root = catalogueWith([validSkill]);
    try {
      const [match] = searchCatalog(repoRoot, root, {}).matches;
      assert.equal(match.skill.instructionBytes, Buffer.byteLength(SECRET_BODY, 'utf8'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the projection is a field list, not a delete — a new field is hidden by default', () => {
    // The difference matters under change, and only under change: `delete result.instructions`
    // leaks every field added later, a named projection leaks none. Asserted on behaviour by
    // adding a field the catalogue has never heard of and proving it does not travel.
    const root = catalogueWith([{ ...validSkill, signature: { alg: 'ed25519', value: 'CARRIES-A-SECRET' } }]);
    try {
      const result = searchCatalog(repoRoot, root, {});
      assert.equal(result.matches.length, 1);
      assert.doesNotMatch(JSON.stringify(result), /CARRIES-A-SECRET/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the body is reachable only by adopting, and only by id', () => {
    const registry = new AdoptedSkillRegistry();
    assert.equal(registry.instructionsFor('refactor-safely'), null);
    registry.adopt(validSkill, { sessionId: 's1' });
    assert.equal(registry.instructionsFor('refactor-safely'), SECRET_BODY);
    assert.equal(registry.instructionsFor('something-else'), null);
  });
});

describe('zero at rest — computed from the registry, never asserted', () => {
  test('a fresh process carries no skills and says so', () => {
    const status = skillCatalogStatus(new AdoptedSkillRegistry());
    assert.equal(status.atRest, true);
    assert.equal(status.adoptedSkillCount, 0);
    assert.equal(status.contextBytes, 0);
  });

  test('atRest follows the real registry rather than a constant', () => {
    const registry = new AdoptedSkillRegistry();
    registry.adopt(validSkill, { sessionId: 's1' });
    const status = skillCatalogStatus(registry);
    assert.equal(status.atRest, false);
    assert.equal(status.adoptedSkillCount, 1);
    assert.equal(status.contextBytes, Buffer.byteLength(SECRET_BODY, 'utf8'));
  });

  test("a task's close drops what was adopted for it, and keeps what was promoted", () => {
    const registry = new AdoptedSkillRegistry();
    registry.adopt(validSkill, { sessionId: 's1' });
    registry.adopt({ ...validSkill, id: 'permanent-one' }, { sessionId: 's1', permanent: true });
    registry.adopt({ ...validSkill, id: 'other-session' }, { sessionId: 's2' });
    const dropped = registry.dropAll({ sessionId: 's1' });
    assert.deepEqual(dropped, ['refactor-safely']);
    assert.deepEqual(registry.list().map((s) => s.id).sort(), ['other-session', 'permanent-one']);
  });

  test('the status never lists a body either', () => {
    const registry = new AdoptedSkillRegistry();
    registry.adopt(validSkill, { sessionId: 's1' });
    assert.doesNotMatch(JSON.stringify(skillCatalogStatus(registry)), /do not paste this/);
  });

  test('adopting runs nothing, and the status says so rather than leaving it to be assumed', () => {
    const status = skillCatalogStatus(new AdoptedSkillRegistry());
    assert.equal(status.adoptRunsCode, false);
    assert.equal(status.searchReturnsInstructions, false);
    assert.equal(status.denylist, false);
  });

  // Rewritten for `D-0345`, and the rewrite is the point. This used to read:
  //
  //     assert.equal(status.enforced, false);
  //     assert.match(status.reason, /nothing in the product yet composes an adopted skill/);
  //
  // which asserted the VALUE the surface happened to have rather than the PROPERTY it must
  // hold — so the day the gap was actually closed, the suite went red for having fixed it.
  // That is the same defect-as-requirement shape `CE-034` was rewritten out of, and it is
  // worth noticing that it survived here for two sessions after the lesson was written down.
  //
  // The property is a BICONDITIONAL: the flag must agree with reality. `enforced` may claim
  // true only while composing a skill really does put it in front of the Author, and must
  // claim false the moment that stops being so.
  test('`enforced` says what is true of the product, not what was true when it was written', () => {
    const status = skillCatalogStatus(new AdoptedSkillRegistry());
    const prompt = buildAuthoringPrompt({
      goal: 'g', step: 's', path: 'f.mjs', contents: 'x\n',
      skills: [{ id: 'probe', name: 'Probe', instructions: 'PROBE_INSTRUCTIONS' }],
    });
    const composes = prompt.includes('PROBE_INSTRUCTIONS');
    assert.equal(status.enforced, composes,
      composes
        ? '`enforced` must be true: the Author is handed adopted skills before it writes'
        : '`enforced` must be false: nothing composes an adopted skill into the prompt');
    if (!composes) assert.match(status.reason, /nothing in the product yet composes an adopted skill/);
  });

  test('a malformed key is refused, and the registry is untouched', () => {
    const registry = new AdoptedSkillRegistry();
    assert.throws(
      () => registry.adopt(validSkill, { publicKeyPem: 'not a key', sessionId: 's1' }),
      (error) => error instanceof SkillCatalogError && error.kind === 'PROVENANCE_REFUSED',
    );
    assert.equal(registry.list().length, 0, 'a refused adopt still recorded the skill');
  });

  test('a REAL key whose signature does not verify is refused too — the other branch', () => {
    // Added because a mutation deleting the BAD_SIGNATURE refusal SURVIVED. The test above
    // looked like it covered this and did not: a malformed key makes the verifier THROW, so
    // every run took the PROVENANCE_REFUSED path and the `!verified` line was never reached.
    // An assertion on a case the real input never produces — only the mutation showed it.
    const { publicKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const registry = new AdoptedSkillRegistry();

    // A well-formed signature over nothing anybody signed: valid base64, right key, wrong
    // bytes. The verifier returns false rather than throwing, which is the branch under test.
    const forged = { ...validSkill, signature: { alg: 'ed25519', value: Buffer.alloc(64).toString('base64') } };
    assert.throws(
      () => registry.adopt(forged, { publicKeyPem, sessionId: 's1' }),
      (error) => error instanceof SkillCatalogError && error.kind === 'BAD_SIGNATURE',
    );
    assert.equal(registry.list().length, 0, 'a skill with an unverifiable signature was adopted anyway');
  });
});

describe('validation holds a skill to the tool catalogue\'s standard, not a looser one', () => {
  const schema = loadSkillCatalogSchema(repoRoot);

  test('a skill with no instructions is a menu entry with nothing behind it', () => {
    const result = validateSkillEntry({ ...validSkill, instructions: '   ' }, schema);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /non-empty string/);
  });

  test('a declared effect naming an unknown operation is refused', () => {
    const result = validateSkillEntry(
      { ...validSkill, declaredEffects: [{ operations: ['TELEPORT'], paths: ['src/'] }] }, schema,
    );
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /unknown operation "TELEPORT"/);
  });

  test('effects are optional — most skills only change how the agent reasons', () => {
    assert.equal(validateSkillEntry(validSkill, schema).valid, true);
  });

  test('an invalid entry is reported, never silently skipped into an empty result', () => {
    const root = catalogueWith([validSkill, { id: 'broken', name: 'Broken' }]);
    try {
      const result = searchCatalog(repoRoot, root, {});
      assert.equal(result.matches.length, 1);
      assert.equal(result.invalid.length, 1);
      assert.equal(result.invalid[0].id, 'broken');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('one surface, two shells — §4b.4 rule 4', () => {
  test('both methods are in the one policy table, and both are bridged', () => {
    // `D-0302`: one table, applied inside the dispatch. A method missing here is refused
    // fail-closed, so this is also the assertion that the methods are reachable at all.
    for (const method of ['skills.status', 'skills.search']) {
      assert.ok(SESSION_METHOD_POLICY[method], `${method} has no policy entry`);
      assert.equal(SESSION_METHOD_POLICY[method].bridged, true, `${method} is not bridged — the shells would diverge`);
    }
    assert.equal(SESSION_METHOD_POLICY['skills.search'].permission, 'workspace.read');
  });

  test('the skills surface is reachable through the derived address book', () => {
    // The failure this guards is the one the old comment described: a surface with nowhere to
    // go from. It used to check a HAND-WRITTEN `/skills` menu entry beside the derived address;
    // that entry was removed on 2026-08-14 with the other sixteen, because writing a
    // destination down a second time beside a list that derives it is the `PANEL_NAMES`
    // duplication this project has already paid for twice. The property is unchanged and is
    // now checked where reachability actually lives — the derived book.
    const html = readFileSync(join(repoRoot, 'apps/webui-static/index.html'), 'utf8');
    const addresses = parseCodenAddressBook(html);
    const list = addresses.addresses ?? addresses;
    assert.ok(
      list.some((a) => a.address === 'settings/skills'),
      'the address book does not derive settings/skills — the surface would be unreachable',
    );
    const commands = readFileSync(join(repoRoot, 'apps/shared/coden/agent-commands.js'), 'utf8');
    assert.doesNotMatch(commands, /\{ name: 'skills',/,
      'the hand-written skills entry is back beside the derived address — that is the duplication');
  });

  test('the entry is written once, in the shared source, and not a second time in a shell', () => {
    // Rule 2 of §4b.4, and the reason `PANEL_NAMES` came to say 14 against 25: a hand-written
    // copy in one shell is a defect, not a shortcut.
    for (const shell of ['apps/shared/coden/tui-screen.mjs', 'tools/tui-fullscreen.mjs']) {
      const source = readFileSync(join(repoRoot, shell), 'utf8');
      assert.doesNotMatch(
        source, /name:\s*'skills'/,
        `${shell} declares the skills entry itself instead of reading the shared source`,
      );
    }
  });
});
