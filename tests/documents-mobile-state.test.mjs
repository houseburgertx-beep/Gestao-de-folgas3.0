import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/documents.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function listHarness() {
  const requests = [], rendered = [];
  const container = { innerHTML: '' };
  const state = { user: { FuncionarioID: 'e1' }, documents: [], activeTab: 'minhas', isManager: false, isAdmin: false, storeFilter: 'store-filter', statusFilter: 'Pendente', monthFilter: '2026-11' };
  const auth = { currentUser: { uid: 'u1' } };
  const context = {
    state, window: { __GESTAO_FIREBASE__: { runtime: { auth } } },
    $: key => key === '#documentsAppRoot' ? container : null,
    userFuncId: user => String(user?.FuncionarioID || ''),
    callApi: (...args) => { const pending = deferred(); requests.push({ args, ...pending }); return pending.promise; },
    renderLoadingState: () => { container.innerHTML = 'loading'; },
    renderDocumentsView: () => { rendered.push(state.documents); },
    esc: String, console: { error() {} },
  };
  const start = source.indexOf('let documentListRequest = null;');
  const block = source.slice(start, source.indexOf('\n/**\n * Renderiza o estado de carregamento', start)).replace('export async function', 'async function');
  vm.runInNewContext(`${block}\nthis.load = loadDocuments;`, context);
  return { state, auth, requests, rendered, container, load: options => context.load(options) };
}

test('concurrent document opens share one request and local filters do not truncate the fetched dataset', async () => {
  const app = listHarness();
  const first = app.load(), second = app.load();
  assert.equal(app.requests.length, 1);
  assert.deepEqual(app.requests[0].args, ['documentsList', '', '', 'e1', '']);
  app.requests[0].resolve({ documents: [{ DocumentoID: 'pending', Status: 'Pendente' }, { DocumentoID: 'signed', Status: 'Assinado' }] });
  await Promise.all([first, second]);
  assert.equal(app.state.documents.length, 2);
  assert.equal(app.rendered.length, 1);
});

test('forced refresh after mutation supersedes an older request from the same account', async () => {
  const app = listHarness();
  const previous = app.load();
  const refreshed = app.load({ force: true });
  assert.equal(app.requests.length, 2);
  app.requests[1].resolve({ documents: [{ DocumentoID: 'document', Status: 'Assinado' }] });
  await refreshed;
  app.requests[0].resolve({ documents: [{ DocumentoID: 'document', Status: 'Pendente' }] });
  await previous;
  assert.equal(app.state.documents[0].Status, 'Assinado');
  assert.equal(app.rendered.length, 1);
});

test('new account response wins and old response cannot overwrite or render private documents', async () => {
  const app = listHarness();
  const old = app.load();
  app.auth.currentUser = { uid: 'u2' };
  app.state.user = { FuncionarioID: 'e2' };
  const recent = app.load();
  app.requests[1].resolve({ documents: [{ DocumentoID: 'u2-document' }] });
  await recent;
  app.requests[0].resolve({ documents: [{ DocumentoID: 'u1-private-document' }] });
  await old;
  assert.equal(app.state.documents[0].DocumentoID, 'u2-document');
  assert.equal(app.rendered.length, 1);
});

test('late error from another account cannot replace the new loading screen or stop its loading state', async () => {
  const app = listHarness();
  const old = app.load();
  app.auth.currentUser = { uid: 'u2' }; app.state.user = { FuncionarioID: 'e2' };
  const recent = app.load();
  app.requests[0].reject(new Error('old account error'));
  await old;
  assert.equal(app.container.innerHTML, 'loading');
  assert.equal(app.state.loading, true);
  app.requests[1].resolve({ documents: [] }); await recent;
  assert.equal(app.state.loading, false);
});

test('manager fetches authorized metadata once so switching to management is not stuck on own documents', async () => {
  const app = listHarness(); app.state.isManager = true;
  const loading = app.load();
  assert.deepEqual(app.requests[0].args, ['documentsList', '', '', '', '']);
  app.requests[0].resolve({ documents: [] }); await loading;
});

test('medical attachment preparation does not send health data to the task photo uploader', async () => {
  const start = source.indexOf('async function prepareMedicalCertificateAttachment(');
  const block = source.slice(start, source.indexOf('\n/**\n * Inicializador público', start));
  const completeBase64 = `data:application/pdf;base64,${'A'.repeat(2_200_000)}`;
  const context = { compressMedicalDocument: async () => ({ base64: completeBase64, mimeType: 'application/pdf' }), Date, fetch: () => { throw Error('must not upload to task endpoint'); } };
  vm.runInNewContext(`${block}\nthis.prepare = prepareMedicalCertificateAttachment;`, context);
  const file = await context.prepare({ type: 'application/pdf' }, 'Pessoa de teste');
  assert.equal(file.url, '');
  assert.equal(file.base64, completeBase64);
  assert.ok(file.base64.length > 2_000_000);
  assert.match(file.fileName, /\.pdf$/);
  assert.doesNotMatch(source, /SELFIE_DRIVE_UPLOAD_ENDPOINT|uploadMedicalCertificateToDrive/);
});

