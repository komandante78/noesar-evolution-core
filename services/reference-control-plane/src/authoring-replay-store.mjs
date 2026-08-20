// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The recorded state of a model call — `CE-006`, "ogni chiamata al modello è rieseguibile
// isolata dal suo stato registrato".
//
// WHAT WAS MEASURED BEFORE THIS FILE EXISTED. `author.mjs` records one fixture per call and
// `workspace-actions.mjs` writes those fixtures into the event ledger, with the comment
// *"`CE-006` asks for the session to be re-runnable, and a ledger line saying 'there were
// three' replays nothing"*. What the fixture actually held was `{path, model, promptDigest,
// answerDigest, at, provenance, outcome, contentsDigest}` — **five digests and no bytes**.
//
// A digest cannot be re-executed. It can only ever CHECK a call somebody re-executed by other
// means, and the means were not recorded anywhere. So the record was a verification record
// wearing the name of a replay record, and `author.mjs`'s own rule 5 — "EVERY CALL IS A
// FIXTURE (`CE-006`). Each authoring returns a replayable record" — was a claim the code did
// not have (`CLAUDE10.md` rule 43).
//
// WHY THE BYTES LIVE HERE AND NOT IN THE LEDGER. The obvious repair is to put the prompt and
// the answer on the ledger line. That would push the contents of the user's repository into an
// append-only audit surface, multiply the size of every `workspace_action.authored` entry by
// the size of the files it touched, and do it on a product whose ledger is meant to be
// exportable. Instead the digests the fixture ALREADY carries become **content addresses**:
// the bytes go in a store keyed by their own sha256, the ledger line does not grow by a single
// byte, and the record becomes resolvable. Identical prompts across attempts — which is the
// normal case when a model is asked twice — cost one file, not two.
//
// WHY THE STORE IS HERE AND NOT IN `author.mjs`. Rule 2 of that file: *"THE ENGINE READS, NOT
// THE MODEL. This file does not import `node:fs` and has no way to read anything."* That rule
// is load-bearing and is not weakened for a convenience. The Author hands its caller the bytes
// in memory; the orchestrator, which already owns the filesystem, is what persists them.
import { createHash } from 'node:crypto';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, renameSync,
} from 'node:fs';
import { join } from 'node:path';

import { replayAuthoringCall } from './author.mjs';

const digestOf = (text) => createHash('sha256').update(String(text)).digest('hex');

/** A stored object is named by its own digest, so the name is the integrity check. */
const NAME = /^[0-9a-f]{64}$/;

export class AuthoringReplayStore {
  #directory;

