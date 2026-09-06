import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import webpush from "web-push";
import worker, { validSubscription, boundedJson, tick } from "../src/index.js";
import { createECDH } from "node:crypto";
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const sub = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: Buffer.alloc(16, 1).toString("base64url"),
  },
};
test("valida destino push e bloqueia endpoints arbitrários e internos", () => {
  assert.equal(validSubscription(sub), true);
  for (const endpoint of [
    "http://localhost/a",
    "https://evil.com/x",
    "https://fcm.googleapis.com.evil.com/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
  ])
    assert.equal(validSubscription({ ...sub, endpoint }), false);
  assert.equal(validSubscription({ ...sub, keys: {} }), false);
});
test("não aceita solicitação de outra origem nem sem configuração", async () => {
  assert.equal(
    (
      await worker.fetch(
        new Request("https://worker/subscribe", {
          method: "POST",
          headers: { Origin: "https://evil.com" },
        }),
        { APP_ORIGIN: "https://house.test" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request("https://worker/subscribe", {
          method: "POST",
          headers: { Origin: "https://house.test" },
        }),
        { APP_ORIGIN: "https://house.test" },
      )
    ).status,
    503,
  );
});
test("limita tamanho das respostas e rejeita falhas upstream", async () => {
  await assert.rejects(
    boundedJson(new Response("123456"), 3),
    /response_too_large/,
  );
  await assert.rejects(
    boundedJson(new Response("{}", { status: 403 })),
    /upstream_403/,
  );
});
test("gera payload Web Push criptografado aceito pelo transporte fetch", () => {
  const keys = webpush.generateVAPIDKeys();
  const result = webpush.generateRequestDetails(
    sub,
    JSON.stringify({ body: "Faltam 5 minutos" }),
    {
      vapidDetails: {
        subject: "https://house.test",
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      },
    },
  );
  assert.equal(result.headers["Content-Encoding"], "aes128gcm");
  assert.ok(result.body.byteLength > 0);
  assert.ok(result.headers.Authorization.startsWith("vapid "));
});
function dbAdapter() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_push.sql", import.meta.url),
      "utf8",
    ),
  );
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => statement.get(...args),
            all: async () => ({ results: statement.all(...args) }),
            run: async () => ({
              meta: { changes: statement.run(...args).changes },
            }),
          };
        },
      };
    },
    batch: async (statements) => Promise.all(statements.map((s) => s.run())),
    db,
  };
}
test("ledger impede duplicação e só permite repetir tentativa após a janela", async () => {
  const { db } = dbAdapter();
  const stmt = db.prepare(
    "INSERT INTO deliveries(event_key,endpoint,state,lease_until,expires_at) VALUES(?,?,'sending',?,?) ON CONFLICT(event_key,endpoint) DO UPDATE SET state='sending',lease_until=excluded.lease_until WHERE deliveries.state!='sent' AND deliveries.lease_until<?",
  );
  assert.equal(stmt.run("e", "p", 200, 500, 100).changes, 1);
  assert.equal(stmt.run("e", "p", 220, 500, 110).changes, 0);
  assert.equal(stmt.run("e", "p", 400, 500, 201).changes, 1);
  db.exec("UPDATE deliveries SET state='sent'");
  assert.equal(stmt.run("e", "p", 600, 800, 501).changes, 0);
});
test("o agendador fica inativo sem dispositivos cadastrados", async () => {
  const DB = dbAdapter();
  await tick({
    DB,
    FIREBASE_WEB_API_KEY: "x",
    FIREBASE_CLIENT_EMAIL: "x",
    FIREBASE_PRIVATE_KEY: "x",
    VAPID_PUBLIC_KEY: "x",
    VAPID_PRIVATE_KEY: "x",
  });
});

test("agendador envia uma vez, não vaza para outra conta e cancela após retorno", async () => {
  const DB = dbAdapter(),
    now = Date.parse("2026-09-06T18:58:00-03:00");
  DB.db
    .prepare("INSERT INTO devices VALUES(?,?,?,?,?,?,?)")
    .run(
      sub.endpoint,
      "u1",
      JSON.stringify(sub),
      JSON.stringify({ clock: true, interval: true, notices: false }),
      now - 60000,
      now,
      0,
    );
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const privateKey = Buffer.from(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  ).toString("base64");
  const vapid = webpush.generateVAPIDKeys();
  const env = {
    DB,
    FIREBASE_WEB_API_KEY: "key",
    FIREBASE_CLIENT_EMAIL: "test@example.test",
    FIREBASE_PRIVATE_KEY: privateKey,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "https://house.test",
    FIREBASE_DATABASE_URL: "https://fixture.test",
    FIREBASE_ROOT: "root",
  };
  let pushes = 0;
  const tables = {
    Funcionarios: { f: { FuncionarioID: "f1", LojaID: "l1", Ativo: true } },
    JornadasPonto: {
      j: {
        FuncionarioID: "f1",
        Ativa: true,
        HoraEntrada: "16:00",
        HoraSaida: "23:00",
        DuracaoIntervaloMinutos: 60,
      },
    },
    Folgas: {},
    RegistrosPonto: {
      r: {
        FuncionarioID: "f1",
        Data: "2026-09-06",
        TipoMarcacao: "SAIDA_INTERVALO",
        DataHora: "2026-09-06T18:03:00-03:00",
        RegistroPontoID: "r",
      },
    },
    Notificacoes: {},
  };
  let profile = { u1: { FuncionarioID: "f1", LojaID: "l1", Ativo: true } };
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "fixture" });
    if (url.hostname === "fcm.googleapis.com") {
      pushes++;
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith("/access.json")) return Response.json(profile);
    const table = url.pathname.split("/").at(-1).replace(".json", "");
    return Response.json(tables[table] || {});
  };
  try {
    await tick(env, now);
    await tick(env, now + 60000);
    assert.equal(pushes, 1);
    tables.RegistrosPonto.ret = {
      ...tables.RegistrosPonto.r,
      RegistroPontoID: "ret",
      TipoMarcacao: "RETORNO_INTERVALO",
      DataHora: "2026-09-06T19:00:00-03:00",
    };
    await tick(env, now + 5 * 60000);
    assert.equal(pushes, 1);
    delete tables.RegistrosPonto.ret;
    profile.u1.Ativo = false;
    await tick(env, now + 5 * 60000);
    assert.equal(pushes, 1);
  } finally {
    globalThis.fetch = original;
  }
});
