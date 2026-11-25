import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeetingEngine, buildPrompt } from './engine.mjs';
import { chooseFlow, normalizeWorkflow } from './workflow.mjs';

const qaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'qa');
const ready = ['codex', 'claude', 'gemini'].map(id => ({ id, installed: true, auth: 'ready' }));
const participants = ready.map(p => ({ id: p.id, provider: p.id, name: p.id.toUpperCase(), model: '', effort: 'default', enabled: true }));

async function run(t, stancePlan, maxRounds) {
  await mkdir(qaRoot, { recursive: true });
  const temp = await mkdtemp(path.join(qaRoot, 'debate-test-'));
  let turn = 0;
  const prompts = [];
  const engine = new MeetingEngine({
    dataDir: path.join(temp, 'rooms'), workDir: path.join(temp, 'workdir'), getProviders: async () => ready, broadcast: () => {},
    runProvider: async req => { prompts.push(req.prompt); const i = turn++; const final = req.prompt.includes('자동 토론 결론 단계'); return { text: final ? '최종 결론입니다.' : '발언 ' + i + '\n[입장: ' + stancePlan(i) + ']', durationMs: 1 }; },
  });
  await engine.init();
  t.after(async () => { await engine.shutdown(); await rm(temp, { recursive: true, force: true }); });
  const room = await engine.create({ title: '회의', topic: '주제', mode: 'meeting', rounds: 1, turnDelayMs: 0, wordLimit: 90, userLed: true, participants, flow: 'debate', access: 'chat', maxRounds });
  await engine.message(room.id, '토론 주제');
  await engine.start(room.id);
  await engine.jobs.get(room.id)?.promise;
  return { room: engine.get(room.id), prompts };
}

test('debate flow is chosen unless the project mode forces a single writer', () => {
  assert.equal(chooseFlow({ flow: 'debate', access: 'research' }, '토론'), 'debate');
  assert.equal(chooseFlow({ flow: 'debate', access: 'project' }, '토론'), 'sequential');
  assert.equal(normalizeWorkflow({ flow: 'debate', maxRounds: 99 }).maxRounds, 10);
  assert.equal(normalizeWorkflow({ flow: 'debate' }).maxRounds, 5);
});

test('debate ends early once everyone agrees in a full round, then writes the conclusion', { timeout: 10000 }, async t => {
  // 3 AIs: round 1 disagrees, round 2 all agree -> 6 turns + 1 conclusion
  const { room, prompts } = await run(t, i => (i >= 3 ? '합의' : '계속'), 6);
  const speeches = room.messages.filter(m => m.kind === 'speech');
  assert.equal(speeches.length, 7);
  assert.equal(room.debate.reason, 'agreed');
  assert.equal(speeches.at(-1).phase, 'debate-final');
  assert.ok(speeches.slice(0, 6).every(m => m.phase === 'debate' && !m.text.includes('입장')));
  assert.ok(prompts.at(-1).includes('참가자 모두 합의했습니다'));
  assert.equal(room.status, 'paused');
});

test('debate stops at the maximum round when nobody settles, and says so', { timeout: 10000 }, async t => {
  const { room, prompts } = await run(t, () => '계속', 2);
  const speeches = room.messages.filter(m => m.kind === 'speech');
  assert.equal(speeches.length, 7);
  assert.equal(room.debate.reason, 'max');
  assert.ok(prompts.at(-1).includes('합의하지 못했습니다'));
});

test('a partial agreement in one round does not end the debate', { timeout: 10000 }, async t => {
  const { room } = await run(t, i => (i % 3 === 0 ? '계속' : '합의'), 2);
  assert.equal(room.debate.reason, 'max');
});

test('debate prompt tells the AI to debate on its own instead of waiting for the user', () => {
  const room = { messages: [], mode: 'meeting', nextTurn: 0, cycleStartTurn: 0, cycleOrder: ['codex', 'claude', 'gemini'], debate: { max: 4, final: false, reason: '' }, config: { userLed: true, participants, rounds: 1, wordLimit: 90, access: 'chat' }, topic: 't' };
  const { prompt } = buildPrompt(room, participants[0], 'debate');
  assert.match(prompt, /사용자 개입 없이 AI 참가자끼리/);
  assert.doesNotMatch(prompt, /결론을 확정하지 마세요/);
  assert.match(prompt, /1\/최대 4라운드/);
  assert.match(prompt, /\[입장: 합의\]/);
});
