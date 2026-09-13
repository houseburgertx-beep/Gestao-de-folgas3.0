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

test('central de decisões respeita unidade inclusive quando a pendência só informa o funcionário',()=>{
 const h=harness();
 h.send({manager:true,coreReady:true,employees:[{FuncionarioID:'1',LojaID:'a'},{FuncionarioID:'2',LojaID:'b'}],stores:[{LojaID:'a',NomeLoja:'Centro'},{LojaID:'b',NomeLoja:'Sul'}],pending:[{FuncionarioID:'1',NomeFuncionario:'Ponto Centro',Data:'2026-09-01'},{FuncionarioID:'2',NomeFuncionario:'Ponto Sul',Data:'2026-09-01'}],timeOff:[{FuncionarioID:'1',LojaID:'a',NomeFuncionario:'Pedido Centro',Status:'Pendente'},{FuncionarioID:'2',LojaID:'b',NomeFuncionario:'Pedido Sul',Status:'Pendente'}]});
 h.events.change({target:{matches:()=>true,value:'a'}});
 const html=h.nodes.get('#journeyHome').innerHTML;
 assert.match(html,/Ponto Centro/);assert.match(html,/Pedido Centro/);
 assert.doesNotMatch(html,/Ponto Sul|Pedido Sul/);
});
test('área pessoal identifica o cadastro pelo ID e nunca expõe pedidos de colegas',()=>{
 const h=harness();
 h.send({manager:false,coreReady:true,user:{FuncionarioID:'me'},employees:[{FuncionarioID:'other',Nome:'Outra pessoa',SaldoFolgas:99},{FuncionarioID:'me',Nome:'Eu',SaldoFolgas:3}],timeOff:[{FuncionarioID:'other',TipoFolga:'SEGREDO',Status:'Pendente'},{FuncionarioID:'me',TipoFolga:'Meu pedido',Status:'Pendente'}]});
 const html=h.nodes.get('#journeyHome').innerHTML;
 assert.match(html,/Meu pedido/);assert.match(html,/<strong>3<\/strong>/);
 assert.doesNotMatch(html,/SEGREDO|Outra pessoa|<strong>99<\/strong>/);
});
test('falha ao carregar ponto não é apresentada como jornada concluída',()=>{
 const h=harness();
 h.send({user:{FuncionarioID:'me'},clock:{loadError:'Rede indisponível',todayRecords:[],nextAction:''}});
 const html=h.nodes.get('#journeyHome').innerHTML;
 assert.match(html,/Rede indisponível/);assert.match(html,/Tentar carregar meu ponto/);
 assert.doesNotMatch(html,/Jornada concluída|Tudo registrado/);
});
test('programação pessoal usa os quatro nomes de marcação para dois turnos',()=>{
 const h=harness();h.send({user:{FuncionarioID:'me'},clock:{flexibleTwoShifts:true,nextAction:'RETORNO_INTERVALO',todayRecords:[]}});
 const html=h.nodes.get('#journeyHome').innerHTML;
 for(const label of ['Entrada 1','Saída 1','Entrada 2','Saída 2']) assert.match(html,new RegExp(label));
 assert.match(html,/Abrir ponto · Entrada 2/);
});

test('quadro de equipe permite alternar para lista sem perder o filtro da unidade',()=>{
 const h=harness();h.send({manager:true,stores:[{LojaID:'1',NomeLoja:'Centro'},{LojaID:'2',NomeLoja:'Sul'}],presence:{presence:[{FuncionarioID:'a',Nome:'Ana',LojaID:'1',status:'trabalhando'},{FuncionarioID:'b',Nome:'Bruno',LojaID:'2',status:'intervalo'}]}});
 assert.match(h.nodes.get('#journeyTeam').innerHTML,/v-team-column/);
 h.events.click({target:{closest(s){return s==='[data-j-unit-card]'?{dataset:{jUnitCard:'1'}}:null}}});
 h.events.click({target:{closest(s){return s==='[data-j-layout]'?{dataset:{jLayout:'lista'}}:null}}});
 const html=h.nodes.get('#journeyTeam').innerHTML;
 assert.match(html,/Ana/);assert.doesNotMatch(html,/Bruno|v-team-column/);
});
test('cartões de unidade não aparecem na área de funcionário',()=>{
 const h=harness();h.send({manager:false,user:{FuncionarioID:'1'},stores:[{LojaID:'1',NomeLoja:'Centro'},{LojaID:'2',NomeLoja:'Sul'}],presence:{presence:[{FuncionarioID:'2',Nome:'Pessoa restrita',LojaID:'2',status:'trabalhando'}]}});
 assert.doesNotMatch(h.nodes.get('#journeyHome').innerHTML,/v-units|Pessoa restrita/);
});

test('gestor conserva decisões de folga, ajuste e troca com atalhos para resolver',()=>{
 const h=harness();h.send({manager:true,coreReady:true,pendingCounts:{total:4,timeOff:2,clock:1,swaps:1},incompletePunches:[{FuncionarioID:'a'},{FuncionarioID:'b'}],presence:{presence:[{Nome:'Ana',status:'ausente'},{Nome:'Bia',status:'trabalhando',entryTime:'17:12',horarioEscala:'17:00 — 01:00'}]}});
 const html=h.nodes.get('#journeyHome').innerHTML;
 assert.match(html,/<strong>4<\/strong><span>solicitações aguardando decisão/);
 assert.match(html,/2 folgas · 1 ponto · 1 troca/);
 assert.match(html,/<strong>2<\/strong><span>pontos incompletos/);
 assert.match(html,/data-pending-filter-target="clock"/);
 assert.match(html,/data-jump-team="atrasados"/);assert.match(html,/data-jump-team="ausente"/);
 assert.doesNotMatch(html,/data-live-clock/);
});
