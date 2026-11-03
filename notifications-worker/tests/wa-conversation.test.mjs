import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveConversationFollowUp,createWhatsAppConversationStore} from '../src/wa-conversation.js';
import {processInboundHouseAI} from '../src/house-ai.js';
const now=Date.parse('2026-11-02T14:00:00Z');
const state={employeeId:'e1',storeId:'s1',intent:'escala',date:'2026-11-02',at:now};
test('memória só reaproveita assunto para mesma pessoa/unidade dentro do prazo',()=>{
 const options={text:'e amanhã?',previous:state,employeeId:'e1',storeId:'s1',now};
 assert.match(resolveConversationFollowUp(options),/meu horário/);
 for(const overrides of [{employeeId:'e2'},{storeId:'s2'},{now:now+21*60000},{now:now-1},{text:'aprovar folga amanhã'},{text:'sim'}]) assert.equal(resolveConversationFollowUp({...options,...overrides}),overrides.text||options.text);
});
test('armazenamento usa chave HMAC e não salva telefone nem transcrições',async()=>{
 let captured;
 const store=await createWhatsAppConversationStore({WA_WEBHOOK_SECRET:'test-secret',FIREBASE_DATABASE_URL:'https://db.example',FIREBASE_ROOT:'app'},'token','5573991740014',async(url,options)=>{captured={url,options};return {ok:true};});
 await store.save(state);
 assert.doesNotMatch(captured.url,/5573991740014|test-secret/);
 assert.deepEqual(JSON.parse(captured.options.body),state);
});
test('WhatsApp continua escala em outro dia, usa jornada vigente e reconhece folga real',async()=>{
 let saved=null;const memory={load:async()=>saved,save:async value=>{saved=value;}};
 const db=async(_e,_t,path)=>({
 'tables/Funcionarios':{e1:{FuncionarioID:'e1',Nome:'Ana',Telefone:'5573991740014',LojaID:'s1',Ativo:true}},
 'tables/JornadasPonto':{a:{FuncionarioID:'e1',Ativa:true,VigenteDe:'2026-01-01',DiasTrabalho:'1,2,3,4,5,6',Entrada:'08:00',Saida:'17:00'}},
 'tables/Folgas':{f:{FuncionarioID:'e1',DataInicio:'2026-11-03',DataFim:'2026-11-03',Status:'Aprovada'}},
 }[path]||{});
 const run=text=>processInboundHouseAI({from:'5573991740014',text,env:{},database:db,tok:'test',now,conversationStore:memory});
 const first=await run('Qual meu horário hoje?');assert.match(first.replyText,/02\/11\/2026/);assert.match(first.replyText,/08:00/);
 const second=await run('e amanhã?');assert.match(second.replyText,/03\/11\/2026/);assert.match(second.replyText,/descanso/);
 assert.equal(saved.intent,'escala');assert.equal(saved.employeeId,'e1');
 const third=await run('Minhas folgas amanhã');assert.match(third.replyText,/folga aprovada/);
 const fourth=await run('sim');assert.notEqual(fourth.action,'folga_aprovada_whatsapp');
});
