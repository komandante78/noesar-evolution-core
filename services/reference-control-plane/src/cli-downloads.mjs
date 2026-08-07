// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The bootstrap route: how a machine that has only this installation obtains the launcher.
//
// WHY IT EXISTS. `deployment/container/install-coden-cli.sh` removes the host ritual, but
// it cannot remove the problem of getting hold of ITSELF. Before this route the only
// documented way was 08_INSTALLAZIONE §12 step 1 — `docker create`, `docker cp`, `docker rm`,
// `chmod`, and the image tag typed correctly — which is four commands and a fact to
// memorise, i.e. exactly the shape of problem the launcher was written to abolish, moved up
// one floor. And it required the person to be on the machine running the engine, with the
// right to talk to it, which the browser user is not.
//
// The port is already open and already serving the page. So the bytes are served from it.
//
// THE INVARIANT, AND WHY IT IS MECHANICAL. Nothing here ever joins a path fragment that came
// from the URL. A request pathname is used only as a KEY into a frozen table, and what comes
// back is a basename this file wrote. Path traversal is therefore not defended against, it is
// unrepresentable: there is no code path in which caller input reaches `join()`. This is the
// same shape as the `/skills` search invariant — a projection rather than a filter — chosen
// for the same reason: the two behave identically today and diverge under change, because a
// filter has to be updated when something new is added and a projection does not.
//
// WHAT IS DELIBERATELY UNAUTHENTICATED. These four files are AGPL source, they are already
// published, and they contain no secret, no address and no state of this installation. The
// route exists precisely for a caller who has no credentials yet — requiring a session to
// download the thing you log in WITH is a loop. What is NOT served here is anything derived
// from the running installation; the table is a constant, not a directory listing.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A launcher or an installer is a few tens of kilobytes. The cap is here so that a
// misconfigured runtime root — one pointing at a tree where these names mean something
// else entirely — cannot turn this route into a way to read a large file out of the host.
export const MAX_ARTIFACT_BYTES = 1024 * 1024;

// route -> the file it serves. The value's `basename` is the ONLY thing that ever reaches
// the filesystem, and every one of them is a literal written here.
const CATALOGUE = new Map([
  ['/cli/install.sh', {
    basename: 'install-coden-cli.sh',
    contentType: 'text/x-shellscript; charset=utf-8',
    summary: 'installer, POSIX shell (Linux, macOS, BSD, WSL)',
  }],
  ['/cli/install.ps1', {
    basename: 'Install-CodenCli.ps1',
    contentType: 'text/plain; charset=utf-8',
    summary: 'installer, PowerShell (Windows)',
  }],
  ['/cli/coden-evolution', {
    basename: 'coden-evolution',
    contentType: 'text/x-shellscript; charset=utf-8',
    summary: 'the launcher itself, POSIX shell',
  }],
  ['/cli/coden-evolution.ps1', {
    basename: 'coden-evolution.ps1',
    contentType: 'text/plain; charset=utf-8',
    summary: 'the launcher itself, PowerShell',
  }],
]);

const DIGEST_SUFFIX = '.sha256';

/** Every route this module answers, digests included. Derived, never hand-listed. */
export function cliDownloadRoutes() {
  const routes = ['/cli', '/cli/'];
  for (const route of CATALOGUE.keys()) {
    routes.push(route, `${route}${DIGEST_SUFFIX}`);
  }
  return routes;
}

/**
 * Resolve a request pathname to a catalogue entry.
 *
 * Returns null for anything not in the table — which includes every traversal attempt,
 * not because they are detected but because they are not keys.
 */
export function resolveCliDownload(pathname) {
  if (typeof pathname !== 'string') return null;
  if (pathname.endsWith(DIGEST_SUFFIX)) {
    const base = pathname.slice(0, -DIGEST_SUFFIX.length);
    const entry = CATALOGUE.get(base);
    return entry ? { ...entry, route: base, digestOnly: true } : null;
  }
  const entry = CATALOGUE.get(pathname);
  return entry ? { ...entry, route: pathname, digestOnly: false } : null;
}

/**
 * Read an artifact and digest it.
 *
 * `runtimeRoot` is the installation's own declared root, never anything from a request.
 * A missing file is a null, not a throw: an image built before these files were shipped is
 * a real state, and the route must say "not here" rather than fall over.
 */
export function readCliArtifact(runtimeRoot, entry) {
  if (!entry || typeof runtimeRoot !== 'string' || !runtimeRoot) return null;
  const path = join(runtimeRoot, 'tools', entry.basename);
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ARTIFACT_BYTES) return null;
  const bytes = readFileSync(path);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), path };
}

/**
 * The human page at /cli.
 *
 * Plain text on purpose: it is read in a terminal at least as often as in a browser, and
 * the whole point of this route is to be usable by someone who has nothing installed yet.
 *
 * The verify-then-run form is given FIRST and the pipe-to-shell form is not given at all.
 * This project's own rule is that the digest of anything installed is checked before it is
 * installed, and a page that teaches `curl | sh` teaches people to skip exactly that.
 */
export function renderCliIndex(baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  const lines = [
    'NOESAR EVOLUTION — open the session from a terminal',
    '',
    'You do not need any of this to use the product. The same session is already open',
    `in a browser at ${base}/ — on any device, with nothing installed.`,
    '',
    'This page is only for putting the one-word command on a machine that has a',
    'container engine.',
    '',
    'Linux, macOS, BSD, WSL — download, check the digest, then run it:',
    '',
    `    curl -fsSLO ${base}/cli/install.sh`,
    `    curl -fsSL  ${base}/cli/install.sh.sha256`,
    '    sha256sum install-coden-cli.sh      # compare the two, then:',
    '    sh install.sh',
    '',
    'Windows (PowerShell):',
    '',
    `    Invoke-WebRequest ${base}/cli/install.ps1 -OutFile Install-CodenCli.ps1`,
    `    Invoke-WebRequest ${base}/cli/install.ps1.sha256 -OutFile Install-CodenCli.ps1.sha256`,
    '    Get-FileHash Install-CodenCli.ps1    # compare, then:',
    '    .\\Install-CodenCli.ps1',
    '',
    'Neither installer needs root or Administrator. Neither edits sshd, sudoers, or any',
    'group membership. Both install into your own account and can be undone with',
    '--uninstall. Afterwards, type:  coden_evolution',
    '',
    'Files served here:',
  ];
  for (const [route, entry] of CATALOGUE) {
    lines.push(`    ${route}${' '.repeat(Math.max(1, 28 - route.length))}${entry.summary}`);
    lines.push(`    ${route}${DIGEST_SUFFIX}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
