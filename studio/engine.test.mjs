import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeetingEngine, publicRoom, buildPrompt, exportMarkdown, exportSrt, normalizeConfig } from './engine.mjs';
import { chooseFlow, chooseCycleOrder, normalizeWorkflow, resolveWorkspace } from './workflow.mjs';

const qaRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'qa');
const ready=['codex','claude','gemini'].map(id=>({id,installed:true,auth:'ready'}));
const participants=ready.map(p=>({id:p.id,provider:p.id,name:p.id.toUpperCase(),model:'',effort:'default',enabled:true}));
const config=(patch={})=>({topic:'사용자가 직접 촬영할 수 있는 AI 회의',mode:'meeting',rounds:2,turnDelayMs:0,wordLimit:40,participants,...patch});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

async function fixture(t,options={}) {
  await mkdir(qaRoot,{recursive:true});
  const temp=await mkdtemp(path.join(qaRoot,'engine-test-'));
  const events=[];
  const engine=new MeetingEngine({dataDir:path.join(temp,'rooms'),workDir:path.join(temp,'workdir'),getProviders:async()=>ready,runProvider:async()=>({text:'공개 발언입니다.',durationMs:1}),broadcast:event=>events.push(event),...options});
  await engine.init();
  t.after(async()=>{
    await engine.shutdown();
    assert.equal(path.dirname(path.resolve(temp)),qaRoot,'cleanup remains inside the dedicated QA directory');
    assert.match(path.basename(temp),/^engine-test-/);
    await rm(temp,{recursive:true,force:true});
  });
  return {engine,temp,events};
}

async function settled(engine,id) {
  const pending=engine.jobs.get(id)?.promise;
  if(pending)await pending;
}

test('auto selects parallel research and sequential chat; project always serializes writers',()=>{
  assert.equal(chooseFlow({flow:'auto',access:'research'},'플레이스토어 시장을 조사해줘'),'parallel');
  assert.equal(chooseFlow({flow:'auto',access:'research'},'안녕, 아이디어를 이야기하자'),'sequential');
  assert.equal(chooseFlow({flow:'parallel',access:'project'},'조사'),'sequential');
  assert.throws(()=>normalizeWorkflow({access:'project',workspace:'relative/path'}),/절대 경로/);
});

test('auto rotates speakers and explicit mentions choose only the addressed participant',()=>{
  assert.deepEqual(chooseCycleOrder(participants,{id:'m1',text:'회의 시작'},2,'auto'),['claude','gemini','codex']);
  assert.deepEqual(chooseCycleOrder(participants,{id:'m2',text:'@Gemini 웹 조사해줘'},1,'auto'),['gemini']);
  assert.deepEqual(chooseCycleOrder(participants,{id:'m2',text:'@Gemini 웹 조사해줘'},2,'auto','m2'),['claude','gemini','codex']);
});

test('a direct mention calls just the addressed provider without blocking on unselected authentication',{timeout:5000},async t=>{
  const calls=[];
  const {engine}=await fixture(t,{getProviders:async()=>ready.map(p=>p.id==='claude'?{...p,auth:'login_required'}:p),runProvider:async req=>{calls.push(req.provider);return {text:'확인'};}});
  const room=await engine.create(config({userLed:true,flow:'auto',access:'research'}));
  await engine.message(room.id,'@Codex 이 자료를 조사해줘');
  await engine.start(room.id);await settled(engine,room.id);
  assert.deepEqual(calls,['codex']);
  assert.equal(room.cycleComplete,true);
  assert.equal(room.config.participants.length,3);
});

