// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Does this document have the SHAPE a descriptor must have — `D-0546`.
//
// `schemas/model-descriptor.schema.json` has existed since `D-0521` and, until this file, was
// read by nothing: a `grep` for its own filename across the tree found three mentions, all of
// them prose. A schema nobody executes is documentation that happens to be valid JSON.
//
// It matters here and not only as tidiness. `signModelDescriptor()` will sign **any** object —
// it is a signature over bytes and asks no questions. So a publisher could sign a descriptor
// with `hashes` spelled `hash`, ship it, and have it refused downstream for a reason that has
// nothing to do with authenticity, with a valid signature attached to a useless document. The
// signature would be correct and the artefact still unusable, which is the worst kind of pass.
//
// # Why this is not a JSON Schema implementation, and refuses to be mistaken for one
//
// It implements the keywords `schemas/model-descriptor.schema.json` actually uses. A validator
// that quietly ignored a keyword it did not implement would report `valid: true` for a document
// it never checked — a green light earned by not looking. So an unknown keyword is a **throw**,
// not a shrug: `validateAgainstSchema()` refuses a schema it cannot check completely, and the
// day someone adds `pattern` or `minimum` to the schema, this file fails loudly and gets the
// keyword rather than silently weakening every check downstream of it.
//
// No filesystem and no network, like every other module in this package: the caller reads the
// schema and passes it in, so the same function serves the CLI, a test, and a third party who
// keeps the schema somewhere else entirely.

/** Keywords that carry no constraint and are therefore safe to ignore. */
const INERT = new Set(['$schema', '$id', 'title', 'description', 'examples', 'default']);

/** Keywords this file checks. Anything outside these two sets is a refusal, never a pass. */
const SUPPORTED = new Set(['type', 'required', 'properties', 'additionalProperties', 'items', 'const', 'enum']);

export class SchemaSupportError extends Error {
  constructor(keyword, path) {
    super(`this validator does not implement the JSON Schema keyword "${keyword}" (at ${path || '#'}), so it cannot state that a document satisfies this schema`);
    this.name = 'SchemaSupportError';
    this.keyword = keyword;
    this.path = path;
  }
}

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const matchesType = (value, type) => {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeOf(value) === type;
};

/**
 * Walk the WHOLE schema before looking at any document.
 *
 * Checking each node as it is reached would only cover the branches a particular document
 * happens to visit: a keyword sitting on an optional field nobody filled in would pass
 * unnoticed until the day someone used that field, and then it would pass unchecked. The
 * guarantee has to be about the schema, not about one document's path through it.
 */
export function assertSchemaSupported(schema, path = '') {
  if (schema === true || schema === false || schema === undefined) return;
  if (typeOf(schema) !== 'object') throw new SchemaSupportError(String(typeOf(schema)), path);
  for (const keyword of Object.keys(schema)) {
    if (INERT.has(keyword) || SUPPORTED.has(keyword)) continue;
    throw new SchemaSupportError(keyword, path);
  }
  for (const [key, entry] of Object.entries(schema.properties ?? {})) assertSchemaSupported(entry, `${path}/${key}`);
  if (schema.items !== undefined) assertSchemaSupported(schema.items, `${path}/*`);
  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
    assertSchemaSupported(schema.additionalProperties, `${path}/*`);
  }
}

function check(value, schema, path, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push({ path, message: 'no value is allowed here' });
    return;
  }

  if ('const' in schema && value !== schema.const) {
    errors.push({ path, message: `must be ${JSON.stringify(schema.const)}, not ${JSON.stringify(value)}` });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) {
    errors.push({ path, message: `must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}` });
    return;
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push({ path, message: `must be ${types.join(' or ')}, not ${typeOf(value)}` });
      // A wrong type makes every nested check meaningless — reporting them too would bury
      // the one error that matters under its own consequences.
      return;
    }
  }

  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push({ path: `${path}/${key}`, message: 'is required and missing' });
    }
    const properties = schema.properties ?? {};
    for (const [key, entry] of Object.entries(value)) {
      const child = `${path}/${key}`;
      if (Object.hasOwn(properties, key)) {
        check(entry, properties[key], child, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: child, message: 'is not a field this schema defines' });
      } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
        check(entry, schema.additionalProperties, child, errors);
      }
    }
    // A `properties` subschema is applied only to a key that is present: an absent optional
    // field is absent, not invalid. `required` is the only thing that makes absence an error.
  }

  if (typeOf(value) === 'array' && schema.items !== undefined) {
    value.forEach((entry, index) => check(entry, schema.items, `${path}/${index}`, errors));
  }
}

/**
 * Validate `document` against `schema`.
 *
 * @param {unknown} document
 * @param {object} schema  a schema using only the keywords listed in `SUPPORTED`
 * @returns {{valid: boolean, errors: Array<{path: string, message: string}>}}
 * @throws {SchemaSupportError} when the schema uses a keyword this file cannot check —
 *         deliberately louder than returning `valid: true` for a document nobody checked
 */
export function validateAgainstSchema(document, schema) {
  assertSchemaSupported(schema);
  const errors = [];
  check(document, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

/** One line per error, in the order found — what a CLI prints and a test asserts on. */
export function formatSchemaErrors(errors) {
  return errors.map((error) => `  ${error.path === '' ? '(document)' : error.path} ${error.message}`).join('\n');
}
