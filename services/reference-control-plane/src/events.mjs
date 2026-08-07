// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The event ledger: correlation, causation and a digest chain. Mirrors
// rust/crates/noesar-events; both sides answer to conformance/event-vectors.json.
//
// Distinct from AuditLedger, which records who did what as a flat chain. This records what
// caused what, so "why did this happen" is answered by walking backwards instead of by
// reading a log and guessing which lines belong together.
//
// Each of the three properties is refused rather than repaired: a run has exactly one root,
// a cause must exist and belong to the same run, and every digest covers the previous one so
// removing or reordering a middle event breaks every digest after it.
//
// Durable since D-0338, and the shape of the durability matters. The chain is append-only,
// so the file is append-only too: one JSON object per line, appended as each event is
// recorded — the idiom AuditLedger already uses. Nothing ever rewrites a line, which is what
// makes a torn write at the tail recoverable instead of fatal (see `loadFrom`).
//
// It is not the product's audit trail and does not replace it.

import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync,
} from 'node:fs';
import { dirname } from 'node:path';

export const GENESIS = 'GENESIS';

export class EventError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'EventError';
    this.kind = kind;
    this.reason = reason;
  }
}

const fail = (kind, reason) => { throw new EventError(kind, reason); };

// Length-delimited over every field, including the previous digest: without the delimiters
// two different events could hash alike by moving a boundary between adjacent fields.
function digestOf(draft, previousDigest) {
  const hash = createHash('sha256');
  const feed = (value) => {
    const text = String(value ?? '');
    hash.update(text, 'utf8');
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(Buffer.byteLength(text, 'utf8')));
    hash.update(length);
  };
  feed(previousDigest);
  feed(draft.id);
  feed(draft.correlationId);
  feed(draft.causationId ?? '');
  feed(draft.actor);
  feed(draft.action);
  feed(draft.payload);
  feed(String(draft.recordedAtUnix));
  return hash.digest('hex');
}

export class EventLedger {
  #events = [];
  #index = new Map();
  // Where each accepted event is appended, or `null` for a ledger that lives only as long as
  // the process. Null keeps every existing embedder (and the unit suites) working unchanged,
  // and `eventsStatus()` reports which of the two this ledger is rather than assuming.
  #journalPath = null;
  // What loading had to skip, carried so `eventsStatus()` can SAY it. A ledger that quietly
  // discarded a line would be a chain claiming completeness it does not have.
  #recovered = null;

  constructor({ journalPath = null } = {}) {
    if (journalPath) {
      mkdirSync(dirname(journalPath), { recursive:true, mode:0o700 });
      this.#journalPath = journalPath;
    }
  }

