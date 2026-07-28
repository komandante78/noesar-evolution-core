// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal repository understanding · phase 1 step 7, the last step of the backbone
// (09_PIANO.md §2, moved here from phase 2 by P5 in 11_REVISIONE_E_CORREZIONI.md: planning
// needs it regardless, and without it phase 1 could not pass its own "done" criterion).
//
// Scope is deliberately the P5 list and nothing past it: language detection, entry points,
// a symbol index, literal search, a dependency map. The richer picture in
// MASTER_PROJECT/06_CODEN_EVOLUTION.md §3 -- ownership, recency, per-module coverage,
// criticality, fragility, ambiguity -- is named there as phase 2's "second-level signals"
// and is not built here. Reaching for it now would be exactly the anticipatory work the
// phase cycle forbids (skill step 5: "nothing anticipatory, nothing while we're here").
//
// No Rust twin. Steps 1/3/4/5/6 got one because they decide and confine -- the stack split
// in 11_REVISIONE_E_CORREZIONI.md D-A. This module answers "what is in this tree", it does
// not gate anything on the answer: reading a repository is JavaScript's side of that split,
// same as the shells and the presentation layer. There is nothing here for a shared
// conformance/*.json oracle to hold two implementations equal to.
//
// The method is a heuristic, and it says so rather than implying more than it does. Symbol
// extraction is regex over source text, not a parser -- the plan itself distinguishes "AST
// parsing for breadth" from a index built this way, and pretending otherwise on a security
// surface is exactly the "schema mork" failure 09_PIANO.md §1 names: a signal that reads as
// more certain than it is, is worse than no signal.

import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

export class RepoMapError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'RepoMapError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new RepoMapError(kind, reason); };

// Directories never worth walking. node_modules and target alone can carry more files than
// the rest of a repository combined -- a "map" dominated by vendored code is not a map of
// the repository, and walking them is where an "incremental, never blocking" scan would stop
// being either.
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', 'vendor', '.venv', 'venv',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.next', '.nuxt', 'coverage', '.cache',
  '.workspace', 'shadows',
]);

// Extensions that are source in some language, versus configuration/markup/data that still
// counts as a file but is not "a language" in the sense §1 of this map reports.
const LANGUAGE_BY_EXTENSION = Object.freeze({
  '.js':'javascript', '.mjs':'javascript', '.cjs':'javascript', '.jsx':'javascript',
  '.ts':'typescript', '.tsx':'typescript',
  '.py':'python', '.pyi':'python',
  '.rs':'rust',
  '.go':'go',
  '.rb':'ruby',
  '.java':'java',
  '.c':'c', '.h':'c',
  '.cpp':'cpp', '.cc':'cpp', '.hpp':'cpp', '.hh':'cpp',
  '.cs':'csharp',
  '.php':'php',
  '.sh':'shell', '.bash':'shell',
  '.ps1':'powershell', '.psm1':'powershell',
  '.sql':'sql',
});
const NON_LANGUAGE_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.md', '.txt', '.html', '.css', '.svg', '.lock',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.pdf', '.zip',
]);

// Regex over source text, per language. Each pattern names the symbol kind it stands for;
// none of this is a parser and a symbol nested inside a class, a closure, or a macro can be
// missed or mis-kinded. Declared in repoMapStatus(), not discovered by whoever reads it.
const JS_PATTERNS = [
  { kind:'function', re:/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/gm },
  { kind:'function', re:/^\s*(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/gm },
  { kind:'class',    re:/^\s*export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
  { kind:'class',    re:/^\s*class\s+([A-Za-z_$][\w$]*)/gm },
  { kind:'const',    re:/^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=/gm },
];
const SYMBOL_PATTERNS = Object.freeze({
  javascript: JS_PATTERNS,
  typescript: [
    ...JS_PATTERNS,
    { kind:'interface', re:/^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/gm },
    { kind:'type',       re:/^\s*export\s+type\s+([A-Za-z_$][\w$]*)/gm },
  ],
  python: [
    { kind:'function', re:/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm },
    { kind:'class',    re:/^\s*class\s+([A-Za-z_]\w*)/gm },
  ],
  rust: [
    { kind:'function', re:/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/gm },
    { kind:'struct',   re:/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/gm },
    { kind:'enum',     re:/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/gm },
    { kind:'trait',    re:/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/gm },
  ],
  go: [
    { kind:'function', re:/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm },
    { kind:'struct',   re:/^\s*type\s+([A-Za-z_]\w*)\s+struct\b/gm },
  ],
});

/**
 * Walks the tree once, breadth of files only -- no content is read here. Symlinked
 * directories are listed but never entered: following one could walk outside `rootDir`
 * silently, which is exactly the escape path-auth.mjs already refuses for writes and this
 * read-only walk refuses for the same reason.
 */
function walk(rootDir, maxFiles) {
  const files = [];
  const skippedSymlinks = [];
  let truncated = false;
  const stack = [rootDir];
  while (stack.length && !truncated) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes:true }); } catch { continue; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) { skippedSymlinks.push(relative(rootDir, full)); continue; }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(full);
      if (files.length >= maxFiles) { truncated = true; break; }
    }
  }
  return { files, skippedSymlinks, truncated };
}

