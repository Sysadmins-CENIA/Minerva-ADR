import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dateFromPath } from '../src/shared/dates.js';

test('dateFromPath toma la fecha de una carpeta de la ruta', () => {
  assert.equal(
    dateFromPath('Minerva/Sin grupo/2026-11-04 – Reunión On Demand 1/Seguimiento de Portafolio y Equipo PM.md'),
    '2026-11-04'
  );
});

test('dateFromPath prefiere la fecha más cercana al archivo', () => {
  assert.equal(dateFromPath('2025-01-01 archivo/2026-11-05 reunión/acta.md'), '2026-11-05');
});

test('dateFromPath devuelve null sin fecha válida', () => {
  assert.equal(dateFromPath('Minerva/acta.md'), null);
  assert.equal(dateFromPath('2026-13-40 raro/acta.md'), null);
  assert.equal(dateFromPath(null), null);
});
