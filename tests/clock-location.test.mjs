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