function detectLanguages(files) {
  const byLanguage = new Map();
  let otherFiles = 0;
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[ext];
    if (language) {
      byLanguage.set(language, (byLanguage.get(language) ?? 0) + 1);
    } else if (!NON_LANGUAGE_EXTENSIONS.has(ext)) {
      otherFiles += 1;
    }
  }
  const languages = [...byLanguage.entries()]
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files);
  return {
    languages,
    primary: languages[0]?.language ?? null,
    otherFiles,
    // A repository this map has no pattern for still gets counted, not silently dropped:
    // "primary: null" on an empty repo and "primary: null" on a repo of one unknown
    // language must not read the same in a report someone did not open the raw numbers on.
  };
}

function readBounded(file, maxBytes) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return readFileSync(file, 'utf8');
  } catch { return null; }
}

function detectManifests(rootDir, files) {
  const manifestNames = new Set([
    'package.json', 'Cargo.toml', 'requirements.txt', 'pyproject.toml', 'go.mod',
    'Gemfile', 'composer.json', 'Dockerfile', 'Containerfile',
  ]);
  return files
    .filter((file) => manifestNames.has(file.slice(file.lastIndexOf(sep) + 1)))
    .map((file) => ({ path:relative(rootDir, file), name:file.slice(file.lastIndexOf(sep) + 1) }));
}

/** package.json main/bin/exports -- the manifest's own declaration, not a guess. */
function entryPointsFromPackageJson(rootDir, manifestPath) {
  const points = [];
  const text = readBounded(join(rootDir, manifestPath), 1024 * 1024);
  if (!text) return points;
  let pkg;
  try { pkg = JSON.parse(text); } catch { return points; }
  const dir = manifestPath.slice(0, manifestPath.length - 'package.json'.length);
  if (typeof pkg.main === 'string') points.push({ kind:'main', path:dir + pkg.main, source:manifestPath });
  if (typeof pkg.bin === 'string') points.push({ kind:'bin', path:dir + pkg.bin, source:manifestPath });
  if (pkg.bin && typeof pkg.bin === 'object') {
    for (const [name, target] of Object.entries(pkg.bin)) {
      points.push({ kind:'bin', name, path:dir + target, source:manifestPath });
    }
  }
  return points;
}

/** Cargo.toml [[bin]] entries and the two conventional paths cargo treats as entry points
 * without any manifest line at all. Line-scanned on purpose -- see the module comment on the
 * zero-dependency policy this project already keeps; a TOML table scan for one bounded shape
 * is honest about not being a parser, a new dependency for a full one would not be. */
function entryPointsFromCargoToml(rootDir, manifestPath) {
  const points = [];
  const dir = manifestPath.slice(0, manifestPath.length - 'Cargo.toml'.length);
  const text = readBounded(join(rootDir, manifestPath), 1024 * 1024) ?? '';
  const binPathRe = /path\s*=\s*"([^"]+)"/;
  const lines = text.split('\n');
  let inBinTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[\[bin\]\]/.test(trimmed)) { inBinTable = true; continue; }
    if (/^\[/.test(trimmed) && !/^\[\[bin\]\]/.test(trimmed)) { inBinTable = false; continue; }
    if (inBinTable) {
      const match = binPathRe.exec(trimmed);
      if (match) points.push({ kind:'bin', path:dir + match[1], source:manifestPath });
    }
  }
  for (const conventional of ['src/main.rs', 'src/bin']) {
    const full = join(rootDir, dir, conventional);
    try { lstatSync(full); points.push({ kind:'bin', path:dir + conventional, source:'convention' }); } catch { /* absent */ }
  }
  return points;
}

