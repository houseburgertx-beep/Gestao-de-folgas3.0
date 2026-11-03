import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {scheduleForDay,workday,active,shiftDate} from '../src/core/reminder-policy.js';
const source=(await readFile(new URL('../src/journey.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
function app(){
 let timestamp=Date.parse('2026-11-03T15:00:00Z');
 class Clock extends Date {constructor(...args){super(...(args.length?args:[timestamp]));}static now(){return timestamp;}}
 const nodes=new Map(),events={};
 const document={querySelector(key){if(!nodes.has(key))nodes.set(key,{innerHTML:'',classList:{toggle(){}}});return nodes.get(key);},querySelectorAll:()=>[],addEventListener:()=>{}};
 const context={window:{addEventListener:(key,callback)=>{events[key]=callback;}},document,Date:Clock,Intl,setInterval(){},scheduleForDay,workday,active,shiftDate};
 vm.runInNewContext(source+'\nthis.quote=dailyMotivationalQuote;this.award=currentEmployeeRecognition;this.hero=workspaceHero;this.tick=tick;',context);
 return {nodes,quote:context.quote,award:context.award,hero:context.hero,tick:context.tick,setTime:value=>{timestamp=Date.parse(value);},send:detail=>events['house-journey']({detail})};
}
const employee={FuncionarioID:'e1',Nome:'Ana',LojaID:'s1'};
const recognition={ReconhecimentoID:'r1',FuncionarioID:'e1',LojaID:'s1',NomeFuncionario:'Ana',CriadoEm:'2026-11-03T14:00:00Z',Ativo:true,Categoria:'Destaque da cozinha',Motivo:'Seu cuidado fez a diferença',AtribuidoPor:'Liderança'};
test('frase permanece durante o dia da Bahia e muda à meia-noite, com 32 versões',()=>{
 const h=app();assert.equal(h.quote(new Date('2026-11-03T03:00:00Z')),h.quote(new Date('2026-11-04T02:59:59Z')));assert.notEqual(h.quote(new Date('2026-11-04T02:59:59Z')),h.quote(new Date('2026-11-04T03:00:00Z')));
 const phrases=Array.from({length:32},(_,i)=>h.quote(new Date(Date.parse('2026-11-03T12:00:00Z')+i*86400000)));assert.equal(new Set(phrases).size,32);
});
test('topo mostra somente destaque ativo do funcionário e da semana atual, sem cargo de nível',()=>{
 const h=app();h.send({user:employee,employees:[employee],recognitions:[{...recognition,ReconhecimentoID:'other',FuncionarioID:'e2',Motivo:'OTHER_PERSON'},{...recognition,ReconhecimentoID:'wrong-store',LojaID:'s2',Motivo:'WRONG_STORE'},{...recognition,ReconhecimentoID:'inactive',Ativo:false,Motivo:'INACTIVE'},{...recognition,ReconhecimentoID:'old',CriadoEm:'2026-10-27T12:00:00Z',Motivo:'OLD_WEEK'},recognition]});
 const html=h.nodes.get('#journeyHome').innerHTML;
 assert.match(html,/Seu destaque da semana/);assert.match(html,/Seu cuidado fez a diferença/);assert.doesNotMatch(html,/OTHER_PERSON|WRONG_STORE|INACTIVE|OLD_WEEK|j-kitchen-tag|Ajudante da Cozinha/);
 assert.ok(html.indexOf('Seu destaque da semana')<html.indexOf('data-daily-quote'));
 assert.equal((html.match(/data-profile-recognition/g)||[]).length,1);
});
test('nome igual de outra pessoa não ganha destaque e texto é escapado',()=>{
 const h=app();h.send({user:employee,recognitions:[{...recognition,FuncionarioID:'e2',NomeFuncionario:'Ana'}]});assert.doesNotMatch(h.hero(),/data-profile-recognition/);
 h.send({user:employee,recognitions:[{...recognition,Motivo:'<img src=x onerror=alert(1)>'}]});assert.doesNotMatch(h.hero(),/<img/);assert.match(h.hero(),/&lt;img/);
});
test('virada de semana remove destaque antigo e animação não reinicia em atualização comum',()=>{
 const h=app();h.send({user:employee,recognitions:[recognition]});assert.match(h.nodes.get('#journeyHome').innerHTML,/v-profile-highlight is-new/);assert.doesNotMatch(h.hero(),/v-profile-highlight is-new/);
 h.setTime('2026-11-09T03:00:00Z');h.tick();assert.doesNotMatch(h.nodes.get('#journeyHome').innerHTML,/data-profile-recognition/);
});
