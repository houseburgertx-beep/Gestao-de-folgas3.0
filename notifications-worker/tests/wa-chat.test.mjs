import test from 'node:test';
import assert from 'node:assert/strict';
import {runGroqConversation,createEmployeeTools} from '../src/wa-chat.js';
import {processInboundHouseAI} from '../src/house-ai.js';
const now=Date.parse('2026-11-02T15:00:00Z');
const employee={FuncionarioID:'e1',LojaID:'s1',Nome:'Ana Silva',Perfil:'Funcionário',Cargo:'Atendente',Ativo:true,CPF:'sensitive-cpf'};
const colleague={FuncionarioID:'e2',LojaID:'s1',Nome:'Beatriz',Ativo:true};
const env={GROQ_API_KEY:'test-only-key',APP_URL:'https://example.test/'};
function memory(initial){let value=initial;return {load:async()=>value,save:async next=>{value=next;},get value(){return value;}};}
const completion=message=>({ok:true,json:async()=>({choices:[{message}]})});
function provider(...messages){const calls=[];return {calls,fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});const next=messages.shift();return completion(typeof next==='function'?next(calls.at(-1)):next);}};}
const call=(name,args={},id='tool1')=>({role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const base={env,employee,employees:[employee,colleague],profile:employee,database:async()=>({}),tok:'mock',now,executeLegacy:async()=>{throw Error('unexpected write');}};

test('conversa social usa modelo e envia histórico de turnos completos',async()=>{
 const mem=memory();const model=provider({role:'assistant',content:'Sinto muito pelo imprevisto. Quer ajuda com o horário?'},req=>{assert.ok(req.body.messages.some(m=>m.content?.includes('meu ônibus atrasou')));return {role:'assistant',content:'Você comentou que o ônibus atrasou. Podemos conferir seu horário.'};});
 await runGroqConversation({...base,text:'meu ônibus atrasou',memory:mem,fetcher:model.fetch});
 const result=await runGroqConversation({...base,text:'e o que eu faço nesse caso?',memory:mem,fetcher:model.fetch});
 assert.equal(result.action,'groq_conversation');assert.match(result.replyText,/ônibus/);assert.equal(mem.value.messages.length,4);
 assert.equal(model.calls[0].url,'https://api.groq.com/openai/v1/chat/completions');
 assert.ok(model.calls[0].body.tools.some(t=>t.function.name==='consultar_sistema'));
});
test('modelo consulta ferramenta real, recebe dados e responde sem ler colegas',async()=>{
 const mem=memory();let read=0;
 const model=provider(call('consultar_sistema',{assunto:'minhas_tarefas',funcionario_id:'e2'}),request=>{
  const result=JSON.parse(request.body.messages.find(m=>m.role==='tool').content);
  assert.equal(result.total,1);assert.equal(result.registros[0].titulo,'Bancada');assert.doesNotMatch(JSON.stringify(result),/Segredo/);
  return {role:'assistant',content:'Sua tarefa é organizar a bancada.'};
 });
 const result=await runGroqConversation({...base,text:'o que falta fazer?',memory:mem,fetcher:model.fetch,database:async(_e,_t,path)=>{read++;assert.equal(path,'tables/Tarefas');return {a:{FuncionarioID:'e1',LojaID:'s1',Titulo:'Bancada',Status:'A fazer'},b:{FuncionarioID:'e2',Titulo:'Segredo'}};}});
 assert.equal(read,1);assert.match(result.replyText,/bancada/);
});
test('troca de identidade ou unidade não reaproveita histórico nem proposta',async()=>{
 const foreign={employeeId:'e2',storeId:'s1',at:now,messages:[{role:'user',content:'PRIVATE_OTHER_ACCOUNT'}],pending:{legacyText:'danger',createdAt:now}};
 const model=provider(request=>{assert.doesNotMatch(JSON.stringify(request.body),/PRIVATE_OTHER_ACCOUNT|danger/);return {role:'assistant',content:'Olá, Ana.'};});
 await runGroqConversation({...base,text:'sim',memory:memory(foreign),fetcher:model.fetch});
});
test('preparar folga exige confirmação posterior e consome proposta uma única vez',async()=>{
 const mem=memory();let writes=0;
 const model=provider(call('preparar_folga',{datas:['2026-11-05'],motivo:'Compromisso pessoal'}),{role:'assistant',content:'Pedido para 05/11, compromisso pessoal. Ainda não foi enviado. Posso confirmar?'},{role:'assistant',content:'Como posso ajudar agora?'});
 const options={...base,memory:mem,fetcher:model.fetch,executeLegacy:async text=>{writes++;assert.match(text,/05\/11\/2026/);return {handled:true,authorized:true,action:'folga_solicitada_whatsapp',replyText:'Pedido enviado para avaliação.'};}};
 const prepared=await runGroqConversation({...options,text:'preciso de folga quinta por compromisso pessoal'});
 assert.equal(writes,0);assert.match(prepared.replyText,/Ainda não/);assert.ok(mem.value.pending);
 const confirmed=await runGroqConversation({...options,text:'sim'});assert.equal(confirmed.action,'folga_solicitada_whatsapp');assert.equal(writes,1);assert.equal(mem.value.pending,null);
 await runGroqConversation({...options,text:'sim'});assert.equal(writes,1);
});
test('funcionário não prepara alterações de colega e ferramenta não revela CPF',async()=>{
 let pending=false;const execute=createEmployeeTools({...base,setPending:()=>{pending=true;}});
 assert.ok((await execute('preparar_folga',{datas:['2026-11-05'],motivo:'teste',funcionario_id:'e2'})).erro);
 assert.ok((await execute('minha_equipe')).erro);assert.equal(pending,false);
 assert.doesNotMatch(JSON.stringify(await execute('meu_cadastro')),/sensitive-cpf|CPF/);
 assert.ok((await execute('sql',{sql:'DELETE'})).erro);
});
test('erro de provedor é explícito, não vira menu nem confirmação falsa',async()=>{
 const result=await runGroqConversation({...base,text:'oi',memory:memory(),fetcher:async()=>({ok:false,status:429})});
 assert.equal(result.action,'groq_unavailable');assert.match(result.replyText,/nenhuma alteração/i);assert.doesNotMatch(result.replyText,/Envie uma das opções|Sou a House AI/);
});
test('conteúdo médico e registro de ponto não são enviados ao modelo',async(t)=>{
 let called=0;t.mock.method(globalThis,'fetch',async()=>{called++;throw Error('Unexpected external request');});const db=async(_e,_t,path)=>{if(path==='tables/Funcionarios')return {e1:{...employee,Telefone:'5573991740014'}};return {};};
 for(const text of ['Meu CID é X123','bater ponto agora']) {
  const result=await processInboundHouseAI({from:'5573991740014',text,env:{...env,AI:{run:()=>{called++;}}},database:db,now,tok:'mock'});
  assert.match(result.action,/bloqueio/);
 }
 assert.equal(called,0);
});
test('cadastro sem vínculo e documentos sem destinatário não expõem registros',async()=>{
 let reads=0;
 const invalid=createEmployeeTools({...base,employee:{Nome:'Sem vínculo'},database:async()=>{reads++;return {a:{Titulo:'Privado'}};},setPending:()=>{}});
 assert.ok((await invalid('meus_documentos')).erro);assert.equal(reads,0);
 const linked=createEmployeeTools({...base,database:async()=>({a:{id:'e1',Titulo:'Documento sem destinatário'},b:{FuncionarioID:'e1',Titulo:'Meu documento'}}),setPending:()=>{}});
 const result=await linked('meus_documentos');assert.equal(result.registros.length,1);assert.equal(result.registros[0].titulo,'Meu documento');
});
test('reiniciar contexto limpa histórico e proposta sem chamar modelo ou alterar registros',async()=>{
 const mem=memory({employeeId:'e1',storeId:'s1',at:now,messages:[{role:'user',content:'antiga'}],pending:{createdAt:now,legacyText:'não executar'}});
 const result=await runGroqConversation({...base,text:'limpar conversa',memory:mem,fetcher:async()=>{throw Error('unexpected provider');}});
 assert.equal(result.action,'chat_reset');assert.deepEqual(mem.value.messages,[]);assert.equal(mem.value.pending,null);
});
test('orientação de tolerância inventada é revisada antes de persistir ou enviar',async()=>{
 const mem=memory();const model=provider({role:'assistant',content:'Há tolerância de 10 minutos e podemos abrir um registro de atraso.'},request=>{assert.match(request.body.messages.at(-1).content,/Revise a resposta/);return {role:'assistant',content:'Entendo o imprevisto. Posso ajudar a escrever um aviso para sua gerência.'};});
 const result=await runGroqConversation({...base,text:'meu ônibus atrasou',memory:mem,fetcher:model.fetch});
 assert.equal(result.action,'groq_conversation');assert.doesNotMatch(result.replyText,/tolerância|10 minutos|abrir um registro/);assert.equal(mem.value.messages.length,2);
});
