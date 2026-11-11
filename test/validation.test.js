import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertId, assertIds, MAX_BULK_IDS } from '../src/resolvers/validation.js';

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('assertId acepta UUID y rechaza otros valores', () => {
  assert.equal(assertId(uuid(1)), uuid(1));
  assert.throws(() => assertId('1; DROP TABLE'), /no válido/);
  assert.throws(() => assertId(42), /no válido/);
});

test('assertIds devuelve los ids válidos sin duplicados', () => {
  assert.deepEqual(assertIds([uuid(1), uuid(2), uuid(1)]), [uuid(1), uuid(2)]);
});

test('assertIds rechaza vacío, no-array, exceso e ids inválidos', () => {
  assert.throws(() => assertIds([]), /Selecciona/);
  assert.throws(() => assertIds('x'), /Selecciona/);
  assert.throws(
    () => assertIds(Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => uuid(i))),
    /Máximo/
  );
  assert.throws(() => assertIds([uuid(1), 'malo']), /no válido/);
});
