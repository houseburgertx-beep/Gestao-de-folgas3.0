import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveChatDates, calendarContext } from '../src/wa-chat-dates.js';

const now = Date.parse('2026-11-03T15:00:00Z');
test('weekday dates are computed from Bahia calendar, including multiple weekdays', () => {
  assert.deepEqual(resolveChatDates('Quero folga sexta-feira e sábado', now), ['2026-11-06', '2026-11-07']);
  assert.deepEqual(resolveChatDates('sexta feira e SÁBADO e sexta', now), ['2026-11-06', '2026-11-07']);
  assert.deepEqual(resolveChatDates('terça-feira', now), ['2026-11-03']);
  assert.deepEqual(resolveChatDates('próxima terça', now), ['2026-11-10']);
  assert.deepEqual(resolveChatDates('terça que vem', now), ['2026-11-10']);
});
test('next week means the following Monday through Sunday', () => {
  for (const qualifier of ['na próxima semana', 'da semana que vem', 'da semana seguinte']) {
    assert.deepEqual(resolveChatDates(`segunda e sexta-feira ${qualifier}`, now), ['2026-11-09', '2026-11-13']);
  }
  assert.deepEqual(resolveChatDates('sábado e domingo da próxima semana', now), ['2026-11-14', '2026-11-15']);
});
test('relative references respect Bahia midnight and do not double-count after tomorrow', () => {
  const beforeBahiaMidnight = Date.parse('2026-11-04T02:59:59Z');
  assert.deepEqual(resolveChatDates('hoje, amanhã e depois de amanhã', beforeBahiaMidnight), ['2026-11-03', '2026-11-04', '2026-11-05']);
  assert.deepEqual(resolveChatDates('depois de amanhã', now), ['2026-11-05']);
  assert.deepEqual(resolveChatDates('hoje', Date.parse('2026-11-04T03:00:00Z')), ['2026-11-04']);
});
test('month and year boundaries and leap days stay valid', () => {
  assert.deepEqual(resolveChatDates('amanhã e depois de amanhã', Date.parse('2026-12-31T15:00:00Z')), ['2027-01-01', '2027-01-02']);
  assert.deepEqual(resolveChatDates('segunda da próxima semana', Date.parse('2026-12-31T15:00:00Z')), ['2027-01-04']);
  assert.deepEqual(resolveChatDates('amanhã', Date.parse('2028-02-28T15:00:00Z')), ['2028-02-29']);
  assert.deepEqual(resolveChatDates('amanhã', Date.parse('2026-11-30T15:00:00Z')), ['2026-12-01']);
});
test('explicit Brazilian and ISO dates take priority over conflicting weekday wording', () => {
  assert.deepEqual(resolveChatDates('sexta 04/11/2026', now), ['2026-11-04']);
  assert.deepEqual(resolveChatDates('sexta 2026-11-06 e sábado 07/11', now), ['2026-11-06', '2026-11-07']);
  assert.deepEqual(resolveChatDates('2027-01-02 e 1/1/27', now), ['2027-01-01', '2027-01-02']);
  assert.deepEqual(resolveChatDates('06/11 e 06/11/2026', now), ['2026-11-06']);
  assert.deepEqual(resolveChatDates('29/02/2028', now), ['2028-02-29']);
});
test('invalid dates and standalone numbers are never silently inferred', () => {
  for (const text of ['31/02/2026', '29/02/2026', '2026-13-01', '2026-02-30', '00/11', '06/00/26', 'sexta 31/02', 'sexta 01/02/20260', 'sexta 1/2/3', 'dias 4 e 5', 'às 18:00', 'tenho 5 folgas', 'sim', '', null]) {
    assert.equal(resolveChatDates(text, now), null, String(text));
  }
  assert.equal(resolveChatDates('amanhã', NaN), null);
  assert.equal(calendarContext(NaN), '');
});
test('calendar context lists fourteen real consecutive weekdays without Friday/Saturday drift', () => {
  const lines = calendarContext(now).split('\n');
  assert.equal(lines.length, 14);
  assert.equal(lines[0], 'terça-feira, 03/11/2026 (2026-11-03)');
  assert.equal(lines[3], 'sexta-feira, 06/11/2026 (2026-11-06)');
  assert.equal(lines[4], 'sábado, 07/11/2026 (2026-11-07)');
  assert.equal(lines[13], 'segunda-feira, 16/11/2026 (2026-11-16)');
});

 test('replacement clauses discard the superseded weekday instead of requesting both', () => {
  for (const text of ['Em vez de sexta, quero sábado', 'não sexta, sábado', 'troca de sexta para sábado', 'na verdade sábado', 'sexta. Na verdade, sábado', 'Troque a folga de sexta por sábado']) {
    assert.deepEqual(resolveChatDates(text, now), ['2026-11-07'], text);
  }
  assert.deepEqual(resolveChatDates('em vez de sexta e sábado, quero domingo', now), ['2026-11-08']);
  assert.deepEqual(resolveChatDates('em vez de sexta, quero sábado e domingo', now), ['2026-11-07', '2026-11-08']);
  assert.equal(resolveChatDates('em vez de sexta, quero dia 7', now), null);
});
