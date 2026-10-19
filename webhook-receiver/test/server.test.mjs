import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computeSignature, createApp, verifyWebhook } from '../src/server.mjs';

const secret = 'whsec_abcdefghijklmnopqrstuvwxyz1234567890';

test('firma el cuerpo crudo con event_id y timestamp', () => {
  const rawBody = Buffer.from('{"id":"evt_1"}');
  const timestamp = '1786996800';
  const signature = computeSignature(secret, 'evt_1', timestamp, rawBody);
  assert.match(signature, /^v1=[a-f0-9]{64}$/);
  assert.deepEqual(verifyWebhook({ secret, eventId: 'evt_1', timestamp, signature, rawBody, now: 1786996800000 }), { valid: true, reason: null });
});

test('acepta cualquiera de las firmas enviadas durante una rotacion', () => {
  const previousSecret = 'whsec_previousabcdefghijklmnopqrstuvwxyz1234';
  const rawBody = Buffer.from('{"id":"evt_1"}');
  const timestamp = '1786996800';
  const signature = [
    computeSignature(secret, 'evt_1', timestamp, rawBody),
    computeSignature(previousSecret, 'evt_1', timestamp, rawBody),
  ].join(',');

  assert.deepEqual(verifyWebhook({ secret, eventId: 'evt_1', timestamp, signature, rawBody, now: 1786996800000 }), { valid: true, reason: null });
  assert.deepEqual(verifyWebhook({ secret: previousSecret, eventId: 'evt_1', timestamp, signature, rawBody, now: 1786996800000 }), { valid: true, reason: null });
});

test('rechaza firmas alteradas y timestamps vencidos', () => {
  const rawBody = Buffer.from('{}');
  const timestamp = '1786996800';
  assert.equal(verifyWebhook({ secret, eventId: 'evt_1', timestamp, signature: 'v1=nope', rawBody, now: 1786996800000 }).reason, 'invalid_signature');
  const signature = computeSignature(secret, 'evt_1', timestamp, rawBody);
  assert.equal(verifyWebhook({ secret, eventId: 'evt_1', timestamp, signature, rawBody, now: 1786997800000 }).reason, 'expired_timestamp');
});

test('guarda el secret recortando espacios y saltos de linea al pegarlo', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timermayu-secret-test-'));
  const server = createApp({ dataDir, panelPassword: 'test-password' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = `Basic ${Buffer.from('debug:test-password').toString('base64')}`;
  const response = await fetch(`${base}/debug/webhooks/api/secret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ secret: `  ${secret}\n` }),
  });
  assert.equal(response.status, 200);
  assert.equal(await readFile(path.join(dataDir, 'webhook-secret'), 'utf8'), `${secret}\n`);
});

test('rechaza un valor que no sea un whsec_ valido', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timermayu-secret-test-'));
  const server = createApp({ dataDir, panelPassword: 'test-password' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = `Basic ${Buffer.from('debug:test-password').toString('base64')}`;
  const response = await fetch(`${base}/debug/webhooks/api/secret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ secret: '3i_test_algo.no-es-un-whsec' }),
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: 'secret_invalid' });
});

test('acepta un evento firmado y detecta el duplicado', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timermayu-webhook-test-'));
  await mkdir(path.join(dataDir, 'requests'));
  await mkdir(path.join(dataDir, 'dedupe'));
  await writeFile(path.join(dataDir, 'webhook-secret'), secret);
  const server = createApp({ dataDir, panelPassword: 'test-password' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ id: 'evt_1', type: 'webhook.test', api_version: 'v1', data: {} });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    'Content-Type': 'application/json',
    'Webhook-Id': 'evt_1',
    'Webhook-Delivery': 'dlv_1',
    'Webhook-Timestamp': timestamp,
    'Webhook-Signature': computeSignature(secret, 'evt_1', timestamp, Buffer.from(body)),
  };
  const first = await fetch(`${base}/webhooks/3i`, { method: 'POST', headers, body });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).duplicate, false);
  const second = await fetch(`${base}/webhooks/3i`, { method: 'POST', headers, body });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).duplicate, true);
});
