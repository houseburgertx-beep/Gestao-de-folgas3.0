import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/pwa.js',import.meta.url),'utf8');
const start=source.indexOf('let reloadPending = false;');
const code=source.slice(start,source.indexOf('const registerServiceWorker',start));
test('atualização do PWA aguarda documento/atestado fechar antes de recarregar',()=>{
 let opened=true,reloads=0;const timers=[];
 const ctx={document:{querySelector:selector=>selector.includes('documentSignDialog')&&opened?{}:null},window:{setTimeout:fn=>timers.push(fn),location:{reload:()=>{reloads++;}}}};
 vm.runInNewContext(code+'\nthis.reload=requestSafeReload;',ctx);ctx.reload();assert.equal(reloads,0);assert.equal(timers.length,1);
 opened=false;timers.shift()();assert.equal(reloads,1);
});
