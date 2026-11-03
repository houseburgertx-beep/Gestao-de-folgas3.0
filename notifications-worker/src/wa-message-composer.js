// All factual clauses are opaque, ordered slots. The model may choose tone and
// spacing, but cannot author facts, instructions, permissions or delivery status.
export const WHATSAPP_COMPOSER_MODEL = 'openai/gpt-oss-120b';
const OPENINGS = ['', 'Olá!', 'Tenho uma atualização para você:', 'Uma atualização sobre seu registro:', 'Passando para te avisar:', 'Confira esta atualização:'];
const CLOSINGS = ['', 'Se precisar de ajuda, estou por aqui.', 'Você pode conferir os detalhes no aplicativo.', 'Posso ajudar a consultar seus registros quando precisar.'];
const MAX_SOURCE = 16000;

export function readableWhatsAppFacts(value) {
  // Protect URLs before formatting dates: changing a date inside a signed URL
  // would break the destination or invalidate its signature.
  return String(value ?? '').split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => {
    if (index % 2) return part;
    return part.replace(/\b(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?\b/g, (match, year, month, day) => {
      const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return match;
      if (!match.includes('T')) return `${day}/${month}/${year}`;
      const instant = new Date(match);
      if (!Number.isFinite(instant.getTime())) return match;
      const dateText = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric' }).format(instant);
      const timeText = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(instant);
      return `${dateText} às ${timeText} (horário da Bahia)`;
    });
  }).join('');
}

export function cleanNotificationFacts(source) {
 let text=readableWhatsAppFacts(source).replace(/^(?:House\s*190|Grupo House\s*190)\s*\r?\n/i,'').trim();
 // These redundant headings repeat the confirmed status already in the body.
 if(/^Folga aprovada\s*\r?\n/i.test(text)&&/foi aprovad[oa]/i.test(text.split(/\r?\n/).slice(1).join(' ')))text=text.replace(/^Folga aprovada\s*\r?\n/i,'');
 if(/^(?:Folga|Pedido) (?:recusad[oa]|rejeitad[oa])\s*\r?\n/i.test(text)&&/foi (?:recusad[oa]|rejeitad[oa])/i.test(text.split(/\r?\n/).slice(1).join(' ')))text=text.replace(/^[^\n]+\r?\n/,'');
 text=text.replace(/Seu pedido de folga para (\d{2}\/\d{2}\/\d{4}) foi aprovado[!.]?/gi,'Sua folga para $1 está aprovada.');
 return text;
}
function messageKind(source) {
 const value=String(source).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/recusad|rejeitad|negad|cancelad/.test(value))return 'retorno_pedido';
 if(/folga.*aprovad|pedido.*aprovad/.test(value))return 'folga_aprovada';
 if(/ponto de entrada|entrada.*registrad/.test(value))return 'entrada';
 if(/retorno.*intervalo/.test(value))return 'retorno';
 if(/intervalo/.test(value))return 'intervalo';
 if(/ponto de saida|saida.*registrad/.test(value))return 'saida';
 return 'aviso';
}
function toneFor(kind) {
 const openings=[...OPENINGS],closings=[...CLOSINGS];
 if(kind==='folga_aprovada'){openings.push('Boa notícia!');closings.push('Se quiser, posso consultar suas próximas folgas.');}
 if(kind==='entrada'){closings.push('Bom turno!','Bom trabalho!');}
 if(kind==='saida'){closings.push('Bom descanso!','Até a próxima jornada.');}
 if(kind==='intervalo'){closings.push('Bom intervalo!','Boa pausa!');}
 if(kind==='retorno'){closings.push('Bom retorno!','Boa continuidade de turno!');}
 return {openings,closings};
}

export function protectWhatsAppFacts(source) {
  const text = cleanNotificationFacts(source);
  const kind=messageKind(source),tone=toneFor(kind);
  const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const facts = text.split(/\r?\n/).filter(line => line.trim()).map((value, index) => ({ token: `[[HFACT_${nonce}_${index}]]`, value }));
  return { text, facts, kind,...tone,template: facts.map(fact => fact.token).join('\n') };
}

