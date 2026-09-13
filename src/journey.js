import {scheduleForDay, workday, active, shiftDate} from "./core/reminder-policy.js";
// Presentation only: all clock mutations stay in the existing validated flow.
const $ = (s) => document.querySelector(s);
const list = (x) => Array.isArray(x) ? x : [];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = (d = new Date()) => new Date(d).toLocaleTimeString('pt-BR',{timeZone:'America/Bahia',hour:'2-digit',minute:'2-digit'});
const dateKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
let teamLayout = 'quadro';
let data = {}, unit = '', teamFilter = 'todos', search = '', mode = 'dia', anchor = dateKey();
const names = {trabalhando:'Trabalhando',intervalo:'Em intervalo',ausente:'Sem entrada',folga:'Folga',concluido:'Encerrado'};
const colors = {trabalhando:'#71cbb0',intervalo:'#ecd47c',ausente:'#eea69e',folga:'#c7b4eb',concluido:'#9bbce5'};
const storeId = s => String(s.LojaID || s.lojaId || '').trim();
const storeName = s => String(s.NomeLoja || s.nomeLoja || s.Nome || s.nome || '').trim();
function stores() {
 const unique = new Map();
 for (const s of list(data.stores)) {
  const id = storeId(s);
  if (id && (!unique.has(id) || !storeName(unique.get(id)))) unique.set(id,s);
 }
 return [...unique.values()];
}
function personUnit(p) { return String(p.NomeLoja || '').trim() || storeName(stores().find(s=>storeId(s)===String(p.LojaID)) || {}) || 'Unidade não informada'; }
function uniquePeople(people) {
 const seen=new Set();
 return people.filter(p=>{const id=String(p.FuncionarioID || p.funcionarioId || '');if(!id)return true;if(seen.has(id))return false;seen.add(id);return true;});
}
function rows() { return data.manager ? uniquePeople(list(data.presence?.presence)).filter(p => !unit || String(p.LojaID) === unit) : []; }
function delay(p) {
 const expected=String(p.horarioEscala || '').match(/(\d{2}):(\d{2})/), actual=String(p.entryTime || '').match(/^(\d{2}):(\d{2})/);
 if(!expected || !actual) return 0;
 const difference=(Number(actual[1])*60+Number(actual[2]))-(Number(expected[1])*60+Number(expected[2]));
 return Math.max(0, difference>720?difference-1440:difference < -720?difference+1440:difference);
}
function avatar(p) { return `<span class="j-avatar" style="--avatar:${colors[p.status] || '#c7b4eb'}">${esc((p.Nome || '?').split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join(''))}</span>`; }
function person(p) {
 const status=names[p.status] || p.statusLabel || 'Sem informação';
 const detail=p.status==='intervalo' ? `Intervalo desde ${p.lastPunchTime || '—'}${p.breakReturnTime ? ' · Retorno '+p.breakReturnTime : ''}` : p.entryTime ? [`Entrada ${p.entryTime}`,p.elapsedTexto && `${p.elapsedTexto} trabalhados`].filter(Boolean).join(' · ') : p.statusLabel !== status ? p.statusLabel : '';
 const metadata=[String(p.Cargo || '').trim(),personUnit(p)].filter(Boolean).filter((v,i,a)=>a.findIndex(x=>x.toLocaleLowerCase('pt-BR')===v.toLocaleLowerCase('pt-BR'))===i);
 return `<article class="j-person">${avatar(p)}<div><strong>${esc(p.Nome || 'Colaborador')}</strong><small>${metadata.map(esc).join(' · ')}</small>${detail?`<span>${esc(detail)}</span>`:''}</div><span class="j-status" style="--status:${colors[p.status] || '#c7b4eb'}">${esc(status)}</span></article>`;
}
function unitSelect() { return data.manager ? `<label class="j-unit"><span>Unidade</span><select data-j-unit aria-label="Selecionar unidade"><option value="">Todas as unidades</option>${stores().map(s=>`<option value="${esc(storeId(s))}" ${storeId(s)===unit?'selected':''}>${esc(storeName(s) || 'Unidade sem nome')}</option>`).join('')}</select></label>` : ''; }
const ownId = () => String(data.user?.funcionarioId || data.user?.FuncionarioID || '');
const dateLabel = day => day ? new Date(day.slice(0,10)+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'America/Bahia',day:'2-digit',month:'short'}) : 'Data não informada';
const norm = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const scoped = items => list(items).filter(x => data.manager ? (!unit || String(x.LojaID || list(data.employees).find(p=>String(p.FuncionarioID)===String(x.FuncionarioID))?.LojaID || '') === unit) : String(x.FuncionarioID) === ownId());
const approved = x => ['aprovada','concluida'].includes(norm(x.Status));
function emptyState(text, detail='') { return `<div class="w-empty"><span aria-hidden="true">◇</span><strong>${esc(text)}</strong>${detail?`<p>${esc(detail)}</p>`:''}</div>`; }
function leaveItems(items, manager=false) {
 return items.map(x=>`<div class="w-request"><div class="w-date"><strong>${esc(dateLabel(x.DataInicio))}</strong><small>${x.DataFim && x.DataFim!==x.DataInicio?'até '+esc(dateLabel(x.DataFim)):esc(manager?x.TipoFolga || 'Folga':'Solicitação')}</small></div><div><strong>${esc(manager?x.NomeFuncionario || 'Colaborador':x.TipoFolga || 'Folga solicitada')}</strong><small>${esc(manager?x.NomeLoja || '':x.Motivo || 'Acompanhe a decisão da gestão')}</small></div><span class="w-badge ${approved(x)?'ok':'wait'}">${esc(x.Status || 'Pendente')}</span></div>`).join('');
}
function managerCommand() {
 const r=rows(), late=r.filter(p=>delay(p)>0).length, missing=r.filter(p=>p.status==='ausente').length;
 const requests=unit ? scoped(data.timeOff).filter(x=>norm(x.Status)==='pendente').length : Number(data.pendingCounts?.total || 0), incomplete=scoped(data.incompletePunches || data.pending).length;
 const latePeople=r.filter(p=>delay(p)>0).sort((a,b)=>delay(b)-delay(a));
 const missingPeople=r.filter(p=>p.status==='ausente');
 const priority=[
  {count:requests,label:requests===1?'solicitação aguardando decisão':'solicitações aguardando decisão',detail:unit?'Pedidos de folga nesta unidade':[data.pendingCounts?.timeOff&&`${data.pendingCounts.timeOff} ${data.pendingCounts.timeOff===1?'folga':'folgas'}`,data.pendingCounts?.clock&&`${data.pendingCounts.clock} ${data.pendingCounts.clock===1?'ponto':'pontos'}`,data.pendingCounts?.swaps&&`${data.pendingCounts.swaps} ${data.pendingCounts.swaps===1?'troca':'trocas'}`].filter(Boolean).join(' · '),view:'pending-center',pendingFilter:'all',action:'Revisar'},
  {count:incomplete,label:incomplete===1?'ponto incompleto':'pontos incompletos',detail:'Marcações anteriores para conferir',view:'pending-center',pendingFilter:'clock',action:'Corrigir ponto'},
  {count:late,label:late===1?'entrada atrasada':'entradas atrasadas',detail:latePeople.slice(0,2).map(p=>`${p.Nome} · ${delay(p)} min após`).join(' / '),view:'live-team',teamFilter:'atrasados',action:'Ver equipe'},
  {count:missing,label:missing===1?'pessoa ainda sem entrada':'pessoas ainda sem entrada',detail:missingPeople.slice(0,3).map(p=>p.Nome).join(', '),view:'live-team',teamFilter:'ausente',action:'Conferir'},
 ].filter(item=>item.count>0);
 const currentDate=new Date().toLocaleDateString('pt-BR',{timeZone:'America/Bahia',weekday:'long',day:'2-digit',month:'long'});
 return `<section class="j-command"><div class="j-command-head"><div><span class="eyebrow">GRUPO HOUSE 190 / OPERAÇÃO</span><h2>O que precisa da sua decisão</h2><p>${esc(currentDate)}</p></div>${unitSelect()}</div><div class="j-priority-list">${priority.map(item=>`<button data-view-target="${item.view}"${item.pendingFilter?` data-pending-filter-target="${item.pendingFilter}"`:''}${item.teamFilter?` data-jump-team="${item.teamFilter}"`:''}><strong>${item.count}</strong><span>${esc(item.label)}</span>${item.detail?`<small>${esc(item.detail)}</small>`:''}<b>${item.action} →</b></button>`).join('') || '<div class="j-all-clear"><span>✓</span><div><strong>Nenhuma pendência crítica agora</strong><small>A equipe está dentro do previsto para esta seleção.</small></div></div>'}</div><div class="j-command-actions"><button class="btn btn-secondary" data-view-target="calendar">Abrir calendário</button><button class="btn btn-primary" data-view-target="scheduler">Planejar próximas folgas</button></div></section>`;
}

