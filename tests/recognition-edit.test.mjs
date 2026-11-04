import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime } from '../src/core/runtime.js';
import { createAdvancedHandlers } from '../src/core/api-advanced.js';

const original = {
  ReconhecimentoID: 'recognition-1', FuncionarioID: 'employee-1', NomeFuncionario: 'Colaborador',
  LojaID: 'store-1', NomeLoja: 'Unidade', Categoria: 'Qualidade', Motivo: 'Ótimo trabalho',
  Semana: 'Semana 4 nov', SemanaInicio: '2026-11-02', SemanaFim: '2026-11-08',
  CriadoEm: '2026-11-04T12:00:00Z', AtribuidoPor: 'Liderança original', Ativo: true,
};
function setup(t, profile, row = original) {
  const writes = [];
  t.mock.method(runtime, 'requireProfile', async () => profile);
  t.mock.method(runtime, 'getById', async () => row && {...row});
  t.mock.method(runtime, 'upsert', async (table, value) => { writes.push({table,value}); return value; });
  return {writes, edit: createAdvancedHandlers().editarReconhecimento};
}
test('administrator edits only the recognition text and category, preserving identity and original period', async t => {
  const {writes, edit} = setup(t, {Perfil:'Administrador', Email:'admin@example.test'});
  const result = await edit(['recognition-1', {
    Categoria:' Atendimento ', Motivo:' Qualidade e agilidade ', Semana:' Semana especial ',
    ReconhecimentoID:'forged', FuncionarioID:'colleague', LojaID:'other-store', Ativo:false,
    SemanaInicio:'2000-01-01', SemanaFim:'2099-01-01', CriadoEm:'2099-01-01',
    AtribuidoPor:'Outra pessoa', NomeFuncionario:'Nome trocado',
  }]);
  assert.equal(result.success,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0].table,'Reconhecimentos');
  const saved = writes[0].value;
  assert.equal(saved.Categoria,'Atendimento');
  assert.equal(saved.Motivo,'Qualidade e agilidade');
  assert.equal(saved.Semana,'Semana especial');
  for(const key of ['ReconhecimentoID','FuncionarioID','LojaID','Ativo','SemanaInicio','SemanaFim','CriadoEm','AtribuidoPor','NomeFuncionario'])assert.equal(saved[key],original[key],key);
  assert.equal(saved.AtualizadoPor,'admin@example.test');
  assert.ok(Number.isFinite(Date.parse(saved.AtualizadoEm)));
});
test('manager edits own-store recognition and omitted fields retain their existing values', async t => {
  const {writes, edit} = setup(t, {Perfil:'Gerente', LojaID:'store-1', Nome:'Gestor'});
  const result = await edit(['recognition-1',{Motivo:'Elogio atualizado'}]);
  assert.equal(result.data.Categoria,original.Categoria);
  assert.equal(result.data.Semana,original.Semana);
  assert.equal(result.data.AtualizadoPor,'Gestor');
  assert.equal(writes.length,1);
});
test('foreign store, missing store link and employee access cannot edit or create notifications', async t => {
  for(const profile of [{Perfil:'Gerente',LojaID:'store-2'},{Perfil:'Gerente'},{Perfil:'Funcionário',LojaID:'store-1',FuncionarioID:'employee-1'}]) {
    await t.test(profile.Perfil+' '+(profile.LojaID||'unlinked'),async t=>{
      const {writes,edit}=setup(t,profile);
      await assert.rejects(edit(['recognition-1',{Motivo:'Tentativa'}]));
      assert.equal(writes.length,0);
    });
  }
});
test('inactive or mismatched recognition IDs are rejected before writing', async t => {
  for(const row of [{...original,Ativo:false},{...original,ReconhecimentoID:'other'},null]) {
    await t.test(row?.ReconhecimentoID+' '+row?.Ativo,async t=>{
      const {writes,edit}=setup(t,{Perfil:'Administrador'},row);
      await assert.rejects(edit(['recognition-1',{Motivo:'Tentativa'}]));
      assert.equal(writes.length,0);
    });
  }
});
test('empty category or reason does not erase an existing recognition',async t=>{
  const {writes,edit}=setup(t,{Perfil:'Administrador'});
  await assert.rejects(edit(['recognition-1',{Motivo:'  '}]),/elogio/);
  await assert.rejects(edit(['recognition-1',{Categoria:'  '}]),/categoria/);
  assert.equal(writes.length,0);
});
