import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/copilot.js', import.meta.url), 'utf8');
const start = source.indexOf('  const clearChatBtn = $("#copilotClearChatBtn");');
const block = source.slice(start, source.indexOf('\n  form?.addEventListener', start));
function setup(reset) {
  let onClear;
  let cleared = false;
  let welcome = false;
  const errors = [];
  const clear = { disabled: false, addEventListener(type, callback) { assert.equal(type, 'click'); onClear = callback; } };
  const send = { disabled: false };
  const messages = { innerHTML: 'existing conversation' };
  const input = { value: 'unsent draft', style: { height: '60px' } };
  const context = {
    isProcessing: false, pendingAction: { type: 'action' }, messages, input,
    $: selector => selector === '#copilotClearChatBtn' ? clear : send,
    callNativeHouseAI: reset,
    getCurrentView: () => 'timeoff',
    clearCopilotChatHistory: () => { cleared = true; },
    updateWelcomeAndChips: () => { welcome = true; },
    appendAssistantMessage: text => errors.push(text),
    window: { __GESTAO_TOAST__: text => errors.push(text) },
  };
  vm.runInNewContext(block, context);
  return { context, clear, send, messages, input, errors, click: () => onClear(), get cleared() { return cleared; }, get welcome() { return welcome; } };
}

test('clear button awaits server reset before discarding messages, history and draft', async () => {
  let release;
  let calls = 0;
  const app = setup((prompt, context) => {
    calls++;
    assert.equal(prompt, 'limpar conversa');
    assert.deepEqual(JSON.parse(JSON.stringify(context)), { currentView: 'timeoff' });
    return new Promise(resolve => { release = resolve; });
  });
  const clearing = app.click();
  await app.click();
  assert.equal(calls, 1);
  assert.equal(app.messages.innerHTML, 'existing conversation');
  assert.equal(app.cleared, false);
  assert.equal(app.clear.disabled, true);
  assert.equal(app.send.disabled, true);
  release({ type: 'query', provider: 'groq', reply: 'Conversa limpa.' });
  await clearing;
  assert.equal(app.messages.innerHTML, '');
  assert.equal(app.cleared, true);
  assert.equal(app.welcome, true);
  assert.equal(app.context.pendingAction, null);
  assert.equal(app.input.value, '');
  assert.equal(app.clear.disabled, false);
  assert.equal(app.send.disabled, false);
});

test('failed server reset preserves conversation, draft and pending action and reports error', async () => {
  const app = setup(async () => { throw new Error('Sem conexão'); });
  await app.click();
  assert.equal(app.messages.innerHTML, 'existing conversation');
  assert.equal(app.input.value, 'unsent draft');
  assert.equal(app.cleared, false);
  assert.equal(app.welcome, false);
  assert.equal(app.context.pendingAction.type, 'action');
  assert.match(app.errors[0], /Sem conexão/);
  assert.equal(app.clear.disabled, false);
  assert.equal(app.send.disabled, false);
});
