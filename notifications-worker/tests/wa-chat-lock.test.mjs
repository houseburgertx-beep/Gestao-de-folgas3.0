import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {withChatLease} from '../src/wa-chat-lock.js';
function db(){const database=new DatabaseSync(':memory:');database.exec(readFileSync(new URL('../migrations/0001_push.sql',import.meta.url),'utf8'));return {prepare:sql=>({bind:(...args)=>({run:async()=>({meta:{changes:Number(database.prepare(sql).run(...args).changes)}})})})};}
test('duas mensagens do mesmo chat são processadas em sequência',async()=>{
 const env={DB:db()};const events=[];
 const first=withChatLease(env,'chat',async()=>{events.push('first-start');await new Promise(r=>setTimeout(r,30));events.push('first-end');});
 const second=withChatLease(env,'chat',async()=>{events.push('second');});
 await Promise.all([first,second]);assert.deepEqual(events,['first-start','first-end','second']);
});
test('mensagem ocupada ou falha de lock nunca executa operação paralela',async()=>{
 let writes=0;const locked={DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:0}})})})}};
 const result=await withChatLease(locked,'chat',async()=>{writes++;},{waitMs:0});assert.equal(result.action,'chat_busy');assert.equal(writes,0);
 const failed=await withChatLease({DB:{prepare:()=>{throw Error('offline');}}},'chat',async()=>{writes++;});assert.equal(failed.action,'chat_lock_unavailable');assert.equal(writes,0);
});
