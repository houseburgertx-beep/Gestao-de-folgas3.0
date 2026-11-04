import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/legacy/Scripts.html',import.meta.url),'utf8');
const start=source.indexOf('  let HOUSE_AI_DASHBOARD_REQUEST_');
const end=source.indexOf('  async function renderHouseAiDashboardContent_',start);
function harness(){
 const state={user:{Perfil:'Administrador'},coreReady:true,currentView:'dashboard'},auth={currentUser:{uid:'u1'}},calls=[];
 const ctx={state,window:{__GESTAO_FIREBASE__:{runtime:{auth}}},Date,JSON,renderHouseAiDashboardContent_:key=>new Promise(resolve=>calls.push({key,resolve}))};
 vm.runInNewContext(source.slice(start,end)+';this.render=renderHouseAiDashboard_;',ctx);
 return{state,auth,calls,render:ctx.render};
}
test('dashboard repaints share one analysis and reuse its result for one minute; explicit refresh bypasses',async()=>{
 const h=harness();const a=h.render(),b=h.render();assert.equal(h.calls.length,1);h.calls[0].resolve();await Promise.all([a,b]);
 await h.render();assert.equal(h.calls.length,1);
 const c=h.render(true);assert.equal(h.calls.length,2);h.calls[1].resolve();await c;
});
test('analysis waits for core and visible dashboard, and a different unit receives a separate analysis',async()=>{
 const h=harness();h.state.coreReady=false;await h.render();h.state.coreReady=true;h.state.currentView='timeclock';await h.render();assert.equal(h.calls.length,0);
 h.state.currentView='dashboard';const a=h.render();h.state.selectedStoreId='s2';const b=h.render();assert.equal(h.calls.length,2);h.calls.forEach(c=>c.resolve());await Promise.all([a,b]);
});