test('parallel calls share only the initial snapshot; fast answers arrive first and reviews see all results',{timeout:5000},async t=>{
  const gates=new Map(participants.map(p=>[p.id,deferred()]));
  const allStarted=deferred(), calls=[];
  const {engine}=await fixture(t,{runProvider:async req=>{
    calls.push(req);
    if(req.prompt.includes('독립 조사 단계:')){
      if(calls.length===3)allStarted.resolve();
      await gates.get(req.provider).promise;
      return {text:'RESULT-'+req.provider,tools:['web']};
    }
    return {text:'REVIEW-'+req.provider};
  }});
  const room=await engine.create(config({userLed:true,flow:'parallel',access:'research'}));
  await engine.message(room.id,'독립적으로 조사해줘');
  await engine.start(room.id);
  await allStarted.promise;
  try{
    assert.equal(calls.length,3);
    assert.equal(room.messages.filter(m=>m.status==='streaming').length,3);
    assert.ok(calls.every(req=>req.access==='research'&&!req.prompt.includes('RESULT-')));
    gates.get('gemini').resolve();
    for(let i=0;i<100&&!room.messages.some(m=>m.text==='RESULT-gemini'&&m.status==='complete');i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(room.messages.find(m=>m.kind==='speech'&&m.status==='complete')?.provider,'gemini');
    await engine.message(room.id,'추가 조건: 2주 이내');
  }finally{for(const gate of gates.values())gate.resolve();}
  await settled(engine,room.id);
  const review=calls.filter(r=>r.prompt.includes('상호 검토 단계:'));
  assert.equal(review.length,3);
  assert.ok(review.every(r=>participants.every(p=>r.prompt.includes('RESULT-'+p.id))&&r.prompt.includes('추가 조건')));
  assert.equal(room.cycleComplete,true);
  assert.equal(room.status,'paused');
  assert.equal(room.nextTurn,6);
});

test('a failed parallel member can be retried without repeating successful research',{timeout:5000},async t=>{
  let failed=false;const calls=[];
  const {engine}=await fixture(t,{runProvider:async req=>{
    const research=req.prompt.includes('독립 조사 단계:');
    calls.push([req.provider,research]);
    if(research&&req.provider==='claude'&&!failed){failed=true;throw new Error('test failure');}
    return {text:'RESULT-'+req.provider};
  }});
  const room=await engine.create(config({userLed:true,flow:'parallel',access:'research'}));
  await engine.message(room.id,'조사');
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(room.status,'error');
  assert.equal(room.parallelPlan.researchDone.length,2);
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(room.status,'paused');assert.equal(room.cycleComplete,true);
  assert.equal(calls.filter(([p,r])=>p==='codex'&&r).length,1);
  assert.equal(calls.filter(([p,r])=>p==='claude'&&r).length,2);
});

test('pause during concurrent research waits for active requests and postpones review',{timeout:5000},async t=>{
  const ready=deferred(),gate=deferred();let calls=0;
  const {engine}=await fixture(t,{runProvider:async()=>{if(++calls===3)ready.resolve();await gate.promise;return {text:'답변'};}});
  const room=await engine.create(config({userLed:true,flow:'parallel',access:'research'}));
  await engine.message(room.id,'조사');await engine.start(room.id);await ready.promise;
  try{await engine.pause(room.id);assert.equal(room.pausePending,true);}finally{gate.resolve();}
  await settled(engine,room.id);
  assert.equal(calls,3);assert.equal(room.parallelPlan.phase,'review');
  await engine.start(room.id);await settled(engine,room.id);assert.equal(calls,6);
});

test('stop aborts all concurrent providers and never launches review',{timeout:5000},async t=>{
  const ready=deferred();let calls=0,aborts=0;
  const {engine}=await fixture(t,{runProvider:async req=>{
    if(++calls===3)ready.resolve();
    return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>{aborts++;reject(new Error('aborted'));},{once:true}));
  }});
  const room=await engine.create(config({userLed:true,flow:'parallel',access:'research'}));
  await engine.message(room.id,'조사');await engine.start(room.id);await ready.promise;
  await engine.stop(room.id);await settled(engine,room.id);
  assert.equal(aborts,3);assert.equal(calls,3);assert.equal(room.status,'stopped');
  assert.equal(room.messages.filter(m=>m.status==='streaming').length,0);
});

