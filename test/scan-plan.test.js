import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_VISITED,
  folderPriority,
  parseScanState,
  serializeScanState,
  scanTree,
} from '../src/google-drive/scan-plan.js';

// Árbol falso con la estructura de Minerva: raíz / grupo / reunión (una minuta).
const makeTree = () => ({
  root: [
    { id: 'g1', name: 'Sin grupo' },
    { id: 'g2', name: 'Proyecto X' },
  ],
  g1: [
    { id: 'm1', name: '2026-11-04 – Reunión A' },
    { id: 'm3', name: '2026-11-10 – Reunión B' },
  ],
  g2: [{ id: 'm2', name: '2026-11-05 – Reunión C' }],
  m1: [],
  m2: [],
  m3: [],
});

const lister = (tree, calls = []) => async (folder) => {
  calls.push(folder.id);
  return { folders: tree[folder.id] || [], files: [{ id: `f-${folder.id}` }], truncated: false };
};

const leafOrder = (handled) => handled.filter((id) => id.startsWith('m'));

test('folderPriority pone primero las carpetas sin fecha y luego las reuniones más nuevas', () => {
  const sorted = [
    { name: '2026-11-04 – A' },
    { name: 'Sin grupo' },
    { name: '2026-11-10 – B' },
    { name: '2026-11-05 – C' },
  ].sort(folderPriority).map((f) => f.name);
  assert.deepEqual(sorted, ['Sin grupo', '2026-11-10 – B', '2026-11-05 – C', '2026-11-04 – A']);
});

test('scanTree revisa las reuniones de la más nueva a la más antigua, entre grupos', async () => {
  const handled = [];
  const result = await scanTree({
    root: { id: 'root', name: 'Minerva', path: 'Minerva' },
    visited: new Set(),
    listChildren: lister(makeTree()),
    handleFolder: async (folder) => { handled.push(folder.id); return false; },
    shouldStop: () => false,
  });
  assert.deepEqual(leafOrder(handled), ['m3', 'm2', 'm1']);
  assert.equal(result.complete, true);
  assert.equal(result.visited.size, 0, 'al completar la vuelta se reinicia el ciclo');
});

test('scanTree se detiene con el presupuesto y la siguiente ejecución retoma sin repetir reuniones', async () => {
  const tree = makeTree();
  let budget = 5; // root, g1, g2, m3, m2
  const first = [];
  const r1 = await scanTree({
    root: { id: 'root', name: 'Minerva', path: 'Minerva' },
    visited: new Set(),
    listChildren: lister(tree),
    handleFolder: async (folder) => { first.push(folder.id); return false; },
    shouldStop: () => budget-- <= 0,
  });
  assert.equal(r1.complete, false);
  assert.deepEqual([...r1.visited].sort(), ['m2', 'm3']);
  assert.equal(r1.pending, 1);

  const calls = [];
  const second = [];
  const r2 = await scanTree({
    root: { id: 'root', name: 'Minerva', path: 'Minerva' },
    visited: r1.visited,
    listChildren: lister(tree, calls),
    handleFolder: async (folder) => { second.push(folder.id); return false; },
    shouldStop: () => false,
  });
  assert.deepEqual(leafOrder(second), ['m1']);
  assert.ok(!calls.includes('m2') && !calls.includes('m3'), 'no vuelve a listar reuniones ya revisadas');
  assert.equal(r2.complete, true);
});

test('scanTree encuentra una reunión nueva aunque el ciclo esté a medias', async () => {
  const tree = makeTree();
  tree.g2.push({ id: 'm4', name: '2026-11-12 – Reunión D' });
  tree.m4 = [];
  const handled = [];
  await scanTree({
    root: { id: 'root', name: 'Minerva', path: 'Minerva' },
    visited: new Set(['m3', 'm2']),
    listChildren: lister(tree),
    handleFolder: async (folder) => { handled.push(folder.id); return false; },
    shouldStop: () => false,
  });
  assert.deepEqual(leafOrder(handled), ['m4', 'm1']);
});

test('scanTree no marca como revisada una reunión cuyos archivos quedaron a medias', async () => {
  const result = await scanTree({
    root: { id: 'root', name: 'Minerva', path: 'Minerva' },
    visited: new Set(),
    listChildren: lister(makeTree()),
    handleFolder: async (folder) => folder.id === 'm3', // se corta en m3
    shouldStop: () => false,
  });
  assert.equal(result.complete, false);
  assert.ok(!result.visited.has('m3'));
});

test('scanTree no marca como revisada una carpeta con listado truncado', async () => {
  const tree = makeTree();
  const result = await scanTree({
    root: { id: 'root', name: 'Minerva', path: 'Minerva' },
    visited: new Set(),
    listChildren: async (folder) => ({
      folders: tree[folder.id] || [],
      files: [],
      truncated: folder.id === 'm1',
    }),
    handleFolder: async () => false,
    shouldStop: () => false,
  });
  assert.equal(result.complete, false);
  assert.ok(!result.visited.has('m1'));
});

test('parseScanState acepta texto JSON u objeto y descarta ids inválidos', () => {
  assert.deepEqual([...parseScanState('{"visited":["abc_1","x-2"]}')], ['abc_1', 'x-2']);
  assert.deepEqual([...parseScanState({ visited: ['abc', "'; DROP"] })], ['abc']);
  assert.equal(parseScanState(null).size, 0);
  assert.equal(parseScanState('no es json').size, 0);
  assert.equal(parseScanState({ visited: 'x' }).size, 0);
});

test('serializeScanState devuelve null sin pendientes y respeta el tope', () => {
  assert.equal(serializeScanState(new Set()), null);
  const many = new Set(Array.from({ length: MAX_VISITED + 10 }, (_, i) => `id${i}`));
  assert.equal(JSON.parse(serializeScanState(many)).visited.length, MAX_VISITED);
  assert.deepEqual([...parseScanState(serializeScanState(new Set(['a', 'b'])))], ['a', 'b']);
});