  constructor(directory) {
    this.#directory = directory ?? null;
    if (this.#directory) mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
  }

  /** `false` for an installation that keeps no run state — replay is then honestly absent,
   *  not silently empty. `workspace-actions.mjs` passes `null` in exactly that case. */
  get durable() { return this.#directory !== null; }

  get directory() { return this.#directory; }

  /**
   * Stores `text` under its own digest and returns that digest.
   *
   * Idempotent by construction: the same bytes are the same name, so a second `put` of the
   * same prompt writes nothing. Temp-then-rename for the same reason `RunStore.save` does it —
   * a reader sees a whole object or no object, never a half-written one.
   */
  put(text) {
    const body = String(text ?? '');
    const digest = digestOf(body);
    if (!this.#directory) return digest;
    const target = join(this.#directory, digest);
    if (existsSync(target)) return digest;
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
    return digest;
  }

  /**
   * The bytes for a digest, or `null`.
   *
   * `null` is a real answer and is never softened into an empty string: "the store does not
   * have this" and "the model answered with nothing" are different facts, and a replay that
   * confused them would report a faithful reproduction of an answer nobody kept.
   */
  get(digest) {
    const found = this.read(digest);
    return found.status === 'ok' ? found.body : null;
  }

  /**
   * The tri-state behind `get`: `ok` · `absent` · `corrupt`.
   *
   * Written this way after the oracle for a CORRUPTED object came back saying "the recorded
   * answer is not in the store". That was a `null` doing the work of two different facts, and
   * it pointed an operator at the wrong problem — "nobody kept it" and "what was kept has been
   * altered" call for opposite responses, and the second is the one worth alarming about.
   *
   * The name IS the checksum, so verifying costs one hash and catches a store truncated by a
   * full disk, restored badly, or edited by hand. Trusting the filename would rest the whole
   * integrity claim on the filesystem never lying.
   */
  read(digest) {
    if (!this.#directory) return { status: 'absent', body: null, reason: 'this installation keeps no replay store' };
    if (!NAME.test(String(digest ?? ''))) return { status: 'absent', body: null, reason: 'not a digest' };
    const target = join(this.#directory, digest);
    if (!existsSync(target)) return { status: 'absent', body: null, reason: 'no object under that digest' };
    const body = readFileSync(target, 'utf8');
    const actual = digestOf(body);
    if (actual !== digest) {
      return { status: 'corrupt', body: null, reason: `the stored object hashes to ${actual.slice(0, 12)}… and is named ${String(digest).slice(0, 12)}…` };
    }
    return { status: 'ok', body, reason: null };
  }

  /**
   * Mark and sweep against the digests the surviving runs still reference — `D-0346`'s lesson,
   * applied to this directory before it can repeat.
   *
   * Content-addressed objects are SHARED between runs, so "delete what this run referenced" is
   * wrong: it would delete a prompt another run still needs. Only a caller that can enumerate
   * every live reference may sweep, which is why this takes the whole set and never computes
   * it here.
   *
   * **`apply` defaults to `false`, and the default is the safeguard.** This destroys recorded
   * state, so the caller that wants it destroyed says so — a signature whose default deletes
   * is one typo away from an accident, and `D-0606` (the phase that wired this) found the
   * live-set builder naming the wrong field, which is exactly the class of mistake a dry run
   * is for. The dry run returns the same shape, plus the names it *would* have removed.
   */
  sweep(referenced, { apply = false } = {}) {
    if (!this.#directory) return { removed: 0, kept: 0, removable: [], apply, durable: false };
    const live = referenced instanceof Set ? referenced : new Set(referenced ?? []);
    const removable = [];
    let removed = 0;
    let kept = 0;
    for (const name of readdirSync(this.#directory)) {
      if (!NAME.test(name)) continue;          // never touch anything this file did not name
      if (live.has(name)) { kept += 1; continue; }
      removable.push(name);
      if (!apply) continue;
      rmSync(join(this.#directory, name), { force: true });
      removed += 1;
    }
    return { removed, kept, removable, apply, durable: true };
  }
}

/**
 * Replays ONE recorded model call, in isolation, from the store — `CE-006`'s own method.
 *
 * "In isolation" is meant literally: nothing here reaches the workspace, the run, the session
 * or a model. The inputs are the fixture and the store, and if those two are not enough then
 * the record was not sufficient, which is the finding this whole file exists to make
 * impossible to miss.
 *
 * The verdict distinguishes three things a single boolean would have merged:
 *
 *   UNRESOLVABLE   the store cannot produce the bytes this fixture names. NOT a faithful
 *                  replay and never reported as one — an absent record is the one case where
 *                  "no differences were found" would be a lie.
 *   PORT_REFUSAL   the port refused before an answer existed, so there is no answer to
 *                  re-apply the rules to. The decision is still reproduced (it is the refusal
 *                  itself), and the shape says why it took a different road.
 *   RE_APPLIED     the rules ran again over the recorded answer and the decision was rebuilt.
 */
export function replayFromStore({ fixture, store }) {
  const promptRead = fixture?.promptDigest ? store.read(fixture.promptDigest) : { status: 'absent', body: null, reason: 'the fixture names no prompt' };
  // A corrupt object is named as corrupt HERE, before the pure replay sees it, because the pure
  // function is given bytes and cannot tell why bytes are missing. Reporting "not in the store"
  // for an object that is in the store and altered would send an operator looking for the wrong
  // failure — the difference between somebody never keeping a record and somebody changing one.
  if (promptRead.status === 'corrupt') {
    return { kind: 'UNRESOLVABLE', faithful: false, decision: null, diffs: [], reason: `the recorded prompt is corrupt: ${promptRead.reason}` };
  }
  const answerRead = fixture?.answerRecordDigest ? store.read(fixture.answerRecordDigest) : { status: 'absent', body: null, reason: 'the fixture names no answer' };
  if (answerRead.status === 'corrupt') {
    return { kind: 'UNRESOLVABLE', faithful: false, decision: null, diffs: [], reason: `the recorded answer is corrupt: ${answerRead.reason}` };
  }
  return replayAuthoringCall({ fixture, prompt: promptRead.body, answer: answerRead.body });
}

/**
 * Every digest the given fixtures reference, for `sweep`.
 *
 * Built from named fields rather than by walking the object, so a fixture that grows a new
 * digest-shaped field does not silently become garbage-collectable — the projection discipline
 * `skill-catalog.mjs` already uses, for the same reason: a `delete` leaves every future field
 * exposed, a named list leaves every future field out until someone says otherwise.
 *
 * # THE DEFECT THIS FUNCTION CARRIED, AND WHY IT WAS INVISIBLE (`D-0606`)
 *
 * A named list has a failure mode a walk does not: it can name a field that is not the one
 * stored. This did. What the orchestrator writes into the store is the PROMPT and the ANSWER
 * RECORD — `put(call.prompt)` and `put(call.answer)`, where `call.answer` is `answerRecord`
 * (`author.mjs`) — so the digests that name real objects are `promptDigest` and
 * `answerRecordDigest`. This function named `promptDigest` and **`answerDigest`**, which since
 * `D-0597` is deliberately a different thing: the digest of the model's CONTENT, which is never
 * stored on its own.
 *
 * The two coincide for a **text** answer (`answerRecord === String(answer)`), and diverge for a
 * **structured** one — the shape a real provider produces. So the live set omitted the stored
 * answer of every structured call, and a sweep would have deleted it while keeping the prompt,
 * leaving `replayFromStore` to answer `UNRESOLVABLE` for calls whose ledger lines still claim
 * they are replayable. That is `CE-006` silently destroyed by the very function meant to keep
 * the store honest, and it stayed invisible because `sweep()` had no product caller: the bug
 * was latent by luck, not held back by design.
 *
 * **Both fields are named, not just the corrected one.** Fixtures written before `D-0597` have
 * no `answerRecordDigest` at all, and for those the stored bytes ARE named by `answerDigest`.
 * Dropping it to "fix" the list would have made every pre-`D-0597` answer sweepable — trading
 * one silent deletion for another. A digest that names nothing in the store costs one Set entry
 * and protects nothing; a digest missing from the set costs the record itself.
 */
export function referencedDigests(fixtures) {
  const digests = new Set();
  for (const fixture of fixtures ?? []) {
    if (fixture?.promptDigest) digests.add(fixture.promptDigest);
    if (fixture?.answerRecordDigest) digests.add(fixture.answerRecordDigest);
    // Pre-`D-0597` fixtures: back then this WAS the stored object's name. See above.
    if (fixture?.answerDigest) digests.add(fixture.answerDigest);
  }
  return digests;
}
