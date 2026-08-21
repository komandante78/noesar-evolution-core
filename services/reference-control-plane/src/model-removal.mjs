// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Removing a downloaded model — `D-0625`, the Owner's requirement: «pulsante elimina, tutto con
// doppia conferma prima di fare qualcosa».
//
// # Why this is a module and not four lines in a route
//
// It deletes bytes that do not come back. Every rule about *which* bytes, *when*, and *what
// counts as having been asked twice, belongs somewhere a test can reach it — `model-catalog.mjs`
// already sets that precedent for lanes, and a route that decided this for itself would be a
// second answer to the same question (`D-0300`, `D-0302`).
//
// # What "double confirmation" means here, precisely
//
// Two acts that cannot both be muscle memory:
//
//   1. `confirm: true`      — an explicit intent flag; a stray POST does not carry it.
//   2. `confirmId === id`   — the caller types back WHICH model. A dialog you click twice is one
//                             decision made twice; naming the target is a second, different
//                             decision, and it is the one that catches deleting the wrong row.
//
// This is the shape the terminal already uses for destructive work — `/session-action … confirm`
// and `/logout confirm` (`15 §13`: in a terminal a lone `y` is one paste away from being
// answered by accident). One product, one idiom for "are you sure".
//
// # What it refuses, and why each refusal is a rule rather than a nicety
//
//   · the model in use          — deleting what is answering right now breaks the session that
//                                 is asking; stop it first, deliberately.
//   · a model with no artefact  — a seeded catalogue entry was never downloaded. "Deleted"
//                                 would be a lie about work that never happened.
//   · a path outside the artefact directory — `artefactName()` already escapes an id like
//                                 `../../etc`, and this checks the RESULT as well, because a
//                                 sanitiser trusted without its output being checked is how
//                                 traversal bugs survive.

import { statSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { artefactName } from './model-acquisition.mjs';

export class ModelRemovalError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'ModelRemovalError';
    this.kind = kind;
    this.reason = reason;
  }
}

function refuse(kind, reason) { throw new ModelRemovalError(kind, reason); }

/**
 * Where a model's artefact lives, with the result checked and not merely sanitised.
 * Exported because the preview and the removal must agree on the path, and two spellings of
 * "where is it" is the defect `D-0608` and `D-0616` both left behind.
 */
export function artefactPathFor(artefactDir, id) {
  let name;
  try {
    name = artefactName(id);
  } catch {
    refuse('INVALID_ID', 'a model id is required');
  }
  const path = join(artefactDir, `${name}.bin`);
  const root = resolve(artefactDir);
  if (resolve(path) !== root && !resolve(path).startsWith(root + sep)) {
    refuse('PATH_ESCAPE', 'the resolved artefact path is outside the artefact directory');
  }
  return path;
}

/**
 * What removing this model WOULD do. Reads only; deletes nothing.
 *
 * This is the first half of the double confirmation and it is not decoration: the panel shows
 * these bytes before it will let the second act happen, so "are you sure" is answered against a
 * fact instead of against a name. Same shape as `/retention` before `/sweep`, which this
 * product already ships.
 */
export function previewRemoval({ artefactDir, id, activeModelId = null }) {
  if (!id || typeof id !== 'string') refuse('INVALID_ID', 'a model id is required');
  const path = artefactPathFor(artefactDir, id);
  let stat = null;
  try { stat = statSync(path); } catch { stat = null; }
  const present = Boolean(stat?.isFile?.());
  return {
    id,
    present,
    bytes: present ? stat.size : 0,
    inUse: activeModelId === id,
    removable: present && activeModelId !== id,
    // Why it cannot be removed, in words, when it cannot. A disabled button with no reason
    // teaches nothing about where the ability starts (the MC-006 posture, applied here).
    reason: !present
      ? 'questo modello non e scaricato su questa installazione: non c’e nessun file da eliminare'
      : activeModelId === id
        ? 'questo modello e in uso adesso: fermalo prima di eliminarlo'
        : null,
  };
}

/**
 * Removes the artefact. Both confirmations are checked HERE, not in the caller: a guard the
 * route owns is a guard the next route forgets.
 */
export function removeModel({ artefactDir, id, activeModelId = null, confirm = false, confirmId = null }) {
  const preview = previewRemoval({ artefactDir, id, activeModelId });

  if (confirm !== true) {
    refuse('NOT_CONFIRMED', 'removal requires an explicit confirmation');
  }
  if (confirmId !== id) {
    refuse(
      'CONFIRMATION_MISMATCH',
      'the second confirmation must name the same model: type the model id to confirm which one is being removed',
    );
  }
  if (!preview.present) refuse('NOT_PRESENT', preview.reason);
  if (preview.inUse) refuse('IN_USE', preview.reason);

  unlinkSync(preview.path ?? artefactPathFor(artefactDir, id));
  return { id, removed: true, bytesFreed: preview.bytes };
}
