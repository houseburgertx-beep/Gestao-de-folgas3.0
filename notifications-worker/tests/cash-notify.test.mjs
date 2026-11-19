import test from "node:test";
import assert from "node:assert/strict";
import webpush from "web-push";
import worker from "../src/index.js";

const vapidKeys = webpush.generateVAPIDKeys();

const env = {
  APP_ORIGIN: "https://houseburgertx-beep.github.io",
  WA_SERVICE_TOKEN: "valid-secret-token-190",
  WA_ENABLED: "false",
  FIREBASE_WEB_API_KEY: "fake-web-api-key",
  FIREBASE_CLIENT_EMAIL: "test@example.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7\n-----END PRIVATE KEY-----\n",
  FIREBASE_DATABASE_URL: "https://test.firebaseio.com",
  FIREBASE_ROOT: "gestao-folgas/v2",
  VAPID_PUBLIC_KEY: vapidKeys.publicKey,
  VAPID_PRIVATE_KEY: vapidKeys.privateKey,
  DB: {
    prepare: () => ({
      bind: () => ({
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
  },
};

test("/cash-notify rejeita método diferente de POST com 405", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "GET",
      headers: { Origin: "https://houseburgertx-beep.github.io" },
    }),
    env
  );
  assert.equal(res.status, 405);
});

test("/cash-notify rejeita requisição sem X-Service-Token com 401", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "POST",
      headers: {
        Origin: "https://houseburgertx-beep.github.io",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventKind: "cash_closing",
        unitId: "teixeira",
      }),
    }),
    env
  );
  assert.equal(res.status, 401);
});

test("/cash-notify rejeita X-Service-Token incorreto com 401", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "POST",
      headers: {
        Origin: "https://houseburgertx-beep.github.io",
        "Content-Type": "application/json",
        "X-Service-Token": "token-falso-invalido",
      },
      body: JSON.stringify({
        eventKind: "cash_closing",
        unitId: "teixeira",
      }),
    }),
    env
  );
  assert.equal(res.status, 401);
});

test("/cash-notify rejeita payload incompleto com 400", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "POST",
      headers: {
        Origin: "https://houseburgertx-beep.github.io",
        "Content-Type": "application/json",
        "X-Service-Token": "valid-secret-token-190",
      },
      body: JSON.stringify({
        eventKind: "cash_closing",
      }),
    }),
    env
  );
  assert.equal(res.status, 400);
});

test("/cash-notify rejeita tipo de evento desconhecido com 400", async () => {
  const res = await worker.fetch(
    new Request("https://worker/cash-notify", {
      method: "POST",
      headers: {
        Origin: "https://houseburgertx-beep.github.io",
        "Content-Type": "application/json",
        "X-Service-Token": "valid-secret-token-190",
      },
      body: JSON.stringify({
        eventKind: "evento_desconhecido",
        unitId: "teixeira",
      }),
    }),
    env
  );
  assert.equal(res.status, 400);
});
