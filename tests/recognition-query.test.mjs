import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {PUBLIC_AUTH_TABLES,STORE_SCOPED_FIELDS,EMPLOYEE_SCOPED_FIELDS} from '../src/core/constants.js';
const source=await readFile(new URL('../src/core/runtime.js',import.meta.url),'utf8');
const start=source.indexOf('  async fetchScopedRows_(table, profile)');
const code=source.slice(start,source.indexOf('\n  async list(table',start)).replace('async fetchScopedRows_','async function fetchScopedRows_');
function harness(){
 const requests=[];const context={PUBLIC_AUTH_TABLES,STORE_SCOPED_FIELDS,EMPLOYEE_SCOPED_FIELDS,isAdminProfile:p=>p.Perfil==='Administrador',isEmployeeProfile:p=>p.Perfil==='Funcionário',isStoreReaderProfile:p=>['Gerente','Responsável de loja'].includes(p.Perfil),get:async request=>{requests.push(request);return request;},query:(path,...conditions)=>({path,conditions}),orderByChild:field=>({field}),equalTo:value=>({value})};
 vm.runInNewContext(code+'\nthis.read=fetchScopedRows_;',context);
 const app={appRef:path=>path,recordsFromSnapshot:(_table,snapshot)=>snapshot};return {requests,read:profile=>context.read.call(app,'Reconhecimentos',profile)};
}
test('consulta de destaque do funcionário usa ID autorizado em vez de lista global negada',async()=>{
 const h=harness();await h.read({Perfil:'Funcionário',FuncionarioID:'e1',LojaID:'s1'});assert.equal(h.requests.length,1);assert.deepEqual(h.requests[0].conditions,[{field:'FuncionarioID'},{value:'e1'}]);
});
test('gestor consulta sua unidade e administrador mantém acesso de gestão à rede',async()=>{
 const h=harness();await h.read({Perfil:'Gerente',FuncionarioID:'m1',LojaID:'s1'});assert.deepEqual(h.requests[0].conditions,[{field:'LojaID'},{value:'s1'}]);await h.read({Perfil:'Administrador'});assert.equal(h.requests[1],'tables/Reconhecimentos');
});
