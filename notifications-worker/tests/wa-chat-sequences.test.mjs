import assert from 'node:assert/strict';
import test from 'node:test';
import { runGroqConversation, createEmployeeTools } from '../src/wa-chat.js';
import { createWhatsAppConversationStore } from '../src/wa-conversation.js';

const now = Date.parse('2026-11-03T15:00:00Z');
const employee = { FuncionarioID: 'sequence-e1', LojaID: 'sequence-s1', Nome: 'Pessoa de teste', Perfil: 'Funcionário', Ativo: true };
const env = { GROQ_API_KEY: 'test-only-key', WA_WEBHOOK_SECRET: 'test-only-hmac', FIREBASE_DATABASE_URL: 'https://sequence.example.test', FIREBASE_ROOT: 'fixture' };
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
async function memoryRoundtrip() {
  let stored = null;
  return createWhatsAppConversationStore(env, 'test-token', 'fixture-sequence:groq', async (_url, options) => {
    if (options.method === 'PUT') { stored = JSON.stringify(sorted(JSON.parse(options.body))); return new Response('null'); }
    return new Response(stored || 'null');
  });
}
const toolCall = (dates, reason) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'sequence-tool', type: 'function', function: {
  name: 'preparar_folga', arguments: JSON.stringify({ datas: dates, motivo: reason }),
} }] });
function provider(...messages) {
  const requests = [];
  return { requests, fetcher: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const message = messages.shift() || { role: 'assistant', content: 'Não há proposta pendente.' };
    return new Response(JSON.stringify({ choices: [{ message }] }));
  } };
}
const base = { env, employee, employees: [employee], profile: employee, database: async () => ({}), tok: 'test-token', now };

test('Friday request, Saturday correction and Envia preserve only the corrected proposal across RTDB roundtrips', async () => {
  const memory = await memoryRoundtrip();
  const model = provider(toolCall(['2026-11-04'], 'visitar minha família'), toolCall(['2026-11-05'], 'visitar minha família'));
  const writes = [];
  const options = { ...base, memory, fetcher: model.fetcher, executeLegacy: async text => {
    writes.push(text);
    return { handled: true, authorized: true, action: 'sequence_confirmed', replyText: 'Pedido de teste enviado.' };
  } };
  const friday = await runGroqConversation({ ...options, text: 'Quero folga sexta para visitar minha família.' });
  assert.match(friday.replyText, /sexta-feira/);
  assert.match(friday.replyText, /06\/11\/2026/);
  assert.deepEqual((await memory.load()).pending.datas, ['2026-11-06']);
  const saturday = await runGroqConversation({ ...options, text: 'Em vez de sexta, quero sábado.' });
  assert.match(saturday.replyText, /sábado/);
  assert.match(saturday.replyText, /07\/11\/2026/);
  assert.doesNotMatch(saturday.replyText, /04\/11|05\/11|06\/11/);
  assert.deepEqual((await memory.load()).pending.datas, ['2026-11-07']);
  assert.equal(writes.length, 0);
  const confirmed = await runGroqConversation({ ...options, text: 'Envia!' });
  assert.equal(confirmed.action, 'sequence_confirmed');
  assert.equal(writes.length, 1);
  assert.match(writes[0], /07\/11\/2026/);
  assert.doesNotMatch(writes[0], /04\/11|05\/11|06\/11/);
  await runGroqConversation({ ...options, text: 'Envia!' });
  assert.equal(writes.length, 1);
});

test('simple confirmation aliases consume a prepared proposal exactly once without a second model call', async () => {
  for (const text of ['sim', 'envia', 'envie', 'pode mandar']) {
    const memory = await memoryRoundtrip();
    const model = provider(toolCall(['2026-11-04'], 'visitar minha família'));
    let writes = 0;
    const options = { ...base, memory, fetcher: model.fetcher, executeLegacy: async () => {
      writes++;
      return { action: 'sequence_confirmed', replyText: 'Pedido de teste enviado.' };
    } };
    await runGroqConversation({ ...options, text: 'Quero folga sexta para visitar minha família.' });
    assert.equal((await runGroqConversation({ ...options, text })).action, 'sequence_confirmed', text);
    assert.equal(writes, 1, text);
    assert.equal(model.requests.length, 1, text);
  }
});

test('a confirmation containing a date correction never executes the previous proposal', async () => {
  const memory = await memoryRoundtrip();
  const model = provider(toolCall(['2026-11-04'], 'visitar minha família'), { role: 'assistant', content: 'Vou conferir a alteração para sábado.' });
  let writes = 0;
  const options = { ...base, memory, fetcher: model.fetcher, executeLegacy: async () => { writes++; return { replyText: 'unexpected' }; } };
  await runGroqConversation({ ...options, text: 'Quero folga sexta para visitar minha família.' });
  const result = await runGroqConversation({ ...options, text: 'sim mas sábado' });
  assert.notEqual(result.action, 'sequence_confirmed');
  assert.equal(writes, 0);
  assert.equal(model.requests.length, 2);
  assert.equal((await memory.load()).pending, null);
});

test('reasonContext blocks invented generic motives while allowing the exact words supplied by the person', async () => {
  let pending;
  const options = { ...base, requestedDates: ['2026-11-06'], setPending: value => { pending = value; } };
  const missing = createEmployeeTools({ ...options, reasonContext: 'Quero folga sexta.' });
  const rejected = await missing('preparar_folga', { datas: ['2026-11-04'], motivo: 'Compromisso pessoal' });
  assert.match(rejected.erro, /motivo não foi informado/);
  assert.equal(pending, undefined);
  const supplied = createEmployeeTools({ ...options, reasonContext: 'Quero folga sexta para visitar minha família.' });
  const accepted = await supplied('preparar_folga', { datas: ['2026-11-04'], motivo: 'visitar minha família' });
  assert.equal(accepted.preparado, true);
  assert.equal(pending.motivo, 'visitar minha família');
  assert.deepEqual(pending.datas, ['2026-11-06']);
});

test('a motive supplied in a later human message preserves the Friday requested in the preceding turn', async () => {
  const memory = await memoryRoundtrip();
  const model = provider({ role: 'assistant', content: 'Qual é o motivo da folga?' }, toolCall(['2026-11-04'], 'visitar minha família'));
  const options = { ...base, memory, fetcher: model.fetcher, executeLegacy: async () => { throw Error('must not write before confirmation'); } };
  await runGroqConversation({ ...options, text: 'Quero folga sexta.' });
  await runGroqConversation({ ...options, text: 'É para visitar minha família.' });
  assert.deepEqual((await memory.load()).pending.datas, ['2026-11-06']);
  assert.equal((await memory.load()).pending.motivo, 'visitar minha família');
});
test('pedido completo prepara ferramenta em vez de pedir permissão para apenas preparar',async()=>{
 const memory=await memoryRoundtrip();
 const model=provider({role:'assistant',content:'Você quer folga na sexta. Posso preparar o pedido?'},toolCall(['2026-11-04'],'visitar minha família'));
 const result=await runGroqConversation({...base,memory,fetcher:model.fetcher,text:'Quero folga sexta para visitar minha família.',executeLegacy:()=>{throw Error('no write');}});
 assert.match(result.replyText,/06\/11\/2026/);
 assert.equal((await memory.load()).pending.datas[0],'2026-11-06');
});