test('project mode runs serially in the explicitly selected existing directory',{timeout:5000},async t=>{
  const calls=[];let active=0,peak=0;
  const {engine,temp}=await fixture(t,{runProvider:async req=>{calls.push(req);peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,10));active--;return {text:'검토 완료'};}});
  const project=path.join(temp,'test-project');await mkdir(project);
  const room=await engine.create(config({userLed:true,flow:'parallel',access:'project',workspace:project}));
  await engine.message(room.id,'파일을 검토해줘');
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(peak,1);assert.equal(calls.length,3);
  assert.ok(calls.every(r=>r.cwd===room.config.workspace&&r.access==='project'));
  assert.ok(calls.every(r=>r.prompt.includes('사용자가 선택한 프로젝트')));
  assert.equal(room.config.workspace,await resolveWorkspace(project));
  await assert.rejects(resolveWorkspace(path.parse(project).root),/프로젝트 폴더/);
});

test('private mystery clues are isolated from public state, exports, broadcasts, and other participants',{timeout:5000},async t=>{
  const {engine,events}=await fixture(t);
  const room=await engine.create(config({mode:'mystery'}));
  const publicText=JSON.stringify(publicRoom(room));
  assert.equal(Object.hasOwn(publicRoom(room),'privateCase'),false);
  assert.equal(publicText.includes('culpritId'),false);
  for(const participant of room.config.participants){
    const own=room.privateCase.secrets[participant.id];
    const {prompt}=buildPrompt(room,participant);
    assert.ok(prompt.includes(own));
    for(const other of room.config.participants.filter(p=>p.id!==participant.id))assert.ok(!prompt.includes(room.privateCase.secrets[other.id]));
    assert.ok(!publicText.includes(own));
    assert.ok(!exportMarkdown(room).includes(own));
    assert.ok(!exportSrt(room).includes(own));
    assert.ok(!JSON.stringify(events).includes(own));
  }
});

test('mystery answer is disclosed only after all scheduled real provider turns complete',{timeout:5000},async t=>{
  const calls=[];
  const {engine}=await fixture(t,{runProvider:async request=>{calls.push(request);return {text:`공개 답변 ${calls.length}`,durationMs:1};}});
  const room=await engine.create(config({mode:'mystery',rounds:1}));
  await engine.start(room.id,{single:true});await settled(engine,room.id);
  assert.equal(room.caseRevealed,undefined);
  assert.equal(room.messages.some(m=>m.text.includes('[정답 공개]')),false);
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(calls.length,3);
  assert.equal(room.status,'completed');
  assert.equal(room.caseRevealed,true);
  assert.equal(room.messages.filter(m=>m.text.includes('[정답 공개]')).length,1);
  assert.ok(room.messages.at(-1).text.includes(room.privateCase.culpritName));
});

test('pause finishes the current utterance then resumes at the next participant',{timeout:5000},async t=>{
  const entered=deferred(),release=deferred();let calls=0;
  const {engine}=await fixture(t,{runProvider:async()=>{calls++;if(calls===1){entered.resolve();await release.promise;}return {text:`발언 ${calls}`,durationMs:1};}});
  const room=await engine.create(config({participants:participants.slice(0,2)}));
  await engine.start(room.id);await entered.promise;
  const pending=engine.jobs.get(room.id).promise;
  await engine.pause(room.id);
  assert.equal(room.pausePending,true);
  assert.equal(room.currentSpeaker,'codex');
  release.resolve();await pending;
  assert.equal(calls,1);
  assert.equal(room.status,'paused');
  assert.equal(Boolean(room.pausePending),false,'pausePending clears when the requested utterance finishes');
  assert.equal(room.nextTurn,1);
  await engine.start(room.id,{single:true});await settled(engine,room.id);
  assert.equal(calls,2);
  assert.deepEqual(room.messages.filter(m=>m.status==='complete').map(m=>m.participantId),['codex','claude']);
  assert.equal(room.nextTurn,2);
});