function eventNode(extra = {}) {
  const listeners = new Map();
  return { ...extra, listeners,
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type) { for (const callback of [...(listeners.get(type) || [])]) callback(); },
  };
}
function signHarness() {
  const rendering = deferred(), revoked = [], alerts = [];
  const state = { hasScrolledToBottom: false, signatureHasDrawn: false };
  const viewer = eventNode({ scrollHeight: 100, clientHeight: 100, scrollTop: 0 });
  const confirm = eventNode({ disabled: true }), check = eventNode({ checked: false });
  const canvas = eventNode({ getContext: () => ({ scale() {} }), getBoundingClientRect: () => ({ width: 200, height: 100 }) });
  const dialog = eventNode({ close() { this.dispatch('close'); }, removeAttribute() {} });
  const win = eventNode({ devicePixelRatio: 1 });
  const nodes = { '#docViewerBox': viewer, '#docSignCanvas': canvas, '#docSignConfirmBtn': confirm, '#docAffirmationCheck': check };
  const context = { state, documentListOwner: () => 'fixture-owner', window: win, $: key => nodes[key], URL: { revokeObjectURL: value => revoked.push(value) }, renderPdfToContainer: () => rendering.promise, alert: value => alerts.push(value), console };
  const start = source.indexOf('function setupSignModalEvents(');
  const block = source.slice(start, source.indexOf('\n/**\n * Abre o Modal de Assinatura em Modo Paisagem', start));
  vm.runInNewContext(`${block}\nthis.setup = setupSignModalEvents;`, context);
  context.setup(dialog, { DocumentoID: 'fixture', ArquivoOriginalBase64: 'fixture-pdf' }, 'blob:fixture');
  return { context, state, viewer, confirm, check, dialog, win, rendering, revoked, alerts };
}

test('signature stays locked while PDF spinner fits the viewport and unlocks only after document rendering', async () => {
  const app = signHarness();
  app.viewer.dispatch('scroll');
  assert.equal(app.state.hasScrolledToBottom, false);
  app.rendering.resolve(true); await Promise.resolve();
  assert.equal(app.state.hasScrolledToBottom, true);
});

test('closing signature removes global drawing listener and late PDF completion cannot unlock the next document', async () => {
  const app = signHarness();
  assert.equal(app.win.listeners.get('mouseup').size, 1);
  app.dialog.dispatch('close');
  assert.equal(app.win.listeners.get('mouseup').size, 0);
  assert.deepEqual(app.revoked, ['blob:fixture']);
  app.rendering.resolve(true); await Promise.resolve();
  assert.equal(app.state.hasScrolledToBottom, false);
});

test('forcing submit before document reading cannot start signature API call', () => {
  const app = signHarness();
  app.state.signatureHasDrawn = true; app.check.checked = true;
  app.confirm.dispatch('click');
  assert.equal(app.alerts.length, 1);
  assert.match(app.alerts[0], /Leia o documento/);
});

test('medical retries keep the same request ID, while reopening the form creates a new submission', async () => {
  const nodes = new Map(), sent = [];
  let sequence = 0, fail = true;
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: selector === '#medSingleDate' ? '2026-11-03' : '', style: {}, disabled: false,
      addEventListener(type, callback) { this[type] = callback; },
      showModal() {}, setAttribute() {}, close() {},
    });
    return nodes.get(selector);
  }
  const context = {
    $: selector => node(selector), esc: String,
    state: { user: { Nome: 'Pessoa de teste' } },
    documentListOwner: () => 'test-owner', uuid: () => `fixture-request-${++sequence}`,
    prepareMedicalCertificateAttachment: async () => ({ base64: 'data:application/pdf;base64,fixture', url: '' }),
    callApi: async (name, payload) => {
      assert.equal(name, 'submitMedicalCertificate'); sent.push(payload);
      if (fail) { fail = false; throw new Error('Temporary network failure'); }
      return { success: true };
    },
    FileReader: class { readAsDataURL() { this.onload({ target: { result: 'data:application/pdf;base64,fixture' } }); } },
    window: {}, document: {}, console: { error() {} }, setTimeout() {}, Date, Intl,
  };
  const start = source.indexOf('export function openMedicalCertificateDialog(');
  const block = source.slice(start, source.indexOf('\n/**\n * Abre o Modal de Emissão', start)).replace('export function', 'function');
  vm.runInNewContext(`${block}\nthis.open = openMedicalCertificateDialog;`, context);
  const chooseFile = () => node('#medFileInput').change({ target: { files: [{ name: 'fixture.pdf', type: 'application/pdf' }] } });
  context.open(); chooseFile();
  await node('#medSubmitBtn').click();
  await node('#medSubmitBtn').click();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].requestId, sent[1].requestId);
  context.open(); chooseFile();
  await node('#medSubmitBtn').click();
  assert.notEqual(sent[2].requestId, sent[0].requestId);
});
