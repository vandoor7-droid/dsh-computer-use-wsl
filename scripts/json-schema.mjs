/**
 * A deliberately small JSON Schema (draft 2020-12) validator.
 *
 * The plugin keeps its tests dependency-free: a fresh clone runs `node --test`
 * without an install step. Rather than pulling in `ajv`, this module implements
 * exactly the keywords the vendored manifest schema uses, and **refuses to
 * validate a schema that uses anything else** — a silently narrower validator
 * would turn the gate into a rubber stamp the day upstream adds a keyword.
 *
 * Supported: type, required, properties, patternProperties, additionalProperties,
 * items, minItems, maxItems, minLength, maxLength, pattern, const, enum, oneOf,
 * $ref (#/$defs/*), format (ignored, i.e. lenient).
 *
 * Not supported on purpose: allOf/anyOf/if-then-else/$dynamicRef, numeric bounds,
 * dependentRequired, unevaluatedProperties.
 */

const KEYWORDS = new Set([
  'type',
  'required',
  'properties',
  'patternProperties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'const',
  'enum',
  'oneOf',
  '$ref',
  '$defs',
  'format',
]);

const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'default',
  'examples',
  '$comment',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

function walkSchema(node, path, visit) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  visit(node, path);
  for (const key of ['properties', 'patternProperties', '$defs']) {
    const group = node[key];
    if (!group || typeof group !== 'object') continue;
    for (const [name, sub] of Object.entries(group)) walkSchema(sub, `${path}/${key}/${name}`, visit);
  }
  if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
    walkSchema(node.items, `${path}/items`, visit);
  }
  if (Array.isArray(node.oneOf)) {
    node.oneOf.forEach((sub, index) => walkSchema(sub, `${path}/oneOf/${index}`, visit));
  }
  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    walkSchema(node.additionalProperties, `${path}/additionalProperties`, visit);
  }
}

/** Throws when the schema uses a keyword this validator does not implement. */
export function assertSchemaSupported(schema) {
  const unknown = new Set();
  walkSchema(schema, '#', (node) => {
    for (const key of Object.keys(node)) {
      if (KEYWORDS.has(key) || ANNOTATIONS.has(key)) continue;
      unknown.add(key);
    }
  });
  if (unknown.size) {
    throw new Error(`json-schema subset missing keyword(s): ${[...unknown].sort().join(', ')}`);
  }
}

function resolveRef(ref, root) {
  const prefix = '#/$defs/';
  if (!ref.startsWith(prefix)) throw new Error(`unsupported $ref: ${ref}`);
  const name = ref.slice(prefix.length);
  const target = root.$defs && root.$defs[name];
  if (!target) throw new Error(`unknown $def: ${name}`);
  return target;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(expected, value) {
  const actual = typeOf(value);
  if (expected === 'integer') return actual === 'number' && Number.isInteger(value);
  if (expected === 'number') return actual === 'number' && Number.isFinite(value);
  if (expected === 'object') return actual === 'object';
  return actual === expected;
}

function check(schema, value, path, root, errors) {
  if (schema.$ref) {
    check(resolveRef(schema.$ref, root), value, path, root, errors);
    return;
  }

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((type) => matchesType(type, value))) {
      errors.push(`${path || '<root>'}: expected ${expected.join('|')}, got ${typeOf(value)}`);
      return;
    }
  }

  if (Object.hasOwn(schema, 'const') && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${path || '<root>'}: expected const ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    errors.push(`${path || '<root>'}: value ${JSON.stringify(value)} is not in enum`);
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((sub) => {
      const branch = [];
      check(sub, value, path, root, branch);
      return branch.length === 0;
    }).length;
    if (matches !== 1) errors.push(`${path || '<root>'}: oneOf matched ${matches} branches`);
  }

  if (typeof value === 'string') {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${path || '<root>'}: shorter than ${schema.minLength}`);
    }
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${path || '<root>'}: longer than ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path || '<root>'}: does not match ${schema.pattern}`);
    }
  }

  if (Array.isArray(value)) {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${path || '<root>'}: needs at least ${schema.minItems} item(s)`);
    }
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${path || '<root>'}: allows at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) value.forEach((item, index) => check(schema.items, item, `${path}/${index}`, root, errors));
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path || '<root>'}: missing required "${key}"`);
    }
    const patterns = Object.entries(schema.patternProperties || {});
    for (const [key, item] of Object.entries(value)) {
      const child = `${path}/${key}`;
      let matched = false;
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        matched = true;
        check(schema.properties[key], item, child, root, errors);
      }
      for (const [pattern, sub] of patterns) {
        if (new RegExp(pattern, 'u').test(key)) {
          matched = true;
          check(sub, item, child, root, errors);
        }
      }
      if (matched) continue;
      if (schema.additionalProperties === false) {
        errors.push(`${path || '<root>'}: unexpected property "${key}"`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        check(schema.additionalProperties, item, child, root, errors);
      }
    }
  }
}

/**
 * Validate `value` against `schema`.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validate(schema, value) {
  assertSchemaSupported(schema);
  const errors = [];
  check(schema, value, '', schema, errors);
  return { ok: errors.length === 0, errors };
}
