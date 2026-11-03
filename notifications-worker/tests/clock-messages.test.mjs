import assert from "node:assert/strict";
import test from "node:test";
import { generateMotivationalTimeClockMessage } from "../src/house-ai.js";

const labels = {
  ENTRADA: "ENTRADA",
  SAIDA: "SAÍDA",
  SAIDA_INTERVALO: "SAÍDA PARA INTERVALO",
  RETORNO_INTERVALO: "RETORNO DO INTERVALO",
};

for (const [type, label] of Object.entries(labels)) {
  test(`ponto ${type} oferece oito textos distintos sem alterar nome, horário ou ação`, () => {
    const texts = Array.from({ length: 8 }, (_, index) => generateMotivationalTimeClockMessage({
      type, employeeName: "  Ana Claudia  ", timeStr: "00:20", rng: () => (index + 0.5) / 8,
    }));
    assert.equal(new Set(texts).size, 8);
    for (const text of texts) {
      assert.ok(text.startsWith(`Olá, Ana! Ponto de ${label} registrado às 00:20.`));
      assert.doesNotMatch(text, /Claudia|\p{Extended_Pictographic}|\b(parabéns|pontual|atrasad|produtividade|excelente desempenho)\b/iu);
      assert.ok(text.length < 300);
    }
  });

  test(`ponto ${type} evita repetir o último texto quando fornecido pelo chamador`, () => {
    const options = { type, employeeName: "Ana", timeStr: "08:15", rng: () => 0 };
    const previousMessage = generateMotivationalTimeClockMessage(options);
    const next = generateMotivationalTimeClockMessage({ ...options, previousMessage });
    assert.notEqual(next, previousMessage);
    assert.ok(next.includes("08:15"));
    assert.ok(next.includes(label));
  });
}

test("ID da marcação preserva mensagem em reenvios independentemente do sorteio", () => {
  const args = { type: "ENTRADA", employeeName: "João Silva", timeStr: "16:00", recordId: "clock-record-001" };
  const first = generateMotivationalTimeClockMessage({ ...args, rng: () => { throw new Error("Não deve sortear novamente"); } });
  const repeated = generateMotivationalTimeClockMessage({ ...args, rng: () => 0.999 });
  assert.equal(first, repeated);
  const messages = new Set(Array.from({ length: 40 }, (_, id) => generateMotivationalTimeClockMessage({ ...args, recordId: `clock-record-${id}` })));
  assert.ok(messages.size > 1);
});

test("sorteios nos limites e fora do intervalo sempre produzem texto válido", () => {
  for (const sample of [0, 1, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const text = generateMotivationalTimeClockMessage({ type: "SAIDA", employeeName: " ", timeStr: "23:59", rng: () => sample });
    assert.ok(text.startsWith("Olá, Colaborador! Ponto de SAÍDA registrado às 23:59."));
    assert.doesNotMatch(text, /undefined/);
  }
  assert.equal(generateMotivationalTimeClockMessage({ type: "DESCONHECIDO" }), "");
  assert.equal(generateMotivationalTimeClockMessage({ type: "__proto__" }), "");
});

test("horário ausente usa Bahia e chamada antiga continua aceitando apenas os três campos", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-04T02:20:00Z") });
  const text = generateMotivationalTimeClockMessage({ type: "ENTRADA", employeeName: "João Silva" });
  assert.ok(text.includes("João"));
  assert.ok(text.includes("23:20"));
  const legacy = generateMotivationalTimeClockMessage({ type: "RETORNO_INTERVALO", employeeName: "João", timeStr: "11:00" });
  assert.ok(legacy.includes("11:00"));
});
