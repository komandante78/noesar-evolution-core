// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Static analysis configuration.
//
// This exists because of blocker B-006 and the two Phase 4 findings behind it. F4-005 and
// F4-006 were the same defect twice: an object-literal shorthand naming an identifier that
// is not in scope. `node --check` cannot see it — it is valid syntax — and one instance
// meant streaming chat had never worked at all, in any release, because the ReferenceError
// fired on the first delta of every stream.
//
// Phase 4 wrote a homegrown checker for that class twice and rejected it both times as
// unsound (decision D-0034): a checker whose output has to be ignored is worse than no
// checker, because it teaches people to skip it. The correct tool was named in the blocker
// — a linter with no-undef — and this is it.
//
// `no-undef` is an error everywhere. Nothing in this configuration downgrades it, and no
// file is exempt from it.

const NODE_GLOBALS = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  ReadableStream: 'readonly',
  WritableStream: 'readonly',
  TransformStream: 'readonly',
  Event: 'readonly',
  EventTarget: 'readonly',
  MessageChannel: 'readonly',
  structuredClone: 'readonly',
  performance: 'readonly',
  queueMicrotask: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  crypto: 'readonly',
  global: 'readonly',
  globalThis: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
};

const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  Node: 'readonly',
  NodeFilter: 'readonly',
  HTMLElement: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  AbortController: 'readonly',
  EventSource: 'readonly',
  WebSocket: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  DOMParser: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  crypto: 'readonly',
  console: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  performance: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  Image: 'readonly',
  DataTransfer: 'readonly',
  MediaRecorder: 'readonly',
  PointerEvent: 'readonly',
  MediaStream: 'readonly',
  Audio: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
};

// Rules beyond no-undef, chosen for one property: each one catches a defect that runs
// without complaint. Style rules are deliberately absent — this is not a formatter, and a
// linter that reports whitespace is a linter whose real findings get scrolled past.
const CORRECTNESS_RULES = {
  'no-undef': 'error',
  'no-unused-vars': ['error', {
    args: 'none',
    caughtErrors: 'none',
    varsIgnorePattern: '^_',
    ignoreRestSiblings: true,
  }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-fallthrough': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-const-assign': 'error',
  'no-class-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-obj-calls': 'error',
  'no-sparse-arrays': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-async-promise-executor': 'error',
  'require-atomic-updates': 'off',
  // 'except-parens' (the default), not 'always': the SSE framing loop uses the standard
  // `while ((split = buffer.indexOf('\n\n')) >= 0)` idiom, where the assignment is
  // parenthesised and the comparison explicit. 'always' flags that correct code, and a
  // rule that flags correct code is a rule people learn to ignore.
  'no-cond-assign': ['error', 'except-parens'],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-prototype-builtins': 'error',
  'no-shadow-restricted-names': 'error',
  'no-with': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-return-assign': ['error', 'always'],
  'no-throw-literal': 'error',
  'no-unused-private-class-members': 'error',
  'no-useless-backreference': 'error',
  eqeqeq: ['error', 'smart'],
};

export default [
  {
    ignores: [
      'rust/vendor/**',
      // `D-0413`: `@xterm/xterm` is vendored, minified, third-party and MIT. Linting it produced
      // 444 errors in code nobody here may edit — a gate that reports what cannot be acted on
      // is a gate people learn to ignore. Its provenance and hashes are checked instead, by
      // `vendor-provenance.test.mjs`, which is the verification that actually applies to bytes
      // we did not write. Same category as `rust/vendor/**` directly above.
      'apps/webui-static/vendor/**',
      'node_modules/**',
      '**/node_modules/**',
      'BACKUPS/**',
      'provenance/**',
      'MASTER_REFERENCE/**',
      'private-boundary/**',
    ],
  },
  {
    // Node runtime, tooling, tests, workers and Node-based installers.
    //
    // `apps/shared/**` is excluded rather than merely overridden below, because flat config
    // MERGES `languageOptions.globals` across every matching block — it does not replace them.
    // A later block granting `{ console }` therefore adds `console` to Node's set instead of
    // narrowing to it, and `process.env` in shared code kept linting clean. Measured, not
    // assumed: the first attempt at this caught a planted `document.title` and missed the
    // planted `process.env.HOME` beside it, which is exactly the half-working check that
    // teaches people to trust a green result.
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    ignores: ['apps/shared/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: NODE_GLOBALS,
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: CORRECTNESS_RULES,
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // The static WebUI runs in a browser, so it has a different global set. It gets the
    // same rules — no-undef included — because that is precisely where an undeclared
    // identifier is hardest to notice: a broken handler simply does nothing.
    files: ['apps/webui-static/**/*.js', 'apps/webui-static/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      // ES modules: app.js imports from i18n.js, which exports. Declaring these as
      // scripts made ESLint report a parse error on the first line of each.
      sourceType: 'module',
      globals: BROWSER_GLOBALS,
    },
    rules: CORRECTNESS_RULES,
  },
  {
    // `D-0405` slice 1. `apps/shared/` is the code BOTH shells import: the browser fetches it
    // over `/shared/`, the terminal imports it off disk. So it gets NEITHER global set — not
    // the browser's and not Node's — and `no-undef` becomes the enforcement of that contract
    // rather than a comment asking for it. Under the generic Node block above, a `process.env`
    // in this tree would have linted clean and then thrown in the browser on first load; under
    // the browser block, a `document.` would have linted clean and thrown in the terminal.
    // Only the intersection is safe here, and only the intersection is granted.
    //
    // `console` is the one exception, and it is a real one: it is specified in both
    // environments, and excluding it would push shared code into inventing a logging seam it
    // does not need. Everything else — `process`, `document`, `window`, `fetch`, `Buffer`,
    // timers — must be passed in by whichever shell is calling, which is what keeps a module
    // that two runtimes import from quietly acquiring one runtime's assumptions.
    files: ['apps/shared/**/*.js', 'apps/shared/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { console: 'readonly' },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: CORRECTNESS_RULES,
  },
  {
    // The browser acceptance harness is a Node program that also carries code destined
    // for the page: the callbacks handed to page.evaluate() are serialised and run
    // inside the browser, where `document` and `location` do exist. Linting it as pure
    // Node reported six no-undef errors that were all correct code, and a check that
    // cries wolf is a check people learn to skip. It gets BOTH global sets, and keeps
    // no-undef switched on — the rule still catches a genuine typo in either half.
    // The WCAG audit is the same shape of program and gets the same treatment.
    // The colour snapshot is the third program of this shape: Node on the outside, page
    // code inside page.evaluate(). It is listed here rather than given a blanket exemption,
    // so no-undef keeps working on both halves of it.
    files: ['tools/browser-e2e.mjs', 'tools/accessibility-audit.mjs', 'tools/computed-style-snapshot.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
    },
    rules: CORRECTNESS_RULES,
  },
];
