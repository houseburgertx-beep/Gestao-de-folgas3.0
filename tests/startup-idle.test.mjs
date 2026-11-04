import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/legacy/Scripts.html',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  function scheduleIdleTask_('),source.indexOf('  function compactTurboRows_('));
function setup(idle=true){
 const timers=[],slots=[],auth={currentUser:{uid:'u1'}};
 const context={window:{__GESTAO_FIREBASE__:{runtime:{auth}}},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},Promise,console};
 if(idle)context.window.requestIdleCallback=(fn,options)=>slots.push({fn,options});
 vm.runInNewContext(body+';this.schedule=scheduleIdleTask_;',context);
 return {timers,slots,auth,schedule:context.schedule};
}
test('background requests wait for their own delay instead of starting together on first idle',async()=>{
 const h=setup();let calls=0;
 h.schedule(()=>{calls++;},6000);h.schedule(()=>{calls++;},9000);
 assert.equal(h.slots.length,0);assert.deepEqual(h.timers.map(t=>t.delay),[6000,9000]);
 h.timers[0].fn();assert.equal(calls,0);assert.equal(h.slots.length,1);
 h.slots[0].fn();await Promise.resolve();assert.equal(calls,1);
 h.timers[1].fn();h.slots[1].fn();await Promise.resolve();assert.equal(calls,2);
});
test('scheduled work from an old account does not run under the new login',async()=>{
 const h=setup();let calls=0;h.schedule(()=>{calls++;},5000);h.timers[0].fn();
 h.auth.currentUser={uid:'u2'};h.slots[0].fn();await Promise.resolve();assert.equal(calls,0);
});
test('browsers without idle callbacks retain staggered fallback',async()=>{
 const h=setup(false);let calls=0;h.schedule(()=>{calls++;},6000);assert.equal(calls,0);
 h.timers[0].fn();await Promise.resolve();assert.equal(calls,1);
});
