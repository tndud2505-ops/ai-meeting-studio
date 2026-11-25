import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { __testing as t } from './providers.mjs';

test('prompts containing Korean and shell syntax stay exclusively on stdin', () => {
  const prompt = '한국어 대화 " & whoami; $(echo injected)\n둘째 줄';
  for (const provider of ['codex', 'claude', 'gemini']) {
    const call = t.buildInvocation(provider, 'test-model', 'medium', prompt);
    assert.ok(!call.args.some(argument => argument.includes(prompt)));
    if (provider === 'gemini') assert.equal(JSON.parse(call.input).message.content, prompt);
    else assert.equal(call.input, prompt);
    assert.ok(!call.args.includes('--dangerously-skip-permissions'));
  }
});

test('Claude disables tools using a real empty argv value and preserves OAuth', () => {
  const { args } = t.buildInvocation('claude', '', 'medium', 'hi');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(args.includes('--safe-mode'));
  assert.ok(!args.includes('--bare'));
  assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config') + 1]), { mcpServers: {} });
});

test('Antigravity permissions are session-only and do not force plan output', () => {
  const { args } = t.buildInvocation('gemini', '', '', 'hello');
  assert.ok(!args.includes('plan'));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.ok(settings.permissions.deny.includes('command(*)'));
  assert.ok(settings.permissions.deny.includes('write_file(*)'));
  assert.equal(settings.agentMode, '');
});

test('research enables only public web tools and project mode enables workspace tools without permission bypass',()=>{
  for(const provider of ['codex','claude','gemini']){
    const research=t.buildInvocation(provider,'','low','query','research').args;
    const project=t.buildInvocation(provider,'','low','query','project').args;
    assert.ok(!project.some(a=>a.includes('dangerously')||a==='bypassPermissions'||a==='danger-full-access'));
    if(provider==='codex'){
      assert.ok(research.includes('web_search="live"'));assert.ok(research.includes('features.shell_tool=false'));
      assert.ok(project.includes('workspace-write'));assert.ok(project.includes('features.shell_tool=true'));
    }else if(provider==='claude'){
      assert.equal(research[research.indexOf('--tools')+1],'WebSearch,WebFetch');
      assert.ok(project.includes('--restricted'));assert.match(project[project.indexOf('--tools')+1],/Read.*Edit.*Bash/);
    }else{
      const s=JSON.parse(research[research.indexOf('--settings')+1]);assert.ok(s.permissions.allow.includes('read_url(*)'));assert.ok(s.permissions.deny.includes('command(*)'));
      assert.ok(project.includes('--sandbox'));assert.ok(!JSON.parse(project[project.indexOf('--settings')+1]).permissions.deny.includes('write_file(*)'));
    }
  }
});

test('tool evidence stores only categories, never tool arguments',()=>{
  const p=t.createParser('codex');
  p.consume({type:'item.completed',item:{type:'web_search',query:'SECRET'}});
  p.consume({type:'item.completed',item:{type:'command_execution',command:'PRIVATE'}});
  assert.deepEqual([...p.data.tools],['web','terminal']);
  assert.ok(!JSON.stringify(p.data).includes('SECRET'));
  const q=t.createParser('claude');q.consume({type:'assistant',message:{content:[{type:'tool_use',name:'WebFetch',input:{url:'private'}}]}});
  assert.deepEqual([...q.data.tools],['web']);
});

test('Codex emits only answer text once and ignores reasoning/commentary', () => {
  const deltas = [];
  const p = t.createParser('codex', delta => deltas.push(delta));
  p.consume({ type: 'item.completed', item: { type: 'reasoning', text: 'private reasoning' } });
  p.consume({ type: 'item.completed', item: { type: 'agent_message', phase: 'commentary', text: 'tool preamble' } });
  p.consume({ type: 'item.updated', item: { id: '1', type: 'agent_message', text: '안녕' } });
  p.consume({ type: 'item.completed', item: { id: '1', type: 'agent_message', text: '안녕하세요.' } });
  p.consume({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3 } });
  assert.equal(deltas.join(''), '안녕하세요.');
  assert.equal(p.data.success, true);
  assert.equal(p.data.usage.output_tokens, 3);
});

test('Claude streaming plus final response does not duplicate text', () => {
  const deltas = [];
  const p = t.createParser('claude', delta => deltas.push(delta));
  p.consume({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } } });
  p.consume({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '확인' } } });
  p.consume({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' 완료' } } });
  p.consume({ type: 'assistant', message: { content: [{ type: 'text', text: '확인 완료' }], model: 'claude-example' } });
  p.consume({ type: 'result', subtype: 'success', is_error: false, result: '확인 완료' });
  assert.equal(deltas.join(''), '확인 완료');
  assert.equal(p.data.final, '확인 완료');
  assert.equal(p.data.success, true);
});

