import {scheduleForDay, workday, active, shiftDate} from "./core/reminder-policy.js";
// Presentation only: all clock mutations stay in the existing validated flow.
const $ = (s) => document.querySelector(s);
const list = (x) => Array.isArray(x) ? x : [];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = (d = new Date()) => new Date(d).toLocaleTimeString('pt-BR',{timeZone:'America/Bahia',hour:'2-digit',minute:'2-digit'});
const dateKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const hours = n => `${Math.floor(Math.max(0,n)/60)}h${String(Math.round(Math.max(0,n)%60)).padStart(2,'0')}`;
let data = {}, unit = '', teamFilter = 'todos', search = '', mode = 'dia';
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
function clock() { return `<article class="j-card j-clock"><div class="j-card-top"><span>SEU TEMPO IMPORTA</span><span class="j-live"><i></i> AO VIVO</span></div><time class="j-digital" data-live-clock>--:--:--</time><div class="j-date" data-live-date></div><div class="j-clock-bottom"><span>Hoje é um bom dia para fazer acontecer.</span><button class="btn btn-primary" data-view-target="timeclock">Bater ponto ↗</button></div></article>`; }
function unitSelect() { return data.manager ? `<label class="j-unit"><span>Unidade</span><select data-j-unit aria-label="Selecionar unidade"><option value="">Todas as unidades</option>${stores().map(s=>`<option value="${esc(storeId(s))}" ${storeId(s)===unit?'selected':''}>${esc(storeName(s) || 'Unidade sem nome')}</option>`).join('')}</select></label>` : ''; }
function managerCommand() {
 const r=rows(), late=r.filter(p=>delay(p)>0).length, missing=r.filter(p=>p.status==='ausente').length;
 const requests=Number(data.pendingCounts?.total || 0), incomplete=list(data.incompletePunches).length;
 const latePeople=r.filter(p=>delay(p)>0).sort((a,b)=>delay(b)-delay(a));
 const missingPeople=r.filter(p=>p.status==='ausente');
 const priority=[
  {count:requests,label:requests===1?'solicitação aguardando decisão':'solicitações aguardando decisão',detail:[data.pendingCounts?.timeOff&&`${data.pendingCounts.timeOff} folgas`,data.pendingCounts?.clock&&`${data.pendingCounts.clock} pontos`,data.pendingCounts?.swaps&&`${data.pendingCounts.swaps} trocas`].filter(Boolean).join(' · '),view:'pending-center',pendingFilter:'all',action:'Revisar'},
  {count:incomplete,label:incomplete===1?'saída esquecida':'saídas esquecidas',detail:'Jornadas anteriores sem fechamento',view:'pending-center',pendingFilter:'clock',action:'Corrigir ponto'},
  {count:late,label:late===1?'entrada atrasada':'entradas atrasadas',detail:latePeople.slice(0,2).map(p=>`${p.Nome} · ${delay(p)} min após`).join(' / '),view:'live-team',teamFilter:'atrasados',action:'Ver equipe'},
  {count:missing,label:missing===1?'pessoa ainda sem entrada':'pessoas ainda sem entrada',detail:missingPeople.slice(0,3).map(p=>p.Nome).join(', '),view:'live-team',teamFilter:'ausente',action:'Conferir'},
 ].filter(item=>item.count>0);
 const currentDate=new Date().toLocaleDateString('pt-BR',{timeZone:'America/Bahia',weekday:'long',day:'2-digit',month:'long'});
 return `<section class="j-command"><div class="j-command-head"><div><span class="eyebrow">OPERAÇÃO DE HOJE</span><h2>O que precisa da sua decisão</h2><p>${esc(currentDate)}</p></div>${unitSelect()}</div><div class="j-priority-list">${priority.map(item=>`<button data-view-target="${item.view}"${item.pendingFilter?` data-pending-filter-target="${item.pendingFilter}"`:''}${item.teamFilter?` data-jump-team="${item.teamFilter}"`:''}><strong>${item.count}</strong><span>${esc(item.label)}</span>${item.detail?`<small>${esc(item.detail)}</small>`:''}<b>${item.action} →</b></button>`).join('') || '<div class="j-all-clear"><span>✓</span><div><strong>Nenhuma pendência crítica agora</strong><small>A equipe está dentro do previsto para esta seleção.</small></div></div>'}</div><div class="j-command-actions"><button class="btn btn-secondary" data-view-target="calendar">Abrir calendário</button><button class="btn btn-primary" data-view-target="scheduler">Planejar próximas folgas</button></div></section>`;
}
function operation() {
 const r=rows(), present=r.filter(p=>['trabalhando','intervalo'].includes(p.status)).length;
 const pct=r.length?Math.round(present/r.length*100):0;
 let pos=0; const gradient=Object.entries(colors).map(([k,c])=>{const start=pos;pos+=r.filter(p=>p.status===k).length/Math.max(1,r.length)*100;return `${c} ${start}% ${pos}%`}).join(',');
 const counts=['trabalhando','intervalo','atrasos','ausente'].map(k=>`<article class="j-stat" style="--tint:${colors[k] || '#eea69e'}33"><span class="j-stat-icon" style="color:${colors[k] || '#eea69e'}">●</span><strong>${data.presence?(k==='atrasos'?r.filter(p=>delay(p)>0).length:r.filter(p=>p.status===k).length):'—'}</strong><span>${k==='atrasos'?'Entradas após o horário':names[k]}</span></article>`).join('');
 const recent=r.filter(p=>p.lastPunchTime).sort((a,b)=>b.lastPunchTime.localeCompare(a.lastPunchTime)).slice(0,5);
 return `<div class="j-stats">${counts}</div><article class="j-card j-people"><div class="j-card-top"><div><h3>Agora na empresa</h3><small>${present} de ${r.length} colaboradores presentes</small></div><div class="j-avatar-stack">${r.filter(p=>['trabalhando','intervalo'].includes(p.status)).slice(0,4).map(avatar).join('')}</div></div>${r.filter(p=>['trabalhando','intervalo'].includes(p.status)).slice(0,3).map(person).join('') || '<p class="j-empty">Nenhum colaborador presente nesta seleção.</p>'}<button class="btn btn-ghost" data-view-target="live-team">Ver toda a equipe →</button></article><article class="j-card j-team-chart"><div class="j-card-top"><h3>Cobertura da equipe</h3><span class="j-live"><i></i> AO VIVO</span></div><div class="j-donut-wrap"><div class="j-donut" role="img" aria-label="${pct}% da equipe presente" style="background:conic-gradient(${r.length?gradient:'#eceaf2 0% 100%'})"><div><strong>${data.presence?pct+'%':'—'}</strong><small>Presentes</small></div></div><div class="j-legend">${Object.entries(names).map(([k,n])=>`<span><i style="background:${colors[k]}"></i>${n}<b>${r.filter(p=>p.status===k).length}</b></span>`).join('')}</div></div><small>Sem entrada é um alerta operacional, não uma falta confirmada.</small></article><article class="j-card j-activity-card"><div class="j-card-top"><h3>Últimas marcações</h3><span class="j-live"><i></i></span></div><div class="j-activity">${recent.map(p=>`<div><time>${esc(p.lastPunchTime)}</time><i></i><span><strong>${esc(p.Nome)}</strong><small>${esc({ENTRADA:'registrou entrada',SAIDA_INTERVALO:'iniciou intervalo',RETORNO_INTERVALO:'voltou do intervalo',SAIDA_FINAL:'encerrou a jornada'}[p.lastPunchType] || p.statusLabel)}</small></span></div>`).join('') || '<p class="j-empty">Nenhuma marcação disponível.</p>'}</div></article>`;
}
function personal() {
 const d=data.clock, days=list(d?.days), today=days.find(x=>x.data===(d?.date || dateKey())) || (d?._quick?d.summary:null), marks=list(d?.todayRecords);
 const labels={ENTRADA:'Entrada',SAIDA_INTERVALO:'Intervalo',RETORNO_INTERVALO:'Retorno',SAIDA_FINAL:'Saída'};
 const monday=new Date(dateKey()+'T12:00:00-03:00');monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
 const week=Array.from({length:7},(_,i)=>{const day=new Date(monday);day.setDate(day.getDate()+i);return {label:['SEG','TER','QUA','QUI','SEX','SÁB','DOM'][i],value:days.find(x=>x.data===dateKey(day))};});
 const total=week.reduce((n,x)=>n+Number(x.value?.trabalhadoMinutos||0),0),max=Math.max(480,...week.map(x=>Number(x.value?.trabalhadoMinutos||0)));
 return `<article class="j-card j-journey"><div class="j-card-top"><h3>Jornada de hoje</h3><span class="j-status">${!d?'Carregando…':d.offToday?'De folga':({SAIDA_INTERVALO:'Trabalhando',RETORNO_INTERVALO:'Em intervalo',SAIDA_FINAL:'Trabalhando',ENTRADA:'Aguardando entrada'}[d.nextAction] || 'Jornada encerrada')}</span></div><div class="j-journey-line">${['ENTRADA','SAIDA_INTERVALO','RETORNO_INTERVALO','SAIDA_FINAL'].map(k=>{const m=marks.find(x=>x.TipoMarcacao===k);return `<div class="${m?'done':''}"><i></i><strong>${m?esc(time(m.DataHora)):'—'}</strong><small>${labels[k]}</small></div>`;}).join('')}</div><div class="j-totals"><span>Previsto<b>${esc(today?.previstoTexto || '—')}</b></span><span>Realizado<b>${esc(today?.trabalhadoTexto || '—')}</b></span><span>Restante<b>${today?hours(Math.max(0,today.previstoMinutos-today.trabalhadoMinutos)):'—'}</b></span></div><button class="btn btn-primary j-wide" data-view-target="timeclock">${({ENTRADA:'Registrar entrada',SAIDA_INTERVALO:'Iniciar intervalo',RETORNO_INTERVALO:'Finalizar intervalo',SAIDA_FINAL:'Registrar saída'}[d?.nextAction] || 'Abrir meu ponto')}</button></article><article class="j-card j-week"><div class="j-card-top"><h3>Minha semana</h3><button class="btn btn-ghost" data-view-target="timeclock">Ver detalhes →</button></div><div class="j-bars">${week.map(x=>`<div><small>${x.value?hours(x.value.trabalhadoMinutos):'—'}</small><div><i style="height:${x.value?Math.max(2,x.value.trabalhadoMinutos/max*100):0}%"></i></div><span>${x.label}</span></div>`).join('')}</div><div class="j-totals"><span>Total registrado<b>${days.length?hours(total):'—'}</b></span><span>Banco de horas<b>${esc(data.balance?.totalTexto || '—')}</b></span></div>${!days.length?'<p class="j-caption">Abra o ponto para carregar o histórico da semana.</p>':''}</article>`;
}
function renderTeam() {
 const r=rows().filter(p=>(teamFilter==='todos'||(teamFilter==='atrasados'?delay(p)>0:p.status===teamFilter))&&`${p.Nome} ${p.Cargo} ${personUnit(p)}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
 $('#journeyTeam').innerHTML=data.manager?`<div class="j-page-head"><div><span class="eyebrow">PESSOAS QUE FAZEM ACONTECER</span><h2>Equipe</h2><p>${rows().length} colaboradores</p></div>${unitSelect()}</div><label class="j-search">Buscar colaborador<input data-j-search type="search" placeholder="Nome, cargo ou unidade…" value="${esc(search)}"></label><div class="j-chips">${[['todos','Todos'],['atrasados','Atrasados'],...Object.entries(names)].map(([k,n])=>`<button data-j-filter="${k}" aria-pressed="${teamFilter===k}">${n}</button>`).join('')}</div><div id="journeyTeamRows" class="j-team-list">${r.map(person).join('')||'<p class="j-empty">Nenhuma pessoa nesta seleção.</p>'}</div>`:'<p class="j-empty">A visualização da equipe está disponível para gestores.</p>';
}
function renderSchedule() {
 const today=dateKey(), start=mode==='mês'?today.slice(0,7)+'-01':mode==='semana'?shiftDate(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7)):today;
 const count=mode==='mês'?new Date(Number(today.slice(0,4)),Number(today.slice(5,7)),0).getDate():mode==='semana'?7:1;
 const own=String(data.user?.funcionarioId || data.user?.FuncionarioID || '');
 const employees=uniquePeople(list(data.employees)).filter(p=>active(p.Ativo)&&(!unit||String(p.LojaID)===unit)&&(data.manager||String(p.FuncionarioID)===own));
 const blocks=Array.from({length:count},(_,i)=>{const day=shiftDate(start,i);const shifts=employees.map(p=>({p,s:scheduleForDay(list(data.schedules),p.FuncionarioID,day)})).filter(({p,s})=>s&&workday(p,s,day,list(data.timeOff))).sort((a,b)=>String(a.s.HoraEntrada).localeCompare(String(b.s.HoraEntrada)));
 return `<article class="j-card ${day===today?'j-is-today':''}"><span class="eyebrow">${day===today?'HOJE · ':''}${new Date(day+'T12:00:00Z').toLocaleDateString('pt-BR',{timeZone:'America/Bahia',weekday:'short',day:'2-digit',month:'short'})}</span>${shifts.map(({p,s})=>`<div class="j-shift"><time>${esc(s.HoraEntrada || '—')} — ${esc(s.HoraSaida || '—')}</time>${avatar(p)}<div><strong>${esc(p.Nome)}</strong><small>${esc(personUnit(p))}</small></div></div>`).join('')||'<p class="j-empty">Sem jornada prevista nesta seleção.</p>'}</article>`;}).join('');
 $('#journeySchedule').innerHTML=`<div class="j-page-head"><div><span class="eyebrow">SEU PRÓXIMO PASSO</span><h2>Escala</h2><p>Jornadas cadastradas e folgas aprovadas</p></div>${unitSelect()}</div><div class="j-chips">${['dia','semana','mês'].map(k=>`<button data-j-mode="${k}" aria-pressed="${mode===k}">${k}</button>`).join('')}</div><div class="j-schedule-grid">${data.schedules?blocks:'<p class="j-empty">Carregando jornadas…</p>'}</div><button class="btn btn-secondary" data-view-target="calendar">Consultar e gerenciar folgas →</button>`;
}

function render() {
 if(!$('#journeyHome'))return;
 $('#journeyHome').innerHTML=data.manager?`${managerCommand()}${operation()}`:`${clock()}${personal()}`;
 $('#view-dashboard').classList.toggle('j-unit-filtered',!!unit);
 $('#view-dashboard').classList.toggle('j-manager-home',!!data.manager);
 renderTeam();renderSchedule();tick();
}
function tick(){const now=new Date();document.querySelectorAll('[data-live-clock]').forEach(e=>e.textContent=now.toLocaleTimeString('pt-BR',{timeZone:'America/Bahia',hour:'2-digit',minute:'2-digit',second:'2-digit'}));document.querySelectorAll('[data-live-date]').forEach(e=>e.textContent=now.toLocaleDateString('pt-BR',{timeZone:'America/Bahia',weekday:'long',day:'2-digit',month:'short',year:'numeric'}));}
window.addEventListener('house-journey',e=>{const next=e.detail || {};if(String(next.user?.email || next.user?.Email || '')!==String(data.user?.email || data.user?.Email || '')){unit='';search='';teamFilter='todos';}data=next;if(unit && !stores().some(s=>storeId(s)===unit))unit='';render()});
document.addEventListener('change',e=>{if(e.target.matches('[data-j-unit]')){unit=e.target.value;render();}});
document.addEventListener('input',e=>{if(e.target.matches('[data-j-search]')){search=e.target.value;const r=rows().filter(p=>(teamFilter==='todos'||(teamFilter==='atrasados'?delay(p)>0:p.status===teamFilter))&&`${p.Nome} ${p.Cargo} ${personUnit(p)}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));$('#journeyTeamRows').innerHTML=r.map(person).join('')||'<p class="j-empty">Nenhuma pessoa nesta seleção.</p>';}});
document.addEventListener('click',e=>{const f=e.target.closest('[data-j-filter]'),m=e.target.closest('[data-j-mode]'),jump=e.target.closest('[data-jump-team]');if(f){teamFilter=f.dataset.jFilter;renderTeam();}if(m){mode=m.dataset.jMode;renderSchedule();}if(jump){teamFilter=jump.dataset.jumpTeam;renderTeam();}});
setInterval(()=>{if(!document.hidden)tick();},1000);
