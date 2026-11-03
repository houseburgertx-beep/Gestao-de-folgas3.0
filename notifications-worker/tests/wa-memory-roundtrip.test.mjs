import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsAppConversationStore } from '../src/wa-conversation.js';
import { runGroqConversation } from '../src/wa-chat.js';

const now = Date.parse('2026-11-03T15:00:00Z');
const employee = { FuncionarioID: 'fixture-e1', LojaID: 'fixture-s1', Nome: 'Pessoa de teste', Perfil: 'Funcionário', Ativo: true };
const env = { GROQ_API_KEY: 'test-only-key', WA_WEBHOOK_SECRET: 'test-only-hmac', FIREBASE_DATABASE_URL: 'https://fixture.example.test', FIREBASE_ROOT: 'fixture' };
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;

async function roundtripMemory() {
  let stored = null;
  const memory = await createWhatsAppConversationStore(env, 'fixture-token', 'fixture-conversation:groq', async (_url, options) => {
    if (options.method === 'PUT') {
      // A database roundtrip preserves values, not insertion order of keys.
      stored = JSON.stringify(sorted(JSON.parse(options.body)));
      return new Response('null');
    }
    return new Response(stored || 'null');
  });
  return memory;
}
const completion = message => new Response(JSON.stringify({ choices: [{ message }] }));
const base = { env, employee, employees: [employee], profile: employee, database: async () => ({}), tok: 'fixture-token', now };

test('conversation history survives RTDB JSON roundtrip with reordered identity keys', async () => {
  const memory = await roundtripMemory();
  const requests = [];
  const fetcher = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return completion({ role: 'assistant', content: requests.length === 1 ? 'Podemos organizar sua semana.' : 'Você estava falando da organização da semana.' });
  };
  await runGroqConversation({ ...base, text: 'Quero organizar minha semana.', memory, fetcher });
  const loaded = await memory.load();
  assert.deepEqual(Object.keys(loaded.identity), ['channel', 'role', 'uid']);
  await runGroqConversation({ ...base, text: 'E como continuo?', memory, fetcher });
  assert.ok(requests[1].messages.some(message => message.role === 'user' && message.content === 'Quero organizar minha semana.'));
  assert.ok(requests[1].messages.some(message => message.role === 'assistant' && message.content === 'Podemos organizar sua semana.'));
});

test('pending leave proposal survives RTDB roundtrip and is consumed by subsequent confirmation', async () => {
  const memory = await roundtripMemory();
  let providerCalls = 0;
  let writes = 0;
  const fetcher = async () => {
    providerCalls++;
    return completion(providerCalls === 1 ? {
      role: 'assistant', content: null, tool_calls: [{ id: 'fixture-tool', type: 'function', function: {
        name: 'preparar_folga', arguments: JSON.stringify({ datas: ['2026-11-06'], motivo: 'Compromisso de teste' }),
      } }],
    } : { role: 'assistant', content: 'Pedido para sexta, 06/11/2026. Ainda não foi enviado. Posso confirmar?' });
  };
  const options = { ...base, memory, fetcher, executeLegacy: async text => {
    writes++;
    assert.match(text, /06\/11\/2026/);
    return { handled: true, authorized: true, action: 'fixture_confirmed', replyText: 'Pedido de teste enviado.' };
  } };
  await runGroqConversation({ ...options, text: 'Quero folga na sexta, 06/11, motivo compromisso de teste.' });
  assert.equal((await memory.load()).pending.targetEmployeeId, 'fixture-e1');
  const confirmed = await runGroqConversation({ ...options, text: 'Sim' });
  assert.equal(confirmed.action, 'fixture_confirmed');
  assert.equal(writes, 1);
  assert.equal((await memory.load()).pending, null);
  assert.equal(providerCalls, 1);
});