test('Antigravity parses public agent-response deltas and errors honestly', () => {
  const deltas = [];
  const p = t.createParser('gemini', delta => deltas.push(delta));
  p.consume({ event: 'step_update', step_update: { step_type: 'thinking', text_delta: 'hidden' } });
  p.consume({ event: 'step_update', step_update: { step_type: 'agent_response', step_index: 1, text_delta: '안녕' } });
  p.consume({ event: 'step_update', step_update: { step_type: 'agent_response', step_index: 1, text_delta: '하세요' } });
  p.consume({ event: 'result', result: { status: 'SUCCESS', response: '안녕하세요' } });
  assert.equal(deltas.join(''), '안녕하세요');
  p.consume({ event: 'result', result: { status: 'ERROR', error: 'authentication required' } });
  assert.equal(p.data.success, false);
  assert.equal(p.data.failure, 'authentication required');
});

test('Gemini effort variants are grouped without invented levels', () => {
  const parsed = t.parseAgyModels('gemini-3.8-flash-high  Gemini 3.8 Flash (High)\ngemini-3.8-flash-medium  Gemini 3.8 Flash (Medium)\ngemini-3.8-flash-low  Gemini 3.8 Flash (Low)');
  assert.deepEqual(parsed, [{ id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'] }]);
});

test('untrusted model names and raw secrets do not escape validation/redaction', () => {
  for (const model of ['--dangerous', 'name\n--extra', 'name;command', '$(command)']) assert.throws(() => t.validModel(model));
  assert.equal(t.validModel('gpt-6.2-sol'), 'gpt-6.2-sol');
  assert.ok(!t.redact('Bearer abcdefghij').includes('abcdefghij'));
  assert.ok(!t.redact('user@example.com').includes('user@example.com'));
  const env = t.cliEnvironment();
  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) assert.equal(env[name], undefined);
});

test('verification evidence preserves a real challenge reply and redacts account data', () => {
  const evidence = t.cleanVerification({
    status: 'verified', checkedAt: '2026-11-25T01:00:00Z',
    challenge: 'MEETING-123456ABCDEF', challengeVerified: true,
    reply: '연결되었습니다. MEETING-123456ABCDEF user@example.com Bearer hidden-secret',
    requestedModel: 'sonnet', resolvedModel: 'claude-example', modelSource: 'cli',
    effort: 'low', durationMs: 1234.4, cliVersion: '2.1.309',
    token: 'must not be persisted', rawLogs: 'must not be persisted',
  }, 'claude');
  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.modelSource, 'cli');
  assert.equal(evidence.durationMs, 1234);
  assert.ok(evidence.reply.includes('MEETING-123456ABCDEF'));
  assert.ok(!evidence.reply.includes('user@example.com'));
  assert.ok(!evidence.reply.includes('hidden-secret'));
  assert.equal(evidence.token, undefined);
  assert.equal(evidence.rawLogs, undefined);
  const forged = t.cleanVerification({ ...evidence, reply: 'success' }, 'claude');
  assert.equal(forged.status, 'failed');
  assert.equal(forged.challengeVerified, false);
  assert.equal(forged.code, 'VERIFICATION_MISMATCH');
});

test('verification records survive restart with serialized atomic writes and no secrets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'meeting-provider-checks-'));
  try {
    const file = path.join(dir, 'checks.json');
    const store = t.createVerificationStore(file);
    const base = { status: 'verified', checkedAt: '2026-11-25T01:00:00Z', challenge: 'MEETING-123456ABCDEF', challengeVerified: true, reply: '연결되었습니다. MEETING-123456ABCDEF', requestedModel: 'test', durationMs: 99 };
    await Promise.all([store.save('codex', base), store.save('gemini', base), store.save('claude', { ...base, status: 'login_required', reply: '', code: 'LOGIN_REQUIRED', challengeVerified: false })]);
    const reopened = t.createVerificationStore(file);
    await reopened.load();
    assert.equal(reopened.get('codex').status, 'verified');
    assert.equal(reopened.get('gemini').persisted, true);
    assert.equal(reopened.get('claude').status, 'login_required');
    const detached = reopened.get('codex');
    detached.status = 'failed';
    assert.equal(reopened.get('codex').status, 'verified');
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(persisted.version, 1);
    assert.deepEqual(Object.keys(persisted.providers).sort(), ['claude', 'codex', 'gemini']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function assertProcessesExited(pids) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const alive = pids.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (!alive.length) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('An adapter-owned fixture process survived cancellation.');
}

test('abort terminates the adapter-owned process and its child on Windows', async () => {
  const controller = new AbortController();
  let pids = [];
  const fixture = "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(JSON.stringify([process.pid,child.pid])); setInterval(()=>{},1000);";
  await assert.rejects(t.execute({ executable: process.execPath, prefix: [] }, ['-e', fixture], {
    signal: controller.signal,
    timeout: 5000,
    onLine: line => { pids = JSON.parse(line); controller.abort(); },
  }), /aborted/);
  assert.equal(pids.length, 2);
  await assertProcessesExited(pids);
});

test('timeout terminates a stalled adapter-owned process', async () => {
  let pid;
  await assert.rejects(t.execute({ executable: process.execPath, prefix: [] }, ['-e', 'console.log(process.pid); setInterval(()=>{},1000);'], {
    timeout: 500,
    onLine: line => { pid = Number(line); },
  }), /timeout/);
  assert.ok(pid > 0);
  await assertProcessesExited([pid]);
});
