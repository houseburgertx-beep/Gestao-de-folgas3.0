import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {scheduleForDay,workday,active,shiftDate} from '../src/core/reminder-policy.js';
const source=(await readFile(new URL('../src/journey.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
function harness(){
 const nodes=new Map(),events={};
 const document={querySelector(s){if(!nodes.has(s))nodes.set(s,{innerHTML:'',classList:{toggle(){}}});return nodes.get(s)},querySelectorAll(){return []},addEventListener(k,f){events[k]=f}};
 const window={addEventListener(k,f){events[k]=f}};
 vm.runInNewContext(source,{document,window,setInterval(){},Date,Intl,scheduleForDay,workday,active,shiftDate});
 return {nodes,events,send(detail){events['house-journey']({detail})}};
}
test('painel usa contagens reais, escapa nomes e limpa dados gerenciais ao trocar de perfil',()=>{
 const h=harness();h.send({manager:true,presence:{presence:[{Nome:'<img onerror=x>',LojaID:'1',status:'trabalhando',horarioEscala:'17:00 — 01:00',entryTime:'17:12'}]}});
 assert.match(h.nodes.get('#journeyHome').innerHTML,/100%/);
 assert.match(h.nodes.get('#journeyHome').innerHTML,/12 min após/);
 assert.doesNotMatch(h.nodes.get('#journeyHome').innerHTML,/<img/);
 h.send({manager:false,user:{funcionarioId:'2'}});
 assert.doesNotMatch(h.nodes.get('#journeyHome').innerHTML,/onerror/);
 assert.match(h.nodes.get('#journeyTeam').innerHTML,/disponível para gestores/);
});
test('seletor de unidade altera equipe, indicadores e escala sem misturar lojas',()=>{
 const h=harness();h.send({manager:true,stores:[{LojaID:'1',Nome:'Centro'},{LojaID:'2',Nome:'Sul'}],presence:{presence:[{Nome:'Ana',LojaID:'1',status:'trabalhando'},{Nome:'Bruno',LojaID:'2',status:'intervalo'}]}});
 h.events.change({target:{matches:()=>true,value:'1'}});
 assert.match(h.nodes.get('#journeyTeam').innerHTML,/Ana/);
 assert.doesNotMatch(h.nodes.get('#journeyTeam').innerHTML,/Bruno/);
});
test('escala semanal respeita folgas aprovadas e jornadas vigentes',()=>{
 const h=harness();const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 h.send({manager:true,employees:[{FuncionarioID:'1',Nome:'Ana',Ativo:true}],schedules:[{FuncionarioID:'1',Ativa:true,HoraEntrada:'17:00',HoraSaida:'01:00',DiasTrabalho:'0,1,2,3,4,5,6'}],timeOff:[{FuncionarioID:'1',Status:'Aprovada',DataInicio:day,DataFim:day}]});
 assert.doesNotMatch(h.nodes.get('#journeySchedule').innerHTML,/<strong>Ana/);
 h.events.click({target:{closest(s){return s==='[data-j-mode]'?{dataset:{jMode:'semana'}}:null}}});
 assert.match(h.nodes.get('#journeySchedule').innerHTML,/<strong>Ana/);
});
test('unidades usam NomeLoja real e removem repetição pelo ID, preservando homônimos',()=>{
 const h=harness();h.send({manager:true,stores:[{LojaID:'1',NomeLoja:'House TX'},{LojaID:'1',Nome:'Duplicado'},{LojaID:'2',nomeLoja:'Food Park TX'}],presence:{presence:[{FuncionarioID:'a',Nome:'Ana',LojaID:'1',status:'trabalhando'},{FuncionarioID:'a',Nome:'Ana',LojaID:'1',status:'trabalhando'},{FuncionarioID:'b',Nome:'Ana',LojaID:'1',status:'trabalhando'}]}});
 const html=h.nodes.get('#journeyTeam').innerHTML;
 assert.match(html,/>House TX<\/option>/);assert.match(html,/>Food Park TX<\/option>/);assert.doesNotMatch(html,/Duplicado/);
 assert.equal((html.match(/<strong>Ana<\/strong>/g)||[]).length,2);
 assert.match(html,/House TX<\/small>/);
});

test('gestor recebe central de decisão com pendências reais em vez do relógio pessoal',()=>{
 const h=harness();h.send({manager:true,pendingCounts:{total:4},incompletePunches:[{id:'1'},{id:'2'}],presence:{presence:[{Nome:'Ana',status:'ausente',LojaID:'1'},{Nome:'Bia',status:'trabalhando',LojaID:'1',horarioEscala:'17:00',entryTime:'17:12'}]}});
 const html=h.nodes.get('#journeyHome').innerHTML;
 assert.match(html,/O que precisa da sua decisão/);
 assert.match(html,/4<\/strong><span>solicitações aguardando decisão/);
 assert.match(html,/2<\/strong><span>saídas esquecidas/);
 assert.match(html,/1<\/strong><span>entrada atrasada/);
 assert.match(html,/1<\/strong><span>pessoa ainda sem entrada/);
 assert.match(html,/data-pending-filter-target="clock"/);
 assert.match(html,/data-jump-team="atrasados"/);
 assert.match(html,/data-jump-team="ausente"/);
 assert.doesNotMatch(html,/data-live-clock/);
});
