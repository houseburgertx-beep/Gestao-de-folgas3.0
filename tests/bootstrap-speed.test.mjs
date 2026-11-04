import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from '../src/core/runtime.js';
import { bootstrap, createBaseHandlers } from '../src/core/api-base.js';

const profile = { Perfil: 'Funcionário', FuncionarioID: 'own', Nome: 'Pessoa', LojaID: 'store', Ativo: true, PoliticaPrivacidadeCiente: true };

test('fast bootstrap validates profile and opens shell without any operational table reads or writes', async t => {
  let profileReads = 0;
  t.mock.method(runtime, 'requireProfile', async () => { profileReads++; return profile; });
  for (const name of ['list','getById','create','upsert','patch','applyEmployeeLeaveBalance']) {
    t.mock.method(runtime, name, async () => { throw Error(`Unexpected operational I/O: ${name}`); });
  }
  const result = await createBaseHandlers().getBootstrapDataWithSession([{fast:true}]);
  assert.equal(profileReads, 1);
  assert.equal(result.data.deferred, true);
  assert.equal(result.data.user.FuncionarioID, 'own');
  assert.equal(result.data.user.PoliticaPrivacidadeCiente, true);
  assert.deepEqual(result.data.employees, []);
  assert.deepEqual(result.data.timeOff, []);
  assert.equal(result.data.performance.mode, 'firebase-profile');
});

test('full and forced bootstrap still load operational data and finish deferred hydration', async t => {
  t.mock.method(runtime, 'requireProfile', async () => ({...profile, FuncionarioID: ''}));
  const reads=[];
  t.mock.method(runtime, 'list', async table => { reads.push(table); return table === 'Lojas' ? [{LojaID:'store'}] : []; });
  const handlers=createBaseHandlers();
  for(const payload of [{fast:false},{fast:true,forceRefresh:true}]) {
    reads.length=0;
    const result=await handlers.getBootstrapDataWithSession([payload]);
    assert.equal(result.data.deferred,false);
    assert.deepEqual([...reads].sort(), ['Feriados','Folgas','Funcionarios','Lojas']);
    assert.deepEqual(result.data.stores,[{LojaID:'store'}]);
  }
});

test('fast bootstrap does not bypass revoked session validation', async t => {
  t.mock.method(runtime, 'requireProfile', async () => { throw Error('Acesso desativado'); });
  await assert.rejects(bootstrap({fast:true}), /Acesso desativado/);
});

test('password login returns deferred shell without reading every operational collection', async t => {
  const user={getIdToken:async()=> 'test-token'};
  t.mock.method(runtime, 'login', async()=> user);
  t.mock.method(runtime, 'requireProfile', async()=> profile);
  let reads=0;
  t.mock.method(runtime, 'list', async()=> {reads++;return [];});
  const result=await createBaseHandlers().loginUser([{email:'employee@example.test',senha:'fixture'}]);
  assert.equal(reads,0);
  assert.equal(result.data.bootstrap.deferred,true);
  assert.equal(result.data.token,'test-token');
});
