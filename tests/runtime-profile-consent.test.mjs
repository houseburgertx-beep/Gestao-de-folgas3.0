import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { asBoolean, clone, normalizeEmail } from '../src/core/utils.js';
const source = await readFile(new URL('../src/core/runtime.js', import.meta.url), 'utf8');
const start = source.indexOf('  async loadOwnProfile(');
const method = source.slice(start, source.indexOf('\n  async requireProfile(', start));
async function load(profile, employee) {
  let reads = 0;
  const user = { uid: 'own-account', email: 'own@example.test' };
  const receiver = { auth: { currentUser: user }, profile: null, appRef: path => path };
  const ctx = {
    asBoolean, clone, normalizeEmail, pathKey: String, isPermissionDenied: () => false, console,
    get: async target => {
      reads++;
      const data = String(target).startsWith('access/') ? profile : employee;
      return { val: () => data };
    }, query: ref => ref, orderByChild: String, equalTo: String,
    snapshotList: snap => snap.val() ? [snap.val()] : [], update: async () => {}, set: async () => {},
  };
  vm.createContext(ctx); vm.runInContext(`this.load=({${method}}).loadOwnProfile;`, ctx);
  return { result: await ctx.load.call(receiver), reads };
}
const ownProfile = { FuncionarioID: 'own-employee', LojaID: 'own-store', Perfil: 'Funcionário', Ativo: true };
test('profile readiness carries existing employee privacy consent without an additional database read', async () => {
  const employee = { FuncionarioID: 'own-employee', Ativo: true, PoliticaPrivacidadeCiente: true,
    PoliticaPrivacidadeData: '2026-10-01T10:00:00Z', PoliticaPrivacidadeVersao: '1.0', PoliticaPrivacidadeAssinatura: 'stored-signature' };
  const { result, reads } = await load(ownProfile, employee);
  assert.equal(reads, 2); // own access + existing employee lookup only
  for (const field of ['PoliticaPrivacidadeCiente', 'PoliticaPrivacidadeData', 'PoliticaPrivacidadeVersao', 'PoliticaPrivacidadeAssinatura']) assert.equal(result[field], employee[field]);
});
test('profile consent metadata takes precedence, while true employee consent survives a false profile flag', async () => {
  const { result } = await load({ ...ownProfile, PoliticaPrivacidadeCiente: 'false', PoliticaPrivacidadeVersao: '2.0', PoliticaPrivacidadeData: 'profile-date', PoliticaPrivacidadeAssinatura: 'profile-signature' },
    { Ativo: true, PoliticaPrivacidadeCiente: true, PoliticaPrivacidadeVersao: '1.0', PoliticaPrivacidadeData: 'employee-date', PoliticaPrivacidadeAssinatura: 'employee-signature' });
  assert.equal(result.PoliticaPrivacidadeCiente, true);
  assert.equal(result.PoliticaPrivacidadeVersao, '2.0');
  assert.equal(result.PoliticaPrivacidadeData, 'profile-date');
  assert.equal(result.PoliticaPrivacidadeAssinatura, 'profile-signature');
});
test('profile enrichment does not invent consent when neither record contains it', async () => {
  const { result } = await load(ownProfile, { Ativo: true });
  assert.equal(result.PoliticaPrivacidadeCiente, false);
  assert.equal(result.PoliticaPrivacidadeAssinatura, '');
});
