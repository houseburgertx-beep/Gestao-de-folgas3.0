import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseCopilotIntent, resolveCopilotProxyResult } from '../src/copilot.js';

const context = { user: { FuncionarioID:'emp1', Nome:'Ana Silva', Perfil:'Funcionário', LojaID:'store1' }, employees:[{FuncionarioID:'emp1',Nome:'Ana Silva',LojaID:'store1'}], currentView:'holidays' };
test('fallback genérico não esconde conhecimento contextual nem pedidos locais', () => {
  for (const prompt of ['como funciona esta tela', 'Solicitar folga amanhã', 'Quais são minhas tarefas?']) {
    const local = parseCopilotIntent(prompt, context);
    assert.deepEqual(resolveCopilotProxyResult(prompt, context, { data: {engine:'local',reply:'Resposta genérica'} }),local);
    assert.notEqual(local.reply,'Resposta genérica');
  }
});
test('resposta remota válida é preservada e ausência de resposta aciona o parser', () => {
  assert.deepEqual(resolveCopilotProxyResult('oi',context,{reply:'Olá, Ana!'}),{type:'query',reply:'Olá, Ana!'});
  assert.deepEqual(resolveCopilotProxyResult('como funciona esta tela',context,{}),parseCopilotIntent('como funciona esta tela',context));
});
test('cartão pessoal usa nome e somente folgas próprias aprovadas no mês', async () => {
  const source = await readFile(new URL('../src/legacy/Scripts.html', import.meta.url),'utf8');
  const start = source.indexOf('  async function renderHouseAiDashboardContent_(owner)');
  const end = source.indexOf('  function activity(',start);
  const month = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit'}).format(new Date());
  const container = { innerHTML:'',querySelectorAll:()=>[] };
  const state = {user:context.user,timeOff:[
    {FuncionarioID:'emp1',Status:'Aprovada',DataInicio:`${month}-10`},
    {FuncionarioID:'emp2',Status:'Aprovada',DataInicio:`${month}-10`},
    {FuncionarioID:'emp1',Status:'Pendente',DataInicio:`${month}-11`},
    {FuncionarioID:'emp1',Status:'Aprovada',DataInicio:'2020-01-01'},
  ]};
  await vm.runInNewContext(`${source.slice(start,end)};renderHouseAiDashboardContent_()`, {
    state,Date,Intl,console,$:()=>container,isAdmin:()=>false,isManager:()=>false,arr:x=>Array.isArray(x)?x:[],
    val:(row,...keys)=>keys.map(k=>row[k]).find(x=>x!==undefined),esc:x=>String(x),
  });
  assert.match(container.innerHTML,/Olá, Ana/);
  assert.match(container.innerHTML,/1 folga aprovada/);
  assert.doesNotMatch(container.innerHTML,/de 5|Assistente Ativa|Conversar com House AI/);
  assert.equal((container.innerHTML.match(/data-house-prompt=/g)||[]).length,3);
});
test('links do WhatsApp abrem abas de funcionário usando view ou tab legado', async () => {
  const source = await readFile(new URL('../src/legacy/Scripts.html', import.meta.url),'utf8');
  const start=source.indexOf('  async function renderInitialView()'),end=source.indexOf('  function renderCurrentView(',start);
  for(const query of ['?view=tasks','?tab=timeoff','?tab=timeclock','?view=documents','?view=takeat-credit']) {
    let opened,cleaned;const location=new URL(`https://example.test/${query}`);
    await vm.runInNewContext(`${source.slice(start,end)};renderInitialView()`,{URL,URLSearchParams,location,history:{replaceState:(_s,_t,url)=>{cleaned=String(url);}},checkWhatsAppMagicTokenArrival_:async()=>false,switchView:view=>{opened=view;}});
    assert.equal(opened,query.split('=')[1]);assert.equal(cleaned,'https://example.test/');
  }
});
