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
  const result = await createAdvancedHandlers().atribuirReconhecimento([{ FuncionarioID: 'canonical-e1', NomeFuncionario: 'Nome forjado', Motivo: 'Bom trabalho', Semana: 'Semana de 2000', SemanaInicio: '2000-01-01', SemanaFim: '2099-01-01' }]);
  assert.equal(result.data.FuncionarioID, 'canonical-e1');
  assert.equal(result.data.NomeFuncionario, 'Pessoa oficial');
  assert.equal(result.data.SemanaInicio, '2026-11-02');
  assert.equal(result.data.SemanaFim, '2026-11-08');
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-01-01T15:00:00Z') });
  const next = await createAdvancedHandlers().atribuirReconhecimento([{ FuncionarioID: 'canonical-e1', Motivo: 'Bom trabalho' }]);
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

test('recognition rejects a lookup record belonging to a different employee without writing', async t => {
  t.mock.method(runtime, 'requireProfile', async () => ({ Perfil: 'Gerente', LojaID: 's1' }));
  t.mock.method(runtime, 'getById', async () => ({ FuncionarioID: 'other-id', LojaID: 's1', Ativo: true }));
  const writes = t.mock.method(runtime, 'upsert', async (_table, value) => value);
  await assert.rejects(createAdvancedHandlers().atribuirReconhecimento([{ FuncionarioID: 'selected-id', Motivo: 'Bom trabalho' }]), /identificação/);
  assert.equal(writes.mock.calls.length, 0);
});
test('recognition uses dedicated notification schema and only exact recipient identity', async t => {
  t.mock.method(runtime, 'requireProfile', async () => ({ Perfil: 'Gerente', LojaID: 's1', Nome: 'Gestor' }));
  t.mock.method(runtime, 'getById', async table => table === 'Funcionarios' ? { FuncionarioID: 'e1', Nome: 'Nome repetido', LojaID: 's1', Ativo: true } : {});
  const writes = [];
  t.mock.method(runtime, 'upsert', async (table, value) => { writes.push({table, value}); return value; });
  const result = await createAdvancedHandlers().atribuirReconhecimento([{ FuncionarioID: 'e1', Motivo: 'Bom trabalho' }]);
  const notice = writes.find(row => row.table === 'Notificacoes').value;
  assert.equal(notice.DestinatarioID, 'e1');
  assert.equal(notice.Destinatario, '');
  assert.equal(notice.Tipo, 'Reconhecimento');
  assert.equal(notice.RegistoRelacionadoID, result.data.ReconhecimentoID);
  assert.equal(notice.Status, 'Pendente');
  assert.ok(notice.Assunto); assert.ok(notice.DataCriacao);
});
test('notification persistence failure reports warning while preserving saved recognition', async t => {
  t.mock.method(runtime, 'requireProfile', async () => ({ Perfil: 'Gerente', LojaID: 's1' }));
  t.mock.method(runtime, 'getById', async table => table === 'Funcionarios' ? { FuncionarioID: 'e1', LojaID: 's1', Ativo: true } : {});
  t.mock.method(runtime, 'upsert', async (table, value) => { if (table === 'Notificacoes') throw new Error('offline'); return value; });
  const result = await createAdvancedHandlers().atribuirReconhecimento([{ FuncionarioID: 'e1', Motivo: 'Bom trabalho' }]);
  assert.equal(result.success, true);
  assert.match(result.data.AvisoNotificacao, /Destaque salvo/);
});
function selectorHarness() {
  const select = { value: '', innerHTML: '', dataset: {} };
  const state = { user: { FuncionarioID: 'manager', LojaID: 's1', Perfil: 'Gerente' }, stores: [], employees: [] };
  const context = { state, $: () => select, window: {}, arr: x => Array.isArray(x) ? x : [],
    val: (o, ...keys) => { for (const key of keys) if (o?.[key] != null) return o[key]; return ''; },
    bool: v => v === true || String(v) === 'true' || String(v) === '1', esc: v => String(v),
    idOf: (o, type) => o[type + 'ID'], isStoreAdmin: () => false };
  const start = source.indexOf('  function recognitionEligibleEmployees_()');
  const end = source.indexOf('  function openNewAnnouncementDialog()', start);
  const ownerStart = source.indexOf('  function recognitionOwnerKey_()');
  const ownerEnd = source.indexOf('  async function loadRecognitions_', ownerStart);
  vm.runInNewContext(source.slice(ownerStart, ownerEnd) + source.slice(start, end) + 'this.populate = populateRecognizeEmployeeSelect_; this.eligible = recognitionEligibleEmployees_;', context);
  return {state, select, populate: context.populate, eligible: context.eligible};
}
test('recognition selector rejects missing, generic, duplicate and foreign identities; disambiguates same names', () => {
  const app = selectorHarness();
  app.state.employees = [
    { FuncionarioID: 'e1', Nome: 'Ana', LojaID: 's1', Ativo: true },
    { FuncionarioID: 'e2', Nome: 'Ana', LojaID: 's1', Ativo: true },
    { id: 'uid-only', Nome: 'UID', LojaID: 's1', Ativo: true },
    { FuncionarioID: 'dup', LojaID: 's1', Ativo: true },
    { FuncionarioID: 'dup', LojaID: 's2', Ativo: true },
    { FuncionarioID: 'foreign', LojaID: 's2', Ativo: true },
    { FuncionarioID: 'inactive', LojaID: 's1', Ativo: false },
  ];
  app.populate();
  assert.deepEqual(Array.from(app.eligible(), x => x.FuncionarioID), ['e1', 'e2']);
  assert.match(app.select.innerHTML, /Ana.*ID: e1/);
  assert.match(app.select.innerHTML, /ID: e2/);
  app.state.user.LojaID = '';
  assert.equal(app.eligible().length, 0);
});
test('recognition selector clears selection across profile changes', () => {
  const app = selectorHarness();
  app.state.employees = [{ FuncionarioID: 'e1', Nome: 'Ana', LojaID: 's1' }];
  app.populate(); app.select.value = 'e1';
  app.state.user.FuncionarioID = 'different-manager';
  app.populate();
  assert.equal(app.select.value, '');
  assert.equal(app.select.dataset.recognitionOwner.includes('different-manager'), true);
});
test('notifying an existing recognition reuses stable notice identity and exact recipient without modifying recognition', async t => {
  t.mock.method(runtime, 'requireProfile', async () => ({ Perfil: 'Gerente', LojaID: 's1' }));
  t.mock.method(runtime, 'getById', async table => table === 'Reconhecimentos'
    ? { ReconhecimentoID: 'recognition-1', FuncionarioID: 'e1', LojaID: 's1', Ativo: true, Categoria: 'Destaque', Motivo: 'Qualidade' }
    : { FuncionarioID: 'e1', LojaID: 's1', Ativo: true });
  const writes = [];
  t.mock.method(runtime, 'upsert', async (table, row) => { writes.push({table, row}); return row; });
  const handler = createAdvancedHandlers();
  const a = await handler.notificarReconhecimento(['recognition-1']);
  const b = await handler.notificarReconhecimento(['recognition-1']);
  assert.equal(a.data.NotificacaoID, b.data.NotificacaoID);
  assert.equal(a.data.WhatsAppConfirmado, false);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(w => w.table === 'Notificacoes' && w.row.DestinatarioID === 'e1' && w.row.Destinatario === '' && w.row.RegistoRelacionadoID === 'recognition-1'));
});
test('notifying recognition rejects employee, foreign store, inactive and mismatched identities before writes', async t => {
  let profile = { Perfil: 'Funcionário', LojaID: 's1', FuncionarioID: 'e1' };
  let recognition = { ReconhecimentoID: 'r1', FuncionarioID: 'e1', LojaID: 's1', Ativo: true };
  let employee = { FuncionarioID: 'e1', LojaID: 's1', Ativo: true };
  t.mock.method(runtime, 'requireProfile', async () => profile);
  t.mock.method(runtime, 'getById', async table => table === 'Reconhecimentos' ? recognition : employee);
  const writes = t.mock.method(runtime, 'upsert', async (_t, row) => row);
  const handler = createAdvancedHandlers();
  await assert.rejects(handler.notificarReconhecimento(['r1']));
  profile = { Perfil: 'Gerente', LojaID: 's2' };
  await assert.rejects(handler.notificarReconhecimento(['r1']), /própria loja/);
  profile.LojaID = 's1'; recognition.Ativo = 'false';
  await assert.rejects(handler.notificarReconhecimento(['r1']), /inativo/);
  recognition.Ativo = true; employee.FuncionarioID = 'other';
  await assert.rejects(handler.notificarReconhecimento(['r1']), /identificação/);
  employee.FuncionarioID = 'e1'; employee.LojaID = 's2';
  await assert.rejects(handler.notificarReconhecimento(['r1']), /unidade/);
  employee.LojaID = 's1'; employee.Ativo = false;
  await assert.rejects(handler.notificarReconhecimento(['r1']), /inativo/);
  assert.equal(writes.mock.calls.length, 0);
});
test('recognition notify UI coalesces double clicks and does not claim WhatsApp delivery', async () => {
  let resolve;
  const notices = [], calls = [];
  const context = { window: {}, recognitionOwnerKey_: () => 'same-owner', sessionToken: () => 'fixture',
    toast: message => notices.push(message), call: (...args) => {calls.push(args); return new Promise(r => resolve = r);} };
  const start = source.indexOf('  const RECOGNITION_NOTIFY_PENDING_');
  const end = source.indexOf('  async function deleteRecognition_', start);
  vm.runInNewContext(source.slice(start, end), context);
  const a = context.window.notifyEmployeeRecognition_('r1');
  const b = context.window.notifyEmployeeRecognition_('r1');
  assert.equal(calls.length, 1);
  resolve({NotificacaoID: 'n1'}); await Promise.all([a,b]);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Aviso salvo no aplicativo/);
  assert.match(notices[0], /ainda não foi confirmada/);
});
