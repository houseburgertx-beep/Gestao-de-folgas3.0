import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyHouseAIReadIntent,processInboundHouseAI} from '../src/house-ai.js';

test('intenções naturais distinguem descanso, horas, escala, equipe e escrita', () => {
  for(const [text,intent] of [['Quando eu descanso?','folgas'],['Quanto estou devendo de horas?','horas'],['Que horas começo hoje?','escala'],['Quem está na escala hoje?','equipe'],['Qual meu saldo?','clarificar_saldo'],['Quais são minhas tarefas?','tarefas'],['saldo de consumo','consumo'],['Criar tarefa para Ana',''],['Aprovar folga amanhã','']]) assert.equal(classifyHouseAIReadIntent(text),intent,text);
});
const employee={FuncionarioID:'emp1',Nome:'Ana Silva',Telefone:'5573991740014',LojaID:'s1',Ativo:true};
function database(tasks={},fail=false){return async(_env,_tok,path)=>{
  if(path==='tables/Funcionarios')return {emp1:employee};
  if(path==='tables/Tarefas'){if(fail)throw Error('offline');return tasks;}
  return {};
};}
const query=(text,db)=>processInboundHouseAI({from:employee.Telefone,text,env:{APP_URL:'https://example.test/'},database:db,tok:'mock'});
test('WhatsApp consulta tarefas próprias sem expor colegas/unidades ou concluídas',async()=>{
  const res=await query('Quais são minhas tarefas?',database({a:{FuncionarioID:'emp1',LojaID:'s1',Titulo:'Organizar bancada',Status:'A fazer'},b:{RESPONSAVEL_ID:'emp1',LOJA_ID:'s1',TITULO:'Conferir estoque',Coluna:'pendente'},c:{FuncionarioID:'emp2',Titulo:'Segredo colega'},d:{FuncionarioID:'emp1',LojaID:'s2',Titulo:'Outra unidade'},e:{FuncionarioID:'emp1',Titulo:'Encerrada',Status:'Concluída'}}));
  assert.equal(res.action,'consulta_tarefas');assert.match(res.replyText,/2 tarefa/);assert.match(res.replyText,/Organizar bancada/);assert.match(res.replyText,/Conferir estoque/);assert.doesNotMatch(res.replyText,/Segredo|Outra unidade|Encerrada/);
});
test('saldo ambíguo pede esclarecimento e falha de consulta não vira lista vazia',async()=>{
  assert.equal((await query('Meu saldo?',database())).action,'clarificar_saldo');
  assert.equal((await query('saldo de consumo',database())).action,'consulta_consumo');
  assert.equal((await query('Minhas tarefas',database({},true))).action,'consulta_tarefas_indisponivel');
});
