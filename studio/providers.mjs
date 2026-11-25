import { spawn } from 'node:child_process';
import { access, readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IS_WINDOWS = process.platform === 'win32';
const CACHE_MS = 30_000;
const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_ANSWER = 100_000;
const TIMEOUT_MS = 180_000;
const names = { codex: 'Codex', claude: 'Claude', gemini: 'Gemini' };
const state = new Map();
const loginWindows = new Map();
const loginLaunches = new Map();
let discoveryPromise;
let discoveryAt = 0;
let cachedProviders;
const verificationStore = createVerificationStore(path.join(HERE, 'data', 'provider-checks.json'));

// Credentials stay with the vendor CLI. Deliberately do not read credential files.
function cliEnvironment() {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  for (const key of Object.keys(env)) {
    if (/^(?:CODEX_API_KEY|OPENAI_API_KEY|OPENAI_BASE_URL|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|CLAUDE_CODE_SIMPLE|CLAUDECODE|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_APPLICATION_CREDENTIALS)$/i.test(key)) delete env[key];
  }
  return env;
}

function validProvider(value) {
  if (!Object.hasOwn(names, value)) throw new Error('지원하지 않는 AI입니다.');
  return value;
}

function validModel(value = '') {
  if (typeof value !== 'string' || value.length > 160 || (value && !/^[a-zA-Z0-9][a-zA-Z0-9._:/()+ -]*$/.test(value))) {
    throw new Error('모델 이름은 영문, 숫자, 점, 밑줄, 하이픈 등으로 입력해 주세요.');
  }
  return value.trim();
}

function validEffort(value = '') {
  if (value === 'auto' || value === 'default' || value == null) return '';
  if (!['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value)) throw new Error('지원하지 않는 추론 강도입니다.');
  return value;
}

function redact(value) {
  return String(value || '')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/(?:Bearer\s+)[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|sk-ant|AIza)[-_a-zA-Z0-9]{15,}\b/g, '[redacted]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[redacted]')
    .replace(/((?:access|refresh|id)[_-]?token|api[_-]?key|authorization)(["'\s:=]+)[^\s,;}]+/gi, '$1$2[redacted]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[account]');
}

function cleanVerification(value, provider) {
  if (!value || typeof value !== 'object' || !Object.hasOwn(names, provider)) return null;
  const statuses = ['verified', 'failed', 'login_required', 'missing'];
  if (!statuses.includes(value.status) || !Number.isFinite(Date.parse(value.checkedAt))) return null;
  const clean = (key, max = 160) => redact(typeof value[key] === 'string' ? value[key] : '').slice(0, max);
  const result = {
    id: clean('id', 64), provider, status: value.status,
    checkedAt: new Date(value.checkedAt).toISOString(),
    requestedModel: clean('requestedModel'), resolvedModel: clean('resolvedModel'),
    modelSource: value.modelSource === 'cli' ? 'cli' : 'requested',
    effort: clean('effort', 24), cliVersion: clean('cliVersion', 100),
    challenge: /^MEETING-[A-F0-9]{12}$/.test(value.challenge) ? value.challenge : '',
    challengeVerified: value.challengeVerified === true && value.status === 'verified',
    reply: clean('reply', 4000),
    durationMs: Number.isFinite(value.durationMs) ? Math.max(0, Math.round(value.durationMs)) : 0,
    code: clean('code', 64), message: clean('message', 1000),
    persisted: value.persisted === true,
  };
  // A historical success is useful evidence only with the actual challenge response.
  if (result.status === 'verified' && (!result.challenge || !result.challengeVerified || !result.reply.includes(result.challenge))) {
    result.status = 'failed'; result.challengeVerified = false;
    result.code = 'VERIFICATION_MISMATCH'; result.message = '응답 확인 코드가 일치하지 않습니다.';
  }
  return result;
}

function createVerificationStore(file) {
  let records = {}, loading, queue = Promise.resolve();
  async function load() {
    if (!loading) loading = (async () => {
      try {
        const text = await readFile(file, 'utf8');
        if (text.length > 64 * 1024) return;
        const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
        if (parsed?.version !== 1 || !parsed.providers || typeof parsed.providers !== 'object') return;
        for (const provider of Object.keys(names)) {
          const evidence = cleanVerification(parsed.providers[provider], provider);
          if (evidence) records[provider] = evidence;
        }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !(error instanceof SyntaxError)) throw error;
      }
    })();
    await loading;
    return structuredClone(records);
  }
  async function save(provider, value) {
    const evidence = cleanVerification(value, provider);
    if (!evidence) throw new Error('유효하지 않은 연결 확인 기록입니다.');
    const task = queue.catch(() => {}).then(async () => {
      await load();
      records[provider] = { ...evidence, persisted: true };
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, providers: records }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, file);
      } catch (error) {
        records[provider] = { ...evidence, persisted: false };
        await unlink(temporary).catch(() => {});
        throw error;
      }
      return structuredClone(records[provider]);
    });
    queue = task;
    return task;
  }
  return { load, save, get: provider => structuredClone(records[provider] || null) };
}

async function saveVerification(provider, evidence) {
  let saved;
  try { saved = await verificationStore.save(provider, evidence); }
  catch { saved = { ...cleanVerification(evidence, provider), persisted: false }; }
  const record = state.get(provider);
  if (record) record.descriptor.verification = saved;
  const descriptor = cachedProviders?.find(item => item.id === provider);
  if (descriptor) descriptor.verification = saved;
  return saved;
}

function providerError(provider, raw = '', code) {
  const text = redact(raw).slice(-8000);
  let message = `${names[provider]} 실행에 실패했습니다. 연결 상태와 선택한 모델을 확인해 주세요.`;
  let kind = 'PROVIDER_ERROR';
  if (/aborted|aborterror|cancelled|canceled/i.test(text)) { message = '요청을 중지했습니다.'; kind = 'ABORTED'; }
  else if (/timeout|timed out|시간 초과/i.test(text)) { message = `${names[provider]} 응답 제한 시간을 초과했습니다. 다시 실행하거나 추론 강도를 낮춰 주세요.`; kind = 'TIMEOUT'; }
  else if (/authentication required|not logged|not authenticated|login required|sign.?in|please log.?in|unauthorized|expired.*(?:token|credential)|401|invalid.*(?:token|credential)/i.test(text)) { message = `${names[provider]} 공식 CLI에서 구독 계정에 로그인한 뒤 다시 연결 확인을 눌러 주세요.`; kind = 'LOGIN_REQUIRED'; }
  else if (/quota|rate.?limit|usage.?limit|429|capacity|resource.?exhausted|credit|usage.*exceed|limit.*reached/i.test(text)) { message = `${names[provider]} 사용량 한도 또는 일시적인 처리 한도에 도달했습니다. 공식 CLI에서 한도를 확인한 뒤 다시 시도해 주세요.`; kind = 'RATE_LIMIT'; }
  else if (/unknown model|invalid model|model.*(?:not found|unsupported|not supported|not available|does not exist)|model_not_found/i.test(text)) { message = `${names[provider]}에서 선택한 모델을 사용할 수 없습니다. 계정에서 이용 가능한 모델을 선택해 주세요.`; kind = 'MODEL_UNAVAILABLE'; }
  else if (/effort|reasoning.*(?:unsupported|invalid|not supported)/i.test(text)) { message = `${names[provider]}의 해당 모델이 선택한 추론 강도를 지원하지 않습니다. 기본값이나 다른 강도를 선택해 주세요.`; kind = 'EFFORT_UNAVAILABLE'; }
  else if (/unknown (?:option|argument)|unexpected argument|unrecognized (?:option|argument)|invalid value.*(?:--|flag)/i.test(text)) { message = `${names[provider]} CLI 버전과 실행 옵션이 맞지 않습니다. 공식 CLI 업데이트 또는 연결 설정 확인이 필요합니다.`; kind = 'CLI_INCOMPATIBLE'; }
  else if (/ENOENT|not found|설치되지/i.test(text)) { message = `${names[provider]} 공식 CLI 실행 파일을 찾을 수 없습니다.`; kind = 'MISSING'; }
  else if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network|TLS|certificate|connection/i.test(text)) { message = `${names[provider]} 서비스에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.`; kind = 'NETWORK_ERROR'; }
  const error = new Error(message);
  error.code = kind;
  if (Number.isInteger(code)) error.exitCode = code;
  return error;
}

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function resolveCli(command) {
  const candidates = [];
  const add = (executable, prefix = []) => { if (executable) candidates.push({ executable, prefix }); };
  const home = os.homedir();
  if (IS_WINDOWS) {
    if (command === 'claude') add(path.join(home, '.local', 'bin', 'claude.exe'));
    if (command === 'agy' && process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'));
    const npm = process.env.APPDATA && path.join(process.env.APPDATA, 'npm');
    if (npm && command === 'codex') add(process.execPath, [path.join(npm, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')]);
    if (npm && command === 'gemini') add(process.execPath, [path.join(npm, 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js')]);
    if (npm && command === 'claude') add(process.execPath, [path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')]);
  }
  for (const dir of (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)) {
    if (IS_WINDOWS) {
      add(path.join(dir.replace(/^"|"$/g, ''), command + '.exe'));
      // npm .cmd wrappers are read solely to locate the JS entry, never run in a shell.
      const wrapper = path.join(dir.replace(/^"|"$/g, ''), command + '.cmd');
      try {
        const source = (await readFile(wrapper, 'utf8')).slice(0, 16384);
        const match = source.match(/%(?:~dp0|dp0%)[\\/]([^"\r\n]*\.(?:mjs|cjs|js))/i);
        if (match) add(process.execPath, [path.resolve(path.dirname(wrapper), match[1].replaceAll('\\', path.sep))]);
      } catch {}
    } else add(path.join(dir, command));
  }
  for (const candidate of candidates) {
    if (await exists(candidate.executable) && (!candidate.prefix.length || await exists(candidate.prefix[0]))) return candidate;
  }
  return null;
}

function terminateOwnTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WINDOWS) {
    const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
    killer.on('error', () => { try { child.kill(); } catch {} });
    killer.unref();
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
    const hardKill = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1000);
    hardKill.unref();
  }
}

function execute(cli, args, { cwd = HERE, input = '', signal, timeout = TIMEOUT_MS, onLine, maxOutput = MAX_OUTPUT } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const started = Date.now();
    let settled = false, output = '', stderr = '', lineBuffer = '', size = 0, fatal;
    const child = spawn(cli.executable, [...cli.prefix, ...args], {
      cwd, shell: false, windowsHide: true, detached: !IS_WINDOWS,
      env: cliEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
    });
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve({ code, stdout: output, stderr, durationMs: Date.now() - started });
    };
    const fail = error => { fatal = error; terminateOwnTree(child); finish(error); };
    const abort = () => fail(new Error('aborted'));
    const timer = setTimeout(() => fail(new Error('timeout')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', error => finish(error));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > maxOutput) return fail(new Error('CLI output limit exceeded'));
      if (!onLine) output += chunk;
      lineBuffer += chunk;
      if (onLine) {
        let newline;
        while ((newline = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, newline).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(newline + 1);
          try { onLine(line); } catch (error) { return fail(error); }
        }
      }
    });
    child.stderr.on('data', chunk => { if (!settled) stderr = (stderr + chunk).slice(-32768); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE' && !settled) fail(error); });
    child.on('close', code => {
      if (settled) return;
      if (onLine && lineBuffer.trim()) { try { onLine(lineBuffer); } catch (error) { return finish(error); } }
      finish(fatal, code);
    });
    child.stdin.end(input, 'utf8');
  });
}

function safeUsage(value) {
  if (!value || typeof value !== 'object') return undefined;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|duration|latency|turn|cache|request|input|output|total/i.test(key) && typeof item === 'number' && Number.isFinite(item)) output[key] = item;
  }
  return Object.keys(output).length ? output : undefined;
}

function createParser(provider, onDelta = () => {}) {
  const data = { text: '', delivered: '', final: '', success: false, failure: '', usage: undefined, model: '', items: new Map(), tools: new Set() };
  function recordTool(name) {
    // Record only known tool categories. Never persist tool inputs, commands,
    // model reasoning or raw CLI events.
    if(typeof name!=='string')return;
    if(/^(web_search|websearch|webfetch|read_url_content|search_web|read_url|web_fetch)$/i.test(name))data.tools.add('web');
    else if(/^(command_execution|run_command|bash|powershell|terminal_command)$/i.test(name))data.tools.add('terminal');
    else if(/^(file_change|read_file|write_file|list_directory|grep_search|view_file|read|glob|grep|edit|write|multi_edit|replace_file_content)$/i.test(name))data.tools.add('files');
  }
  function publish(text) {
    if (text.length > MAX_ANSWER) throw new Error('CLI output limit exceeded');
    data.text = text;
    if (text.startsWith(data.delivered)) {
      const delta = text.slice(data.delivered.length);
      if (delta) onDelta(delta);
      data.delivered = text;
    }
  }
  function consume(event) {
    if (!event || typeof event !== 'object') return;
    if (provider === 'codex') {
      if (event.type === 'item.completed' || event.type === 'item.updated') {
        const item = event.item;
        if(event.type==='item.completed')recordTool(item?.type);
        if (item?.type === 'agent_message' && typeof item.text === 'string' && item.phase !== 'commentary') {
          data.items.set(item.id || 'answer', item.text);
          publish([...data.items.values()].join('\n\n'));
        }
      }
      if (event.type === 'turn.completed') { data.success = true; data.failure = ''; data.usage = safeUsage(event.usage); }
      if (event.type === 'turn.failed') data.failure = event.error?.message || event.message || 'Codex turn failed';
      if (event.type === 'error') data.failure = event.message || event.error?.message || 'Codex error';
    } else if (provider === 'claude') {
      if (event.type === 'system' && event.subtype === 'init') data.model = String(event.model || '');
      if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') publish(data.text + (event.event.delta.text || ''));
      if (event.type === 'assistant' && event.message?.content) {
        for(const block of event.message.content)if(block.type==='tool_use')recordTool(block.name);
        const text = event.message.content.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
        if (text) publish(text);
        if (event.message.model) data.model = event.message.model;
      }
      if (event.type === 'result') {
        data.success = event.is_error !== true && (!event.subtype || event.subtype === 'success');
        if (!data.success) data.failure = (event.errors || []).join(' ') || event.result || event.subtype || 'Claude result error';
        else if (typeof event.result === 'string') { data.final = event.result; publish(event.result); }
        data.usage = safeUsage(event.usage);
      }
    } else {
      if(event.event==='step_update'){
        const step=event.step_update||{};
        recordTool(step.step_type);
        recordTool(step.tool_name);
        recordTool(step.tool?.name);
      }
      if (event.event === 'step_update' && event.step_update?.step_type === 'agent_response') {
        const step = event.step_update;
        if (typeof step.text_delta === 'string') {
          const key = String(step.step_index ?? 'answer');
          data.items.set(key, (data.items.get(key) || '') + step.text_delta);
          publish([...data.items.values()].join('\n\n'));
        }
      }
      if (event.event === 'result') {
        const result = event.result || {};
        data.success = result.status === 'SUCCESS';
        if (!data.success) data.failure = typeof result.error === 'string' ? result.error : result.error?.message || result.status || 'Antigravity error';
        if (typeof result.response === 'string') { data.final = result.response; if (data.success) publish(result.response); }
        data.usage = safeUsage(result.usage);
        if (result.model) data.model = result.model;
      }
    }
  }
  return {
    data,
    consume,
    line(line) {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      consume(event);
    },
  };
}

async function codexModels() {
  // This cache contains public model metadata. Whitelist fields before returning anything.
  const cacheRoot = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  try {
    const source = await readFile(path.join(cacheRoot, 'models_cache.json'), 'utf8');
    if (source.length > 12 * 1024 * 1024) return [];
    const cache = JSON.parse(source.replace(/^\uFEFF/, ''));
    return (Array.isArray(cache.models) ? cache.models : []).filter(m => typeof m.slug === 'string' && /^(?:gpt-|o[1-9])/.test(m.slug) && !m.slug.includes('/') && m.visibility !== 'hidden').slice(0, 60).map(m => ({
      id: validModel(m.slug), label: String(m.display_name || m.slug).slice(0, 100),
      efforts: (m.supported_reasoning_levels || []).map(e => typeof e === 'string' ? e : e.effort).filter(e => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(e)),
    }));
  } catch { return []; }
}

function parseAgyModels(text) {
  const groups = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(gemini-[a-zA-Z0-9._-]+)\s+(.+)$/);
    if (match) {
      const suffix = match[1].match(/-(low|medium|high|xhigh|max)$/)?.[1];
      const family = suffix ? match[1].replace(/-(low|medium|high|xhigh|max)$/, '') : match[1];
      const existing = groups.get(family);
      if (existing) {
        if (suffix && !existing.efforts.includes(suffix)) existing.efforts.push(suffix);
        if (suffix === 'medium') existing.id = match[1];
      } else groups.set(family, { id: match[1], label: match[2].trim().replace(/\s*\((?:Low|Medium|High|XHigh|Max)\)\s*$/i, '').slice(0, 100), efforts: suffix ? [suffix] : [] });
    }
  }
  return [...groups.values()].slice(0, 80).map(model => ({ ...model, efforts: ['low', 'medium', 'high', 'xhigh', 'max'].filter(e => model.efforts.includes(e)) }));
}

async function inspect(provider) {
  const old = state.get(provider);
  const command = provider === 'gemini' ? 'agy' : provider;
  const cli = await resolveCli(command);
  const result = { id: provider, name: names[provider], installed: Boolean(cli), auth: cli ? 'unknown' : 'missing', authStatus: cli ? 'unknown' : 'missing', authCheckedAt: new Date().toISOString(), verification: verificationStore.get(provider), message: '', version: '', models: [], defaultModel: '', defaultEffort: 'medium' };
  if (!cli) {
    result.message = provider === 'gemini' ? 'Gemini 개인 계정은 Antigravity CLI 설치·로그인이 필요합니다.' : `${names[provider]} 공식 CLI 설치가 필요합니다.`;
    state.set(provider, { cli: null, descriptor: result });
    return result;
  }
  const versionCall = execute(cli, ['--version'], { timeout: 10_000, maxOutput: 128_000 });
  const authCall = execute(cli, provider === 'codex' ? ['login', 'status'] : provider === 'claude' ? ['auth', 'status'] : ['models'], { timeout: 15_000, maxOutput: 256_000 });
  const [versionResult, authResult] = await Promise.allSettled([versionCall, authCall]);
  if (versionResult.status === 'fulfilled') result.version = redact(versionResult.value.stdout || versionResult.value.stderr).trim().split(/\r?\n/).find(line => /\d+\.\d+/.test(line))?.slice(0, 100) || '';
  if (provider === 'codex') result.models = await codexModels();
  if (provider === 'claude') result.models = [
    { id: '', label: 'CLI 기본 모델', efforts: ['low', 'medium', 'high'] },
    { id: 'sonnet', label: 'Claude Sonnet', efforts: ['low', 'medium', 'high'] },
    { id: 'opus', label: 'Claude Opus', efforts: ['low', 'medium', 'high'] },
  ];
  result.message = '설치됨 · 연결 확인으로 실제 응답을 확인해 주세요.';
  let authMethod = '';
  if (authResult.status === 'fulfilled') {
    const info = authResult.value;
    const combined = info.stdout + '\n' + info.stderr;
    if (provider === 'codex') {
      if (info.code === 0 && /chatgpt/i.test(combined)) { result.auth = 'ready'; result.message = 'ChatGPT 구독 로그인 확인'; authMethod = 'subscription'; }
      else if (/api.?key/i.test(combined)) { result.auth = 'login_required'; result.message = '현재 API 인증입니다. ChatGPT 구독 계정으로 로그인해 주세요.'; authMethod = 'api'; }
      else if (info.code !== 0) { result.auth = 'login_required'; result.message = 'ChatGPT 구독 계정으로 로그인해 주세요.'; }
    } else if (provider === 'claude') {
      try {
        const auth = JSON.parse(info.stdout);
        authMethod = String(auth.authMethod || '');
        if (auth.loggedIn === true && ['claude.ai', 'oauth_token'].includes(authMethod)) { result.auth = 'ready'; result.message = 'Claude 구독 로그인 확인'; }
        else if (auth.loggedIn === false || info.code !== 0 || ['none', 'api_key', 'api_key_helper', 'third_party'].includes(authMethod)) { result.auth = 'login_required'; result.message = 'Claude 구독 계정으로 로그인해 주세요.'; }
      } catch { if (info.code !== 0 || /not logged|not authenticated|sign.?in/i.test(combined)) { result.auth = 'login_required'; result.message = 'Claude 구독 계정으로 로그인해 주세요.'; } }
    } else {
      result.models = parseAgyModels(info.stdout);
      result.defaultEffort = 'medium';
      if (info.code !== 0 && /auth|login|log in|sign.?in|credential/i.test(combined)) { result.auth = 'login_required'; result.message = 'Antigravity CLI에서 Google 계정으로 로그인해 주세요.'; }
      else if (info.code !== 0) result.message = 'Antigravity 설치됨 · 로그인 또는 연결 확인이 필요합니다.';
      else if (old?.descriptor.auth === 'ready') { result.auth = 'ready'; result.message = 'Gemini 실제 응답 확인 완료'; }
      else result.message = 'Antigravity 설치됨 · 연결 확인으로 Google 로그인 상태를 확인해 주세요.';
    }
  }
  result.authStatus = result.auth === 'login_required' ? 'required' : provider !== 'gemini' && result.auth === 'ready' ? 'authenticated' : 'unknown';
  result.authCheckedAt = new Date().toISOString();
  if (provider === 'codex' && result.models.length) result.defaultModel = result.models.find(m=>m.id==='gpt-6-astra')?.id || result.models.find(m=>m.id!=='gpt-reserve')?.id || result.models[0].id;
  if (provider === 'gemini') result.defaultModel = result.models.find(m => /flash-medium$/.test(m.id))?.id || result.models.find(m => /flash/.test(m.id))?.id || '';
  state.set(provider, { cli, descriptor: result, authMethod });
  return result;
}

export async function getProviders({ refresh = false } = {}) {
  if (!refresh && cachedProviders && Date.now() - discoveryAt < CACHE_MS) return structuredClone(cachedProviders);
  if (!discoveryPromise) discoveryPromise = (async () => {
    await verificationStore.load().catch(() => {});
    const discovered = await Promise.allSettled(Object.keys(names).map(inspect));
    cachedProviders = discovered.map((item, index) => item.status === 'fulfilled' ? item.value : ({ id: Object.keys(names)[index], name: names[Object.keys(names)[index]], installed: false, auth: 'unknown', authStatus: 'unknown', authCheckedAt: new Date().toISOString(), verification: verificationStore.get(Object.keys(names)[index]), message: '연결 상태를 확인하지 못했습니다. 새로고침해 주세요.', version: '', models: [], defaultModel: '', defaultEffort: 'medium' }));
    discoveryAt = Date.now();
    return cachedProviders;
  })().finally(() => { discoveryPromise = null; });
  return structuredClone(await discoveryPromise);
}

function buildInvocation(provider, model, effort, prompt, access = 'chat') {
  if(!['chat','research','project'].includes(access))throw new Error('지원하지 않는 도구 모드입니다.');
  const project=access==='project', web=access!=='chat';
  if (provider === 'codex') {
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', project?'workspace-write':'read-only',
      '-c', 'approval_policy="never"', '-c', 'features.shell_tool='+String(project), '-c', 'features.hooks=false', '-c', 'features.apps=false', '-c', 'features.multi_agent=false',
      '-c', 'features.view_image='+String(project), '-c', web?'web_search="live"':'web_search="disabled"', '-c', 'hide_agent_reasoning=true', '-c', 'model_reasoning_summary="none"'];
    if (model) args.push('--model', model);
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
    args.push('-');
    return { args, input: prompt };
  }
  if (provider === 'claude') {
    const args = ['--setting-sources', 'local', '--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', project?'Read,Glob,Grep,Edit,Write,Bash,PowerShell,WebSearch,WebFetch':web?'WebSearch,WebFetch':'',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-session-persistence'];
    if(web)args.push('--permission-mode',project?'acceptEdits':'dontAsk','--allowedTools','WebSearch,WebFetch');
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    return { args, input: prompt };
  }
  const deny=project?['mcp(*)','execute_url(*)']:['command(*)','read_file(*)','write_file(*)','mcp(*)','execute_url(*)',...(web?[]:['read_url(*)'])];
  const settings={agentMode:project?'accept-edits':'',toolPermission:project?'proceed-in-sandbox':'request-review',permissions:{deny,...(web?{allow:['read_url(*)']}: {})}};
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', project?'600s':web?'360s':'180s', '--disable-slash-commands',
    '--settings', JSON.stringify(settings)];
  if(project)args.push('--sandbox','--mode','accept-edits');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return { args, input: JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n' };
}

function cacheUpdate(provider, auth, message) {
  const record = state.get(provider);
  if (record) { record.descriptor.auth = auth; record.descriptor.message = message; if (auth === 'login_required') record.descriptor.authStatus = 'required'; }
  const descriptor = cachedProviders?.find(p => p.id === provider);
  if (descriptor) { descriptor.auth = auth; descriptor.message = message; if (auth === 'login_required') descriptor.authStatus = 'required'; }
}

export async function runProvider({ provider, model = '', effort = 'medium', prompt, cwd, signal, onDelta, access = 'chat' } = {}) {
  validProvider(provider);
  model = validModel(model);
  effort = validEffort(effort);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 160_000) throw new Error('대화 입력이 비어 있거나 너무 깁니다.');
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('AI 전용 작업 폴더가 필요합니다.');
  await mkdir(cwd, { recursive: true });
  if (!state.has(provider) || !state.get(provider)?.cli) await getProviders({ refresh: true });
  const record = state.get(provider);
  if (!record?.cli) throw providerError(provider, 'ENOENT');
  if (record.descriptor.auth === 'login_required') throw providerError(provider, 'authentication required');
  if (!model && ['codex','gemini'].includes(provider)) model = record.descriptor.defaultModel;
  if (provider === 'gemini' && !model) throw providerError(provider, 'model not available');
  const selected = record.descriptor.models.find(item => item.id === model);
  if (effort && selected?.efforts.length && !selected.efforts.includes(effort)) throw providerError(provider, 'unsupported effort');
  // Gemini publishes effort variants as model slugs. Select the requested, advertised
  // variant explicitly so the UI and actual invocation agree.
  if (provider === 'gemini' && effort && selected?.efforts.includes(effort) && /-(low|medium|high|xhigh|max)$/.test(model)) model = model.replace(/-(low|medium|high|xhigh|max)$/, '-' + effort);
  const parser = createParser(provider, onDelta);
  const invocation = buildInvocation(provider, model, effort, prompt, access);
  try {
    const result = await execute(record.cli, invocation.args, { cwd, input: invocation.input, signal, onLine: parser.line, timeout:access==='project'?610000:access==='research'?370000:TIMEOUT_MS });
    const answer = (parser.data.final || parser.data.text).trim();
    if (result.code !== 0 || parser.data.failure || !parser.data.success || !answer) {
      throw providerError(provider, parser.data.failure || result.stderr || 'CLI returned no successful answer', result.code);
    }
    cacheUpdate(provider, 'ready', `${names[provider]} 실제 응답 확인 완료`);
    return { text: answer, model: parser.data.model || model || 'CLI 기본 모델', modelSource: parser.data.model ? 'cli' : 'requested', effort: effort || 'default', usage: parser.data.usage, durationMs: result.durationMs, tools:[...parser.data.tools] };
  } catch (error) {
    const safe = error.code && ['ABORTED', 'TIMEOUT', 'LOGIN_REQUIRED', 'RATE_LIMIT', 'MODEL_UNAVAILABLE', 'EFFORT_UNAVAILABLE', 'CLI_INCOMPATIBLE', 'MISSING', 'NETWORK_ERROR', 'PROVIDER_ERROR'].includes(error.code) ? error : providerError(provider, error.message);
    if (safe.code === 'LOGIN_REQUIRED') cacheUpdate(provider, 'login_required', safe.message);
    throw safe;
  }
}

function psQuote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }

async function launchInteractiveConsole({ cli, args = [], working, title, markerFile, keepOpen = true }) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$Host.UI.RawUI.WindowTitle = ${psQuote(title)}`,
    `Set-Location -LiteralPath ${psQuote(working)}`,
    '$meetingWindow = @{ pid = $PID; startedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString("o"); inputRedirected = [Console]::IsInputRedirected; outputRedirected = [Console]::IsOutputRedirected; state = "ready" }',
    `$meetingWindow | ConvertTo-Json -Compress | Set-Content -LiteralPath ${psQuote(markerFile)} -Encoding UTF8`,
    `& ${[cli.executable, ...cli.prefix, ...args].map(psQuote).join(' ')}`,
    '$meetingWindow.state = "finished"; $meetingWindow.exitCode = $LASTEXITCODE',
    `$meetingWindow | ConvertTo-Json -Compress | Set-Content -LiteralPath ${psQuote(markerFile)} -Encoding UTF8`,
  ].join('\n');
  const argsForWindow = ['-NoProfile', ...(keepOpen ? ['-NoExit'] : []), '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  // Start-Process creates a new real console with fresh standard handles. A detached
  // Node child with stdio:'ignore' can immediately close a purported login window.
  const launcher = `$meetingProcess = Start-Process -FilePath ${psQuote(powershell)} -ArgumentList @(${argsForWindow.map(psQuote).join(',')}) -WorkingDirectory ${psQuote(working)} -WindowStyle Normal -PassThru; @{ pid = $meetingProcess.Id } | ConvertTo-Json -Compress`;
  const launched = await execute({ executable: powershell, prefix: [] }, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')], { cwd: working, timeout: 10_000, maxOutput: 16_000 });
  if (launched.code !== 0) throw new Error('로그인 창을 열지 못했습니다.');
  let launchPid;
  try { launchPid = JSON.parse(launched.stdout.trim()).pid; } catch {}
  if (!Number.isInteger(launchPid) || launchPid < 1) throw new Error('로그인 창 시작을 확인하지 못했습니다. 이미 열린 창을 확인해 주세요.');
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const marker = JSON.parse((await readFile(markerFile, 'utf8')).replace(/^\uFEFF/, ''));
      if (marker.pid === launchPid && Number.isFinite(Date.parse(marker.startedAt))) {
        process.kill(marker.pid, 0);
        if (marker.inputRedirected || marker.outputRedirected) throw new Error('로그인 창에서 키보드 입력을 사용할 수 없습니다.');
        return { pid: marker.pid, startedAt: marker.startedAt, state: marker.state, interactive: true };
      }
    } catch (error) {
      if (error.message === '로그인 창에서 키보드 입력을 사용할 수 없습니다.') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('로그인 창 시작을 확인하지 못했습니다. 이미 열린 창을 확인해 주세요.');
}

async function liveLoginWindow(record) {
  if (!record?.pid || !Number.isFinite(Date.parse(record.startedAt))) return false;
  try {
    process.kill(record.pid, 0);
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = `$meetingProcess = Get-Process -Id ${Number(record.pid)} -ErrorAction SilentlyContinue; if ($meetingProcess) { $meetingProcess.StartTime.ToUniversalTime().ToString('o') }`;
    const result = await execute({ executable: powershell, prefix: [] }, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 5000, maxOutput: 4096 });
    return Math.abs(Date.parse(result.stdout.trim()) - Date.parse(record.startedAt)) < 1000;
  } catch { return false; }
}

async function openLogin(provider) {
  validProvider(provider);
  const cli = await resolveCli(provider === 'gemini' ? 'agy' : provider);
  if (!cli) return { ok: false, message: `${names[provider]} 공식 CLI가 아직 설치되지 않았습니다.` };
  if (!IS_WINDOWS) return { ok: false, message: `터미널에서 ${provider === 'codex' ? 'codex login' : provider === 'claude' ? 'claude auth login' : 'agy'}을 실행해 주세요.` };
  const args = provider === 'codex' ? ['login'] : provider === 'claude' ? ['auth', 'login', '--claudeai'] : [];
  const working = path.join(HERE, 'runtime', 'login', provider);
  await mkdir(working, { recursive: true });
  const markerFile = path.join(working, 'window-status.json');
  let prior = loginWindows.get(provider);
  if (!prior) { try { prior = JSON.parse((await readFile(markerFile, 'utf8')).replace(/^\uFEFF/, '')); } catch {} }
  if (await liveLoginWindow(prior)) {
    loginWindows.set(provider, prior);
    return { ok: true, pending: true, terminalPid: prior.pid, message: '이미 열린 공식 로그인 창에서 로그인을 마무리해 주세요.' };
  }
  try {
    const terminal = await launchInteractiveConsole({ cli, args, working, title: names[provider] + ' official login', markerFile });
    loginWindows.set(provider, terminal);
    discoveryAt = 0;
    return { ok: true, pending: true, terminalPid: terminal.pid, message: `${names[provider]} 공식 로그인 창을 열었습니다. 로그인 후 연결 확인을 눌러 주세요.` };
  } catch (error) {
    return { ok: false, message: redact(error.message) };
  }
}

export async function launchLogin(provider) {
  validProvider(provider);
  if (loginLaunches.has(provider)) return loginLaunches.get(provider);
  const request = openLogin(provider).finally(() => { loginLaunches.delete(provider); });
  loginLaunches.set(provider, request);
  return request;
}

export async function checkProvider(provider, options = {}) {
  validProvider(provider);
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('연결 확인 설정이 올바르지 않습니다.');
  const requestedModel = options.model === undefined ? undefined : validModel(options.model);
  const requestedEffort = options.effort === undefined ? undefined : validEffort(options.effort);
  await getProviders({ refresh: true });
  const record = state.get(provider);
  const model = requestedModel === undefined ? record?.descriptor.defaultModel || '' : requestedModel;
  const effectiveModel = model || (provider === 'claude' ? '' : record?.descriptor.defaultModel || '');
  const selected = record?.descriptor.models.find(item => item.id === effectiveModel);
  const effort = requestedEffort === undefined ? selected?.efforts.includes('low') ? 'low' : selected?.efforts[0] || '' : requestedEffort;
  const challenge = 'MEETING-' + randomBytes(6).toString('hex').toUpperCase();
  const base = { id: randomUUID(), provider, requestedModel: model, resolvedModel: effectiveModel, modelSource: 'requested', effort: effort || 'default', cliVersion: record?.descriptor.version || '', challenge, challengeVerified: false, reply: '', durationMs: 0 };
  const started = Date.now();
  try {
    if (!record?.cli) throw providerError(provider, 'ENOENT');
    if (record.descriptor.auth === 'login_required') throw providerError(provider, 'authentication required');
    const result = await runProvider({ provider, model, effort, signal: options.signal, prompt: `연결 확인입니다. 도구나 파일을 사용하지 마세요. 다음 문장을 그대로 한 줄만 출력하세요:\n연결되었습니다. ${challenge}`, cwd: path.join(HERE, 'runtime', 'check', provider) });
    const matched = result.text.includes(challenge);
    const verification = await saveVerification(provider, { ...base, checkedAt: new Date().toISOString(), status: matched ? 'verified' : 'failed', resolvedModel: result.model, modelSource: result.modelSource, effort: result.effort, reply: result.text, durationMs: result.durationMs, challengeVerified: matched, code: matched ? '' : 'VERIFICATION_MISMATCH', message: matched ? '실제 응답 확인 완료' : '응답은 받았지만 확인 코드가 일치하지 않습니다.' });
    return { ok: verification.status === 'verified', provider, ...result, text: verification.reply, verification, message: verification.message, ...(verification.code ? { code: verification.code } : {}) };
  } catch (error) {
    const verification = await saveVerification(provider, { ...base, checkedAt: new Date().toISOString(), status: error.code === 'LOGIN_REQUIRED' ? 'login_required' : error.code === 'MISSING' ? 'missing' : 'failed', code: error.code || 'PROVIDER_ERROR', message: redact(error.message), durationMs: Date.now() - started });
    return { ok: false, provider, message: verification.message, code: verification.code, verification };
  }
}

// Pure helpers allow offline verification without spending any model quota.
export const __testing = Object.freeze({ createParser, buildInvocation, validModel, validEffort, redact, parseAgyModels, cliEnvironment, execute, cleanVerification, createVerificationStore, launchInteractiveConsole, liveLoginWindow });
