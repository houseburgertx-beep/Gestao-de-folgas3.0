import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = (await readFile(new URL('../src/recognition-panel.js',import.meta.url),'utf8')).replace("import './recognition-panel.css';",'');
const {filterRecognitionRows,recognitionCardsHtml} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('recognition panel preserves every active recognition, including multiple awards for one employee',()=>{
 const rows = Array.from({length:28},(_,i)=>({ReconhecimentoID:`r${i}`,FuncionarioID:'same-person',Ativo:true,CriadoEm:`2026-11-${String(i+1).padStart(2,'0')}T12:00:00Z`}));
 const result = filterRecognitionRows(rows);
 assert.equal(result.length,28);
 assert.equal(result[0].ReconhecimentoID,'r27');
 assert.equal((recognitionCardsHtml(result).match(/<article /g)||[]).length,28);
});
test('recognition filters are accent insensitive and retain unit boundaries',()=>{
 const rows=[
  {ReconhecimentoID:'a',NomeFuncionario:'Júlia',Categoria:'Atenção ao cliente',LojaID:'one',Ativo:true},
  {ReconhecimentoID:'b',NomeFuncionario:'Júlia',Categoria:'Agilidade',LojaID:'two',Ativo:true},
  {ReconhecimentoID:'c',NomeFuncionario:'Ana',Motivo:'Atenção constante',LojaID:'one',Ativo:true},
 ];
 assert.deepEqual(filterRecognitionRows(rows,{search:'julia',storeId:'one'}).map(row=>row.ReconhecimentoID),['a']);
 assert.deepEqual(filterRecognitionRows(rows,{search:'atencao',storeId:'one'}).map(row=>row.ReconhecimentoID),['a','c']);
 assert.equal(filterRecognitionRows(rows,{search:'inexistente'}).length,0);
});
test('panel excludes removed recognitions and unidentified records',()=>{
 const rows=[{ReconhecimentoID:'legacy'},{ReconhecimentoID:'yes',Ativo:'true'},{ReconhecimentoID:'no',Ativo:false},{ReconhecimentoID:'no-text',Ativo:'false'},{ReconhecimentoID:'zero',Ativo:0},{Ativo:true}];
 assert.deepEqual(filterRecognitionRows(rows).map(row=>row.ReconhecimentoID),['legacy','yes']);
});
test('recognition cards display full message and escape user controlled text and attributes',()=>{
 const longMessage='Qualidade '.repeat(200)+'<img src=x onerror=alert(1)>';
 const html=recognitionCardsHtml([{ReconhecimentoID:'x" onclick="alert(1)',NomeFuncionario:'<script>name</script>',Motivo:longMessage,Categoria:'<b>mérito</b>',NomeLoja:'<svg onload=alert(1)>',AtribuidoPor:'Gestor <b>Equipe</b>',CriadoEm:'2026-11-04T12:00:00Z'}]);
 assert.ok(html.includes('Qualidade '.repeat(200)));
 assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
 assert.ok(html.includes('&lt;script&gt;name&lt;/script&gt;'));
 assert.ok(html.includes('x&quot; onclick=&quot;alert(1)'));
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('<img '));
 assert.ok(!html.includes('<svg '));
});

test('panel rebuilds after a loading replacement, preserves filters and replaces action handlers',async()=>{
 const {renderRecognitionPanel}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 class Element {
  dataset={};hidden=false;value='';disabled=false;textContent='';
  constructor(selector=''){this.selector=selector;}
  matches(selector){return selector===this.selector;}
 }
 class Container {
  nodes=new Map();classList={add(){}};
  set innerHTML(value){
   this.markup=value;this.nodes.clear();
   for(const key of ['count','search','store','results','status','cards'])this.nodes.set(`[data-recognition-${key}]`,new Element(`[data-recognition-${key}]`));
  }
  set textContent(value){this.markup=value;this.nodes.clear();}
  querySelector(selector){return this.nodes.get(selector)||null;}
  querySelectorAll(){return [];}
  contains(){return true;}
 }
 const container=new Container();let actions=0;
 const rows=[{ReconhecimentoID:'ana',NomeFuncionario:'Ana'},{ReconhecimentoID:'bruno',NomeFuncionario:'Bruno'}];
 renderRecognitionPanel(container,{rows,onCreate:()=>{actions+=100;}});
 const input=container.querySelector('[data-recognition-search]');input.value='Ana';container.oninput({target:input});
 assert.match(container.querySelector('[data-recognition-cards]').innerHTML,/Destaque de Ana/);
 assert.doesNotMatch(container.querySelector('[data-recognition-cards]').innerHTML,/Destaque de Bruno/);
 container.textContent='Carregando destaques…';
 renderRecognitionPanel(container,{rows,onCreate:()=>{actions++;}});
 assert.equal(container.querySelector('[data-recognition-search]').value,'Ana');
 assert.match(container.querySelector('[data-recognition-cards]').innerHTML,/Destaque de Ana/);
 assert.doesNotMatch(container.querySelector('[data-recognition-cards]').innerHTML,/Destaque de Bruno/);
 const button={dataset:{recognitionAction:'create'},closest(){return this;}};
 await container.onclick({target:button});
 assert.equal(actions,1);
});
