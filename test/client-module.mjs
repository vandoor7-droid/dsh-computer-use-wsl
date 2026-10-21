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

check('apply registers the settings card once', () => {
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

  const register = calls.find((call) => call[0] === 'register');
  assert.ok(register, 'settings.section was never registered');
  assert.equal(register[1], 'settings.section');
  assert.equal(register[2], 'wsl-computer-use');
  assert.equal(register[3], 17);
  assert.equal(register[4], 'function');
  assert.ok(
    calls.some((call) => call[0] === 'service' && call[1] === 'sidebarRight'),
    'sidebarRight was not requested',
  );
});

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
