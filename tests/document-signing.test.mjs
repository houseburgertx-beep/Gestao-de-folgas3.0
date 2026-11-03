import test from 'node:test';
import assert from 'node:assert/strict';
import {commitSignature,documentServerRequest,readSigningDocument} from '../src/core/document-signing.js';
const setup=()=>({auth:{currentUser:{uid:'u1',getIdToken:async()=>'test-token'}},root:'gestao-folgas/v2',config:{databaseURL:'https://db.example.test'},resolveStorageKey:async()=> 'legacy-doc-key',invalidateTableCache:()=>{}});
test('assinatura e status do documento são gravados em um único PATCH com confirmação 204',async(t)=>{
 const app=setup();const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return new Response(null,{status:204});});
 const result=await commitSignature(app,{DocumentoID:'doc-1',Status:'Pendente'},{AssinaturaID:'ASS_doc1',DocumentoID:'doc-1'},{Status:'Assinado',AssinaturaID:'ASS_doc1'},'u1');
 assert.equal(result.Status,'Assinado');assert.equal(calls.length,1);
 const {url,options}=calls[0];assert.equal(new URL(url).pathname,'/gestao-folgas/v2.json');assert.equal(new URL(url).searchParams.get('print'),'silent');assert.equal(options.method,'PATCH');assert.equal(options.cache,'no-store');
 assert.deepEqual(JSON.parse(options.body),{'tables/DocumentosAssinaturas/ASS_doc1':{AssinaturaID:'ASS_doc1',DocumentoID:'doc-1'},'tables/Documentos/legacy-doc-key/Status':'Assinado','tables/Documentos/legacy-doc-key/AssinaturaID':'ASS_doc1'});
});
test('assinatura negada não invalida cache nem sinaliza sucesso',async(t)=>{
 const app=setup();let invalidated=false;app.invalidateTableCache=()=>{invalidated=true;};t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:403}));
 await assert.rejects(commitSignature(app,{DocumentoID:'doc-1'},{AssinaturaID:'ASS_doc1'},{Status:'Assinado'},'u1'),/recusou/);assert.equal(invalidated,false);
});
test('troca de conta durante renovação impede PATCH e prazo inclui token pendurado',async(t)=>{
 const app=setup();let resolveToken;let calls=0;app.auth.currentUser.getIdToken=()=>new Promise(resolve=>{resolveToken=resolve;});t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:204});});
 const promise=documentServerRequest(app,'',{method:'PATCH',body:{},timeoutMs:10});
 await assert.rejects(promise,/demorou/);resolveToken('late-token');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,0);
 app.auth.currentUser={uid:'u2',getIdToken:async()=>'other-token'};await assert.rejects(documentServerRequest(app,'',{ownerUid:'u1'}),/sessão mudou/);assert.equal(calls,0);
});
test('leitura da assinatura respeita chave legada e usa servidor sem cache',async(t)=>{
 const app=setup();t.mock.method(globalThis,'fetch',async(url,options)=>{assert.match(url,/legacy-doc-key/);assert.equal(options.cache,'no-store');return new Response('{"Status":"Assinado"}');});
 assert.equal((await readSigningDocument(app,'doc-1','u1')).Status,'Assinado');
});