/** Dockerfile / Containerfile CMD and ENTRYPOINT -- the container's own declared start. */
function entryPointsFromContainerfile(rootDir, manifestPath) {
  const points = [];
  const text = readBounded(join(rootDir, manifestPath), 256 * 1024) ?? '';
  const re = /^\s*(CMD|ENTRYPOINT)\s+(.+)$/gm;
  let match;
  while ((match = re.exec(text))) {
    points.push({ kind:match[1].toLowerCase(), command:match[2].trim(), source:manifestPath });
  }
  return points;
}

function detectEntryPoints(rootDir, manifests) {
  const points = [];
  for (const manifest of manifests) {
    if (manifest.name === 'package.json') points.push(...entryPointsFromPackageJson(rootDir, manifest.path));
    if (manifest.name === 'Cargo.toml') points.push(...entryPointsFromCargoToml(rootDir, manifest.path));
    if (manifest.name === 'Dockerfile' || manifest.name === 'Containerfile') {
      points.push(...entryPointsFromContainerfile(rootDir, manifest.path));
    }
  }
  return points;
}

/** Declared dependencies, read from each manifest's own dependency section. Not resolved,
 * not walked transitively -- a name and the version string the manifest itself states. */
function dependenciesFromManifest(rootDir, manifest) {
  if (manifest.name === 'package.json') {
    const text = readBounded(join(rootDir, manifest.path), 1024 * 1024);
    if (!text) return [];
    let pkg;
    try { pkg = JSON.parse(text); } catch { return []; }
    const deps = [];
    for (const section of ['dependencies', 'devDependencies']) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        deps.push({ name, version:String(version), kind:section, source:manifest.path });
      }
    }
    return deps;
  }
  if (manifest.name === 'Cargo.toml') {
    const text = readBounded(join(rootDir, manifest.path), 1024 * 1024) ?? '';
    const deps = [];
    let inDepsTable = false;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (/^\[dependencies(\.[\w-]+)?\]/.test(line)) { inDepsTable = true; continue; }
      if (/^\[/.test(line)) { inDepsTable = false; continue; }
      if (!inDepsTable || !line || line.startsWith('#')) continue;
      const match = /^([\w-]+)\s*=\s*(.+)$/.exec(line);
      if (match) deps.push({ name:match[1], version:match[2].trim(), kind:'dependencies', source:manifest.path });
    }
    return deps;
  }
  if (manifest.name === 'requirements.txt') {
    const text = readBounded(join(rootDir, manifest.path), 256 * 1024) ?? '';
    return text.split('\n')
      .map((line) => line.split('#')[0].trim())
      .filter(Boolean)
      .map((line) => {
        const match = /^([A-Za-z0-9_.-]+)\s*([<>=!~].*)?$/.exec(line);
        return match
          ? { name:match[1], version:(match[2] ?? '').trim() || 'unpinned', kind:'dependencies', source:manifest.path }
          : null;
      })
      .filter(Boolean);
  }
  return [];
}

/** First-party import literals for JS/TS -- `import ... from './x'` and `require('./x')`
 * whose specifier is relative. Bare specifiers (`from 'node:fs'`, a package name) are not
 * resolved against node_modules: that is module resolution, a different and heavier
 * mechanism than a map of what this repository declares about itself. */
function internalImportsFromSource(rootDir, file, maxBytes) {
  const text = readBounded(file, maxBytes);
  if (!text) return [];
  const specifiers = new Set();
  const importRe = /\bimport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const requireRe = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [importRe, requireRe]) {
    let match;
    while ((match = re.exec(text))) {
      const spec = match[1];
      if (spec.startsWith('.')) specifiers.add(spec);
    }
  }
  return [...specifiers].map((specifier) => ({ from:relative(rootDir, file), specifier }));
}

function buildSymbolIndex(rootDir, files, { maxFileBytes, maxSymbols }) {
  const symbols = [];
  let filesScanned = 0;
  let truncated = false;
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[ext];
    const patterns = language ? SYMBOL_PATTERNS[language] : null;
    if (!patterns) continue;
    const text = readBounded(file, maxFileBytes);
    if (text === null) continue;
    filesScanned += 1;
    for (const { kind, re } of patterns) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text))) {
        const before = text.slice(0, match.index);
        const line = before.split('\n').length;
        symbols.push({ name:match[1], kind, language, path:relative(rootDir, file), line });
        if (symbols.length >= maxSymbols) { truncated = true; break; }
      }
      if (truncated) break;
    }
    if (truncated) break;
  }
  return { symbols, filesScanned, truncated };
}