  get length() { return this.#events.length; }

  get durable() { return this.#journalPath !== null; }

  get recovered() { return this.#recovered; }

  events() { return this.#events.map((event) => ({ ...event })); }

  get(id) {
    const position = this.#index.get(id);
    return position === undefined ? undefined : this.#events[position];
  }

  append(draft) {
    if (!String(draft?.id ?? '').trim() || !String(draft?.correlationId ?? '').trim()) {
      fail('INVALID', 'an event needs an id and the run it belongs to');
    }
    if (!String(draft.action ?? '').trim()) {
      fail('INVALID', 'an event that does not say what happened records nothing');
    }
    if (this.#index.has(draft.id)) fail('DUPLICATE_ID', `event \`${draft.id}\` already exists`);

    if (draft.causationId) {
      const cause = this.get(draft.causationId);
      if (!cause) {
        fail('DANGLING_CAUSATION',
          `event \`${draft.id}\` is caused by \`${draft.causationId}\`, which does not exist`);
      }
      if (cause.correlationId !== draft.correlationId) {
        fail('CROSS_CORRELATION',
          `event \`${draft.id}\` is caused by \`${draft.causationId}\` from another correlation`);
      }
      // An effect recorded before its cause is not a causal record; it is two records with
      // an arrow drawn between them.
      if (draft.recordedAtUnix < cause.recordedAtUnix) {
        fail('CAUSE_IN_THE_FUTURE',
          `event \`${draft.id}\` is recorded before its cause \`${draft.causationId}\``);
      }
    } else if (this.#events.some((event) => event.correlationId === draft.correlationId
      && !event.causationId)) {
      // A run with two beginnings has no beginning.
      fail('SECOND_ROOT', `correlation \`${draft.correlationId}\` already has a root event`);
    }

    const previousDigest = this.#events.at(-1)?.digest ?? GENESIS;
    const event = {
      id: draft.id,
      correlationId: draft.correlationId,
      causationId: draft.causationId ?? null,
      actor: draft.actor ?? '',
      action: draft.action,
      payload: draft.payload ?? '',
      recordedAtUnix: draft.recordedAtUnix,
      previousDigest,
      digest: digestOf(draft, previousDigest),
    };
    this.#index.set(event.id, this.#events.length);
    this.#events.push(event);
    // Written AFTER every refusal above has had its chance, so the journal only ever holds
    // events the ledger accepted. Written BEFORE returning, so a caller that has been told an
    // event exists cannot be contradicted by a restart a moment later.
    if (this.#journalPath) {
      const fresh = !existsSync(this.#journalPath);
      appendFileSync(this.#journalPath, `${JSON.stringify(event)}\n`, { encoding:'utf8', mode:0o600 });
      if (fresh) chmodSync(this.#journalPath, 0o600);
    }
    return { ...event };
  }

  // Recomputes the whole chain from GENESIS. Every digest is derived again from the event's
  // own fields rather than compared with the one it carries: a record that vouches for
  // itself vouches for nothing.
  verify() {
    let previous = GENESIS;
    for (let position = 0; position < this.#events.length; position += 1) {
      const event = this.#events[position];
      if (event.previousDigest !== previous) {
        return { valid:false, position,
          reason:'the recorded previous digest is not the digest of the event before' };
      }
      if (digestOf(event, previous) !== event.digest) {
        return { valid:false, position, reason:'the event does not hash to the digest it carries' };
      }
      previous = event.digest;
    }
    return { valid:true, checked:this.#events.length };
  }

  // Restores a ledger from records that came from somewhere else, verifying as it goes.
  // Rebuilding by pushing through append() would recompute the digests and hide exactly the
  // tampering this is meant to catch.
  static restore(records) {
    const ledger = new EventLedger();
    for (const record of records) {
      if (ledger.#index.has(record.id)) fail('DUPLICATE_ID', `event \`${record.id}\` already exists`);
      ledger.#index.set(record.id, ledger.#events.length);
      ledger.#events.push({ ...record });
    }
    const verified = ledger.verify();
    if (!verified.valid) {
      fail('CHAIN_BROKEN', `the digest chain is broken at position ${verified.position}: ${verified.reason}`);
    }
    return ledger;
  }

  /**
   * Rebuild a ledger from its journal, then keep appending to that same journal.
   *
   * Verification is not optional here and is not re-derived by a second code path: this hands
   * the records to `restore()`, which recomputes every digest from the event's own fields and
   * refuses with `CHAIN_BROKEN` rather than repairing. A ledger that loaded a tampered file
   * and carried on would destroy the single property the chain exists for.
   *
   * **The one thing it does forgive, and why.** The last line can be short: a process killed
   * mid-append leaves a partial JSON object. Because the file is only ever APPENDED to, a
   * torn write can exist nowhere but the tail — every earlier line was complete before the
   * next began. So a final unparseable line is dropped and RECORDED in `recovered`, where
   * `eventsStatus()` reports it. An unparseable line anywhere else is corruption of a
   * different kind and is refused.
   */
  static loadFrom(journalPath) {
    if (!existsSync(journalPath)) return new EventLedger({ journalPath });
    const lines = readFileSync(journalPath, 'utf8').split('\n').filter((line) => line.trim());
    const records = [];
    let truncatedTail = null;
    for (let position = 0; position < lines.length; position += 1) {
      try {
        records.push(JSON.parse(lines[position]));
      } catch (error) {
        if (position !== lines.length - 1) {
          fail('JOURNAL_CORRUPT',
            `the event journal is unreadable at line ${position + 1} of ${lines.length}, which is not the tail: ${error.message}`);
        }
        truncatedTail = { line: position + 1, reason: 'the final line was written only in part' };
      }
    }
    const ledger = EventLedger.restore(records);
    ledger.#journalPath = journalPath;
    ledger.#recovered = truncatedTail;
    // The torn bytes are removed, and the distinction that makes this legitimate: a partial
    // write was NEVER a record. Dropping it returns the file to its last consistent state; it
    // is not this module editing its own history.
    //
    // It also has to be done. The first version of this simply appended a newline to close
    // the fragment off — which would have worked exactly once: on the NEXT load that fragment
    // is a complete line that does not parse and is no longer the tail, so the ledger would
    // have refused with JOURNAL_CORRUPT forever after. Recovery that breaks the second time
    // is worse than no recovery, because it succeeds where anyone would look.
    if (truncatedTail) {
      const temporary = `${journalPath}.${process.pid}.tmp`;
      writeFileSync(temporary, records.map((record) => `${JSON.stringify(record)}\n`).join(''), { encoding:'utf8', mode:0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, journalPath);
    }
    return ledger;
  }

  correlation(correlationId) {
    return this.#events.filter((event) => event.correlationId === correlationId)
      .map((event) => ({ ...event }));
  }

  // Walks causation backwards to the root: the answer to "why did this happen". An unknown
  // id yields nothing rather than a partial chain that would read as complete.
  causalChain(id) {
    const chain = [];
    let cursor = this.get(id);
    while (cursor) {
      chain.push({ ...cursor });
      cursor = cursor.causationId ? this.get(cursor.causationId) : undefined;
    }
    return chain.reverse();
  }
}

export function eventsStatus(ledger) {
  const verified = ledger.verify();
  return {
    events: ledger.length,
    chainValid: verified.valid,
    correlationTracked: true,
    causationTracked: true,
    // Stated, not implied — and READ off the ledger rather than asserted, so an embedder that
    // built an in-memory ledger is reported as in-memory instead of inheriting a claim that
    // happens to be true for the assembled server. This was hard-coded `false` until D-0338;
    // hard-coding it `true` would have reintroduced the same lie in the opposite direction.
    persistsAcrossRestart: ledger.durable,
    // What loading had to skip, or `null`. A chain that silently dropped a torn tail would be
    // claiming a completeness it does not have.
    recoveredOnLoad: ledger.recovered,
    replacesAuditLedger: false,
    reason: 'Every event names the run it belongs to and the single event that caused it, and each digest covers the previous one. This is the engine causal record; the product audit trail is separate and unchanged.',
  };
}
