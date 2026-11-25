import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProfileStore, normalizeProfile } from './profiles.mjs';

const input = { displayName: '기획자', color: '#e5eee7', avatar: { kind: 'emoji', value: '🌿' } };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1sAAAAASUVORK5CYII=';
test('profiles persist all identities across concurrent saves and server reloads', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'meeting-profiles-'));
  try {
    const filename = path.join(directory, 'profiles.json');
    const store = createProfileStore(filename);
    assert.deepEqual((await store.getProfiles()).map(p => p.id), ['codex', 'claude', 'gemini', 'user']);
    await Promise.all([store.saveProfile('codex', input), store.saveProfile('user', { ...input, displayName: '진행자' })]);
    const restored = createProfileStore(filename);
    assert.equal((await restored.getProfile('codex')).displayName, '기획자');
    assert.equal((await restored.getProfile('user')).displayName, '진행자');
    assert.equal((await restored.getProfile('claude')).displayName, 'Claude');
    const copy = await restored.getProfile('codex'); copy.avatar.value = 'X';
    assert.equal((await restored.getProfile('codex')).avatar.value, '🌿');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('profile identities are fixed and labels cannot add new prompt lines', () => {
  assert.throws(() => normalizeProfile('../elsewhere', input));
  assert.equal(normalizeProfile('codex', { ...input, id: 'user', displayName: ' A\nB\u202e ' }).displayName, 'A B');
  assert.equal(normalizeProfile('codex', { ...input, id: 'user' }).id, 'codex');
  assert.throws(() => normalizeProfile('user', { ...input, displayName: 'x'.repeat(33) }));
  assert.throws(() => normalizeProfile('user', { ...input, color: 'url(https://example.test/)' }));
});
test('avatar storage accepts small raster images and rejects remote, SVG, fake and oversized data', () => {
  const valid = normalizeProfile('user', { ...input, avatar: { kind: 'image', value: `data:image/png;base64,${png}` } });
  assert.match(valid.avatar.value, /^data:image\/png/);
  for (const value of ['https://example.test/me.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHNjcmlwdD4=', 'data:image/png;base64,' + 'A'.repeat(140000)]) {
    assert.throws(() => normalizeProfile('user', { ...input, avatar: { kind: 'image', value } }));
  }
  const huge = Buffer.from(png, 'base64'); huge.writeUInt32BE(100000, 16);
  assert.throws(() => normalizeProfile('user', { ...input, avatar: { kind: 'image', value: `data:image/png;base64,${huge.toString('base64')}` } }));
});
test('corrupt persisted data is not silently replaced by a new save', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'meeting-profiles-'));
  try {
    const filename = path.join(directory, 'profiles.json');
    await writeFile(filename, 'broken');
    const store = createProfileStore(filename);
    await assert.rejects(store.saveProfile('codex', input), /프로필/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('avatar validation accepts actual opaque, lossless and transparent WebP encodings', () => {
  // Deterministic 17×13 images encoded with Pillow/libwebp, covering the
  // VP8, VP8L and VP8X headers produced by common photo/canvas encoders.
  const samples = [
    ['VP8 ', 'UklGRjwAAABXRUJQVlA4IDAAAACwAgCdASoRAA0APmEmkEUkIiGYBABABgSygABCBgAA/ttR/0l0uQ3/160tzbiAAAA='],
    ['VP8L', 'UklGRh4AAABXRUJQVlA4TBEAAAAvEAADAAfQztp1r/+BiOh/AAA='],
    ['VP8X', 'UklGRmAAAABXRUJQVlA4WAoAAAAQAAAAEAAADAAAQUxQSAoAAAABB1DAiAhERP8DVlA4IDAAAACwAgCdASoRAA0APmEmkEUkIiGYBABABgSygABCBgAA/ttR/0l0uQ3/160tzbiAAAA='],
  ];
  for (const [chunk, base64] of samples) {
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(bytes.toString('ascii', 12, 16), chunk);
    const avatar = { kind: 'image', value: `data:image/webp;base64,${base64}` };
    assert.deepEqual(normalizeProfile('user', { ...input, avatar }).avatar, avatar, chunk);
  }
  const oversized = Buffer.from(samples[2][1], 'base64');
  oversized.writeUIntLE(512, 24, 3); // VP8X stores width minus one: 513 px.
  assert.throws(() => normalizeProfile('user', { ...input, avatar: { kind: 'image', value: `data:image/webp;base64,${oversized.toString('base64')}` } }), /512/);
});