test('stop aborts an active turn; retry keeps the same speaker and omits incomplete text from context',{timeout:5000},async t=>{
  const entered=deferred();const prompts=[];let calls=0;
  const {engine}=await fixture(t,{runProvider:async request=>{
    prompts.push(request.prompt);calls++;
    if(calls===1){
      request.onDelta('중단된-비공개-조각');entered.resolve();
      await new Promise((resolve,reject)=>{const stop=()=>reject(new Error('사용자 중지'));if(request.signal.aborted)stop();else request.signal.addEventListener('abort',stop,{once:true});});
    }
    return {text:'완성된 공개 답변',durationMs:1};
  }});
  const room=await engine.create(config({rounds:1,participants:participants.slice(0,1)}));
  await engine.start(room.id);await entered.promise;
  const pending=engine.jobs.get(room.id).promise;
  await engine.stop(room.id);await pending;
  assert.equal(room.nextTurn,0);
  assert.equal(room.status,'stopped');
  assert.equal(room.messages[0].status,'error');
  assert.equal(engine.busy,null);
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(room.nextTurn,1);
  assert.equal(room.status,'completed');
  assert.equal(room.messages[1].participantId,'codex');
  assert.ok(!prompts[1].includes('중단된-비공개-조각'));
  assert.ok(!exportSrt(room).includes('중단된-비공개-조각'));
});

test('stop while provider preflight is pending never invokes a model after the stop',{timeout:5000},async t=>{
  const entered=deferred(),release=deferred();let calls=0;
  const {engine}=await fixture(t,{getProviders:async()=>{entered.resolve();return release.promise;},runProvider:async()=>{calls++;return {text:'이 호출은 실행되면 안 됩니다.'};}});
  const room=await engine.create(config({rounds:1,participants:participants.slice(0,1)}));
  const starting=engine.start(room.id);
  await entered.promise;
  await engine.stop(room.id);
  release.resolve(ready);
  await starting.catch(()=>{});await settled(engine,room.id);
  assert.equal(calls,0,'an acknowledged stop must cancel a start still in preflight');
  assert.equal(room.status,'stopped');
});

test('a second room cannot start while another room is in preflight or has an active turn',{timeout:5000},async t=>{
  const authEntered=deferred(),authRelease=deferred(),runEntered=deferred(),runRelease=deferred();
  const {engine}=await fixture(t,{getProviders:async()=>{authEntered.resolve();return authRelease.promise;},runProvider:async()=>{runEntered.resolve();await runRelease.promise;return {text:'첫 번째 방 완료'};}});
  const first=await engine.create(config({rounds:1,participants:participants.slice(0,1)}));
  const second=await engine.create(config({rounds:1,participants:participants.slice(0,1)}));
  const starting=engine.start(first.id);await authEntered.promise;
  await assert.rejects(engine.start(second.id),/진행 중/);
  authRelease.resolve(ready);await starting;await runEntered.promise;
  await assert.rejects(engine.start(second.id),/진행 중/);
  runRelease.resolve();await settled(engine,first.id);
  assert.equal(engine.busy,null);
});

test('failure to persist the start releases the active-room reservation',{timeout:5000},async t=>{
  let calls=0;
  const {engine}=await fixture(t,{runProvider:async()=>{calls++;return {text:'복구 후 응답'};}});
  const room=await engine.create(config({rounds:1,participants:participants.slice(0,1)}));
  const realSave=engine.save.bind(engine);let fail=true;
  engine.save=async value=>{if(fail){fail=false;throw new Error('simulated disk write failure');}return realSave(value);};
  await assert.rejects(engine.start(room.id),/disk write failure/);
  assert.equal(engine.busy,null,'a failed initial save cannot lock all subsequent meetings');
  assert.equal(engine.jobs.size,0);
  assert.equal(calls,0);
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(calls,1);
  assert.equal(room.status,'completed');
});

test('a moderator interjection is included in the next participant prompt',{timeout:5000},async t=>{
  const entered=deferred(),release=deferred(),prompts=[];
  const {engine}=await fixture(t,{runProvider:async request=>{prompts.push(request.prompt);if(prompts.length===1){entered.resolve();await release.promise;}return {text:'이번 차례의 답변'};}});
  const room=await engine.create(config({rounds:1,participants:participants.slice(0,2)}));
  await engine.start(room.id);await entered.promise;
  await engine.message(room.id,'예산은 오만원이며 재활용품을 우선해주세요.');
  release.resolve();await settled(engine,room.id);
  assert.equal(prompts.length,2);
  assert.ok(!prompts[0].includes('예산은 오만원'));
  assert.ok(prompts[1].includes('예산은 오만원'));
  assert.ok(prompts[1].includes('이번 차례의 답변'));
});

