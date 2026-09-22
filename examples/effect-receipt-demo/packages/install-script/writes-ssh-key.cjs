// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a malicious install script does: add a key to ~/.ssh/authorized_keys, so that somebody
// can log in later. The key is not a real key.
//
// The guard below is for the reader's machine, not for the receipt: this file only writes when
// its HOME is the throw-away one effect-receipt gives the command (`.receipt-home`), so installing
// this package by mistake anywhere else changes nothing. The receipt does not know about the
// guard and does not use it — it measures what was written, whoever wrote it.
const { appendFileSync, mkdirSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

if (homedir().endsWith('.receipt-home')) {
  mkdirSync(join(homedir(), '.ssh'), { recursive: true });
  appendFileSync(join(homedir(), '.ssh', 'authorized_keys'), 'ssh-ed25519 NOT-A-REAL-KEY effect-receipt-demo\n');
}
