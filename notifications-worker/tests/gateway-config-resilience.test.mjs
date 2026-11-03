import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const start = source.indexOf('async function getGatewayConfig(env) {');
const body = source.slice(start, source.indexOf('\nasync function handle(', start));

function configReader(database) {
  const context = { googleToken: async () => 'test-token', database, console: { warn() {} } };
  vm.runInNewContext(`${body}\nthis.readConfig = getGatewayConfig;`, context);
  return context.readConfig;
}

test('private configuration outage preserves current public tunnel URL and environment API key', async () => {
  const paths = [];
  const read = configReader(async (env, token, path) => {
    assert.equal(token, 'test-token');
    paths.push(path);
    if (path.startsWith('workerPrivate/')) throw new Error('temporary private read outage');
    return { GatewayUrl: 'https://current-tunnel.example.test/api', InstanceName: 'current-session', Ativo: true };
  });
  const result = await read({ WA_API_URL: 'https://old-tunnel.example.test/api', WA_API_KEY: 'test-env-key' });
  assert.equal(paths.length, 2);
  assert.equal(result.url, 'https://current-tunnel.example.test/api');
  assert.equal(result.instance, 'current-session');
  assert.equal(result.apiKey, 'test-env-key');
  assert.equal(result.ativo, true);
});

test('public configuration outage preserves private API key and environment tunnel fallback', async () => {
  const read = configReader(async (env, token, path) => {
    if (path.startsWith('tables/')) throw new Error('temporary public read outage');
    return { ApiKey: 'test-private-key' };
  });
  const result = await read({ WA_API_URL: 'https://fallback.example.test', WA_SESSION_ID: 'fallback-session' });
  assert.equal(result.url, 'https://fallback.example.test/api');
  assert.equal(result.instance, 'fallback-session');
  assert.equal(result.apiKey, 'test-private-key');
});

test('successful reads retain environment key precedence and disabled configuration', async () => {
  const read = configReader(async (env, token, path) => path.startsWith('tables/')
    ? { GatewayUrl: 'https://current.example.test/api', Ativo: false, ApiKey: 'test-legacy-key' }
    : { ApiKey: 'test-private-key' });
  const result = await read({ WA_API_KEY: 'test-env-key' });
  assert.equal(result.apiKey, 'test-env-key');
  assert.equal(result.ativo, false);
});
