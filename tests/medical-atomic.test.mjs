import test from 'node:test';
import assert from 'node:assert/strict';
import {createBaseHandlers,confirmMedicalCommit} from '../src/core/api-base.js';
import {runtime} from '../src/core/runtime.js';
const employee={FuncionarioID:'e1',LojaID:'s1',Ativo:true,Nome:'Teste',CPF:'private-cpf',Email:'test@example.test'};
const payload=()=>({requestId:'12345678-abcd-1234-abcd-123456789012',dataInicio:'2026-11-03',dataFim:'2026-11-04',documentoBase64:'data:application/pdf;base64,'+Buffer.from('%PDF-test').toString('base64'),crm:'private-crm',motivo:'private-observation'});
function setup(t){
 const records=new Map();let commits=0;
 t.mock.method(runtime,'requireProfile',async()=>({...employee,Perfil:'Funcionário'}));t.mock.method(runtime,'getById',async(table,id)=>table==='Funcionarios'?employee:records.get(`${table}/${id}`)||null);
 t.mock.method(runtime,'getByIdFromServer',async(table,id)=>records.get(`${table}/${id}`)||null);
 t.mock.method(runtime,'patchMany',async(items)=>{commits++;const staged=items.map(i=>({...i.record,[i.table==='Documentos'?'DocumentoID':'FolgaID']:i.id}));staged.forEach((record,index)=>records.set(`${items[index].table}/${items[index].id}`,record));return staged;});
 t.mock.method(runtime,'create',async()=>{throw Error('audit unavailable');});t.mock.method(runtime,'upsert',async()=>{throw Error('notification unavailable');});
 return {api:createBaseHandlers(),records,get commits(){return commits;}};
}
test('atestado preserva arquivo acima do corte antigo e retry não reescreve aprovado',async(t)=>{
 const s=setup(t);const p=payload();p.documentoBase64='data:application/pdf;base64,'+'A'.repeat(2200000);
 const first=await s.api.submitMedicalCertificate([p]);assert.equal(first.data.documento.ArquivoOriginalBase64,p.documentoBase64);assert.equal(s.commits,1);
 first.data.folga.Status='Aprovada';
 const second=await s.api.submitMedicalCertificate([p]);assert.equal(second.data.folga.Status,'Aprovada');assert.equal(s.commits,1);
 await assert.rejects(s.api.submitMedicalCertificate([{...p,dataFim:'2026-11-05'}]),/outros dados/);assert.equal(s.commits,1);
});
test('falha na gravação atômica não deixa documento ou solicitação parcial',async(t)=>{
 const s=setup(t);t.mock.method(runtime,'patchMany',async()=>{throw Error('database offline');});
 await assert.rejects(s.api.submitMedicalCertificate([payload()]),/offline/);assert.equal(s.records.size,0);
});
test('datas inexistentes e anexos acima do limite são rejeitados antes de salvar',async(t)=>{
 const s=setup(t);await assert.rejects(s.api.submitMedicalCertificate([{...payload(),dataInicio:'2026-02-30'}]),/data inicial/);
 await assert.rejects(s.api.submitMedicalCertificate([{...payload(),documentoBase64:'data:application/pdf;base64,'+'A'.repeat(8*1024*1024+4)}]),/ultrapassa/);assert.equal(s.commits,0);
});
test('auditoria não replica arquivo, CPF, CRM ou observação clínica',async(t)=>{
 const s=setup(t);let audit;
 t.mock.method(runtime,'create',async(table,row)=>{if(table==='Auditoria')audit=row;return row;});
 await s.api.submitMedicalCertificate([payload()]);await new Promise(resolve=>setTimeout(resolve,0));
 assert.ok(audit);assert.doesNotMatch(JSON.stringify(audit),/private-cpf|private-crm|private-observation|base64/);
});

test('envio médico com confirmação pendurada informa incerteza dentro do prazo',async()=>{
 let resolve;const operation=new Promise(done=>{resolve=done;});
 await assert.rejects(confirmMedicalCommit(()=>operation,5),/não foi confirmado/);
 resolve({Status:'Pendente'});await new Promise(done=>setTimeout(done,0));
});
