import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { callNativeHouseAI } from '../src/copilot.js';

test('native chat invokes authenticated handler without sending browser keys or employee lists', async () => {
  let invocation;
  const api = { invoke: async (...args) => {
    invocation = args;
    return { success: true, data: { type: 'query', reply: 'Consulta respondida.', provider: 'groq', model: 'openai/gpt-oss-120b' } };
  } };
  const result = await callNativeHouseAI('  minhas folgas  ', { currentView: 'timeoff', employees: [{ CPF: 'private' }], user: { Perfil: 'Administrador' }, apiKey: 'not-transmitted' }, api);
  assert.deepEqual(invocation, ['callHouseAIChat', [{ prompt: 'minhas folgas', currentView: 'timeoff' }]]);
  assert.equal(result.reply, 'Consulta respondida.');
  assert.equal(result.provider, 'groq');
});

test('tool response becomes an unexecuted action for the existing confirmation card', async () => {
  let calls = 0;
  const result = await callNativeHouseAI('criar tarefa', { user: { Perfil: 'Administrador', Nome: 'Gestor' } }, {
    invoke: async () => { calls++; return { success: true, data: { type: 'function_call', name: 'criarTarefaCozinha', args: { titulo: 'Limpar bancada' } } }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.type, 'action');
  assert.equal(result.apiMethod, 'cozinhaTasksSave');
  assert.equal(result.apiArgs[0].TITULO, 'Limpar bancada');
  assert.ok(result.diff.length);
});

test('tool conversion keeps employee permission checks', async () => {
  const result = await callNativeHouseAI('criar tarefa', { user: { Perfil: 'Funcionário', FuncionarioID: 'f1' } }, {
    invoke: async () => ({ success: true, data: { type: 'function_call', name: 'criarTarefaCozinha', args: { titulo: 'Tarefa' } } }),
  });
  assert.equal(result.type, 'error');
  assert.match(result.message, /permissão/);
});

test('native chat exposes service errors instead of answering with a local fallback', async () => {
  await assert.rejects(callNativeHouseAI('oi', {}, { invoke: async () => { throw new Error('Groq indisponível'); } }), /Groq indisponível/);
  await assert.rejects(callNativeHouseAI('oi', {}, { invoke: async () => ({ success: false, error: 'Sessão expirada' }) }), /Sessão expirada/);
  await assert.rejects(callNativeHouseAI('oi', {}, {}), /sessão/);
});

test('invalid replies and unsupported tools fail explicitly without mutations', async () => {
  for (const data of [
    { type: 'query', provider: 'groq', reply: '' },
    { type: 'query', engine: 'local', reply: 'Fallback genérico' },
    { type: 'function_call', name: 'deleteAll', args: {} },
    { type: 'function_call', name: 'criarTarefaCozinha', args: [] },
  ]) {
    await assert.rejects(callNativeHouseAI('teste', {}, { invoke: async () => ({ success: true, data }) }), /inválida|não reconhecida/);
  }
});

test('app settings do not request browser API keys and chat submission uses native service', async () => {
  const html = await readFile(new URL('../src/legacy/Index.html', import.meta.url), 'utf8');
  const settings = html.slice(html.indexOf('<div id="copilotSettingsPanel"'), html.indexOf('<div class="copilot-body"'));
  assert.match(settings, /Groq/);
  assert.doesNotMatch(settings, /copilotApiKeyInput|copilotModelSelect|aistudio/);
  const source = await readFile(new URL('../src/copilot.js', import.meta.url), 'utf8');
  const submission = source.slice(source.indexOf('  async function handleUserInput()'), source.indexOf('  const clearChatBtn ='));
  assert.match(submission, /await callNativeHouseAI\(text, context\)/);
  assert.doesNotMatch(submission, /getGeminiApiKey|callGeminiProxy|callGeminiCopilot|parseCopilotIntent/);
});
