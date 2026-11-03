import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentsHandlers} from '../src/core/api-documents.js';
import {runtime} from '../src/core/runtime.js';
const rows=[{DocumentoID:'own-pending',FuncionarioID:'e1',LojaID:'s1',Status:'Pendente',MesReferencia:'2026-11'},{DocumentoID:'own-signed',FuncionarioID:'e1',LojaID:'s1',Status:'Assinado',MesReferencia:'2026-10'},{DocumentoID:'foreign',FuncionarioID:'e2',LojaID:'s2',Status:'Pendente'}];
test('funcionário aplica filtros depois do escopo próprio sem mostrar documentos sem vínculo',async(t)=>{
 let profile={Perfil:'Funcionário',FuncionarioID:'e1',LojaID:'s1'};
 t.mock.method(runtime,'requireProfile',async()=>profile);t.mock.method(runtime,'list',async()=>rows);
 const api=createDocumentsHandlers();const result=await api.documentsList(['all','Assinado','all','2026-10']);assert.deepEqual(result.documents.map(d=>d.DocumentoID),['own-signed']);
 profile={Perfil:'Funcionário'};assert.equal((await api.documentsList([])).documents.length,0);
});
test('gestor sem unidade não recebe documentos de outras pessoas',async(t)=>{
 t.mock.method(runtime,'requireProfile',async()=>({Perfil:'Gerente',FuncionarioID:'e1'}));t.mock.method(runtime,'list',async()=>rows);
 assert.deepEqual((await createDocumentsHandlers().documentsList([])).documents.map(d=>d.DocumentoID),['own-pending','own-signed']);
});
test('emissão exige funcionário cadastrado e unidade autorizada',async(t)=>{
 t.mock.method(runtime,'requireProfile',async()=>({Perfil:'Gerente',LojaID:'s1'}));t.mock.method(runtime,'list',async(table)=>table==='Funcionarios'?[{FuncionarioID:'e2',LojaID:'s2'}]:[]);t.mock.method(runtime,'create',()=>{throw Error('must not write');});
 const api=createDocumentsHandlers();await assert.rejects(api.documentsSave([{Titulo:'Teste',FuncionarioID:'unknown'}]),/não encontrado/);await assert.rejects(api.documentsSave([{Titulo:'Teste',FuncionarioID:'e2'}]),/sua unidade/);
});
