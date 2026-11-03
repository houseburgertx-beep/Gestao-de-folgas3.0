import test from 'node:test';
import assert from 'node:assert/strict';
import {composeWhatsAppMessage,protectWhatsAppFacts,restoreWhatsAppComposition} from '../src/wa-message-composer.js';
import {handleAppHouseAI} from '../src/house-ai-app.js';
import {createAppActionTools,runGroqConversation} from '../src/wa-chat.js';
const employee={FuncionarioID:'e1',LojaID:'s1',Nome:'Ana',Ativo:true,Perfil:'Funcionário'};
const env={GROQ_API_KEY:'test-key'};
for(const text of ['Entrada registrada às 08:00','Saída registrada às 17:00','Intervalo iniciado às 12:00','Retorno do intervalo às 13:00','Aviso: reunião amanhã','House 190\nFolga aprovada\nSeu pedido de folga para 2026-11-06 foi aprovado!']) {
 test(`aviso passa pela Groq sem perder fatos: ${text.split('\n')[0]}`,async()=>{
  let calls=0;
  const result=await composeWhatsAppMessage(env,text,{fetcher:async(_url,options)=>{
   calls++;const data=JSON.parse(JSON.parse(options.body).messages[1].content);
   assert.doesNotMatch(JSON.stringify(data),/08:00|17:00|2026-11-06|06\/11\/2026/);
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({message:`Olá!\n${data.texto}\nSe precisar de ajuda, estou por aqui.`})}}]})};
  }});
  assert.equal(calls,1);assert.equal(result.composition.mode,'ai');assert.doesNotMatch(result.text,/HFACT|2026-11-06/);
 });
}
test('compositor rejeita omissões e fatos adicionais; preserva URLs',()=>{
 const facts=protectWhatsAppFacts('Pedido aprovado para 2026-11-06\nhttps://example.test/2026-11-06');
 for(const bad of [facts.facts[0].token,`Pedido recusado\n${facts.template}`,`${facts.template}\nTolerância de 10 minutos`,facts.template+facts.facts[0].token])assert.equal(restoreWhatsAppComposition(bad,facts),null);
 assert.match(restoreWhatsAppComposition(facts.template,facts),/https:\/\/example.test\/2026-11-06/);
});
test('indisponibilidade preserva aviso e resposta pronta evita segunda chamada',async()=>{
 const text='Saída registrada às 17:00';
 const fallback=await composeWhatsAppMessage(env,text,{fetcher:async()=>({ok:false,status:429})});assert.equal(fallback.text,text);assert.equal(fallback.composition.mode,'fallback');
 const prepared=await composeWhatsAppMessage(env,text,{aiPrepared:true,fetcher:()=>{throw Error('duplicate');}});assert.equal(prepared.composition.mode,'prepared');
});
const base={request:new Request('https://example.test/house-ai-chat'),payload:{prompt:'oi'},env,authenticate:async()=>({uid:'u1',profile:employee}),database:async()=>({e1:employee}),token:async()=>'token',memoryFactory:async()=>({}),chat:async options=>({action:'groq_conversation',replyText:options.employee.Nome})};
test('chat nativo autentica antes de consultar e rejeita contexto forjado',async()=>{
 await assert.rejects(handleAppHouseAI({...base,authenticate:async()=>{throw Error('unauthorized');},database:()=>{throw Error('must not read');}}),/unauthorized/);
 await assert.rejects(handleAppHouseAI({...base,payload:{prompt:'oi',profile:{Perfil:'Admin'}}}),error=>error.status===400);
 await assert.rejects(handleAppHouseAI({...base,authenticate:async()=>({uid:'u1',profile:{...employee,LojaID:'foreign'}})}),error=>error.status===403);
 assert.equal((await handleAppHouseAI(base)).data.provider,'groq');
});
test('preparação no app respeita unidade e nunca grava',async()=>{
 let proposal;const execute=createAppActionTools({env,employee,employees:[employee,{FuncionarioID:'e2',LojaID:'s2',Ativo:true}],profile:{Perfil:'Gerente'},now:Date.now(),database:async()=>({}),setProposal:value=>{proposal=value;}});
 assert.ok((await execute('preparar_acao_app',{acao:'criarTarefaCozinha',titulo:'Estoque',funcionario_id:'e2'})).erro);
 await execute('preparar_acao_app',{acao:'criarTarefaCozinha',titulo:'Estoque',funcionario_id:'e1'});
 assert.equal(proposal.executed,false);assert.equal(proposal.args.responsavelId,'e1');
});
test('sim no app não executa proposta WhatsApp nem reaproveita outro canal',async()=>{
 const now=Date.now();let saved;
 const memory={load:async()=>({version:3,identity:{uid:'e1',role:'funcionario',channel:'whatsapp'},employeeId:'e1',storeId:'s1',at:now,messages:[{role:'user',content:'FOREIGN_CHANNEL'}],pending:{createdAt:now,legacyText:'danger'}}),save:async value=>{saved=value;}};
 const result=await runGroqConversation({env,employee,employees:[employee],profile:employee,database:async()=>({}),now,text:'sim',memory,channel:'app',authScope:{uid:'u1'},executeLegacy:()=>{throw Error('must not execute');},fetcher:async(_url,options)=>{assert.doesNotMatch(options.body,/FOREIGN_CHANNEL|danger/);return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:'Revise e confirme pelo botão no aplicativo.'}}]})};}});
 assert.equal(result.data.type,'query');assert.equal(saved.identity.channel,'app');assert.equal(saved.pending,null);
});
test('promessa de cartão sem ferramenta é reparada para proposta real',async()=>{
 const messages=[{role:'assistant',content:'Vou preparar um cartão de ação.'},{role:'assistant',content:null,tool_calls:[{id:'t1',type:'function',function:{name:'preparar_acao_app',arguments:JSON.stringify({acao:'criarTarefaCozinha',titulo:'Conferir estoque'})}}]},{role:'assistant',content:'Revise o cartão e confirme pelo botão.'}];
 const result=await runGroqConversation({env,employee,employees:[employee],profile:{Perfil:'Gerente'},database:async()=>({}),text:'Crie uma tarefa para conferir estoque',memory:{load:async()=>null,save:async()=>{}},channel:'app',fetcher:async()=>({ok:true,json:async()=>({choices:[{message:messages.shift()}]})})});
 assert.equal(result.data.type,'function_call');assert.equal(result.data.name,'criarTarefaCozinha');assert.equal(result.data.executed,false);
});
test('envio central compõe texto, botões e enquete sem alterar escolhas',async(t)=>{
 const {sendWhatsAppMessage,sendWhatsAppButtons,sendWhatsAppPoll}=await import('../src/whatsapp.js');
 const config={...env,WA_ENABLED:true,WA_API_URL:'https://gateway.test/api',WA_API_KEY:'gateway-test',WA_SESSION_ID:'test'};
 let compositions=0;const deliveries=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const body=JSON.parse(options.body);
  if(String(url).includes('api.groq.com')) {compositions++;const data=JSON.parse(body.messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({message:`Olá!\n${data.texto}`})}}]}));}
  deliveries.push(body);return new Response(JSON.stringify({status:true,data:{key:{id:'test'}}}));
 });
 const common={phone:'5571988887777',text:'Entrada registrada às 08:00'};
 assert.equal((await sendWhatsAppMessage(config,common)).success,true);
 assert.equal((await sendWhatsAppButtons(config,{...common,buttons:[{id:'confirmar',text:'Confirmar'}]})).success,true);
 assert.equal((await sendWhatsAppPoll(config,{...common,question:'Qual opção?',options:['Primeira','Segunda']})).success,true);
 assert.equal(compositions,3);assert.match(deliveries[0].message.text,/Olá!/);
 assert.deepEqual(deliveries[1].buttons,[{id:'confirmar',text:'Confirmar'}]);assert.deepEqual(deliveries[2].options,['Primeira','Segunda']);
});