test('restart repairs unfinished streaming messages even when the last saved room was stopped',{timeout:5000},async t=>{
  const {engine}=await fixture(t);
  const room=await engine.create(config({rounds:1,participants:participants.slice(0,1)}));
  room.status='stopped';room.currentSpeaker='codex';
  room.messages.push({id:'interrupted',participantId:'codex',provider:'codex',name:'CODEX',kind:'speech',text:'일부 답변',round:1,status:'streaming',startedAt:new Date().toISOString()});
  await engine.save(room);
  const restarted=new MeetingEngine({dataDir:engine.dataDir,workDir:engine.workDir,getProviders:async()=>ready,runProvider:async()=>({text:'다시 시작'})});
  await restarted.init();
  const recovered=restarted.get(room.id);
  assert.equal(recovered.messages[0].status,'error','recorded streaming state cannot survive a server restart');
  assert.equal(recovered.currentSpeaker,null);
});

test('captions use sequential valid timestamps and exclude failed, private and system content',{timeout:5000},async t=>{
  const {engine}=await fixture(t);
  const room=await engine.create(config({participants:participants.slice(0,1)}));
  room.messages=[
    {kind:'speech',name:'CODEX',text:'촬영을 위한 첫 번째 공개 발언입니다. '.repeat(6),status:'complete'},
    {kind:'speech',name:'CLAUDE',text:'오류-비공개-내용',status:'error'},
    {kind:'system',name:'진행자',text:'시스템-설명',status:'complete'},
    {kind:'user',name:'진행자',text:'사용자 추가 질문',status:'complete'}
  ];
  const srt=exportSrt(room);
  assert.ok(srt.startsWith('1\n00:00:00,000 --> '));
  assert.ok(srt.includes('사용자 추가 질문'));
  assert.ok(!srt.includes('오류-비공개-내용'));
  assert.ok(!srt.includes('시스템-설명'));
  const blocks=srt.trim().split('\n\n');
  const milliseconds=text=>{const [h,m,s,ms]=text.split(/[:,]/).map(Number);return ((h*60+m)*60+s)*1000+ms;};
  let previousEnd=-1;
  blocks.forEach((block,index)=>{
    const [number,times,text]=block.split('\n');
    assert.equal(Number(number),index+1);
    const match=times.match(/^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/);
    assert.ok(match);assert.ok(text);
    const start=milliseconds(match[1]),end=milliseconds(match[2]);
    assert.ok(start>previousEnd);assert.ok(end>start);previousEnd=end;
  });
});

test('an empty user-led session waits for its first user message without checking or calling providers',{timeout:5000},async t=>{
  let checks=0,calls=0;
  const {engine}=await fixture(t,{getProviders:async()=>{checks++;return ready;},runProvider:async()=>{calls++;return {text:'시작하면 안 되는 응답'};}});
  const room=await engine.create(config({userLed:true,rounds:1}));
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(checks,0);
  assert.equal(calls,0);
  assert.equal(room.messages.length,0);
  assert.equal(room.nextTurn,0);
  assert.equal(room.status,'idle');
  assert.equal(engine.busy,null);
});

test('a user-led message produces one cycle of selected AI responses, then pauses for the user',{timeout:5000},async t=>{
  const calls=[];
  const {engine}=await fixture(t,{runProvider:async request=>{calls.push(request);return {text:`${request.provider}의 공개 응답`};}});
  const room=await engine.create(config({userLed:true,rounds:1}));
  await engine.message(room.id,'우리 함께 적은 예산으로 만들 영상 아이디어를 정해보자.');
  assert.equal(calls.length,0,'entering a message alone does not invoke providers');
  await engine.start(room.id);await settled(engine,room.id);
  assert.deepEqual(calls.map(call=>call.provider),['codex','claude','gemini']);
  assert.equal(room.status,'paused');
  assert.equal(room.cycleComplete,true);
  assert.equal(room.cycleNumber,1);
  assert.equal(room.currentSpeaker,null);
  assert.equal(room.nextTurn,3);
  assert.equal(room.messages.filter(m=>m.kind==='user').length,1);
  assert.equal(room.messages.filter(m=>m.kind==='speech'&&m.status==='complete').length,3);
  assert.ok(calls.every(call=>call.prompt.includes('적은 예산으로 만들 영상 아이디어')));
});

