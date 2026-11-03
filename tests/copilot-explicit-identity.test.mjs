import assert from 'node:assert/strict';
import test from 'node:test';
import { convertFunctionCallToAction } from '../src/copilot.js';

const employees = [
  { FuncionarioID: 'ana-other', Nome: 'Ana Silva', LojaID: 'other' },
  { FuncionarioID: 'ana-local', Nome: 'Ana Silva', LojaID: 'local' },
];
const manager = { FuncionarioID: 'manager', Nome: 'Gestor', Perfil: 'Gerente', LojaID: 'local' };
const admin = { ...manager, Perfil: 'Administrador' };
const context = (user = manager, rows = employees) => ({ user, employees: rows });

test('explicit task assignee ID wins over duplicate and conflicting names', () => {
  const action = convertFunctionCallToAction('criarTarefaCozinha', { titulo: 'Limpar', responsavelId: 'ana-local', responsavelNome: 'Ana Silva' }, context());
  assert.equal(action.type, 'action');
  assert.equal(action.apiArgs[0].RESPONSAVEL_ID, 'ana-local');
  const privileged = convertFunctionCallToAction('criarTarefaCozinha', { titulo: 'Limpar', responsavelId: 'ana-other', responsavelNome: 'Gestor' }, context(admin));
  assert.equal(privileged.apiArgs[0].RESPONSAVEL_ID, 'ana-other');
});

test('explicit task ID missing or outside manager store never falls back to a name or unassigned team', () => {
  for (const responsavelId of ['missing', '', null, 'ana-other']) {
    const result = convertFunctionCallToAction('criarTarefaCozinha', { titulo: 'Limpar', responsavelId, responsavelNome: 'Ana Silva' }, context());
    assert.equal(result.type, 'error');
    assert.equal(result.apiMethod, undefined);
  }
});

test('both leave tools prioritize exact employee ID among duplicate names', () => {
  for (const name of ['solicitarFolga', 'lancarFolga']) {
    const result = convertFunctionCallToAction(name, { data: 'amanhã', colaboradorId: 'ana-local', colaboradorNome: 'Ana Silva' }, context());
    assert.equal(result.type, 'action');
    assert.equal(result.apiArgs[0].FuncionarioID, 'ana-local');
    for (const colaboradorId of ['missing', '', 'ana-other']) {
      const denied = convertFunctionCallToAction(name, { data: 'amanhã', colaboradorId, colaboradorNome: 'Ana Silva' }, context());
      assert.equal(denied.type, 'error');
      assert.equal(denied.apiMethod, undefined);
    }
  }
});

test('own employee identity can be resolved from profile without employee list', () => {
  const employee = { FuncionarioID: 'self', Nome: 'Ana Silva', Perfil: 'Funcionário', LojaID: 'local' };
  const result = convertFunctionCallToAction('solicitarFolga', { data: 'amanhã', colaboradorId: 'self', colaboradorNome: 'Nome divergente' }, context(employee, []));
  assert.equal(result.type, 'action');
  assert.equal(result.apiMethod, 'createEmployeeTimeOffRequest');
  assert.equal(result.apiArgs[0].FuncionarioID, 'self');
  const denied = convertFunctionCallToAction('solicitarFolga', { data: 'amanhã', colaboradorId: 'ana-local', colaboradorNome: 'Ana Silva' }, context(employee));
  assert.equal(denied.type, 'error');
  const authUid = { id: 'auth-uid', Nome: 'Pessoa', Perfil: 'Funcionário', LojaID: 'local' };
  assert.equal(convertFunctionCallToAction('solicitarFolga', { data: 'amanhã', colaboradorId: 'auth-uid' }, context(authUid, [])).type, 'error');
});

test('manager must have a confirmed matching store when explicit identity is provided', () => {
  for (const user of [{ ...manager, LojaID: '' }, manager]) {
    const rows = [{ FuncionarioID: 'unknown-store', Nome: 'Ana Silva' }];
    assert.equal(convertFunctionCallToAction('criarTarefaCozinha', { titulo: 'Limpar', responsavelId: 'unknown-store' }, context(user, rows)).type, 'error');
    assert.equal(convertFunctionCallToAction('lancarFolga', { data: 'amanhã', colaboradorId: 'unknown-store' }, context(user, rows)).type, 'error');
  }
});

test('legacy name-only tools continue resolving the employee without explicit ID', () => {
  const rows = [employees[1]];
  assert.equal(convertFunctionCallToAction('criarTarefaCozinha', { titulo: 'Limpar', responsavelNome: 'Ana Silva' }, context(manager, rows)).apiArgs[0].RESPONSAVEL_ID, 'ana-local');
  assert.equal(convertFunctionCallToAction('solicitarFolga', { data: 'amanhã', colaboradorNome: 'Ana Silva' }, context(manager, rows)).apiArgs[0].FuncionarioID, 'ana-local');
});
