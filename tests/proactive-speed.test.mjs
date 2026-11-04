import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from '../src/core/runtime.js';
import { createHouseAIHandlers } from '../src/core/api-house-ai.js';
const handlers=createHouseAIHandlers();

test('insights fail closed before any reads when session validation fails', async t => {
 t.mock.method(runtime,'requireProfile',async()=>{throw Error('Sessão revogada');});
 let reads=0;
 t.mock.method(runtime,'list',async()=>{reads++;return [];});
 t.mock.method(runtime,'listPeriods',async()=>{reads++;return [];});
 await assert.rejects(handlers.generateProactiveInsights([{}]), /Sessão revogada/);
 assert.equal(reads,0);
});

test('insights read five scoped datasets, correct point table and boundary months in Bahia', async t => {
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-12-01T01:30:00Z')});
 const profile={Perfil:'Administrador'};
 t.mock.method(runtime,'requireProfile',async()=>profile);
 const reads=[];
 t.mock.method(runtime,'list',async(table,options)=>{reads.push(table);assert.equal(options.profile,profile);return [];});
 t.mock.method(runtime,'listPeriods',async(table,periods,options)=>{reads.push(table);assert.equal(table,'RegistrosPonto');assert.deepEqual(periods,['2026-11']);assert.equal(options.profile,profile);return [];});
 const result=await handlers.generateProactiveInsights([{}]);
 assert.equal(reads.length,5);
 assert.deepEqual(reads.sort(),['Documentos','Folgas','Funcionarios','RegistrosPonto','Tarefas']);
 assert.equal(result.data.totalInsights,0);
});

test('first Bahia calendar day reads prior month for unfinished overnight record', async t => {
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-12-01T12:30:00Z')});
 t.mock.method(runtime,'requireProfile',async()=>({Perfil:'Administrador'}));
 t.mock.method(runtime,'list',async()=>[]);
 t.mock.method(runtime,'listPeriods',async(_table,periods)=>{assert.deepEqual(periods,['2026-12','2026-11']);return [];});
 await handlers.generateProactiveInsights([{}]);
});

test('manager cannot request another unit and cannot count foreign data in notices', async t => {
 const profile={Perfil:'Gerente',LojaID:'s1'};
 t.mock.method(runtime,'requireProfile',async()=>profile);
 let calls=0;
 t.mock.method(runtime,'list',async(table,options)=>{
  calls++;assert.equal(options.profile,profile);
  if(table==='Documentos')return [{LojaID:'s1',Status:'Pendente'},{LojaID:'s2',Status:'Pendente'}];
  if(table==='Folgas')return [{LojaID:'s2',Status:'Pendente'}];
  return [];
 });
 t.mock.method(runtime,'listPeriods',async()=>[]);
 await assert.rejects(handlers.generateProactiveInsights([{lojaId:'s2'}]), /própria unidade/);
 assert.equal(calls,0);
 const result=await handlers.generateProactiveInsights([{}]);
 assert.equal(result.data.totalInsights,1);
 assert.match(result.data.insights[0].titulo,/^1 documento/);
});

test('employee insights remain restricted to own identity even when public task table returns colleagues', async t => {
 t.mock.method(runtime,'requireProfile',async()=>({Perfil:'Funcionário',LojaID:'s1',FuncionarioID:'own'}));
 t.mock.method(runtime,'list',async table=>table==='Tarefas'?[{LojaID:'s1',FuncionarioID:'own',Prazo:'2000-01-01'},{LojaID:'s1',FuncionarioID:'other',Prazo:'2000-01-01'}]:[]);
 t.mock.method(runtime,'listPeriods',async()=>[]);
 const result=await handlers.generateProactiveInsights([{}]);
 assert.match(result.data.insights[0].titulo,/^1 tarefa/);
});