test('explicitly continuing a completed user-led cycle retains the full previous conversation',{timeout:5000},async t=>{
  const calls=[];
  const {engine}=await fixture(t,{runProvider:async request=>{calls.push(request);return {text:`이어받을-공개발언-${calls.length}`};}});
  const room=await engine.create(config({userLed:true,rounds:1}));
  await engine.message(room.id,'회의를 이어갈 원래 질문입니다.');
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(calls.length,3);
  await engine.message(room.id,'이번에는 촬영 시간을 십분 이내로 제한해줘.');
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(calls.length,6);
  assert.equal(room.cycleNumber,2);
  assert.equal(room.cycleComplete,true);
  assert.equal(room.status,'paused');
  assert.ok(calls[3].prompt.includes('원래 질문입니다'));
  assert.ok(calls[3].prompt.includes('촬영 시간을 십분 이내'));
  for(let number=1;number<=3;number++)assert.ok(calls[3].prompt.includes(`이어받을-공개발언-${number}`));
  assert.ok(!calls[3].prompt.includes('진행: 2/1라운드'),'an open-ended meeting cannot claim it is in round 2 of 1');
});

test('changing user-led participants between cycles begins with the first newly selected participant',{timeout:5000},async t=>{
  const calls=[];
  const {engine}=await fixture(t,{runProvider:async request=>{calls.push(request.provider);return {text:`${request.provider} 답변`};}});
  const room=await engine.create(config({userLed:true,rounds:1}));
  await engine.message(room.id,'모든 참가자가 한 번씩 이야기해줘.');
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(room.nextTurn,3);
  const changed=[participants[1],participants[2]];
  await engine.start(room.id,{participants:changed});await settled(engine,room.id);
  assert.deepEqual(calls,['codex','claude','gemini','claude','gemini']);
  assert.equal(room.cycleNumber,2);
  assert.equal(room.nextTurn,5);
  assert.equal(room.cycleStartTurn,3);
  assert.equal(room.cycleEndTurn,5);
  assert.deepEqual(room.config.participants.map(p=>p.id),['claude','gemini']);
});

test('role files are freshly resolved for each turn and the exact version hash stays with that utterance',{timeout:5000},async t=>{
  const calls=[],reads=[];let revision=1;
  const {engine}=await fixture(t,{
    roleResolver:async provider=>{reads.push({provider,revision});return {content:`${provider} 역할파일-리비전-${revision}`,filename:`${provider}.md`,hash:`hash-${provider}-${revision}`};},
    runProvider:async request=>{calls.push(request);revision++;return {text:`새 역할 적용 응답 ${calls.length}`};}
  });
  const room=await engine.create(config({userLed:true,rounds:1,participants:participants.slice(0,2)}));
  await engine.message(room.id,'현재 파일에 적힌 역할로 의견을 줘.');
  await engine.start(room.id);await settled(engine,room.id);
  await engine.start(room.id,{single:true});await settled(engine,room.id);
  assert.deepEqual(reads,[{provider:'codex',revision:1},{provider:'claude',revision:2},{provider:'codex',revision:3}]);
  const utterances=room.messages.filter(m=>m.kind==='speech');
  utterances.forEach((message,index)=>{
    const expected=reads[index];
    assert.equal(message.roleFile,`${expected.provider}.md`);
    assert.equal(message.roleHash,`hash-${expected.provider}-${expected.revision}`);
    assert.ok(calls[index].prompt.includes(`${expected.provider} 역할파일-리비전-${expected.revision}`));
  });
  assert.equal(utterances[0].roleHash,'hash-codex-1','updating the role file never rewrites historical provenance');
  assert.equal(room.config.participants[0].persona,'','resolved role content remains per-turn, not stale in config');
});

