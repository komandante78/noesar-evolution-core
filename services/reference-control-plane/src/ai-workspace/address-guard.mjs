// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The address a name actually reaches — closing `F4-010`, open and accepted since phase 4.
//
// # What was wrong, in the register's own words
//
// > provider and tool URL validation checks the hostname STRING, not the address reached.
// > `validateBaseUrl()` and `endpoint()` reject metadata literals and RFC1918 literals, but a
// > hostname that resolves to an internal address passes; there is no resolve-then-check at
// > connect time.
//
// So `https://internal.example.test/v1` registers as an external tool and is dialled, and if that
// name resolves to `10.0.0.5` the product has been used as a proxy into its own network. The
// literal blocklist reads like a defence and is one only against an attacker who writes the
// address down, which nobody does.
//
// The finding was accepted rather than fixed because a correct fix "changes the transport layer".
// That was true. This is that change.
//
// # Two failures, and the second is why checking is not enough
//
//   1. A NAME THAT RESOLVES INWARD — answered by resolving before connecting and refusing on the
//      addresses that come back.
//   2. DNS REBINDING — resolve, check, then connect, and between the check and the connect the
//      name is resolved a SECOND time by the socket layer, which may answer differently. A guard
//      that only checks is one an attacker walks past by giving the checker a public address and
//      the connection a private one.
//
// Both are closed by the same mechanism: the vetted address is PINNED. The request is made
// through `node:http`/`node:https` with a `lookup` that can only ever return the address already
// checked, so there is no second resolution to disagree with the first.
//
// # Why not `fetch`
//
// Measured, not assumed: `fetch` carries no `lookup`, and pinning it needs an `undici` dispatcher
// — and `import('undici')` fails with ERR_MODULE_NOT_FOUND on this runtime (node 22.18.0). Adding
// it as a dependency for one option would put a package in the supply chain of the one module
// whose entire job is to be trustworthy. `node:https` has taken a `lookup` since forever, so the
// complete fix costs a small response shim and no dependency at all.
//
// # Reject if ANY address is inward, never only if all of them are
//
// A name resolving to one public and one private address is not a name with a public address; it
// is the shape of the attack. Accepting it would mean the product is safe or not depending on
// which address it happens to try first.
//
// # This does not replace the string checks
//
// Those refuse a literal before a DNS query is made — cheaper, and they catch the honest mistake
// at registration rather than at use. This is the layer beneath them. The two answer different
// questions: "did you write down something forbidden", and "where does this actually go".

import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Cloud metadata services, as ADDRESSES — the names are refused earlier by the callers' string
 *  checks; these are what this module sees once a name has been resolved. */
export const METADATA_ADDRESSES = Object.freeze([
  '169.254.169.254', // AWS, GCP, Azure, DigitalOcean, Oracle
  '100.100.100.200', // Alibaba Cloud
  'fd00:ec2::254', // AWS IMDSv2 over IPv6
]);

/**
 * Is this literal address one the product must not be talked into reaching?
 *
 * Written out rather than taken from a package: the ranges are stable, the list is short, and a
 * dependency here would be an entry point into the one function whose whole job is to be
 * trustworthy. Every range is named so a reader can check it instead of trusting it.
 */
export function isInternalAddress(address) {
  const value = String(address ?? '').trim().toLowerCase();
  const family = isIP(value);
  if (!family) return true; // not an address at all: fail closed, never "probably fine"
  if (METADATA_ADDRESSES.includes(value)) return true;

  if (family === 4) {
    const parts = value.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
    const [a, b] = parts;
    return a === 0 // "this network"
      || a === 10 // RFC1918
      || a === 127 // loopback
      || (a === 100 && b >= 64 && b <= 127) // RFC6598 carrier-grade NAT
      || (a === 169 && b === 254) // link-local, and where metadata lives
      || (a === 172 && b >= 16 && b <= 31) // RFC1918
      || (a === 192 && b === 0) // IETF protocol assignments
      || (a === 192 && b === 168) // RFC1918
      || (a === 198 && (b === 18 || b === 19)) // RFC2544 benchmarking
      || a >= 224; // multicast and reserved, through 255.255.255.255
  }

  // IPv6. The mapped form is handled FIRST: `::ffff:10.0.0.1` is an RFC1918 address wearing a v6
  // coat, and reading it as v6 would walk every private range through the front door.
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isInternalAddress(mapped[1]);
  if (value === '::' || value === '::1') return true; // unspecified, loopback
  if (/^f[cd]/.test(value)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(value)) return true; // fe80::/10 link-local
  if (/^ff/.test(value)) return true; // multicast
  return false;
}

