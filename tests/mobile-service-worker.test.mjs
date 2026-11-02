import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker({ failWrites = false } = {}) {
  const handlers = {}, entries = new Map();
  let requests = 0, installed = [];
  const response = () => ({ ok: true, type: 'basic', clone: response });
  const cache = {
    match: async r => entries.get(typeof r === 'string' ? r : r.url),
    put: async (r, value) => { if (failWrites) throw Error('QuotaExceeded'); entries.set(r.url, value); },
    addAll: async urls => { installed = urls; },
  };
  vm.runInNewContext(source, {
    URL, console,
    self: { location: { href: 'https://example.test/folgas/sw.js', origin: 'https://example.test' },
      addEventListener: (event, fn) => { handlers[event] = fn; }, skipWaiting() {} },
    caches: { open: async () => cache },
    fetch: async () => { requests++; return response(); },
  });
  return {
    get requests() { return requests; }, get installed() { return installed; },
    async install() { let promise; handlers.install({ waitUntil: p => { promise = p; } }); await promise; },
    async load(path) {
      let promise;
      handlers.fetch({ request: { url: `https://example.test/folgas/${path}`, method: 'GET', destination: 'script', mode: 'cors' },
        respondWith: p => { promise = p; } });
      return promise;
    },
  };
}

test('bundles com hash reutilizam cache sem nova requisição de rede', async () => {
  for (const path of ['assets/index-aB_c1234.js', 'generated/legacy-client-123456abcdef.js']) {
    const w = worker();
    assert.equal((await w.load(path)).ok, true);
    assert.equal((await w.load(path)).ok, true);
    assert.equal(w.requests, 1);
  }
});
test('scripts sem hash continuam consultando versão da rede', async () => {
  const w = worker(); await w.load('config.js'); await w.load('config.js');
  assert.equal(w.requests, 2);
});
test('quota de cache esgotada não impede carregar bundle online', async () => {
  const w = worker({ failWrites: true });
  assert.equal((await w.load('assets/index-12345678.js')).ok, true);
});
