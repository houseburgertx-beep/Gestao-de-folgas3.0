import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/legacy/Scripts.html',import.meta.url),'utf8');
function confirmationHarness(){
 const nodes=new Map(),events=[],payloads=[],gpsOptions=[];let draft=null,calls=0,positionCalls=0,firstApiError=null,gpsError=null;
 const $=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',disabled:false,classList:{add(){},remove(){}}});return nodes.get(selector);};
 const recovery={listClockDrafts:async()=>draft?[draft]:[],saveClockDraft:async(_uid,value)=>{events.push('persist');draft={...value,payload:{...value.payload},requiresLocationRefresh:true};return draft;},refreshClockDraftLocation:async(_uid,id,p)=>{events.push('refresh');draft={...draft,requiresLocationRefresh:false,payload:{...draft.payload,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,locationTimestamp:p.timestamp}};return draft;},markClockDraftLocationIssue:async()=>{draft.requiresLocationRefresh=true;},removeClockDraft:async()=>{draft=null;}};
 const ctx={$,CLOCK_SELFIE_DATA_:'data:image/jpeg;base64,valid-image',CLOCK_PUNCH_REQUEST_ID_:'test-request',CLOCK_EXPECTED_ACTION_:'ENTRADA',window:{__GESTAO_CLOCK_RECOVERY__:recovery,__GESTAO_CLOCK_LOCATION__:{invalidate:()=>events.push('invalidate')},dispatchEvent(){}},Date,performance:{now:()=>1},document:{getElementById:()=>null},setTimeout:()=>0,console:{info(){}},CustomEvent:function(){},clockOwnerUid_:()=> 'owner',getClockPosition_:async options=>{events.push('gps');gpsOptions.push(options);positionCalls++;if(gpsError)throw gpsError;return {timestamp:Date.now(),coords:{latitude:positionCalls===1?-17.5:-17.6,longitude:-39.7,accuracy:20}};},FN:{clockPunch:'punch'},sessionToken:()=>'',call:async(_name,_token,payload)=>{payloads.push({...payload});calls++;if(firstApiError&&calls===1)throw firstApiError;return {TipoMarcacao:'ENTRADA'};},setClockButtonsBusy(){},closeDialog(){},applySavedClockPunch_:()=>events.push('confirmed'),bool:Boolean,toast(){},clockLocationError_:error=>error.message,refreshClockAfterPunch_(){}};
 const start=source.indexOf('  async function confirmClockPunchWithSelfie_(event)');const code=source.slice(start,source.indexOf('\n  function setClockButtonsBusy',start));vm.runInNewContext(code+'\nthis.confirm=confirmClockPunchWithSelfie_;',ctx);
 return {events,nodes,payloads,gpsOptions,confirm:()=>ctx.confirm({preventDefault(){}}),setGpsError:value=>{gpsError=value;},setApiError:value=>{firstApiError=value;},get draft(){return draft;},get calls(){return calls;}};
}
test('permissão GPS negada preserva captura antes da consulta e não chama gravação remota',async()=>{
 const h=confirmationHarness();h.setGpsError(Object.assign(new Error('GPS autorizado mas serviço indisponível'),{code:1}));await h.confirm();
 assert.deepEqual(h.events,['persist','gps']);assert.ok(h.draft.payload.selfieDataUrl);assert.equal(h.calls,0);assert.match(h.nodes.get('#clockSelfieStatus').textContent,/preservados/);
});
test('erro de geofence renova GPS na próxima confirmação sem repetir foto ou perder a tentativa',async()=>{
 const h=confirmationHarness();h.setApiError(Object.assign(new Error('fora da área'),{code:'clock/location-outside',geoValidated:false}));await h.confirm();
 assert.equal(h.draft.requiresLocationRefresh,true);const photo=h.draft.payload.selfieDataUrl, capturedAt=h.draft.payload.capturedAt;
 await h.confirm();assert.equal(h.calls,2);assert.equal(h.draft,null);assert.ok(h.events.includes('invalidate'));assert.ok(h.events.includes('confirmed'));assert.equal(h.events.filter(e=>e==='persist').length,1);assert.ok(photo);assert.ok(capturedAt);assert.equal(h.payloads[1].selfieDataUrl,photo);assert.equal(h.payloads[1].capturedAt,capturedAt);assert.notEqual(h.payloads[1].latitude,h.payloads[0].latitude);assert.equal(h.gpsOptions[1].fresh,true);
});
test('bridge preserva código e estágio de validação sem copiar dados arbitrários do erro',async()=>{
 const failure={message:'fora',code:'clock/location-outside',geoValidated:false,retryable:false,secret:'do-not-copy'};let fail;
 const runner={withSuccessHandler(){return this;},withFailureHandler(fn){fail=fn;return this;},punch(){fail(failure);}};
 const ctx={waitForPortalApi_:async()=>{},google:{script:{run:runner}},sessionToken:()=>''};const start=source.indexOf('  async function gas(name, ...args)');const code=source.slice(start,source.indexOf('\n  function normalizeResponse',start));vm.runInNewContext(code+'\nthis.call=gas;',ctx);
 await assert.rejects(ctx.call('punch'),error=>error.code===failure.code&&error.geoValidated===false&&error.secret===undefined);
});

test('consultas simultâneas de contas diferentes não compartilham resposta pendente',async()=>{
 const pending=[];const ctx={window:{__GESTAO_FIREBASE__:{runtime:{auth:{currentUser:{uid:'first'}}}}},normalizeResponse:value=>({success:true,data:value}),gas:()=>new Promise(resolve=>pending.push(resolve))};
 const start=source.indexOf('  const pendingCalls = new Map();');const code=source.slice(start,source.indexOf('\n  const arr =',start));vm.runInNewContext(code+'\nthis.call=call;',ctx);
 const first=ctx.call('listarReconhecimentos');ctx.window.__GESTAO_FIREBASE__.runtime.auth.currentUser={uid:'second'};const second=ctx.call('listarReconhecimentos');assert.equal(pending.length,2);pending[0](['first-only']);pending[1](['second-only']);assert.deepEqual(await first,['first-only']);assert.deepEqual(await second,['second-only']);
});
