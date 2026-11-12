import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onceUntilSuccess, retry } from '../src/shared/once.js';

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

test('retry reintenta hasta que fn funciona', async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls++;
    if (calls < 3) throw new Error('otra instancia migrando');
    return 'ok';
  }, 4, 0);

  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('retry lanza el último error si se agotan los intentos', async () => {
  let calls = 0;
  await assert.rejects(
    retry(async () => { calls++; throw new Error(`falla ${calls}`); }, 3, 0),
    /falla 3/
  );
  assert.equal(calls, 3);
});
