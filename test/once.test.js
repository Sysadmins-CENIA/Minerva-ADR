import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onceUntilSuccess } from '../src/shared/once.js';

test('onceUntilSuccess ejecuta una sola vez aunque se llame en paralelo', async () => {
  let calls = 0;
  const run = onceUntilSuccess(async () => { calls++; return 'ok'; });

  assert.deepEqual(await Promise.all([run(), run(), run()]), ['ok', 'ok', 'ok']);
  assert.equal(calls, 1);
});

test('onceUntilSuccess reintenta en la siguiente llamada si falla', async () => {
  let calls = 0;
  const run = onceUntilSuccess(async () => {
    calls++;
    if (calls === 1) throw new Error('falla');
    return 'ok';
  });

  await assert.rejects(run(), /falla/);
  assert.equal(await run(), 'ok');
  assert.equal(calls, 2);
});