test('reset by stopping and creating a new user-led room shares neither old prompts nor working directories',{timeout:5000},async t=>{
  const calls=[];
  const {engine}=await fixture(t,{runProvider:async request=>{calls.push(request);return {text:calls.length===1?'이전방에만-남을-응답':'새방-응답'};}});
  const before=await engine.create(config({userLed:true,rounds:1,participants:participants.slice(0,1)}));
  await engine.message(before.id,'이전방에만-남을-질문');
  await engine.start(before.id);await settled(engine,before.id);
  await engine.stop(before.id);
  const after=await engine.create(config({userLed:true,rounds:1,participants:participants.slice(0,1)}));
  assert.notEqual(after.id,before.id);
  assert.equal(after.messages.length,0);
  await engine.message(after.id,'완전히 새로운 회의를 시작해줘.');
  await engine.start(after.id);await settled(engine,after.id);
  assert.equal(calls.length,2);
  assert.ok(!calls[1].prompt.includes('이전방에만-남을-질문'));
  assert.ok(!calls[1].prompt.includes('이전방에만-남을-응답'));
  assert.ok(calls[1].prompt.includes('완전히 새로운 회의'));
  assert.notEqual(calls[0].cwd,calls[1].cwd);
  assert.equal(before.status,'stopped');
  assert.equal(after.cycleNumber,1);
});

test('stop during asynchronous role-file reading does not start the pending provider turn',{timeout:5000},async t=>{
  const entered=deferred(),release=deferred();let calls=0;
  const {engine}=await fixture(t,{
    roleResolver:async()=>{entered.resolve();return release.promise;},
    runProvider:async()=>{calls++;return {text:'중지 후 실행되면 안 되는 응답'};}
  });
  const room=await engine.create(config({userLed:true,rounds:1,participants:participants.slice(0,1)}));
  await engine.message(room.id,'첫 발언을 준비해줘.');
  await engine.start(room.id);await entered.promise;
  const pending=engine.jobs.get(room.id).promise;
  await engine.stop(room.id);
  release.resolve({content:'기본 역할',filename:'codex.md',hash:'a'});await pending;
  assert.equal(calls,0,'stop must be rechecked after asynchronous preparation');
  assert.equal(room.status,'stopped');
  assert.equal(room.nextTurn,0);
});

test('live profile changes reach the next speaker and user message without changing provider identity or historical names',{timeout:5000},async t=>{
  const entered=deferred(),release=deferred(),calls=[];
  const profiles={codex:{displayName:'기획자'},claude:{displayName:'검토자'},gemini:{displayName:'상상가'},user:{displayName:'민지'}};
  const {engine}=await fixture(t,{
    profileResolver:async id=>profiles[id],
    runProvider:async request=>{calls.push(request);if(calls.length===1){entered.resolve();await release.promise;}return {text:`${request.provider}의 답변`};}
  });
  const room=await engine.create(config({userLed:true,rounds:1,participants:participants.slice(0,2)}));
  assert.deepEqual(room.config.participants.map(p=>p.name),['기획자','검토자']);
  await engine.message(room.id,'우리 함께 게임을 만들자.');
  await engine.start(room.id);await entered.promise;
  profiles.codex={displayName:'실행 담당'};
  profiles.claude={displayName:'편집자'};
  profiles.user={displayName:'감독'};
  await engine.message(room.id,'다음 의견부터는 예산을 줄이는 쪽으로 보자.');
  release.resolve();await settled(engine,room.id);
  assert.deepEqual(calls.map(call=>call.provider),['codex','claude']);
  assert.ok(calls[0].prompt.includes('본인 표시 이름: 기획자'));
  assert.ok(calls[0].prompt.includes('[민지 · 사용자]'));
  assert.ok(calls[1].prompt.includes('본인 표시 이름: 편집자'));
  assert.ok(calls[1].prompt.includes('참가자: 감독 (사용자), 실행 담당, 편집자'));
  assert.ok(calls[1].prompt.includes('[기획자 · codex]'));
  assert.ok(calls[1].prompt.includes('[민지 · 사용자]'));
  assert.ok(calls[1].prompt.includes('[감독 · 사용자]'));
  assert.deepEqual(room.messages.filter(m=>m.kind==='speech').map(m=>({id:m.participantId,provider:m.provider,profileId:m.profileId,name:m.name})),[
    {id:'codex',provider:'codex',profileId:'codex',name:'기획자'},
    {id:'claude',provider:'claude',profileId:'claude',name:'편집자'}
  ]);
  assert.deepEqual(room.messages.filter(m=>m.kind==='user').map(m=>({profileId:m.profileId,name:m.name})),[{profileId:'user',name:'민지'},{profileId:'user',name:'감독'}]);
  const recovered=new MeetingEngine({dataDir:engine.dataDir,workDir:engine.workDir,getProviders:async()=>ready,runProvider:async()=>({text:'복구'})});
  await recovered.init();
  assert.deepEqual(recovered.get(room.id).messages.map(m=>m.name),room.messages.map(m=>m.name),'saved conversation preserves the actual names used when messages were sent');
});