function buildDependencyMap(rootDir, files, manifests, { maxFileBytes, maxImportEntries }) {
  const declared = manifests.flatMap((manifest) => dependenciesFromManifest(rootDir, manifest));
  const internal = [];
  let truncated = false;
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext !== '.js' && ext !== '.mjs' && ext !== '.cjs' && ext !== '.jsx'
      && ext !== '.ts' && ext !== '.tsx') continue;
    internal.push(...internalImportsFromSource(rootDir, file, maxFileBytes));
    if (internal.length >= maxImportEntries) { truncated = true; break; }
  }
  return { declared, internalImports:internal, truncated };
}

/**
 * Builds the map in one pass: a real filesystem tree in, five reports out. Called fresh each
 * time -- there is no cache and no watcher. §3 of 06_CODEN_EVOLUTION.md wants "incremental,
 * never a blocking scan"; this is neither yet, and repoMapStatus() says so rather than
 * implying an incremental engine that is not built.
 */
export function buildRepositoryMap(rootDir, options = {}) {
  const root = resolve(rootDir);
  let stat;
  try { stat = lstatSync(root); } catch { refuse('NOT_FOUND', `\`${rootDir}\` does not exist`); }
  if (!stat.isDirectory()) refuse('NOT_A_DIRECTORY', `\`${rootDir}\` is not a directory`);

  const maxFiles = options.maxFiles ?? 20000;
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024;
  const maxSymbols = options.maxSymbols ?? 5000;
  const maxImportEntries = options.maxImportEntries ?? 5000;

  const { files, skippedSymlinks, truncated:filesTruncated } = walk(root, maxFiles);
  const languages = detectLanguages(files);
  const manifests = detectManifests(root, files);
  const entryPoints = detectEntryPoints(root, manifests);
  const symbolIndex = buildSymbolIndex(root, files, { maxFileBytes, maxSymbols });
  const dependencyMap = buildDependencyMap(root, files, manifests, { maxFileBytes, maxImportEntries });

  return {
    rootDir: root,
    generatedAt: new Date().toISOString(),
    filesScanned: files.length,
    skippedSymlinks: skippedSymlinks.length,
    truncated: filesTruncated || symbolIndex.truncated || dependencyMap.truncated,
    languages,
    manifests,
    entryPoints,
    symbolIndex: { symbols:symbolIndex.symbols, filesScanned:symbolIndex.filesScanned, truncated:symbolIndex.truncated },
    dependencyMap,
  };
}

/**
 * On-demand, not part of the map above and not cached with it: a search is a question asked
 * once, and folding it into the incremental map would make the map's size a function of
 * every query anyone ever ran against it.
 *
 * LITERAL search: the query is matched with `includes`, never compiled into a RegExp. A
 * user-supplied pattern reaching a RegExp constructor on a repository-sized input is exactly
 * the ReDoS shape a "search" feature invites, and `includes` cannot have that shape.
 */
export function literalSearch(rootDir, query, options = {}) {
  const root = resolve(rootDir);
  const text = String(query ?? '');
  if (!text) refuse('EMPTY_QUERY', 'a literal search needs a non-empty query');
  const maxFiles = options.maxFiles ?? 20000;
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024;
  const maxMatches = options.maxMatches ?? 500;
  const caseSensitive = options.caseSensitive !== false;
  const needle = caseSensitive ? text : text.toLowerCase();

  const { files, truncated:filesTruncated } = walk(root, maxFiles);
  const matches = [];
  let truncated = filesTruncated;
  for (const file of files) {
    if (matches.length >= maxMatches) { truncated = true; break; }
    const content = readBounded(file, maxFileBytes);
    if (content === null) continue;
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({ path:relative(root, file), line:index + 1, text:lines[index].slice(0, 400) });
        if (matches.length >= maxMatches) { truncated = true; break; }
      }
    }
  }
  return { query:text, caseSensitive, matches, truncated };
}

export function repoMapStatus() {
  return {
    scope: ['languages', 'entryPoints', 'symbolIndex', 'literalSearch', 'dependencyMap'],
    // Named so a reader does not have to diff this file against 06_CODEN_EVOLUTION.md §3 to
    // find out: ownership, recency, per-module test coverage, criticality and fragility are
    // phase 2's "second-level signals" and are not computed here.
    secondLevelSignals: false,
    incremental: false,
    astParsing: false,
    languageServerIntegration: false,
    symbolIndexMethod: 'per-language regex over source text, not a parser',
    dependencyResolution: 'declared manifest sections plus first-party relative import literals; no module resolution, no transitive graph',
    rustTwin: false,
    reason: 'This reads a tree and reports what is in it; it does not decide or confine anything on the answer, so it has no Rust counterpart and no shared conformance oracle. Rebuilt in full on every call -- there is no cache and no file watcher yet.',
  };
}
