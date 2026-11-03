import { bahiaDay, shiftDate } from '../../src/core/reminder-policy.js';

const dayNames = new Map([
  ['domingo', 0], ['segunda', 1], ['terca', 2], ['quarta', 3],
  ['quinta', 4], ['sexta', 5], ['sabado', 6],
]);
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const uniqueSorted = dates => [...new Set(dates)].sort();
function correctedDateText(value) {
  // Only the replacement clause is authoritative when a person corrects a
  // previous choice. Never keep the old weekday as a second requested date.
  const corrections = [
    /\bna\s+verdade\s*[,;:]?\s*([\s\S]+)$/,
    /\bem\s+vez\s+de\b[\s\S]*?(?:[,;]\s*|\b(?:quero|prefiro|por|para)\s+)([\s\S]+)$/,
    /\b(?:troca|troque|trocar|muda|mude|mudar)\s+(?:(?:a\s+)?folga\s+)?(?:de\s+)?[^,;.!?]+?\s+(?:para|pra|por)\s+([\s\S]+)$/,
    /\bnao\s+(?:na\s+|no\s+)?(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[-\s]+feira)?\s*[,;]\s*([\s\S]+)$/,
  ];
  for (const pattern of corrections) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return value;
}

function dayFor(now) {
  const timestamp = Number(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return null;
  try { return bahiaDay(timestamp); } catch { return null; }
}
function validIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

// Explicit dates win over weekday/relative wording. Missing Brazilian years use
// the current Bahia year; we never infer dates from standalone day numbers.
export function resolveChatDates(text, now = Date.now()) {
  if (typeof text !== 'string') return null;
  const today = dayFor(now);
  if (!today) return null;
  const value = correctedDateText(normalize(text));
  const explicit = [];
  for (const match of value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    if (!validIso(match[0])) return null;
    explicit.push(match[0]);
  }
  for (const candidate of value.matchAll(/\b\d+\/\d+(?:\/\d+)?\b/g)) {
    const match = candidate[0].match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?$/);
    if (!match) return null;
    const year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : today.slice(0, 4);
    const date = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    if (!validIso(date)) return null;
    explicit.push(date);
  }
  if (explicit.length) return uniqueSorted(explicit);

  const dates = [];
  // Remove the complete phrase before looking for 'amanhã' on its own.
  const remaining = value.replace(/\bdepois\s+de\s+amanha\b/g, () => {
    dates.push(shiftDate(today, 2));
    return ' ';
  });
  if (/\bamanha\b/.test(remaining)) dates.push(shiftDate(today, 1));
  if (/\bhoje\b/.test(remaining)) dates.push(today);

  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const nextWeek = /\b(?:proxima\s+semana|semana\s+que\s+vem|semana\s+seguinte)\b/.test(value);
  const nextMonday = nextWeek ? shiftDate(today, 7 - ((weekday + 6) % 7)) : null;
  for (const match of remaining.matchAll(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[-\s]+feira)?\b/g)) {
    const target = dayNames.get(match[1]);
    if (nextWeek) {
      dates.push(shiftDate(nextMonday, (target + 6) % 7));
    } else {
      let delta = (target - weekday + 7) % 7;
      // 'Próxima sexta' / 'sexta que vem' means a future occurrence when today
      // itself is Friday. Unqualified 'sexta' can explicitly mean today.
      const prefix = remaining.slice(0, match.index);
      const suffix = remaining.slice(match.index + match[0].length);
      if (!delta && (/\bproxim[oa]\s*$/.test(prefix) || /^\s+que\s+vem\b/.test(suffix))) delta = 7;
      dates.push(shiftDate(today, delta));
    }
  }
  return dates.length ? uniqueSorted(dates) : null;
}

export function calendarContext(now = Date.now()) {
  const today = dayFor(now);
  if (!today) return '';
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });
  return Array.from({ length: 14 }, (_, offset) => {
    const date = shiftDate(today, offset);
    return `${weekday.format(new Date(`${date}T12:00:00Z`))}, ${date.split('-').reverse().join('/')} (${date})`;
  }).join('\n');
}