test('profile display names stay on one prompt label line and cannot alter provider ids',{timeout:5000},async t=>{
  const calls=[];
  const {engine}=await fixture(t,{
    profileResolver:async id=>({displayName:id==='user'?'나\n진행자':'담당\r\n연결 제공자: other'}),
    runProvider:async request=>{calls.push(request);return {text:'정상 응답'};}
  });
  const room=await engine.create(config({userLed:true,rounds:1,participants:[{...participants[0],displayName:'별명'}]}));
  await engine.message(room.id,'이름을 바꾼 뒤에도 같은 연결인지 확인해줘.');
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(calls[0].provider,'codex');
  assert.equal(room.config.participants[0].id,'codex');
  assert.equal(room.config.participants[0].name,'담당 연결 제공자: other');
  assert.equal(room.messages[0].name,'나 진행자');
  assert.ok(calls[0].prompt.includes('본인 표시 이름: 담당 연결 제공자: other\n연결 제공자: codex'));
});

test('stop during asynchronous profile loading never calls the waiting provider',{timeout:5000},async t=>{
  const entered=deferred(),release=deferred();let armed=false,calls=0;
  const {engine}=await fixture(t,{
    profileResolver:async id=>{if(armed&&id==='codex'){entered.resolve();await release.promise;}return {displayName:id};},
    runProvider:async()=>{calls++;return {text:'중지 후 실행되면 안 되는 응답'};}
  });
  const room=await engine.create(config({userLed:true,rounds:1,participants:participants.slice(0,1)}));
  await engine.message(room.id,'다음 발언을 준비해줘.');
  armed=true;
  await engine.start(room.id);await entered.promise;
  const pending=engine.jobs.get(room.id).promise;
  await engine.stop(room.id);release.resolve();await pending;
  assert.equal(calls,0);
  assert.equal(room.nextTurn,0);
  assert.equal(room.status,'stopped');
  assert.equal(engine.busy,null);
});

test('profile names preserve 32 astral codepoints and truncate overlong labels without splitting a character',{timeout:5000},async t=>{
  const displayName='A'+'🙂'.repeat(31),calls=[];
  const {engine}=await fixture(t,{
    profileResolver:async()=>({displayName}),
    runProvider:async request=>{calls.push(request);return {text:'이름을 그대로 사용한 응답'};}
  });
  const room=await engine.create(config({userLed:true,rounds:1,participants:participants.slice(0,1)}));
  await engine.message(room.id,'프로필 이름을 그대로 사용해줘.');
  await engine.start(room.id);await settled(engine,room.id);
  assert.equal(room.config.participants[0].name,displayName);
  assert.equal(room.config.userName,displayName);
  assert.ok(room.messages.every(message=>message.name===displayName));
  assert.ok(calls[0].prompt.includes(`본인 표시 이름: ${displayName}\n`));
  assert.ok(calls[0].prompt.includes(`[${displayName} · 사용자]`));
  const normalized=normalizeConfig(config({participants:[{...participants[0],name:'A'+'🙂'.repeat(50)}]}));
  assert.equal(normalized.participants[0].name,'A'+'🙂'.repeat(39));
  assert.equal([...normalized.participants[0].name].length,40);
  assert.equal(normalized.participants[0].name.isWellFormed(),true);
});
