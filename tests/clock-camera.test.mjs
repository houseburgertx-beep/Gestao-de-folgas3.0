import test from "node:test";
import assert from "node:assert/strict";
import { acquireClockCamera } from "../src/core/clock-camera.js";
test("câmera tardia é desligada após timeout", async () => {
  let release;
  let stopped = 0;
  const camera = acquireClockCamera({ getUserMedia: () => new Promise((resolve) => { release = resolve; }) }, {}, { timeout: 5 });
  await assert.rejects(camera, /CAMERA_TIMEOUT/);
  release({ getTracks: () => [{ stop: () => stopped++ }] });
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(stopped, 1);
});
test("fechar diálogo durante permissão não deixa câmera oculta ativa", async () => {
  let stopped = 0;
  await assert.rejects(acquireClockCamera({ getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) }, {}, { isCurrent: () => false }), { name: "AbortError" });
  assert.equal(stopped, 1);
});