export class BlockedAddressError extends Error {
  constructor(hostname, address) {
    super(`${hostname} resolves to ${address}, which is inside this installation's own network`);
    this.name = 'BlockedAddressError';
    this.status = 403;
    this.hostname = hostname;
    this.address = address;
  }
}

/**
 * Resolve a hostname and return its addresses, having refused if any one of them is internal.
 *
 * A literal short-circuits the query: there is nothing to resolve, and asking a resolver about
 * `93.184.216.34` is a round trip to be told what was already known.
 */
export async function resolvePublicAddresses(hostname, { lookup = dnsLookup, isBlocked = isInternalAddress } = {}) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new BlockedAddressError('(empty)', '(nothing)');
  if (isIP(host)) {
    if (isBlocked(host)) throw new BlockedAddressError(host, host);
    return [{ address: host, family: isIP(host) }];
  }
  let answers;
  try {
    answers = await lookup(host, { all: true });
  } catch (error) {
    // Refused here rather than left to fail at connect time, so the reason a call did not happen
    // is always the same kind of sentence.
    throw Object.assign(new Error(`${host} could not be resolved: ${error?.message ?? 'unknown error'}`), {
      status: 502, hostname: host,
    });
  }
  const addresses = (Array.isArray(answers) ? answers : [answers]).filter(Boolean);
  if (!addresses.length) throw new BlockedAddressError(host, '(no addresses)');
  for (const answer of addresses) {
    if (isBlocked(answer.address)) throw new BlockedAddressError(host, answer.address);
  }
  return addresses;
}

/**
 * A `lookup` for the socket layer that can only answer with addresses already vetted.
 *
 * This is the half that makes the check binding. Node resolves the hostname again when the socket
 * opens; a lookup that cannot return a new answer removes the window in which a resolver could
 * change its mind, deliberately or otherwise.
 */
export function pinnedLookup(addresses) {
  const allowed = addresses.map((answer) => ({ address: answer.address, family: answer.family }));
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    if (!allowed.length) {
      done(Object.assign(new Error(`no vetted address for ${hostname}`), { code: 'EAI_AGAIN' }));
      return;
    }
    const all = typeof options === 'object' && options?.all;
    if (all) done(null, allowed);
    else done(null, allowed[0].address, allowed[0].family);
  };
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * A `fetch`-shaped request whose address is vetted and pinned for the life of the call.
 *
 * Shaped like `fetch` on purpose: a guard that is awkward to call is one somebody routes around
 * the next time they add a caller. `ok`, `status`, `headers.get()`, `text()` and `json()` are what
 * the two call sites use, and they are what this returns.
 *
 * Redirects are NOT followed. A 30x is handed back as itself, because following one would resolve
 * a new hostname inside a call whose address has already been vetted — which is the same hole
 * this module exists to close, reached by a different road. A caller that wants to follow one
 * must come back through here.
 */
export async function guardedFetch(url, init = {}, { lookup = dnsLookup, isBlocked = isInternalAddress, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const target = url instanceof URL ? url : new URL(String(url));
  const addresses = await resolvePublicAddresses(target.hostname, { lookup, isBlocked });
  const transport = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(target, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      lookup: pinnedLookup(addresses),
      // The certificate is still checked against the NAME, not the pinned address — pinning is
      // about where the packets go, never about relaxing who answers.
      servername: target.hostname,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(Object.assign(new Error(`the response exceeded ${maxBytes} bytes`), { status: 502 }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] ?? null },
          text: async () => body,
          json: async () => (body ? JSON.parse(body) : {}),
        });
      });
    });
    request.on('error', reject);
    if (init.signal) {
      if (init.signal.aborted) { request.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })); }
      else init.signal.addEventListener('abort', () => request.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }
    if (init.body !== undefined && init.body !== null) request.write(init.body);
    request.end();
  });
}
