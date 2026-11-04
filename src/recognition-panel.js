import './recognition-panel.css';

const panelStates = new WeakMap();
const list = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '');
const escape = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const isActive = row => row.Ativo === undefined || row.Ativo === true || row.Ativo === 1 || ['true', '1', 'sim'].includes(normalize(row.Ativo));
const recognitionId = row => text(row.ReconhecimentoID);
const initials = name => text(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('pt-BR') || 'D';

export function filterRecognitionRows(rows, { search = '', storeId = '' } = {}) {
  const query = normalize(search).trim();
  return list(rows).filter(row => row && recognitionId(row) && isActive(row))
    .filter(row => !storeId || text(row.LojaID) === text(storeId))
    .filter(row => !query || normalize([row.NomeFuncionario, row.Categoria, row.NomeLoja, row.Motivo].join(' ')).includes(query))
    .sort((a, b) => text(b.CriadoEm).localeCompare(text(a.CriadoEm)) || recognitionId(a).localeCompare(recognitionId(b)));
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function recognitionCardsHtml(rows) {
  return rows.map(row => {
    const id = escape(recognitionId(row));
    const person = row.NomeFuncionario || 'Colaborador';
    const date = dateLabel(row.CriadoEm);
    const author = text(row.AtribuidoPor).split('@')[0];
    return `<article class="recognition-panel-card" aria-label="Destaque de ${escape(person)}">
      <div class="recognition-panel-person"><span class="recognition-panel-avatar" aria-hidden="true">${escape(initials(person))}</span><div><h3>${escape(person)}</h3><p>${escape(row.Cargo || 'Colaborador')}${row.NomeLoja ? ` <span aria-hidden="true">·</span> ${escape(row.NomeLoja)}` : ''}</p></div><span class="recognition-panel-active">Ativo</span></div>
      <div class="recognition-panel-category">${escape(row.Categoria || 'Destaque da Semana')}</div>
      <p class="recognition-panel-reason">${escape(row.Motivo || 'Reconhecimento da liderança.')}</p>
      <div class="recognition-panel-meta">${row.Semana ? `<span>${escape(row.Semana)}</span>` : ''}${date ? `<time datetime="${escape(row.CriadoEm)}">${escape(date)}</time>` : ''}${author ? `<span>Por ${escape(author)}</span>` : ''}</div>
      <div class="recognition-panel-actions"><button type="button" data-recognition-action="edit" data-recognition-id="${id}">Editar</button><button type="button" data-recognition-action="notify" data-recognition-id="${id}">Avisar colaborador</button><button type="button" class="recognition-panel-remove" data-recognition-action="remove" data-recognition-id="${id}">Retirar</button></div>
    </article>`;
  }).join('');
}

function storeOptions(rows, stores) {
  const options = new Map();
  for (const row of filterRecognitionRows(rows)) {
    const id = text(row.LojaID);
    if (!id || options.has(id)) continue;
    const store = list(stores).find(item => text(item.LojaID) === id);
    options.set(id, text(store?.NomeLoja || row.NomeLoja || 'Unidade sem nome'));
  }
  return [...options].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
}

function updateCards(container, state) {
  if (!container.querySelector('[data-recognition-cards]')) return;
  const activeRows = filterRecognitionRows(state.options.rows);
  const visible = filterRecognitionRows(activeRows, state.filters);
  container.querySelector('[data-recognition-count]').textContent = `${activeRows.length} ${activeRows.length === 1 ? 'destaque ativo' : 'destaques ativos'}`;
  const result = container.querySelector('[data-recognition-results]');
  result.textContent = `${visible.length} ${visible.length === 1 ? 'destaque encontrado' : 'destaques encontrados'}`;
  const content = container.querySelector('[data-recognition-cards]');
  content.innerHTML = visible.length ? recognitionCardsHtml(visible) : `<div class="recognition-panel-empty"><strong>${activeRows.length ? 'Nenhum destaque para este filtro' : 'Sua equipe merece ser reconhecida'}</strong><p>${activeRows.length ? 'Tente outro nome, categoria ou unidade.' : 'Indique um colaborador para começar. Cada destaque fica salvo separadamente.'}</p></div>`;
  for (const button of container.querySelectorAll('[data-recognition-action]')) {
    button.disabled = state.busy.has(button.dataset.recognitionId || button.dataset.recognitionAction);
  }
}

/** Presentation only. Callbacks receive the canonical recognition ID. */
export function renderRecognitionPanel(container, options = {}) {
  if (!container) return;
  let state = panelStates.get(container);
  if (!state || !container.querySelector('[data-recognition-cards]')) {
    state ||= { options, filters: { search: '', storeId: '' }, busy: new Set() };
    panelStates.set(container, state);
    container.classList.add('recognition-panel');
    container.innerHTML = `<header class="recognition-panel-heading"><div><span class="recognition-panel-eyebrow">Reconhecimento da equipe</span><h2>Destaques ativos</h2><p data-recognition-count></p></div><div class="recognition-panel-toolbar"><button type="button" class="recognition-panel-refresh" data-recognition-action="refresh">Atualizar</button><button type="button" class="recognition-panel-create" data-recognition-action="create">Novo destaque</button></div></header>
      <div class="recognition-panel-filters"><label><span>Buscar destaque</span><input type="search" data-recognition-search placeholder="Nome, categoria ou elogio" autocomplete="off"></label><label><span>Unidade</span><select data-recognition-store><option value="">Todas as unidades</option></select></label></div>
      <p class="recognition-panel-results" data-recognition-results aria-live="polite"></p><p class="recognition-panel-status" data-recognition-status role="status" hidden></p><div class="recognition-panel-grid" data-recognition-cards></div>`;
    container.oninput = event => {
      if (!event.target.matches('[data-recognition-search]')) return;
      state.filters.search = event.target.value;
      updateCards(container, state);
    };
    container.onchange = event => {
      if (!event.target.matches('[data-recognition-store]')) return;
      state.filters.storeId = event.target.value;
      updateCards(container, state);
    };
    container.onclick = async event => {
      const button = event.target.closest('[data-recognition-action]');
      if (!button || !container.contains(button)) return;
      const action = button.dataset.recognitionAction;
      const id = button.dataset.recognitionId;
      const key = id || action;
      const callback = { edit: 'onEdit', remove: 'onRemove', notify: 'onNotify', create: 'onCreate', refresh: 'onRefresh' }[action];
      if (!callback || state.busy.has(key) || typeof state.options[callback] !== 'function') return;
      if (id && !filterRecognitionRows(state.options.rows).some(row => recognitionId(row) === id)) return;
      state.busy.add(key);
      const status = container.querySelector('[data-recognition-status]');
      status.hidden = true;
      button.disabled = true;
      try { await state.options[callback](id); }
      catch (error) {
        status.textContent = error?.message || 'Não foi possível concluir. Tente novamente.';
        status.hidden = false;
      } finally {
        state.busy.delete(key);
        updateCards(container, state);
      }
    };
  }
  state.options = options;
  const storeSelect = container.querySelector('[data-recognition-store]');
  const choices = storeOptions(options.rows, options.stores);
  if (state.filters.storeId && !choices.some(([id]) => id === state.filters.storeId)) state.filters.storeId = '';
  storeSelect.innerHTML = '<option value="">Todas as unidades</option>' + choices.map(([id, name]) => `<option value="${escape(id)}">${escape(name)}</option>`).join('');
  storeSelect.value = state.filters.storeId;
  container.querySelector('[data-recognition-search]').value = state.filters.search;
  updateCards(container, state);
}
