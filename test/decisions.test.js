import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  countByTab,
  filterDecisions,
  toggleId,
  toggleAll,
  EXPORT_COLUMNS,
  exportRows,
} from '../src/frontend/decisions.js';

const active = [
  { id: 'a', title: 'Almacenamiento scratch', job: 'Clústeres', decision_owner: 'José', review_status: 'Pendiente de revisión' },
  { id: 'b', title: 'Comité de cómputo', job: 'Infra', decision_owner: 'Álvaro Mora', review_status: 'Validado' },
  { id: 'c', title: 'Cambio de colas', job: null, decision_owner: null, review_status: 'Descartado' },
];
const archived = [{ id: 'z', title: 'Vieja', review_status: 'Validado' }];

test('countByTab cuenta por estado de revisión y archivadas', () => {
  assert.deepEqual(countByTab(active, archived), {
    pending: 1, validated: 1, discarded: 1, all: 3, archived: 1,
  });
});

test('filterDecisions filtra por pestaña', () => {
  assert.deepEqual(filterDecisions(active, archived, 'validated', '').map((d) => d.id), ['b']);
  assert.deepEqual(filterDecisions(active, archived, 'archived', '').map((d) => d.id), ['z']);
  assert.deepEqual(filterDecisions(active, archived, 'all', '').map((d) => d.id), ['a', 'b', 'c']);
});

test('filterDecisions busca sin distinguir mayúsculas ni acentos en título, proyecto y responsable', () => {
  assert.deepEqual(filterDecisions(active, archived, 'all', 'COMPUTO').map((d) => d.id), ['b']);
  assert.deepEqual(filterDecisions(active, archived, 'all', 'alvaro').map((d) => d.id), ['b']);
  assert.deepEqual(filterDecisions(active, archived, 'all', 'clusteres').map((d) => d.id), ['a']);
});

test('toggleId agrega y quita sin mutar el original', () => {
  const s = new Set(['a']);
  assert.deepEqual([...toggleId(s, 'b')], ['a', 'b']);
  assert.deepEqual([...toggleId(s, 'a')], []);
  assert.deepEqual([...s], ['a']);
});

test('toggleAll selecciona todo si falta alguno y vacía si ya están todos', () => {
  assert.deepEqual([...toggleAll(new Set(['a']), ['a', 'b'])].sort(), ['a', 'b']);
  assert.deepEqual([...toggleAll(new Set(['a', 'b', 'x']), ['a', 'b'])], ['x']);
});

test('exportRows pone encabezados y convierte vacíos a texto vacío', () => {
  const rows = exportRows([{ title: 'Ñandú', decision: 'Sí', meeting_date: '2026-11-04T00:00:00Z', job: null }]);
  assert.deepEqual(rows[0], EXPORT_COLUMNS.map((c) => c.header));
  const title = EXPORT_COLUMNS.findIndex((c) => c.header === 'Título');
  const job = EXPORT_COLUMNS.findIndex((c) => c.header === 'Proyecto');
  const date = EXPORT_COLUMNS.findIndex((c) => c.header === 'Fecha de reunión');
  assert.equal(rows[1][title], 'Ñandú');
  assert.equal(rows[1][job], '');
  assert.equal(rows[1][date], '2026-11-04');
  assert.equal(rows.length, 2);
});

test('filterDecisions mantiene en su lugar las filas recién revisadas (keep) aunque ya no sean de la pestaña', () => {
  const ids = filterDecisions(active, archived, 'pending', '', new Set(['b'])).map((d) => d.id);
  assert.deepEqual(ids, ['a', 'b']);
});
