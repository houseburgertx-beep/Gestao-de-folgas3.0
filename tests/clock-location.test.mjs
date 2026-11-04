import test from "node:test";
import assert from "node:assert/strict";
import { createClockLocationReader } from "../src/core/clock-location.js";
const position = (accuracy = 10, timestamp = Date.now()) => ({ timestamp, coords: { latitude: -17.5, longitude: -39.7, accuracy } });
test("GPS compartilha leitura, aguarda precisão e encerra monitor ao concluir", async () => {
  let success;
  let watches = 0;
  const stopped = [];
  const reader = createClockLocationReader({ watchPosition: (onPosition) => { watches++; success = onPosition; return 7; }, clearWatch: (id) => stopped.push(id), getCurrentPosition: () => {} }, { timeout: 50 });
  const a = reader(), b = reader();
  assert.equal(a, b);
  success(position(500));
  success(position(15));
  assert.equal((await a).coords.accuracy, 15);
  assert.equal((await b).coords.accuracy, 15);
  assert.equal(watches, 1);
  assert.deepEqual(stopped, [7]);
  await reader();
  assert.equal(watches, 1);
});
test("GPS não aceita posição antiga e encerra com erro sem coordenadas falsas", async () => {
  const reader = createClockLocationReader({ watchPosition: (success) => { success(position(10, Date.now() - 600000)); return 1; }, clearWatch: () => {}, getCurrentPosition: () => {} }, { timeout: 8, fallbackDelay: 2 });
  await assert.rejects(reader(), /localização precisa/);
});
test("negação de permissão é final e não usa cache ou fallback de rede", async () => {
  let fallbacks = 0;
  const reader = createClockLocationReader({ watchPosition: (_ok, fail) => { fail({ code: 1 }); return 1; }, clearWatch: () => {}, getCurrentPosition: () => { fallbacks++; } });
  await assert.rejects(reader(), (error) => error.code === 1);
  assert.equal(fallbacks, 0);
});
test("fallback de rede melhora uma primeira leitura imprecisa", async () => {
  const reader = createClockLocationReader({ watchPosition: (success) => { success(position(320)); return 1; }, clearWatch: () => {}, getCurrentPosition: (success) => success(position(35)) }, { timeout: 50, fallbackDelay: 2 });
  assert.equal((await reader()).coords.accuracy, 35);
});

test('GPS permission granted contradiz erro1: tenta leitura direta e recupera coordenadas',async()=>{
 let direct=0;
 const reader=createClockLocationReader({watchPosition:(_ok,fail)=>{fail({code:1});return 9;},clearWatch(){},getCurrentPosition:ok=>{direct++;ok(position(20));}},{permissions:{query:async()=>({state:'granted'})},timeout:100,fallbackDelay:50});
 assert.equal((await reader()).coords.accuracy,20);assert.equal(direct,1);
});
test('permissão granted com serviço do aparelho bloqueado distingue motivo e não inventa coordenadas',async()=>{
 let direct=0;
 const reader=createClockLocationReader({watchPosition:(_ok,fail)=>{fail({code:1});return 9;},clearWatch(){},getCurrentPosition:(_ok,fail)=>{direct++;fail({code:1});}},{permissions:{query:async()=>({state:'granted'})},timeout:100});
 await assert.rejects(reader(),e=>e.code===1&&e.locationReason==='device');assert.equal(direct,1);
});
test('contexto bloqueado é informado antes de chamar o GPS',async()=>{
 let called=0;const reader=createClockLocationReader({getCurrentPosition(){called++;}},{allowedByPolicy:()=>false});
 await assert.rejects(reader(),e=>e.locationReason==='policy');assert.equal(called,0);
});
test('rejeição de geofence pode invalidar o cache e receber uma nova posição',async()=>{
 let calls=0;const reader=createClockLocationReader({getCurrentPosition:ok=>{calls++;ok(position(calls===1?10:15));}},{timeout:100});
 assert.equal((await reader()).coords.accuracy,10);reader.invalidate();assert.equal((await reader({fresh:true})).coords.accuracy,15);assert.equal(calls,2);
});
test('posição moderada não aguarda o prazo completo; coarse só retorna ao fim para validação de área',async()=>{
 const moderate=createClockLocationReader({getCurrentPosition:ok=>ok(position(150))},{settleDelay:5,timeout:100,fallbackDelay:80});assert.equal((await moderate()).coords.accuracy,150);
 const coarse=createClockLocationReader({getCurrentPosition:ok=>ok(position(1000))},{settleDelay:1,timeout:8,fallbackDelay:5});assert.equal((await coarse()).coords.accuracy,1000);
});