function operation() {
 const r=rows(), present=r.filter(p=>['trabalhando','intervalo'].includes(p.status));
 const alerts=r.filter(p=>p.alertMessage || delay(p)>0 || p.status==='ausente');
 const missing=scoped(data.pending), requests=scoped(data.timeOff).filter(x=>norm(x.Status)==='pendente');
 const ready=!!data.presence, pct=r.length?Math.round(present.length/r.length*100):0;
 const upcoming=scoped(data.timeOff).filter(x=>approved(x)&&String(x.DataFim || x.DataInicio)>=dateKey()).sort((a,b)=>String(a.DataInicio).localeCompare(String(b.DataInicio))).slice(0,5);
 return `<div class="w-summary">
 ${[['trabalhando','Em operação',r.filter(p=>p.status==='trabalhando').length],['intervalo','No intervalo',r.filter(p=>p.status==='intervalo').length],['ausente','Sem entrada',r.filter(p=>p.status==='ausente').length],['atrasados','Entradas atrasadas',r.filter(p=>delay(p)>0).length]].map(([filter,label,count])=>`<button data-j-open-team="${filter}" class="w-stat"><span>${label}</span><strong>${ready?count:'—'}</strong><small>Ver pessoas <span aria-hidden="true">↗</span></small></button>`).join('')}
 </div><article class="j-card w-queue"><div class="j-card-top"><div><span class="eyebrow">CENTRAL DE DECISÕES</span><h3>Pendências da operação</h3></div><span class="w-badge wait">${data.coreReady?requests.length+missing.length:'…'} para revisar</span></div>
 <div class="w-queue-tabs"><button data-view-target="pending-center"><strong>${data.coreReady?requests.length:'—'}</strong> pedidos de folga <span>↗</span></button><button data-view-target="timeclock"><strong>${data.pending?missing.length:'—'}</strong> pontos incompletos <span>↗</span></button></div>
 ${missing.slice(0,3).map(x=>`<div class="w-task"><span class="w-task-mark">!</span><div><strong>${esc(x.NomeFuncionario || x.Nome)}</strong><small>${esc(dateLabel(x.Data))} · Ponto incompleto</small><p>Conferir as marcações antes de fechar as horas.</p></div><button class="btn btn-secondary" data-j-clock="${esc(x.FuncionarioID)}" data-j-day="${esc(x.Data)}">Conferir</button></div>`).join('')}
 ${requests.slice(0,3).map(x=>`<div class="w-task"><span class="w-task-mark neutral">✓</span><div><strong>${esc(x.NomeFuncionario)}</strong><small>${esc(dateLabel(x.DataInicio))} · ${esc(x.TipoFolga || 'Folga')}</small><p>${esc(x.Motivo || 'Aguardando sua decisão')}</p></div><button class="btn btn-secondary" data-action="approve" data-id="${esc(x.FolgaID)}">Analisar</button></div>`).join('')}
 ${!requests.length&&!missing.length?emptyState(data.coreReady?'Nenhum pedido nesta seleção':'Carregando solicitações',data.pending?'As conferências de ponto também estão em dia.':'A conferência dos registros de ponto está sendo carregada.') : ''}
 <button class="btn btn-ghost" data-view-target="pending-center">Abrir central de pendências →</button></article>
 <article class="j-card w-live"><div class="j-card-top"><div><span class="eyebrow">PRESENÇA</span><h3>Agora na unidade</h3><small>${ready?`${present.length} de ${r.length} presentes · ${pct}% da equipe`:'Consultando as marcações…'}</small></div><span class="j-live"><i></i> HOJE</span></div>${present.slice(0,4).map(person).join('')||emptyState(ready?'Ninguém com turno aberto':'Carregando equipe')}
 <button class="btn btn-ghost" data-j-open-team="todos">Consultar toda a equipe →</button></article>
 <article class="j-card w-alerts"><div class="j-card-top"><div><span class="eyebrow">ACOMPANHAMENTO</span><h3>Entradas e alertas</h3></div><span class="w-badge wait">${ready?alerts.length:'—'}</span></div>${alerts.slice(0,4).map(p=>`<div class="w-task"><span class="w-task-mark">!</span><div><strong>${esc(p.Nome)}</strong><small>${esc(p.alertMessage || (delay(p)>0?`${delay(p)} min após o horário previsto`:'Entrada ainda não registrada'))}</small><p>${esc(p.horarioEscala || 'Confira a escala cadastrada')}</p></div><button class="btn btn-ghost" data-j-clock="${esc(p.FuncionarioID)}">Ponto ↗</button></div>`).join('')||emptyState(ready?'Nenhum alerta nesta seleção':'Consultando horários')}
 <p class="w-footnote">Sem entrada pede conferência: a pessoa pode ter um turno mais tarde ou ter esquecido a marcação.</p></article>
 <article class="j-card w-upcoming"><div class="j-card-top"><div><span class="eyebrow">PLANEJAMENTO</span><h3>Próximas folgas aprovadas</h3></div><button class="btn btn-ghost" data-view-target="calendar">Calendário ↗</button></div>${leaveItems(upcoming,true)||emptyState('Nenhuma folga aprovada nos próximos dias','Folgas fixas recorrentes podem ser consultadas no calendário.')}</article>`;
}
function personal() {
 const d=data.clock, marks=list(d?.todayRecords), days=list(d?.days);
 const today=days.find(x=>x.data===(d?.date || dateKey())) || (d?._quick?d.summary:null);
 const me=list(data.employees).find(x=>String(x.FuncionarioID)===ownId()) || {};
 const flex=!!d?.flexibleTwoShifts;
 const labels=flex?['Entrada 1','Saída 1','Entrada 2','Saída 2']:['Entrada','Intervalo','Retorno','Saída'];
 const types=['ENTRADA','SAIDA_INTERVALO','RETORNO_INTERVALO','SAIDA_FINAL'];
 const nextLabel=labels[types.indexOf(d?.nextAction)] || 'Consultar ponto';
 const requests=scoped(data.timeOff).sort((a,b)=>String(b.DataCriacao || b.DataInicio).localeCompare(String(a.DataCriacao || a.DataInicio)));
 const coming=requests.filter(x=>approved(x)&&String(x.DataFim || x.DataInicio)>=dateKey()).sort((a,b)=>String(a.DataInicio).localeCompare(String(b.DataInicio)));
 const mineBalance=list(data.balance?.employees).find(x=>String(x.FuncionarioID)===ownId());
 const balance=mineBalance?.saldoTexto || data.balance?.totalTexto;
 return `<article class="j-card w-myday"><div class="j-card-top"><div><span class="eyebrow">${flex?'MINHA JORNADA · DOIS TURNOS':'MINHA JORNADA'}</span><h3>${!d?'Carregando seu ponto…':d.loadError?'Não foi possível carregar o ponto':d.offToday?'Hoje você está de folga':!d.nextAction&&marks.length?'Jornada concluída':!d.nextAction?'Consulte suas marcações':'Sua próxima marcação'}</h3></div><span class="w-badge ${d?.loadError?esc(d.loadError):d?.nextAction==='RETORNO_INTERVALO'?'wait':'ok'}">${esc(d?.date?dateLabel(d.date):dateLabel(dateKey()))}</span></div>
 <div class="w-next-action"><strong>${!d?'Aguarde a sincronização':d.loadError?'Tente atualizar':d.offToday?'Descanso previsto':d.nextAction?nextLabel:marks.length?'Tudo registrado':'Sem marcações'}</strong><p>${d?.loadError?esc(d.loadError):d?.nextAction==='RETORNO_INTERVALO'?(flex?'Ao iniciar o segundo turno, registre sua entrada.':'Ao voltar do intervalo, registre seu retorno.'):d?.nextAction?'Abra o ponto para confirmar sua foto e localização.':'Consulte suas marcações e solicite uma correção quando necessário.'}</p></div>
 <div class="w-punches">${types.map((k,i)=>{const mark=marks.find(x=>x.TipoMarcacao===k);return `<div class="${mark?'done':d?.nextAction===k?'next':''}"><i>${mark?'✓':i+1}</i><strong>${esc(labels[i])}</strong><time>${mark?esc(time(mark.DataHora)):'—'}</time></div>`}).join('')}</div>
 <button class="btn btn-primary j-wide" data-view-target="timeclock">${d?.loadError?'Tentar carregar meu ponto':d?.nextAction?'Abrir ponto · '+esc(nextLabel):'Conferir meus registros'} <span aria-hidden="true">↗</span></button>
 ${today?.incompleto?'<p class="w-footnote">Há marcações para conferir. Abra o ponto e solicite a correção.</p>':''}</article>
 <article class="j-card w-wallet"><div class="j-card-top"><div><span class="eyebrow">MEUS DIREITOS E SALDOS</span><h3>Folgas e horas</h3></div></div><div class="w-wallet-values"><button data-view-target="timeoff"><span>Folgas extras disponíveis</span><strong>${data.coreReady?esc(me.SaldoFolgas ?? '—'):'—'}</strong><small>Ver minhas folgas ↗</small></button><button data-view-target="timeclock"><span>Banco de horas</span><strong>${esc(balance || '—')}</strong><small>${mineBalance?.desde?'Desde '+esc(dateLabel(mineBalance.desde)):'Abra o ponto para conferir o período'} ↗</small></button></div><p class="w-footnote">Folga fixa: ${esc([me.DiaFolgaPreferencial,me.SegundoDiaFolgaPreferencial].filter(Boolean).join(' e ') || 'Ainda não cadastrada')}</p><div class="w-actions"><button class="btn btn-secondary" data-j-request-leave>Pedir folga</button><button class="btn btn-ghost" data-view-target="notifications">Meus avisos ↗</button></div></article>
 <article class="j-card w-myweek"><div class="j-card-top"><div><span class="eyebrow">PRÓXIMOS 7 DIAS</span><h3>Minha programação</h3></div><button class="btn btn-ghost" data-view-target="shift-plan">Escala ↗</button></div><div class="w-week-list">${Array.from({length:7},(_,i)=>{const day=shiftDate(dateKey(),i),schedule=scheduleForDay(list(data.schedules),ownId(),day),leave=requests.find(x=>approved(x)&&String(x.DataInicio)<=day&&String(x.DataFim||x.DataInicio)>=day),working=schedule&&workday(me,schedule,day,requests);return `<div class="w-week-day"><time>${i===0?'Hoje':esc(new Date(day+'T12:00:00Z').toLocaleDateString('pt-BR',{weekday:'short',timeZone:'America/Bahia'}))}<small>${esc(dateLabel(day))}</small></time><div><strong>${leave?esc(leave.TipoFolga || 'Folga aprovada'):!data.schedules?'Carregando escala':!schedule?'Jornada não cadastrada':!working?'Descanso previsto':esc(schedule.HoraEntrada+' — '+schedule.HoraSaida)}</strong><small>${working&&active(schedule.HorarioFlexivelDoisTurnos)?'Pausa entre turnos: '+esc(schedule.HoraSaidaIntervalo)+' — '+esc(schedule.HoraRetornoIntervalo):working?esc(personUnit(me)):leave?'Aprovada pela gestão':'Consulte os detalhes na escala'}</small></div><span class="w-week-dot ${working?'work':'off'}" aria-hidden="true"></span></div>`}).join('')}</div></article>
 <article class="j-card w-myrequests"><div class="j-card-top"><div><span class="eyebrow">ACOMPANHAMENTO</span><h3>Meus pedidos</h3></div><button class="btn btn-ghost" data-view-target="pending-center">Ver todos ↗</button></div>${leaveItems(requests.slice(0,4))||emptyState(data.coreReady?'Você ainda não tem pedidos':'Carregando seus pedidos','Peça uma folga e acompanhe a decisão por aqui.')}<div class="w-next-leave"><span>Próxima folga aprovada</span><strong>${coming.length?esc(dateLabel(coming[0].DataInicio)):'Nenhuma agendada'}</strong></div></article>`;
}
function teamResults(r) {
 if(teamLayout==='lista') return r.map(person).join('') || emptyState('Nenhuma pessoa nesta seleção');
 const groups=[...Object.keys(names),...new Set(r.map(p=>p.status).filter(k=>!names[k]))];
 return `<div class="v-team-board">${groups.filter(k=>r.some(p=>p.status===k)).map(k=>`<section class="v-team-column" style="--column-color:${colors[k] || '#b5bfcc'}"><header><span>${esc(names[k] || 'Outros registros')}</span><strong>${r.filter(p=>p.status===k).length}</strong></header>${r.filter(p=>p.status===k).map(p=>`<div class="v-team-card">${person(p)}<button class="btn btn-ghost" data-j-clock="${esc(p.FuncionarioID)}">Conferir marcações ↗</button></div>`).join('')}</section>`).join('') || emptyState('Nenhuma pessoa nesta seleção')}</div>`;
}
function unitOverview() {
 if(!data.manager || stores().length<2) return '';
 return `<section class="v-units"><div class="v-section-label">VISÃO POR UNIDADE <span>Selecione para filtrar o painel</span></div><div class="v-unit-grid">${stores().map(s=>{const id=storeId(s), people=uniquePeople(list(data.presence?.presence)).filter(p=>String(p.LojaID)===id), working=people.filter(p=>p.status==='trabalhando').length, onBreak=people.filter(p=>p.status==='intervalo').length;return `<button data-j-unit-card="${esc(id)}" aria-pressed="${unit===id}"><strong>${esc(storeName(s)||'Unidade sem nome')}</strong><div class="v-unit-meter" aria-hidden="true"><i style="width:${people.length?working/people.length*100:0}%"></i><b style="width:${people.length?onBreak/people.length*100:0}%"></b></div><small>${data.presence?`${working} trabalhando · ${onBreak} no intervalo`:'Aguardando registros'} <span>↗</span></small></button>`}).join('')}</div></section>`;
}
function workspaceHero() {
 const me=list(data.employees).find(p=>String(p.FuncionarioID)===ownId());
 const first=String(me?.Nome || data.user?.Nome || data.user?.nome || '').trim().split(' ')[0];
 if(data.manager) return `${managerCommand()}<div class="w-sync house-sync"><span>${data.presenceError?'Não foi possível atualizar a presença':data.updatedAt?'Presença atualizada às '+time(data.updatedAt):'Aguardando presença'}</span><button class="btn btn-secondary" data-j-refresh>↻ Atualizar</button></div>${unitOverview()}`;
 return `<header class="v-workspace-hero"><div class="v-hero-copy"><span class="eyebrow">GRUPO HOUSE 190 / ${data.manager?'GESTÃO':'MINHA JORNADA'}</span><h2>${data.manager?'O dia acontece<br>com a sua equipe.':`${first?'Oi, '+esc(first)+'!':'Olá!'}<br>Seu dia começa aqui.`}</h2><p>${data.manager?'Confira a operação e resolva o que precisa de você.':'Seu ponto, seus próximos turnos e seu tempo de descanso.'}</p><div class="v-hero-actions"><button class="btn btn-primary" data-view-target="${data.manager?'pending-center':'timeclock'}">${data.manager?'Resolver pendências':'Registrar meu ponto'} <span>↗</span></button><button class="btn btn-secondary" data-view-target="${data.manager?'shift-plan':'calendar'}">${data.manager?'Consultar escala':'Minhas folgas'}</button></div></div><div class="v-hero-clock"><span>HORÁRIO DA BAHIA</span><strong data-live-clock></strong><small data-live-date></small><div class="v-clock-caption"><i></i> ${data.manager?'Organização para cada turno':'Um registro de cada vez'}</div></div></header><div class="v-workspace-toolbar"><div><span class="eyebrow">${data.manager?'ACOMPANHAMENTO DO DIA':'SUA ÁREA PESSOAL'}</span><h3>${data.manager?'Operação de hoje':'Hoje e próximos dias'}</h3></div>${unitSelect()}<div class="w-sync"><span>${!data.manager?'Seus registros e pedidos':data.presenceError?'Falha ao atualizar a presença':data.updatedAt?'Presença às '+time(data.updatedAt):'Aguardando presença'}</span><button class="btn btn-secondary" ${data.manager?'data-j-refresh':'data-view-target="notifications"'}>${data.manager?'↻ Atualizar':'Meus avisos ↗'}</button></div></div>${unitOverview()}`;
}
function renderTeam() {
 const r=rows().filter(p=>(teamFilter==='todos'||(teamFilter==='atrasados'?delay(p)>0:p.status===teamFilter))&&`${p.Nome} ${p.Cargo} ${personUnit(p)}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
 $('#journeyTeam').innerHTML=data.manager?`<div class="j-page-head"><div><span class="eyebrow">PESSOAS QUE FAZEM ACONTECER</span><h2>Equipe</h2><p>${rows().length} colaboradores</p></div>${unitSelect()}</div><label class="j-search">Buscar colaborador<input data-j-search type="search" placeholder="Nome, cargo ou unidade…" value="${esc(search)}"></label><div class="j-chips">${[['todos','Todos'],['atrasados','Atrasados'],...Object.entries(names)].map(([k,n])=>`<button data-j-filter="${k}" aria-pressed="${teamFilter===k}">${n}</button>`).join('')}</div><div class="v-layout-switch" aria-label="Formato da equipe">${['quadro','lista'].map(k=>`<button data-j-layout="${k}" aria-pressed="${teamLayout===k}">${k==='quadro'?'Quadro por situação':'Lista compacta'}</button>`).join('')}</div><div id="journeyTeamRows" class="j-team-list">${teamResults(r)}</div>`:'<p class="j-empty">A visualização da equipe está disponível para gestores.</p>';
}
function renderSchedule() {
 const today=dateKey(), start=mode==='mês'?anchor.slice(0,7)+'-01':mode==='semana'?shiftDate(anchor,-((new Date(anchor+'T12:00:00Z').getUTCDay()+6)%7)):anchor;
 const count=mode==='mês'?new Date(Number(anchor.slice(0,4)),Number(anchor.slice(5,7)),0).getDate():mode==='semana'?7:1;
 const own=String(data.user?.funcionarioId || data.user?.FuncionarioID || '');
 const employees=uniquePeople(list(data.employees)).filter(p=>active(p.Ativo)&&(!unit||String(p.LojaID)===unit)&&(data.manager||String(p.FuncionarioID)===own));
 const blocks=Array.from({length:count},(_,i)=>{const day=shiftDate(start,i);const shifts=employees.map(p=>({p,s:scheduleForDay(list(data.schedules),p.FuncionarioID,day)})).filter(({p,s})=>s&&workday(p,s,day,list(data.timeOff))).sort((a,b)=>String(a.s.HoraEntrada).localeCompare(String(b.s.HoraEntrada)));
 return `<article class="j-card ${day===today?'j-is-today':''}"><span class="eyebrow">${day===today?'HOJE · ':''}${new Date(day+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'America/Bahia',weekday:'short',day:'2-digit',month:'short'})}</span>${shifts.map(({p,s})=>`<div class="j-shift"><time>${esc(s.HoraEntrada || '—')} — ${esc(s.HoraSaida || '—')}</time>${avatar(p)}<div><strong>${esc(p.Nome)}</strong><small>${esc(personUnit(p))}</small>${active(s.HorarioFlexivelDoisTurnos)?`<small>Dois turnos · pausa ${esc(s.HoraSaidaIntervalo)} — ${esc(s.HoraRetornoIntervalo)}</small>`:''}</div></div>`).join('')||'<p class="j-empty">Sem jornada prevista nesta seleção.</p>'}</article>`;}).join('');
 $('#journeySchedule').innerHTML=`<div class="j-page-head"><div><span class="eyebrow">SEU PRÓXIMO PASSO</span><h2>Escala</h2><p>Jornadas cadastradas e folgas aprovadas</p></div>${unitSelect()}</div><div class="w-date-nav"><button class="btn btn-secondary" data-j-period="-1" aria-label="Período anterior">←</button><button class="btn btn-ghost" data-j-period="today">Hoje</button><strong>${esc(dateLabel(start))} — ${esc(dateLabel(shiftDate(start,count-1)))}</strong><button class="btn btn-secondary" data-j-period="1" aria-label="Próximo período">→</button></div><div class="j-chips">${['dia','semana','mês'].map(k=>`<button data-j-mode="${k}" aria-pressed="${mode===k}">${k}</button>`).join('')}</div><div class="j-schedule-grid">${data.schedules?blocks:'<p class="j-empty">Carregando jornadas…</p>'}</div><button class="btn btn-secondary" data-view-target="calendar">Consultar e gerenciar folgas →</button>`;
}

function render() {
 if(!$('#journeyHome'))return;
 $('#journeyHome').innerHTML=`${workspaceHero()}${data.manager?operation():personal()}`;
 $('#view-dashboard').classList.toggle('j-unit-filtered',!!unit);
 $('#journeyHome').classList.toggle('v-personal-home',!data.manager);
 renderTeam();renderSchedule();tick();
}
function tick(){const now=new Date();document.querySelectorAll('[data-live-clock]').forEach(e=>e.textContent=now.toLocaleTimeString('pt-BR',{timeZone:'America/Bahia',hour:'2-digit',minute:'2-digit',second:'2-digit'}));document.querySelectorAll('[data-live-date]').forEach(e=>e.textContent=now.toLocaleDateString('pt-BR',{timeZone:'America/Bahia',weekday:'long',day:'2-digit',month:'short',year:'numeric'}));}
window.addEventListener('house-journey',e=>{const next=e.detail || {};if(String(next.user?.email || next.user?.Email || '')!==String(data.user?.email || data.user?.Email || '')){unit='';search='';teamFilter='todos';}data=next;if(unit && !stores().some(s=>storeId(s)===unit))unit='';render()});
document.addEventListener('change',e=>{if(e.target.matches('[data-j-unit]')){unit=e.target.value;render();}});
document.addEventListener('input',e=>{if(e.target.matches('[data-j-search]')){search=e.target.value;const r=rows().filter(p=>(teamFilter==='todos'||(teamFilter==='atrasados'?delay(p)>0:p.status===teamFilter))&&`${p.Nome} ${p.Cargo} ${personUnit(p)}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));$('#journeyTeamRows').innerHTML=teamResults(r);}});
document.addEventListener('click',e=>{const jump=e.target.closest('[data-jump-team]');if(jump){teamFilter=jump.dataset.jumpTeam;renderTeam();}const layout=e.target.closest('[data-j-layout]'),unitCard=e.target.closest('[data-j-unit-card]');if(layout){teamLayout=layout.dataset.jLayout;renderTeam();}if(unitCard){unit=unit===unitCard.dataset.jUnitCard?'':unitCard.dataset.jUnitCard;render();}const period=e.target.closest('[data-j-period]'),team=e.target.closest('[data-j-open-team]');if(period){const n=period.dataset.jPeriod;if(n==='today')anchor=dateKey();else if(mode==='mês'){const d=new Date(anchor.slice(0,7)+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(n));anchor=d.toISOString().slice(0,10);}else anchor=shiftDate(anchor,Number(n)*(mode==='semana'?7:1));renderSchedule();}if(team){teamFilter=team.dataset.jOpenTeam;renderTeam();window.dispatchEvent(new CustomEvent('jornada-team-open'));}const f=e.target.closest('[data-j-filter]'),m=e.target.closest('[data-j-mode]');if(f){teamFilter=f.dataset.jFilter;renderTeam();}if(m){mode=m.dataset.jMode;renderSchedule();}});
setInterval(()=>{if(!document.hidden)tick();},1000);
