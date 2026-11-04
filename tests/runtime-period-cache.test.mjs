import test from 'node:test';
import assert from 'node:assert/strict';
import { FirebaseRuntime } from '../src/core/runtime.js';

const admin = { Perfil: 'Administrador', FuncionarioID: 'admin', LojaID: '' };
function setup() {
  const runtime = new FirebaseRuntime();
  runtime.auth = { currentUser: { uid: 'account-one' } };
  return runtime;
}
test('parallel and repeated admin month reads share one query and independent results', async () => {
  const runtime = setup();
  let queries = 0, release;
  runtime.fetchPeriodRows_ = async () => { queries++; return new Promise(resolve => { release = resolve; }); };
  const first = runtime.listPeriod('RegistrosPonto', '2026-11', { profile: admin });
  const second = runtime.listPeriod('RegistrosPonto', '2026-11', { profile: admin });
  assert.equal(queries, 1);
  release([{ RegistroPontoID: 'punch-one' }]);
  const [a, b] = await Promise.all([first, second]);
  a[0].RegistroPontoID = 'local-only';
  assert.equal(b[0].RegistroPontoID, 'punch-one');
  await runtime.listPeriods('RegistrosPonto', ['2026-11', '2026-11'], { profile: admin });
  assert.equal(queries, 1);
});
test('month cache expires quickly and explicit refresh and writes bypass cached data', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  const runtime = setup();
  let queries = 0;
  runtime.fetchPeriodRows_ = async () => [{ RegistroPontoID: `punch-${++queries}` }];
  const read = (options = {}) => runtime.listPeriod('RegistrosPonto', '2026-11', { profile: admin, ...options });
  assert.equal((await read())[0].RegistroPontoID, 'punch-1');
  t.mock.timers.tick(14999);
  assert.equal((await read())[0].RegistroPontoID, 'punch-1');
  t.mock.timers.tick(1);
  assert.equal((await read())[0].RegistroPontoID, 'punch-2');
  assert.equal((await read({ forceRefresh: true }))[0].RegistroPontoID, 'punch-3');
  runtime.invalidateTableCache('RegistrosPonto');
  assert.equal((await read())[0].RegistroPontoID, 'punch-4');
});
test('month snapshots stay separate by account, month, role and unit', async () => {
  const runtime = setup();
  let queries = 0;
  runtime.fetchPeriodRows_ = async () => [{ RegistroPontoID: `punch-${++queries}` }];
  const read = (month = '2026-11', profile = admin) => runtime.listPeriod('RegistrosPonto', month, { profile });
  await read();
  runtime.auth.currentUser = { uid: 'account-two' };
  await read(); await read('2026-10'); await read('2026-11', { ...admin, LojaID: 'store-two' });
  assert.equal(queries, 4);
});
test('write during month query prevents an older response from repopulating cache', async () => {
  const runtime = setup();
  let release;
  runtime.fetchPeriodRows_ = async () => new Promise(resolve => { release = resolve; });
  const stale = runtime.listPeriod('RegistrosPonto', '2026-11', { profile: admin });
  runtime.invalidateTableCache('RegistrosPonto');
  release([{ RegistroPontoID: 'old' }]); await stale;
  runtime.fetchPeriodRows_ = async () => [{ RegistroPontoID: 'current' }];
  assert.equal((await runtime.listPeriod('RegistrosPonto', '2026-11', { profile: admin }))[0].RegistroPontoID, 'current');
});
test('migration readiness shares one read and keeps only a completed marker for the current account', async () => {
  const runtime = setup();
  let checks = 0, release;
  runtime.fetchPeriodIndexesReady_ = async () => { checks++; return new Promise(resolve => { release = resolve; }); };
  const a = runtime.periodIndexesReady(), b = runtime.periodIndexesReady();
  assert.equal(checks, 1); release(true); await Promise.all([a, b]);
  assert.equal(await runtime.periodIndexesReady(), true); assert.equal(checks, 1);
  runtime.auth.currentUser = { uid: 'account-two' };
  const c = runtime.periodIndexesReady(); assert.equal(checks, 2); release(false); assert.equal(await c, false);
  const d = runtime.periodIndexesReady(); assert.equal(checks, 3); release(true); await d;
  runtime.invalidateTableCache();
  const e = runtime.periodIndexesReady(); assert.equal(checks, 4); release(true); await e;
});
test('failed marker checks do not poison retries or retain rejected promises', async () => {
  const runtime = setup();
  runtime.fetchPeriodIndexesReady_ = async () => { throw Error('temporary network loss'); };
  await assert.rejects(runtime.periodIndexesReady(), /temporary/);
  runtime.fetchPeriodIndexesReady_ = async () => true;
  assert.equal(await runtime.periodIndexesReady(), true);
});
test('non-admin period reads keep the existing authorized scoped query', async () => {
  const runtime = setup();
  const employee = { Perfil: 'Funcionário', FuncionarioID: 'employee-one', LojaID: 'store-one' };
  runtime.fetchPeriodRows_ = async () => { throw Error('admin index must not be used'); };
  runtime.list = async (table, options) => { assert.equal(options.profile, employee); return [{ RegistroPontoID: 'own' }]; };
  assert.equal((await runtime.listPeriod('RegistrosPonto', '2026-11', { profile: employee }))[0].RegistroPontoID, 'own');
});