export function restoreWhatsAppComposition(candidate, protectedFacts) {
  if (typeof candidate !== 'string' || candidate.length > 22000) return null;
  const { facts,openings=OPENINGS,closings=CLOSINGS } = protectedFacts;
  if(!facts.length)return null;
  const expected = facts.map(fact => fact.token);
  const slots = candidate.match(/\[\[HFACT_[^\]\n]+\]\]/g) || [];
  if (slots.length !== expected.length || slots.some((slot, index) => slot !== expected[index])) return null;
  // Only a known neutral greeting/closing is permitted around the unchanged
  // facts. In particular, "não", "recusado" and new normative advice cannot be
  // added next to an approval or pending notice, even if all slots are present.
  let remainder = candidate;
  for (const token of expected) remainder = remainder.replace(token, '');
  const allowed = openings.some(opening => closings.some(closing =>
    remainder.replace(/\s+/g, ' ').trim() === `${opening} ${closing}`.replace(/\s+/g, ' ').trim()));
  if (!allowed) return null;
  // Decorations may only precede/follow the factual body; never split a fact
  // or become a negating qualifier in the middle of an operational notice.
  const first = candidate.indexOf(expected[0]);
  const lastToken = expected.at(-1);
  const end = candidate.lastIndexOf(lastToken) + lastToken.length;
  if (!openings.includes(candidate.slice(0, first).trim()) || !closings.includes(candidate.slice(end).trim())) return null;
  const middle = candidate.slice(first, end);
  let middleRest = middle;
  for (const token of expected) middleRest = middleRest.replace(token, '');
  if (middleRest.trim()) return null;
  return facts.reduce((message, fact) => message.replace(fact.token, () => fact.value), candidate).trim();
}

export async function composeWhatsAppMessage(env, text, { aiPrepared = false, fetcher = fetch } = {}) {
  const source = aiPrepared||!env.GROQ_API_KEY?String(text??''):cleanNotificationFacts(text);
  const fallback = reason => ({ text: source, composition: { mode: 'fallback', reason } });
  if (aiPrepared) return { text: source, composition: { mode: 'prepared' } };
  if (!env.GROQ_API_KEY) return fallback('no_api_key');
  if (!source.trim() || source.length > MAX_SOURCE) return fallback('source_out_of_bounds');
  const protectedFacts = protectWhatsAppFacts(source);
  try {
    const response = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.GROQ_MODEL || WHATSAPP_COMPOSER_MODEL,
        temperature: 0.65, max_completion_tokens: 700,
        response_format: { type: 'json_object' },
        ...((env.GROQ_MODEL || WHATSAPP_COMPOSER_MODEL).includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
        messages: [
          { role: 'system', content: 'Você cuida da apresentação breve de avisos operacionais no WhatsApp em português brasileiro. Responda somente JSON {"message":"texto"}. O conteúdo factual está protegido em slots opacos: mantenha TODOS exatamente uma vez, na mesma ordem, separados por quebras de linha. Nunca troque, omita, interprete ou escreva dentro de slots. Escolha uma abertura e um fechamento curtos exclusivamente das listas autorizadas enviadas. Ajuste o tom à categoria: entrada, saída, pausa, folga ou aviso. Não use a mesma apresentação como título repetitivo. Prefira ser breve: não acrescente abertura ou fechamento sem necessidade. Sem emojis, títulos adicionais, regras, prazos, permissões, suposições ou afirmações de execução. Nenhum outro texto é autorizado.' },
          { role: 'user', content: JSON.stringify({categoria:protectedFacts.kind,aberturasPermitidas:protectedFacts.openings,fechamentosPermitidos:protectedFacts.closings,texto:protectedFacts.template}) },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return fallback(`provider_http_${response.status}`); }
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || raw.length > 22000) return fallback('invalid_provider_response');
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return fallback('invalid_provider_response'); }
    const composed = restoreWhatsAppComposition(parsed?.message, protectedFacts);
    if (!composed) return fallback('fact_validation_failed');
    return { text: composed, composition: { mode: 'ai', provider: 'groq', model: env.GROQ_MODEL || WHATSAPP_COMPOSER_MODEL } };
  } catch (error) {
    // Never log source text, provider bodies, tokens, API keys or phone numbers.
    return fallback(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'provider_timeout' : 'provider_unavailable');
  }
}
