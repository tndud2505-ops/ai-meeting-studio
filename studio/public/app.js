'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const IDS = ['codex', 'claude', 'gemini'];
  const NAMES = { codex: 'Codex', claude: 'Claude', gemini: 'Gemini', user: '나' };
  const PROFILE_COLORS = ['#e5eee7', '#f3e5dd', '#eae6f2', '#f5e7bb', '#e6e7e8', '#f0dfe5'];
  const AVATAR_PRESETS = ['◈', '✳', '✦', '🙂', '💡', '🌱', '🦊', '🐈'];
  const DEFAULT_PROFILES = {
    codex: { id: 'codex', displayName: 'Codex', avatar: { kind: 'emoji', value: '◈' }, color: '#e5eee7' },
    claude: { id: 'claude', displayName: 'Claude', avatar: { kind: 'emoji', value: '✳' }, color: '#f3e5dd' },
    gemini: { id: 'gemini', displayName: 'Gemini', avatar: { kind: 'emoji', value: '✦' }, color: '#eae6f2' },
    user: { id: 'user', displayName: '나', avatar: { kind: 'emoji', value: '🙂' }, color: '#f5e7bb' }
  };
  const CONFIG_KEY = 'meeting-notes-participants-v2';
  const ROOM_KEY = 'ai-meeting-studio-selected-room-v1';
  const DRAFT_KEY = 'meeting-notes-composer-v2';
  const WORKFLOW_KEY = 'meeting-workflow-v1';
  const APP_SETTINGS_KEY = 'meeting-app-settings-v1';
  const DEFAULT_APP_SETTINGS = { fontScale: 100, answerStyle: 'brief', showTime: true, autoScroll: true };
  let appSettings = { ...DEFAULT_APP_SETTINGS };
  try { appSettings = { ...appSettings, ...JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}') }; } catch { /* Defaults. */ }
  let appSettingsTimer = 0;
  function applyAppSettings() {
    const scale = Math.min(150, Math.max(85, Number(appSettings.fontScale) || 100));
    document.documentElement.style.setProperty('--fs', String(scale / 100));
    document.body.classList.toggle('hide-time', appSettings.showTime === false);
    try { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings)); } catch { /* Cache only. */ }
  }
  function syncAppSettingsDialog() {
    $('fontScaleInput').value = appSettings.fontScale;
    $('fontScaleValue').textContent = appSettings.fontScale + '%';
    $('answerStyleSelect').value = appSettings.answerStyle;
    $('showTimeInput').checked = appSettings.showTime !== false;
    $('autoScrollInput').checked = appSettings.autoScroll !== false;
  }
  function queueAppSettingsSave() {
    $('appSettingsState').textContent = '저장 중…';
    clearTimeout(appSettingsTimer);
    appSettingsTimer = setTimeout(async () => {
      try {
        const data = await api('/api/settings', appSettings, 'PUT');
        appSettings = { ...appSettings, ...data.settings };
        $('appSettingsError').hidden = true;
        $('appSettingsState').textContent = '저장됨';
      } catch (error) {
        $('appSettingsError').textContent = error.message;
        $('appSettingsError').hidden = false;
        $('appSettingsState').textContent = '';
      }
    }, 250);
  }
  function changeAppSetting(patch) {
    appSettings = { ...appSettings, ...patch };
    applyAppSettings();
    syncAppSettingsDialog();
    queueAppSettingsSave();
  }
  async function loadAppSettings() {
    const data = await api('/api/settings');
    appSettings = { ...appSettings, ...data.settings };
    applyAppSettings();
    syncAppSettingsDialog();
  }
  let workflow={flow:'auto',access:'research',workspace:'',maxRounds:5};
  let approvedWorkspace='';
  try {const stored=JSON.parse(localStorage.getItem(WORKFLOW_KEY)||'null');if(stored)workflow={...workflow,...stored};}catch{}
  if(!['auto','sequential','parallel','debate'].includes(workflow.flow))workflow.flow='auto';
  workflow.maxRounds=Math.max(1,Math.min(10,Math.round(Number(workflow.maxRounds))||5));
  if(!['chat','research','project'].includes(workflow.access))workflow.access='research';
  if(typeof workflow.workspace!=='string')workflow.workspace='';
  let savedConfig = false;
  let participants = IDS.map(provider => ({ id: provider, provider, name: NAMES[provider], model: '', effort: '', enabled: true }));
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (Array.isArray(stored)) {
      participants = IDS.map(id => ({ ...participants.find(p => p.provider === id), ...(stored.find(p => p.provider === id) || {}), id, provider: id, name: NAMES[id] }));
      savedConfig = true;
    }
  } catch { /* Optional preferences only. */ }
  const state = {
    providers: new Map(), roles: new Map(), rolesError: '', profiles: new Map(), profilesError: '', profileDraft: null, profileRevision: 0, room: null,
    connected: false, busy: false, sending: false, autoScroll: true,
    settingsProvider: null, roleSaving: false, installPrompt: null,
    waitingWorker: null, applyingUpdate: false, selectionRevision: 0,
    refreshBusy: false, sessionPromise: null, authBusy: new Map(), avatarLoading: false, settingsTab: 'profile'
  };
  const headerControls = new Map();
  const messageNodes = new Map();
  let messageSignature = '';
  let events;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function option(value, label) {
    const node = el('option', '', label);
    node.value = value;
    return node;
  }
  function provider(id) {
    return state.providers.get(id) || { id, installed: false, auth: 'unknown', models: [] };
  }
  function participant(id) { return participants.find(p => p.provider === id); }
  function profile(id) { return state.profiles.get(id) || DEFAULT_PROFILES[id] || DEFAULT_PROFILES.user; }
  function cloneProfile(value) { return { id: value.id, displayName: value.displayName, color: value.color, avatar: { ...value.avatar } }; }
  function drawAvatar(node, value, size = '') {
    const data = typeof value === 'string' ? profile(value) : value;
    node.replaceChildren();
    node.classList.add('avatar');
    if (size) node.classList.add(size);
    node.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(data?.color || '') ? data.color : '#e6e7e8';
    const avatar = data?.avatar;
    if (avatar?.kind === 'image' && /^data:image\/(png|jpeg|webp);base64,/i.test(avatar.value || '')) {
      const img = document.createElement('img');
      img.src = avatar.value;
      img.alt = '';
      img.draggable = false;
      node.append(img);
    } else node.append(el('span', 'avatar-glyph', avatar?.value || '🙂'));
  }
  function refreshProfileViews() {
    state.profileRevision++;
    renderModelBar();
    drawAvatar($('userProfileButton'), 'user');
    $('userProfileButton').title = profile('user').displayName + ' · 내 프로필';
    renderMessages();
  }
  async function loadProfiles() {
    try {
      const data = await api('/api/profiles');
      for (const item of data.profiles || []) if (DEFAULT_PROFILES[item.id]) state.profiles.set(item.id, item);
      state.profilesError = '';
      refreshProfileViews();
    } catch (error) { state.profilesError = error.message; }
  }
  function isRunning() { return state.room?.status === 'running' || Boolean(state.room?.pausePending); }
  function saveParticipants() {
    savedConfig = true;
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(participants)); } catch { /* Preferences only. */ }
  }
  function requestParticipants() {
    return participants.map(p => ({ id: p.id, provider: p.provider, name: profile(p.provider).displayName, model: p.model || '', effort: p.effort || '', enabled: p.enabled !== false }));
  }
  function workflowOptions(){
    if(workflow.access==='project'){
      const workspace=workflow.workspace.trim();
      if(!workspace)throw new Error('진행 설정에서 프로젝트 폴더를 지정해주세요.');
      if(approvedWorkspace!==workspace){
        if(!window.confirm('선택한 프로젝트에서 AI의 파일 읽기·편집·터미널 및 웹 도구 사용을 허용할까요?\n\n'+workspace+'\n\n공식 CLI의 권한 제한은 유지됩니다.'))throw new Error('프로젝트 작업을 취소했습니다.');
        approvedWorkspace=workspace;
      }
    }
    return {...workflow};
  }
  function renderWorkflow(){
    $('workflowLabel').textContent=({auto:'자동',sequential:'순차',parallel:'동시',debate:'토론'})[workflow.access==='project'?'sequential':workflow.flow]+' · '+({chat:'대화',research:'웹',project:'작업'})[workflow.access];
    $('workflowButton').title=workflow.access==='project'?workflow.workspace:'진행 및 도구 설정';
  }
  function syncWorkflowDialog(){
    const project=$('workflowAccess').value==='project';
    $('workspaceFields').hidden=!project;
    $('workflowFlow').disabled=project;
    $('workflowHint').hidden=project;
    const debate=!project&&$('workflowFlow').value==='debate';
    $('debateFields').hidden=!debate;
    $('workflowHint').textContent=debate?'주제를 보내면 AI들이 사용자 개입 없이 토론하고, 모두 합의하면 마지막에 결론을 정리해 끝냅니다. 합의가 안 되면 최대 라운드에서 멈추고 갈린 쟁점을 정리합니다. 도중에 일시정지하거나 끼어들 수 있습니다.':'동시 조사 결과가 먼저 도착한 순서로 표시되고, 모두 완료되면 서로 검토합니다.';
  }
  function effortLabel(value) {
    return ({ default: '기본값', auto: '자동', minimal: '최소', low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대', ultra: 'Ultra' })[value] || value;
  }
  function compactModelName(model) {
    return String(model || '기본값')
      .replace(/^claude-/, '').replace(/^gemini-/, '')
      .replace(/^gpt-/, 'GPT-')
      .replace(/sonnet/gi, 'Sonnet').replace(/opus/gi, 'Opus').replace(/haiku/gi, 'Haiku')
      .replace(/astra/gi, 'Astra').replace(/sol/gi, 'Sol')
      .replace(/flash/gi, 'Flash').replace(/pro/gi, 'Pro')
      .replace(/-(Astra|Sol|Sonnet|Opus|Haiku|Flash|Pro)/g, ' $1')
      .replace(/-(high|medium|low)$/, ' · $1');
  }
  function modelOptions(select, id, compact = false) {
    const data = provider(id);
    const p = participant(id);
    const defaultDescriptor = (data.models || []).find(m => typeof m === 'object' && m.id === '');
    const defaultText = data.defaultModel ? compactModelName(data.defaultModel) : defaultDescriptor?.label || '기본값';
    select.replaceChildren(option('', compact ? defaultText : '기본값' + (data.defaultModel ? ' · ' + data.defaultModel : '')));
    const seen = new Set(['']);
    for (const model of data.models || []) {
      const value = typeof model === 'string' ? model : model.id;
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const label = typeof model === 'string' ? model : model.label || value;
      select.append(option(value, compact ? compactModelName(label) : label));
    }
    if (p.model && !seen.has(p.model)) select.append(option(p.model, compact ? compactModelName(p.model) : p.model));
    select.value = p.model || '';
    select.title = p.model || data.defaultModel || '기본 모델';
  }
  function supportedEfforts(id) {
    const data = provider(id);
    const p = participant(id);
    const selected = p.model || data.defaultModel || '';
    const models = data.models || [];
    const model = models.find(m => typeof m === 'object' && m.id === selected) || (!p.model ? models.find(m => typeof m === 'object' && m.id === '') : undefined);
    return Array.isArray(model?.efforts) ? model.efforts.map(e => typeof e === 'string' ? e : e.id) : [];
  }
  function normalizeEffort(id) {
    const p = participant(id);
    if (p.effort && !['default', 'auto'].includes(p.effort) && !supportedEfforts(id).includes(p.effort)) p.effort = '';
  }
  function showError(message) {
    $('errorText').textContent = message || '';
    $('errorLine').hidden = !message;
  }
  function settingsError(message) {
    $('settingsError').textContent = message || '';
    $('settingsError').hidden = !message;
  }
  async function api(path, body, method = 'POST') {
    const options = body === undefined ? { cache: 'no-store' } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    let response;
    try { response = await fetch(path, options); }
    catch { throw new Error('서버에 연결할 수 없습니다.'); }
    let data;
    try { data = await response.json(); }
    catch { throw new Error('서버 응답을 읽을 수 없습니다.'); }
    if (!response.ok || data.ok === false) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || '요청을 처리하지 못했습니다.');
    return data;
  }

  function rememberRoom(id) {
    state.selectionRevision++;
    try { if (id) sessionStorage.setItem(ROOM_KEY, id); else sessionStorage.removeItem(ROOM_KEY); } catch { /* URL fallback. */ }
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('room', id); else url.searchParams.delete('room');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  async function restoreRoom() {
    let id = new URL(location.href).searchParams.get('room');
    if (!id) { try { id = sessionStorage.getItem(ROOM_KEY); } catch { /* Optional storage. */ } }
    if (!id || state.room) return;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) { rememberRoom(null); return; }
    const revision = state.selectionRevision;
    try {
      const data = await api('/api/rooms/' + encodeURIComponent(id));
      if (state.room || revision !== state.selectionRevision) return;
      if (!savedConfig && Array.isArray(data.room?.config?.participants)) {
        participants = IDS.map(providerId => {
          const previous = participant(providerId);
          const active = data.room.config.participants.find(p => p.provider === providerId);
          return { ...previous, ...(active || {}), enabled: Boolean(active) && active.enabled !== false, id: providerId, provider: providerId, name: NAMES[providerId] };
        });
        saveParticipants();
        renderModelBar();
      }
      selectRoom(data.room, true);
    } catch (error) {
      if (state.connected) { rememberRoom(null); showError(error.message); }
    }
  }
  function selectRoom(room, focus = false) {
    if (!room?.id || state.room?.id !== room.id && !focus) return;
    const changed = state.room?.id !== room.id;
    state.room = room;
    if (changed || focus) rememberRoom(room.id);
    if (changed) { state.autoScroll = true; messageSignature = ''; }
    if (room.error && room.status === 'error') showError(typeof room.error === 'string' ? room.error : room.error.message || '대화를 이어가지 못했습니다.');
    renderMessages();
    renderControls();
  }

  function buildModelBar() {
    for (const id of IDS) {
      const wrapper = el('div', 'model-control');
      const avatar = el('button', 'avatar-button header-avatar');
      avatar.type = 'button';
      avatar.setAttribute('aria-label', NAMES[id] + ' 프로필 설정');
      const status = el('span', 'connection-dot');
      status.setAttribute('aria-hidden', 'true');
      const avatarWrap = el('div', 'header-avatar-wrap');
      avatarWrap.append(avatar, status);
      const details = el('div', 'model-control-details');
      const name = el('button', 'provider-name', NAMES[id]);
      name.type = 'button';
      name.setAttribute('aria-label', NAMES[id] + ' 설정');
      const select = document.createElement('select');
      select.className = 'header-model';
      select.setAttribute('aria-label', NAMES[id] + ' 모델');
      select.addEventListener('change', () => {
        participant(id).model = select.value;
        normalizeEffort(id);
        saveParticipants();
        renderModelBar();
        if (state.settingsProvider === id && $('settingsDialog').open) renderSettingsModel();
      });
      avatar.addEventListener('click', () => openSettings(id));
      name.addEventListener('click', () => openSettings(id));
      details.append(name, select);
      wrapper.append(avatarWrap, details);
      $('modelBar').append(wrapper);
      headerControls.set(id, { wrapper, select, avatar, name, status });
    }
    renderModelBar();
    drawAvatar($('userProfileButton'), 'user');
  }
  function authValue(data) { return data.authStatus || data.auth || 'unknown'; }
  function renderModelBar() {
    for (const id of IDS) {
      const controls = headerControls.get(id);
      if (!controls) continue;
      const data = provider(id);
      const person = profile(id);
      modelOptions(controls.select, id, true);
      drawAvatar(controls.avatar, person);
      controls.name.textContent = person.displayName;
      controls.avatar.title = person.displayName + ' · 프로필';
      controls.wrapper.classList.toggle('is-disabled', participant(id).enabled === false);
      const auth = authValue(data);
      const verified = data.verification?.status === 'verified';
      controls.status.dataset.state = participant(id).enabled === false ? 'off' : ['required', 'login_required', 'missing'].includes(auth) ? 'attention' : verified ? 'verified' : 'unknown';
      controls.wrapper.title = participant(id).enabled === false ? '참가 안 함' : verified ? '최근 응답 테스트: ' + fullTimeLabel(data.verification.checkedAt) : ['required', 'login_required', 'missing'].includes(auth) ? '로그인 또는 설치 필요' : '응답 테스트 전';
    }
  }
  function renderSettingsModel() {
    const id = state.settingsProvider;
    if (!id || id === 'user') return;
    const p = participant(id);
    modelOptions($('settingsModel'), id);
    const efforts = supportedEfforts(id);
    $('settingsEffort').replaceChildren(option('', '기본값'));
    for (const effort of [...new Set(efforts)]) if (effort && effort !== 'default') $('settingsEffort').append(option(effort, effortLabel(effort)));
    if (p.effort && !Array.from($('settingsEffort').options).some(o => o.value === p.effort)) $('settingsEffort').append(option(p.effort, effortLabel(p.effort)));
    $('settingsEffort').value = p.effort || '';
    $('settingsEffort').disabled = !efforts.length && !p.effort;
    $('participantEnabled').checked = p.enabled !== false;
    renderConnection();
  }
  function fullTimeLabel(value) {
    if (!value || Number.isNaN(new Date(value).getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(value));
  }
  function renderConnection() {
    const id = state.settingsProvider;
    if (!id || id === 'user') return;
    const data = provider(id);
    const auth = authValue(data);
    const authLabels = { ready: '로그인 확인됨', authenticated: '로그인 확인됨', logged_in: '로그인 확인됨', required: '로그인 필요', login_required: '로그인 필요', missing: '설치 필요', unknown: '확인 필요' };
    const responseAuthenticated = auth === 'unknown' && data.verification?.status === 'verified';
    $('connectionState').textContent = responseAuthenticated ? '최근 응답에서 확인' : authLabels[auth] || '확인 필요';
    $('connectionState').dataset.state = responseAuthenticated || ['ready', 'authenticated', 'logged_in'].includes(auth) ? 'good' : 'pending';
    $('connectionCli').textContent = data.version ? NAMES[id] + ' · ' + data.version : NAMES[id];
    const action = state.authBusy.get(id);
    $('loginButton').disabled = Boolean(action) || data.installed === false;
    $('refreshAuthButton').disabled = Boolean(action) || state.refreshBusy;
    $('checkButton').disabled = Boolean(action) || data.installed === false || isRunning();
    $('loginButton').textContent = action === 'login' ? '여는 중…' : '로그인';
    $('checkButton').textContent = action === 'check' ? '응답 기다리는 중…' : '응답 테스트';
    const card = $('verificationCard');
    card.replaceChildren();
    const evidence = data.verification;
    const heading = el('div', 'verification-heading');
    heading.append(el('span', '', '최근 응답 테스트'));
    if (!evidence) {
      card.dataset.state = 'empty';
      heading.append(el('span', 'state-badge', '테스트 전'));
      card.append(heading, el('p', 'verification-empty', '아직 테스트하지 않았습니다.'));
      return;
    }
    const success = evidence.status === 'verified';
    card.dataset.state = success ? 'verified' : 'failed';
    const badge = el('span', 'state-badge', success ? '응답 확인' : ({ login_required: '로그인 필요', missing: '설치 필요' })[evidence.status] || '실패');
    badge.dataset.state = success ? 'good' : 'pending';
    heading.append(badge);
    card.append(heading, el('time', 'verification-time', fullTimeLabel(evidence.checkedAt)));
    if (evidence.reply) card.append(el('blockquote', 'verification-reply', evidence.reply));
    if (!success && evidence.message) card.append(el('p', 'verification-failure', evidence.message));
    const details = el('dl', 'verification-details');
    for (const [key, value] of [
      [evidence.modelSource === 'cli' ? '응답 모델' : '요청 모델', evidence.resolvedModel || evidence.requestedModel || '기본값'],
      ['추론 강도', effortLabel(evidence.effort || 'default')],
      ['응답 시간', evidence.reply && Number.isFinite(evidence.durationMs) ? (evidence.durationMs / 1000).toFixed(1) + '초' : ''],
      ['CLI', evidence.cliVersion || ''],
      ['검증 코드', evidence.challengeVerified ? evidence.challenge || '' : '']
    ]) {
      if (!value) continue;
      details.append(el('dt', '', key), el('dd', '', value));
    }
    card.append(details);
    const p = participant(id);
    const changed = String(evidence.requestedModel || '') !== String(p.model || '') || Boolean(p.effort) && String(evidence.effort || '') !== String(p.effort);
    if (changed) card.append(el('p', 'verification-note', '이전 설정의 결과입니다. 현재 설정으로 다시 테스트할 수 있습니다.'));
    if (evidence.persisted === false) card.append(el('p', 'verification-note', '확인 기록을 저장하지 못했습니다.'));
  }
  function setSettingsTab(tab, focus = false) {
    if (state.settingsProvider === 'user') tab = 'profile';
    state.settingsTab = tab;
    for (const name of ['profile', 'connection', 'role']) {
      const active = name === tab;
      $(name + 'Tab').setAttribute('aria-selected', String(active));
      $(name + 'Tab').tabIndex = active ? 0 : -1;
      $(name + 'Panel').hidden = !active;
    }
    if (focus) $(tab + 'Tab').focus();
  }
  function renderProfileEditor() {
    const draft = state.profileDraft;
    if (!draft) return;
    drawAvatar($('profilePreview'), draft);
    $('profileName').value = draft.displayName || '';
    for (const button of $('avatarPresets').children) button.setAttribute('aria-pressed', String(draft.avatar?.kind === 'emoji' && draft.avatar.value === button.dataset.avatar));
    for (const button of $('profileColors').children) button.setAttribute('aria-pressed', String(draft.color === button.dataset.color));
  }
  async function openSettings(id) {
    if (state.roleSaving) return;
    state.settingsProvider = id;
    state.profileDraft = cloneProfile(profile(id));
    $('settingsTitle').textContent = id === 'user' ? '내 프로필' : profile(id).displayName;
    $('settingsProviderLabel').textContent = id === 'user' ? '' : NAMES[id];
    $('saveState').textContent = '';
    $('loginHint').hidden = true;
    settingsError('');
    const isUser = id === 'user';
    $('connectionTab').hidden = isUser;
    $('roleTab').hidden = isUser;
    $('modelSettings').hidden = isUser;
    $('settingsDialog').classList.toggle('user-settings', isUser);
    setSettingsTab('profile');
    renderProfileEditor();
    if (!isUser) renderSettingsModel();
    const currentRole = state.roles.get(id);
    $('roleInput').value = currentRole?.content || '';
    $('roleInput').disabled = !currentRole;
    $('saveRoleButton').disabled = false;
    $('roleFilename').textContent = currentRole?.filename ? String(currentRole.filename).split(/[\\/]/).pop() : '';
    if (!$('settingsDialog').open) $('settingsDialog').showModal();
    if (!isUser && !currentRole) {
      await loadRoles();
      if (state.settingsProvider !== id || !$('settingsDialog').open) return;
      const role = state.roles.get(id);
      $('roleInput').value = role?.content || '';
      $('roleInput').disabled = !role;
      $('roleFilename').textContent = role?.filename ? String(role.filename).split(/[\\/]/).pop() : '';
      if (!role) settingsError(state.rolesError || '역할 파일을 읽을 수 없습니다.');
    }
    if (state.profilesError) settingsError(state.profilesError);
  }
  async function loadRoles() {
    try {
      const data = await api('/api/roles');
      for (const role of data.roles || []) state.roles.set(role.provider, role);
      state.rolesError = '';
    } catch (error) { state.rolesError = error.message; }
  }
  async function saveRole() {
    const id = state.settingsProvider;
    if (!id || state.roleSaving || state.avatarLoading) return;
    const draft = cloneProfile(state.profileDraft);
    draft.displayName = $('profileName').value.trim();
    if (!draft.displayName) { settingsError('이름을 입력해주세요.'); setSettingsTab('profile'); $('profileName').focus(); return; }
    state.roleSaving = true;
    $('saveRoleButton').disabled = true;
    settingsError('');
    try {
      const profileResult = await api('/api/profiles/' + id, draft, 'PUT');
      state.profiles.set(id, profileResult.profile || draft);
      state.profileDraft = cloneProfile(state.profiles.get(id));
      refreshProfileViews();
      if (id !== 'user' && !$('roleInput').disabled) {
        const content = $('roleInput').value;
        if (content !== state.roles.get(id)?.content) {
          const result = await api('/api/roles/' + id, { content }, 'PUT');
          state.roles.set(id, result.role || { provider: id, filename: state.roles.get(id)?.filename, content });
        }
      }
      saveParticipants();
      $('settingsTitle').textContent = id === 'user' ? '내 프로필' : draft.displayName;
      $('saveState').textContent = '저장됨';
    } catch (error) { settingsError(error.message); }
    finally { state.roleSaving = false; $('saveRoleButton').disabled = state.avatarLoading; }
  }
  async function prepareAvatar(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('PNG, JPG, WebP 사진을 선택해주세요.');
    if (file.size > 8 * 1024 * 1024) throw new Error('8MB 이하의 사진을 선택해주세요.');
    const blobUrl = URL.createObjectURL(file);
    try {
      const source = new Image();
      source.src = blobUrl;
      await source.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('사진을 처리할 수 없습니다.');
      const side = Math.min(source.naturalWidth, source.naturalHeight);
      if (!side) throw new Error('사진을 읽을 수 없습니다.');
      context.drawImage(source, (source.naturalWidth - side) / 2, (source.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      let result = canvas.toDataURL('image/webp', 0.82);
      if (result.length > 85000) result = canvas.toDataURL('image/jpeg', 0.68);
      if (result.length > 125000) throw new Error('더 작은 사진을 선택해주세요.');
      return { kind: 'image', value: result };
    } finally { URL.revokeObjectURL(blobUrl); }
  }
  async function providerAction(action) {
    const id = state.settingsProvider;
    if (!id || id === 'user' || state.authBusy.has(id)) return;
    state.authBusy.set(id, action);
    settingsError('');
    $('saveState').textContent = '';
    renderConnection();
    try {
      const p = participant(id);
      const result = await api('/api/providers/' + id + '/' + action, action === 'check' ? { model: p.model || '', effort: p.effort || '' } : {});
      if (result.verification) state.providers.set(id, { ...provider(id), verification: result.verification });
      for (const item of result.providers || []) state.providers.set(item.id, item);
      if (state.settingsProvider === id && action === 'login') {
        $('loginHint').textContent = '열린 로그인 창에서 완료한 뒤 로그인 확인을 눌러주세요.';
        $('loginHint').hidden = false;
      }
    } catch (error) { if (state.settingsProvider === id) settingsError(error.message); }
    finally {
      state.authBusy.delete(id);
      await refreshStatus();
      if (state.settingsProvider === id) renderConnection();
    }
  }

  function validateParticipants(checkAuth = false) {
    const enabled = participants.filter(p => p.enabled !== false);
    if (!enabled.length) throw new Error('참가할 모델을 선택해주세요.');
    if (checkAuth) {
      const unavailable = enabled.filter(p => ['missing', 'login_required'].includes(provider(p.provider).auth));
      if (unavailable.length) throw new Error(unavailable.map(p => NAMES[p.provider]).join(', ') + ': 설정에서 연결을 확인해주세요.');
    }
  }
  async function ensureSession() {
    if (state.room) return state.room;
    if (state.sessionPromise) return state.sessionPromise;
    validateParticipants(false);
    state.sessionPromise = (async () => {
      const data = await api('/api/session/open', { participants: requestParticipants(), workflow:workflowOptions() });
      if (!data.room) throw new Error('세션을 열지 못했습니다.');
      selectRoom(data.room, true);
      return data.room;
    })();
    try { return await state.sessionPromise; }
    finally { state.sessionPromise = null; }
  }
  async function startOrPause() {
    if (state.busy || state.sending || !state.connected || state.room?.pausePending) return;
    state.busy = true;
    showError('');
    renderControls();
    try {
      if (isRunning()) {
        const data = await api('/api/rooms/' + encodeURIComponent(state.room.id) + '/pause', {});
        if (data.room) selectRoom(data.room);
      } else {
        const room = await ensureSession();
        const hasMessage = (room.messages || []).some(m => m.kind === 'user' && m.text?.trim());
        if (!hasMessage) { $('messageInput').focus(); return; }
        validateParticipants(false);
        const action = ['paused', 'error'].includes(room.status) ? 'resume' : 'start';
        const data = await api('/api/rooms/' + encodeURIComponent(room.id) + '/' + action, { participants: requestParticipants(), workflow:workflowOptions() });
        if (data.room) selectRoom(data.room);
      }
    } catch (error) { showError(error.message); }
    finally { state.busy = false; renderControls(); }
  }
  async function sendMessage() {
    const text = $('messageInput').value.trim();
    if (!text || state.sending || !state.connected || state.applyingUpdate) return;
    const generatingWhenSent = isRunning();
    state.sending = true;
    showError('');
    renderControls();
    try {
      const room = await ensureSession();
      const data = await api('/api/rooms/' + encodeURIComponent(room.id) + '/message', { text });
      $('messageInput').value = '';
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional draft persistence. */ }
      resizeComposer();
      state.autoScroll = true;
      if (data.room && state.room?.id === room.id) selectRoom(data.room);
      scrollToLatest(true);
      const savedRoom = state.room;
      const canRespond = savedRoom?.status === 'idle' || savedRoom?.status === 'error' || savedRoom?.status === 'stopped' || savedRoom?.status === 'paused' && savedRoom.cycleComplete === true;
      if (!generatingWhenSent && savedRoom?.id === room.id && !isRunning() && canRespond) {
        validateParticipants(false);
        const action = ['paused', 'error'].includes(savedRoom.status) ? 'resume' : 'start';
        const response = await api('/api/rooms/' + encodeURIComponent(room.id) + '/' + action, { participants: requestParticipants(), workflow:workflowOptions() });
        if (response.room && state.room?.id === room.id) selectRoom(response.room);
      }
    } catch (error) { showError(error.message); }
    finally { state.sending = false; renderControls(); $('messageInput').focus(); }
  }
  async function resetSession() {
    if (state.busy || state.sending) return;
    state.busy = true;
    showError('');
    renderControls();
    try {
      const room = state.room;
      if (room && isRunning()) await api('/api/rooms/' + encodeURIComponent(room.id) + '/stop', {});
      if (room) await api('/api/session/reset', { roomId: room.id });
      state.room = null;
      rememberRoom(null);
      messageSignature = '';
      messageNodes.clear();
      $('messages').replaceChildren();
      $('messageInput').value = '';
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional draft persistence. */ }
      state.autoScroll = true;
      resizeComposer();
      $('messageInput').focus();
    } catch (error) { showError(error.message); }
    finally { state.busy = false; renderControls(); }
  }

  function nearBottom() {
    const scroll = $('messageScroll');
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
  }
  function scrollToLatest(force = false) {
    if (force || (state.autoScroll && appSettings.autoScroll !== false)) requestAnimationFrame(() => { $('messageScroll').scrollTop = $('messageScroll').scrollHeight; });
  }
  function timeLabel(value) {
    if (!value || Number.isNaN(new Date(value).getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));
  }
  function dateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
  }
  function dateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(date);
  }
  function renderMessages() {
    const messages = state.room?.messages || [];
    const signature = JSON.stringify([state.connected, state.profileRevision, messages.map(m => [m.id, m.text, m.status, m.error, m.completedAt, m.contextInfo])]);
    if (signature === messageSignature) return;
    messageSignature = signature;
    if (nearBottom()) state.autoScroll = true;
    $('messages').replaceChildren();
    messageNodes.clear();
    let previousDate = '';
    for (const message of messages) {
      const date = dateKey(message.startedAt);
      if (date && date !== previousDate) {
        const divider = el('div', 'date-divider');
        divider.append(el('time', '', dateLabel(message.startedAt)));
        $('messages').append(divider);
        previousDate = date;
      }
      const streaming = message.status === 'streaming' && state.connected;
      const waiting = streaming && !message.text;
      const isUser = message.kind === 'user';
      const isSystem = message.kind === 'system';
      const id = isUser ? 'user' : message.profileId || message.provider;
      const person = DEFAULT_PROFILES[id] ? profile(id) : { displayName: message.name || '회의' };
      const wrapper = el('article', 'message' + (isUser ? ' user' : isSystem ? ' system' : ' assistant') + (streaming ? ' streaming' : '') + (waiting ? ' waiting' : ''));
      wrapper.dataset.messageId = message.id;
      if (!isUser && !isSystem && DEFAULT_PROFILES[id]) {
        const avatar = el('button', 'avatar-button message-avatar');
        avatar.type = 'button';
        drawAvatar(avatar, person);
        avatar.setAttribute('aria-label', person.displayName + ' 프로필 설정');
        avatar.addEventListener('click', () => openSettings(id));
        wrapper.append(avatar);
      }
      const content = el('div', 'message-content');
      const nameNode = el('span', 'message-name' + (isUser ? ' sr-only' : ''), message.name || person.displayName);
      if (message.model) nameNode.title = NAMES[message.provider] + ' · ' + message.model + (message.effort ? ' · ' + effortLabel(message.effort) : '');
      if(message.phase&&!isUser&&!isSystem)nameNode.append(el('span','phase-label',({research:'조사',debate:'토론 '+(message.round||''),'debate-final':'최종 결론'})[message.phase]||'검토'));
      if(message.tools?.length&&!isUser&&!isSystem){const labels={web:'웹',terminal:'터미널',files:'파일'};nameNode.title+=(nameNode.title?' · ':'')+'CLI 도구 이벤트: '+message.tools.map(t=>labels[t]).filter(Boolean).join(', ');}
      const bubbleRow = el('div', 'bubble-row');
      const bubble = el('div', 'message-bubble');
      const text = el('div', 'message-text', message.text || '');
      if(message.status==='complete'&&!isUser&&!isSystem){
        const parts=(message.text||'').split(/(https?:\/\/[^\s<>"'\x60)\]]+)/g);
        if(parts.length>1){text.replaceChildren();for(const part of parts){if(/^https?:\/\//i.test(part)){const link=el('a','source-link',part);link.href=part;link.target='_blank';link.rel='noopener noreferrer';text.append(link);}else text.append(document.createTextNode(part));}}
      }
      if (waiting) {
        const dots = el('span', 'typing-dots');
        dots.setAttribute('role', 'status');
        dots.setAttribute('aria-label', person.displayName + ' 응답 중');
        for (let i = 0; i < 3; i++) dots.append(el('span'));
        text.append(dots);
      }
      bubble.append(text);
      if (message.error) bubble.append(el('div', 'message-error', typeof message.error === 'string' ? message.error : message.error.message || '응답을 받지 못했습니다.'));
      if (message.contextInfo?.truncated) {
        const included = Math.max(0, Number(message.contextInfo.included) || 0);
        const total = Math.max(included, Number(message.contextInfo.total) || 0);
        const note = el('div', 'context-note', '이전 발언 ' + included + '/' + total + '개 참조');
        note.title = '대화가 길어져 최근 발언부터 전달했습니다.';
        bubble.append(note);
      }
      const time = el('time', 'message-time', timeLabel(message.startedAt));
      if (message.startedAt) time.dateTime = message.startedAt;
      bubbleRow.append(bubble, time);
      content.append(nameNode, bubbleRow);
      wrapper.append(content);
      $('messages').append(wrapper);
      messageNodes.set(message.id, { wrapper, text, message });
    }
    scrollToLatest();
  }
  function renderControls() {
    const running = isRunning();
    const hasSpeech = state.room?.messages?.some(m => m.kind === 'speech');
    const continuation = state.room && (hasSpeech || ['paused', 'error', 'completed'].includes(state.room.status));
    $('startText').textContent = running ? '일시정지' : continuation ? '계속' : '시작';
    $('startIcon').textContent = running ? 'Ⅱ' : '▶';
    $('startButton').disabled = state.busy || state.sending || !state.connected || Boolean(state.room?.pausePending) || state.applyingUpdate;
    $('startButton').title = state.room?.pausePending ? '현재 발언 뒤 일시정지' : '';
    $('resetButton').disabled = state.busy || state.sending || state.applyingUpdate;
    $('sendButton').disabled = state.sending || !state.connected || !$('messageInput').value.trim() || state.applyingUpdate;
    $('messageInput').disabled = state.applyingUpdate;
    $('updateButton').hidden = !state.waitingWorker || running;
    $('updateButton').disabled = state.applyingUpdate || state.busy || state.sending;
    $('workflowButton').disabled=running||state.busy||state.sending;
    if ($('settingsDialog').open) renderConnection();
  }
  function resizeComposer() {
    const input = $('messageInput');
    input.style.height = 'auto';
    input.style.height = Math.min(180, input.scrollHeight) + 'px';
  }
  function setConnected(connected) {
    state.connected = connected;
    if (connected && ['서버에 연결할 수 없습니다.', '연결이 끊겼습니다.'].includes($('errorText').textContent)) showError('');
    renderControls();
    renderMessages();
  }
  async function refreshStatus() {
    if (state.refreshBusy) return;
    state.refreshBusy = true;
    try {
      const data = await api('/api/status?refresh=1');
      for (const item of data.providers || []) state.providers.set(item.id, item);
      setConnected(true);
      renderModelBar();
      if ($('settingsDialog').open) renderSettingsModel();
    } catch (error) { setConnected(false); showError(error.message); }
    finally { state.refreshBusy = false; if ($('settingsDialog').open) renderConnection(); }
  }
  function openEvents() {
    events = new EventSource('/api/events');
    events.onopen = async () => {
      setConnected(true);
      const id = state.room?.id;
      if (id) {
        try { const data = await api('/api/rooms/' + encodeURIComponent(id)); if (state.room?.id === id) selectRoom(data.room); }
        catch (error) { showError(error.message); }
      } else await restoreRoom();
    };
    events.onerror = () => { setConnected(false); showError('연결이 끊겼습니다.'); };
    events.onmessage = event => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === 'status') {
        for (const item of data.providers || []) state.providers.set(item.id, item);
        renderModelBar();
        if ($('settingsDialog').open) renderSettingsModel();
       } else if (data.type === 'profiles') {
        for (const item of data.profiles || []) if (DEFAULT_PROFILES[item.id]) state.profiles.set(item.id, item);
        refreshProfileViews();
      } else if (data.type === 'settings' && data.settings) {
        appSettings = { ...appSettings, ...data.settings };
        applyAppSettings();
        if ($('appSettingsDialog').open) syncAppSettingsDialog();
      } else if (data.type === 'room' && data.room?.id === state.room?.id) {
        selectRoom(data.room);
      } else if (data.type === 'delta' && data.roomId === state.room?.id) {
        const message = state.room.messages.find(m => m.id === data.messageId);
        if (!message || message.status !== 'streaming') return;
        message.text = (message.text || '') + (data.delta || '');
        const node = messageNodes.get(data.messageId);
        if (node) { node.text.textContent = message.text; node.wrapper.classList.remove('waiting'); scrollToLatest(); }
        else renderMessages();
      }
    };
  }

  function registerPwa() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.installPrompt = event;
      $('installButton').hidden = false;
    });
    window.addEventListener('appinstalled', () => { state.installPrompt = null; $('installButton').hidden = true; });
    $('installButton').addEventListener('click', async () => {
      const prompt = state.installPrompt;
      if (!prompt) return;
      try { await prompt.prompt(); await prompt.userChoice; }
      finally { state.installPrompt = null; $('installButton').hidden = true; }
    });
    $('updateButton').addEventListener('click', () => {
      if (!state.waitingWorker || isRunning() || state.busy || state.sending) return;
      state.applyingUpdate = true;
      renderControls();
      state.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (state.applyingUpdate && !isRunning()) location.reload();
    });
    navigator.serviceWorker.register('/sw.js').then(registration => {
      if (registration.waiting) { state.waitingWorker = registration.waiting; renderControls(); }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            state.waitingWorker = registration.waiting || worker;
            renderControls();
          }
        });
      });
    }).catch(() => { /* Meetings work without installation or offline shell support. */ });
  }

  buildModelBar();
  renderWorkflow();
  applyAppSettings();
  $('appSettingsButton').addEventListener('click', () => { syncAppSettingsDialog(); $('appSettingsState').textContent = ''; $('appSettingsError').hidden = true; $('appSettingsDialog').showModal(); });
  $('closeAppSettingsButton').addEventListener('click', () => $('appSettingsDialog').close());
  $('doneAppSettingsButton').addEventListener('click', () => $('appSettingsDialog').close());
  $('fontScaleInput').addEventListener('input', () => changeAppSetting({ fontScale: Number($('fontScaleInput').value) }));
  $('fontScaleReset').addEventListener('click', () => changeAppSetting({ fontScale: 100 }));
  $('answerStyleSelect').addEventListener('change', () => changeAppSetting({ answerStyle: $('answerStyleSelect').value }));
  $('showTimeInput').addEventListener('change', () => changeAppSetting({ showTime: $('showTimeInput').checked }));
  $('autoScrollInput').addEventListener('change', () => changeAppSetting({ autoScroll: $('autoScrollInput').checked }));
  $('workflowButton').addEventListener('click',()=>{
    $('workflowFlow').value=workflow.flow;$('workflowAccess').value=workflow.access;$('workspaceInput').value=workflow.workspace;$('workflowMaxRounds').value=workflow.maxRounds;
    syncWorkflowDialog();$('workflowDialog').showModal();
  });
  $('workflowAccess').addEventListener('change',syncWorkflowDialog);
  $('workflowFlow').addEventListener('change',syncWorkflowDialog);
  $('closeWorkflowButton').addEventListener('click',()=>$('workflowDialog').close());
  $('saveWorkflowButton').addEventListener('click',()=>{
    const next={flow:$('workflowFlow').value,access:$('workflowAccess').value,workspace:$('workspaceInput').value.trim(),maxRounds:Math.max(1,Math.min(10,Math.round(Number($('workflowMaxRounds').value))||5))};
    if(next.access==='project'&&!next.workspace){$('workspaceInput').focus();return;}
    if(next.workspace!==workflow.workspace||next.access!==workflow.access)approvedWorkspace='';
    workflow=next;try{localStorage.setItem(WORKFLOW_KEY,JSON.stringify(workflow));}catch{}
    renderWorkflow();$('workflowDialog').close();
  });
  $('startButton').addEventListener('click', startOrPause);
  $('resetButton').addEventListener('click', resetSession);
  $('composerForm').addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
  $('messageInput').addEventListener('input', () => {
    resizeComposer();
    renderControls();
    try { sessionStorage.setItem(DRAFT_KEY, $('messageInput').value); } catch { /* Optional persistence. */ }
  });
  $('messageInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      sendMessage();
    }
  });
  $('messageScroll').addEventListener('scroll', () => { state.autoScroll = nearBottom(); }, { passive: true });
  $('dismissErrorButton').addEventListener('click', () => showError(''));
  $('closeSettingsButton').addEventListener('click', () => $('settingsDialog').close());
  $('settingsDialog').addEventListener('click', event => {
    if (event.target !== $('settingsDialog')) return;
    const rect = $('settingsDialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('settingsDialog').close();
  });
  $('participantEnabled').addEventListener('change', () => {
    const id = state.settingsProvider;
    if (!id || id === 'user') return;
    participant(id).enabled = $('participantEnabled').checked;
    saveParticipants(); renderModelBar();
  });
  $('settingsModel').addEventListener('change', () => {
    const id = state.settingsProvider;
    if (!id || id === 'user') return;
    participant(id).model = $('settingsModel').value;
    normalizeEffort(id);
    saveParticipants(); renderModelBar(); renderSettingsModel();
  });
  $('settingsEffort').addEventListener('change', () => {
    const id = state.settingsProvider;
    if (!id || id === 'user') return;
    participant(id).effort = $('settingsEffort').value;
    saveParticipants(); renderConnection();
  });
  $('userProfileButton').addEventListener('click', () => openSettings('user'));
  for (const tab of ['profile', 'connection', 'role']) {
    $(tab + 'Tab').addEventListener('click', () => setSettingsTab(tab));
    $(tab + 'Tab').addEventListener('keydown', event => {
      const tabs = ['profile', 'connection', 'role'].filter(name => !$(name + 'Tab').hidden);
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setSettingsTab(tabs[index], true);
    });
  }
  for (const glyph of AVATAR_PRESETS) {
    const button = el('button', 'avatar-preset', glyph);
    button.type = 'button';
    button.dataset.avatar = glyph;
    button.setAttribute('aria-label', '프로필 아이콘 ' + glyph);
    button.addEventListener('click', () => {
      if (!state.profileDraft) return;
      state.profileDraft.avatar = { kind: 'emoji', value: glyph };
      $('saveState').textContent = '';
      renderProfileEditor();
    });
    $('avatarPresets').append(button);
  }
  for (const color of PROFILE_COLORS) {
    const button = el('button', 'color-swatch');
    button.type = 'button';
    button.dataset.color = color;
    button.style.backgroundColor = color;
    button.setAttribute('aria-label', ({ '#e5eee7': '세이지', '#f3e5dd': '피치', '#eae6f2': '라일락', '#f5e7bb': '버터', '#e6e7e8': '그레이', '#f0dfe5': '로즈' })[color]);
    button.addEventListener('click', () => {
      if (!state.profileDraft) return;
      state.profileDraft.color = color;
      $('saveState').textContent = '';
      renderProfileEditor();
    });
    $('profileColors').append(button);
  }
  $('profileName').addEventListener('input', () => {
    if (state.profileDraft) state.profileDraft.displayName = $('profileName').value;
    $('saveState').textContent = '';
  });
  $('uploadAvatarButton').addEventListener('click', () => $('avatarInput').click());
  $('resetAvatarButton').addEventListener('click', () => {
    if (!state.profileDraft) return;
    state.profileDraft.avatar = { ...DEFAULT_PROFILES[state.settingsProvider].avatar };
    renderProfileEditor();
    $('saveState').textContent = '';
  });
  $('avatarInput').addEventListener('change', async () => {
    const file = $('avatarInput').files?.[0];
    const id = state.settingsProvider;
    if (!file || !id) return;
    state.avatarLoading = true;
    $('saveRoleButton').disabled = true;
    settingsError('');
    try {
      const avatar = await prepareAvatar(file);
      if (state.settingsProvider !== id) return;
      state.profileDraft.avatar = avatar;
      renderProfileEditor();
      $('saveState').textContent = '';
    } catch (error) { settingsError(error.message); }
    finally { state.avatarLoading = false; $('avatarInput').value = ''; $('saveRoleButton').disabled = state.roleSaving; }
  });
  $('refreshAuthButton').addEventListener('click', async () => {
    settingsError('');
    await refreshStatus();
    if (['ready', 'authenticated', 'logged_in'].includes(authValue(provider(state.settingsProvider)))) $('loginHint').hidden = true;
  });
  $('roleInput').addEventListener('input', () => { $('saveState').textContent = ''; });
  $('saveRoleButton').addEventListener('click', saveRole);
  $('loginButton').addEventListener('click', () => providerAction('login'));
  $('checkButton').addEventListener('click', () => providerAction('check'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
  try { $('messageInput').value = sessionStorage.getItem(DRAFT_KEY) || ''; } catch { /* Optional draft persistence. */ }
  resizeComposer();
  renderControls();
  registerPwa();
  Promise.allSettled([refreshStatus(), loadRoles(), loadProfiles(), loadAppSettings()]).then(async () => {
    await restoreRoom();
    openEvents();
  });
  window.setInterval(() => { if (!document.hidden) refreshStatus(); }, 60000);
})();
