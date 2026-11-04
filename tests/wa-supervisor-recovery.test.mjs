import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../scripts/wa-service-manager.mjs',import.meta.url),'utf8');
const sync=source.slice(source.indexOf('export async function syncConfig'),source.indexOf('\nlet tunnelChild')).replace('export ','');
const health=source.slice(source.indexOf('async function checkTunnelHealth'),source.indexOf('\nexport async function startSupervisor'));
function supervisor(){
 let healthy=false,restarts=0;
 const ctx={URL,AbortSignal,log:()=>{},fetch:async url=>{
  if(String(url).startsWith('https://tunnel.example.test')){if(!healthy)throw Error('DNS unavailable');return {ok:true};}
  if(String(url).startsWith('http://127.0.0.1'))return {ok:true,json:async()=>({data:{status:'CONNECTED'}})};
  return {ok:true};
 },runTunnel:()=>{restarts++;}};
 vm.createContext(ctx);vm.runInContext(`const DEFAULT_GATEWAY_URL='https://tunnel.example.test/api',INSTANCE='house190',API_KEY='test-key',SERVICE_TOKEN='test-service',WORKER_URL='https://worker.example.test';let activeTunnelUrl=null,tunnelFailures=0;${sync}\n${health}\nthis.sync=syncConfig;this.check=checkTunnelHealth;`,ctx);
 return {sync:()=>ctx.sync(),check:()=>ctx.check(),setHealthy:value=>{healthy=value;},get restarts(){return restarts;}};
}
test('duas falhas públicas reiniciam túnel mesmo com sincronização local bem-sucedida',async()=>{
 const s=supervisor();await s.sync();await s.check();await s.sync();await s.check();assert.equal(s.restarts,1);
});
test('resposta pública saudável interrompe a sequência de falhas',async()=>{
 const s=supervisor();await s.sync();await s.check();s.setHealthy(true);await s.check();s.setHealthy(false);await s.check();assert.equal(s.restarts,0);await s.sync();await s.check();assert.equal(s.restarts,1);
});
const recoverySource=source.slice(source.indexOf('export function sessionRecoveryAction'),source.indexOf('\nasync function startSessionIfStopped')).replace('export ','');
const recoveryContext=vm.createContext({});
vm.runInContext(`${recoverySource};this.action=sessionRecoveryAction;`,recoveryContext);
test('supervisor não disputa reconexão nativa nem reinicia sessão aguardando QR',()=>{
 const action=recoveryContext.action;
 assert.equal(action({status:'DISCONNECTED',hasInstance:true},60000),null);
 assert.equal(action({status:'DISCONNECTED',hasInstance:true},299999),null);
 assert.equal(action({status:'DISCONNECTED',hasInstance:true},300000),'restart');
 for(const status of ['SCAN_QR','LOGGED_OUT','CONNECTED','WORKING'])assert.equal(action({status,hasInstance:true},900000),null);
 assert.equal(action({status:'STOPPED',hasInstance:false},0),'start');
});
