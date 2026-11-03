import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { runtime } from '../src/core/runtime.js';
import { createAdvancedHandlers } from '../src/core/api-advanced.js';

const rows = [
  { ReconhecimentoID: 'colleague', FuncionarioID: 'e2', NomeFuncionario: 'Ana Silva', LojaID: 's1', Ativo: true, CriadoEm: '2026-11-03T15:00:00Z' },
  { ReconhecimentoID: 'own', FuncionarioID: 'e1', NomeFuncionario: 'Ana Silva', LojaID: 's1', Ativo: true, CriadoEm: '2026-11-02T15:00:00Z' },
  { ReconhecimentoID: 'foreign-store', FuncionarioID: 'e3', LojaID: 's2', Ativo: true },
  { ReconhecimentoID: 'disabled-string', FuncionarioID: 'e1', LojaID: 's1', Ativo: 'false' },
  { ReconhecimentoID: 'disabled-number', FuncionarioID: 'e1', LojaID: 's1', Ativo: 0 },
];
test('employee recognition source uses employee identity, never duplicate names', async t => {
  t.mock.method(runtime, 'requireProfile', async () => ({ Perfil: 'Funcionário', FuncionarioID: 'e1', LojaID: 's1' }));
  t.mock.method(runtime, 'list', async () => rows);
  const result = await createAdvancedHandlers().listarReconhecimentos([]);
  assert.deepEqual(result.data.map(row => row.ReconhecimentoID), ['own']);
});
test('manager recognition source stays within store; administrator may read the network', async t => {
  let profile = { Perfil: 'Gerente', FuncionarioID: 'manager', LojaID: 's1' };
  t.mock.method(runtime, 'requireProfile', async () => profile);
  t.mock.method(runtime, 'list', async () => rows);
  const handlers = createAdvancedHandlers();
  assert.deepEqual((await handlers.listarReconhecimentos([])).data.map(row => row.ReconhecimentoID), ['colleague', 'own']);
  profile = { Perfil: 'Administrador' };
  assert.equal((await handlers.listarReconhecimentos([])).data.length, 3);
});
test('recognition period is the creation week in Bahia, independent of user-supplied week label', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-09T02:30:00Z') });
  t.mock.method(runtime, 'requireProfile', async () => ({ Perfil: 'Gerente', LojaID: 's1', Nome: 'Gestor' }));
  t.mock.method(runtime, 'getById', async table => table === 'Funcionarios'
    ? { FuncionarioID: 'canonical-e1', Nome: 'Pessoa oficial', LojaID: 's1', Ativo: true }
    : { NomeLoja: 'Unidade oficial' });
  t.mock.method(runtime, 'upsert', async (_table, value) => value);
  const result = await createAdvancedHandlers().atribuirReconhecimento([{ FuncionarioID: 'lookup-e1', NomeFuncionario: 'Nome forjado', Motivo: 'Bom trabalho', Semana: 'Semana de 2000', SemanaInicio: '2000-01-01', SemanaFim: '2099-01-01' }]);
  assert.equal(result.data.FuncionarioID, 'canonical-e1');
  assert.equal(result.data.NomeFuncionario, 'Pessoa oficial');
  assert.equal(result.data.SemanaInicio, '2026-11-02');
  assert.equal(result.data.SemanaFim, '2026-11-08');
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-01-01T15:00:00Z') });
  const next = await createAdvancedHandlers().atribuirReconhecimento([{ FuncionarioID: 'lookup-e1', Motivo: 'Bom trabalho' }]);
  assert.equal(next.data.SemanaInicio, '2026-12-28');
  assert.equal(next.data.SemanaFim, '2027-01-03');
});

const source = await readFile(new URL('../src/legacy/Scripts.html', import.meta.url), 'utf8');
function loaderHarness() {
  const requests = [], publications = [];
  const auth = { currentUser: { uid: 'u1' } };
  const state = { user: { FuncionarioID: 'e1', Perfil: 'Funcionário', LojaID: 's1' }, recognitions: [] };
  const context = { state, window: { __GESTAO_FIREBASE__: { runtime: { auth } } },
    arr: value => Array.isArray(value) ? value : [], sessionToken: () => 'fixture-token',
    publishJourney_: () => publications.push([...state.recognitions]), console: { warn() {} },
    call: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  };
  const start = source.indexOf('  function recognitionOwnerKey_()');
  const body = source.slice(start, source.indexOf('\n  function openRecognizeEmployeeDialog()', start));
  vm.runInNewContext(`let RECOGNITIONS_REQUEST_ = null, RECOGNITIONS_OWNER_ = '', RECOGNITIONS_VERSION_ = 0;\n${body}\nthis.load = loadRecognitions_;`, context);
  return { state, auth, requests, publications, load: options => context.load(options) };
}
test('recognition loading deduplicates opening and discards late replies after a UID change', async () => {
  const app = loaderHarness();
  const old = app.load(), duplicate = app.load();
  assert.equal(app.requests.length, 1);
  app.auth.currentUser = { uid: 'u2' }; app.state.user = { FuncionarioID: 'e2', Perfil: 'Funcionário', LojaID: 's2' };
  const next = app.load();
  app.requests[0].resolve([{ ReconhecimentoID: 'old-account' }]);
  await Promise.all([old, duplicate]);
  assert.equal(app.state.recognitions.length, 0);
  app.requests[1].resolve([{ ReconhecimentoID: 'new-account' }]); await next;
  assert.equal(app.state.recognitions[0].ReconhecimentoID, 'new-account');
  assert.equal(app.publications.some(items => items.some(item => item.ReconhecimentoID === 'old-account')), false);
});
test('recognition loader invalidates the same UID when role or store changes and forced refresh wins', async () => {
  const app = loaderHarness();
  const initial = app.load();
  app.state.user.Perfil = 'Gerente'; app.state.user.LojaID = 's2';
  const changed = app.load();
  const fresh = app.load({ force: true });
  assert.equal(app.requests.length, 3);
  app.requests[2].resolve([{ ReconhecimentoID: 'fresh' }]); await fresh;
  app.requests[1].resolve([{ ReconhecimentoID: 'stale' }]); await changed;
  app.requests[0].resolve([{ ReconhecimentoID: 'old-role' }]); await initial;
  assert.equal(app.state.recognitions[0].ReconhecimentoID, 'fresh');
});
