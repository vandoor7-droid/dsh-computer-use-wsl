/**
 * L6 — the browser half is a script, not a module: DSH's client loader calls
 * `window.__ModuleLoader__.load(spec)` and then `spec.factory(require)`.
 * This loads the real file under that contract so a syntax error, a wrong id
 * or a broken `apply` cannot slip into the published package.
 */

import assert from 'node:assert/strict';

let spec = null;
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      spec = value;
    },
  },
  open() {
    return null;
  },
};

await import('../lib/client.js');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}  ${error.message}`);
  }
}

check('module registers itself with __ModuleLoader__', () => {
  assert.ok(spec, 'load() was never called');
  assert.equal(spec.id, 'dsh-computer-use-wsl');
  assert.equal(typeof spec.factory, 'function');
});

const reactStub = {
  createElement: (...args) => ({ type: args[0], args }),
  useState: (initial) => [initial, () => {}],
  Fragment: Symbol('Fragment'),
};
const mod = spec.factory((name) => (name === 'react' ? reactStub : {}));

check('factory returns the plugin contract', () => {
  assert.equal(typeof mod.apply, 'function');
  assert.deepEqual(mod.inject, ['slots']);
});

check('apply tolerates a host without slots or sidebar', () => {
  assert.doesNotThrow(() => mod.apply({}));
  assert.doesNotThrow(() => mod.apply(undefined));
});

check('apply registers the chat-dock status badge', () => {
  const calls = [];
  const ctx = {
    slots: {
      inject(name, register) {
        calls.push(['inject', name]);
        register();
      },
      register(meta, component) {
        calls.push(['register', meta.name, meta.id, meta.order, typeof component]);
        return () => {};
      },
    },
    inject(services, run) {
      calls.push(['service', services.join(',')]);
      run({ sidebarRight: { openTab() {} } });
      return () => {};
    },
  };
  mod.apply(ctx);

  assert.ok(
    calls.some((call) => call[0] === 'inject' && call[1] === 'conversation.input.dock'),
    'the badge slot was never injected',
  );
  const badge = calls.find((call) => call[0] === 'register' && call[1] === 'conversation.input.dock');
  assert.ok(badge, 'the chat-dock badge was never registered');
  assert.equal(badge[2], 'wsl-computer-status');
  assert.equal(badge[4], 'function');
  assert.ok(
    calls.some((call) => call[0] === 'service' && call[1] === 'sidebarRight'),
    'sidebarRight was not requested',
  );
});

check('apply registers the plugin-page form when configForms is available', () => {
  const calls = [];
  const scope = {
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'ready', value: {}, writable: true, revision: 1 }),
    load: () => {},
    set: () => {},
    mutate: () => true,
  };
  const ctx = {
    slots: {
      inject(name, register) {
        register();
      },
      register(meta, component) {
        calls.push(['register', meta.name, meta.id, meta.order, typeof component]);
        return () => {};
      },
    },
    inject(services, run) {
      if (services.includes('configForms')) {
        run({
          configForms: { get: () => scope, describe: () => ({ acceptView() {}, load() {} }) },
          connection: null,
        });
      }
      return () => {};
    },
  };
  mod.apply(ctx);

  const form = calls.find((call) => call[0] === 'register' && call[1] === 'plugins.item');
  assert.ok(form, 'the plugin-page settings form was never registered');
  assert.equal(form[2], 'wsl-computer-use');
  assert.equal(form[4], 'function');
  // The badge must still be there: both surfaces live in the same module.
  assert.ok(calls.some((call) => call[1] === 'conversation.input.dock'));
});

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
