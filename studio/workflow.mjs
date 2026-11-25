import path from 'node:path';
import os from 'node:os';
import { realpath, stat, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { redact } from '../src/redactor.js';

export function normalizeWorkflow(input = {}) {
  const flow = ['auto','sequential','parallel','debate'].includes(input.flow) ? input.flow : 'sequential';
  const access = ['chat','research','project'].includes(input.access) ? input.access : 'chat';
  const workspace = access === 'project' ? String(input.workspace || '').trim() : '';
  if (access === 'project' && (!workspace || workspace.length > 1024 || !path.isAbsolute(workspace) || /[\u0000-\u001f]/.test(workspace))) {
    throw new Error('프로젝트 작업에는 실제 프로젝트 폴더의 절대 경로가 필요합니다.');
  }
  const maxRounds = Number.isFinite(Number(input.maxRounds)) ? Math.max(1, Math.min(10, Math.round(Number(input.maxRounds)))) : 5;
  return { flow, access, workspace, maxRounds };
}

export async function resolveWorkspace(workspace) {
  const resolved = await realpath(workspace).catch(() => { throw new Error('프로젝트 폴더를 찾을 수 없습니다.'); });
  const info = await stat(resolved);
  const compare = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const sensitiveRoots = [path.parse(resolved).root, os.homedir(), process.env.SystemRoot, process.env.ProgramFiles, process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean);
  if (!info.isDirectory() || sensitiveRoots.some(root => compare(root) === compare(resolved))) throw new Error('드라이브 전체나 시스템/사용자 폴더가 아닌 프로젝트 폴더를 선택하세요.');
  return resolved;
}

export function chooseFlow(config, latestMessage = '') {
  if (config.access === 'project') return 'sequential'; // one writer at a time
  if (config.flow === 'debate') return 'debate';
  if (config.flow !== 'auto') return config.flow === 'parallel' ? 'parallel' : 'sequential';
  return /조사|검색|리서치|시장|비교|경쟁|자료|순위|수익성|플레이스토어|앱스토어|research|search|compare|market|ranking|investigat/i.test(latestMessage) ? 'parallel' : 'sequential';
}

// Explicit @mentions direct a new user message to the chosen agents, without
// changing the saved participant selection. Ordinary messages remain group chat.
export function chooseCycleOrder(participants, latest, cycleNumber, flow, previousUserId) {
  const mention = latest?.id !== previousUserId ? String(latest?.text||'') : '';
  const mentioned = participants.filter(p => [p.provider,p.name].some(name => {
    const escaped=String(name||'').replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
    return escaped&&new RegExp('(?:^|\\s)@'+escaped+'(?=$|[\\s,.:;!?，。])','iu').test(mention);
  }));
  if(mentioned.length)return mentioned.map(p=>p.id);
  const offset=flow==='auto'&&participants.length?((cycleNumber-1)%participants.length):0;
  return [...participants.slice(offset),...participants.slice(0,offset)].map(p=>p.id);
}

export function cycleMembers(room) {
  if(!room.config.userLed||!Array.isArray(room.cycleOrder)||!room.cycleOrder.length)return room.config.participants;
  return room.cycleOrder.map(id=>room.config.participants.find(p=>p.id===id)).filter(Boolean);
}

export function phaseInstruction(phase, reason = '') {
  if (phase === 'debate') return '자동 토론 단계: 억지로 동의하지 말고 실제로 납득했을 때만 합의하세요. 앞 내용을 반복하지 말고 아직 남은 쟁점에 집중하세요. 발언의 맨 마지막 줄에 정확히 [입장: 합의] (현재까지의 안에 동의하며 더 다툴 쟁점이 없음) 또는 [입장: 계속] (해소되지 않은 쟁점이 남음) 중 하나만 적으세요.';
  if (phase === 'debate-final') return '자동 토론 결론 단계: 토론이 끝났습니다. 새 주장을 꺼내지 말고 지금까지의 토론을 정리해 사용자에게 최종 결론을 전달하세요. 형식은 "결론 한 줄 / 핵심 근거 2~3개 / 남은 쟁점 또는 불확실성 / 추천 다음 행동"이며 5~8문장 이내로 쓰세요. ' + (reason === 'max' ? '최대 라운드에 도달했지만 합의하지 못했습니다. 합의되지 않은 쟁점을 합의된 것처럼 쓰지 말고, 갈린 입장과 추천안을 함께 쓰세요.' : '참가자 모두 합의했습니다.');
  if (phase === 'research') return '독립 조사 단계: 아직 이번 단계의 다른 AI 답변을 받지 않았습니다. 사용자의 최신 요청과 자신의 역할에 따라 독립적으로 조사하고, 구체적인 후보·근거·출처·불확실성을 제시하세요. 확인하지 못한 사실은 추정이라고 표시하세요.';
  if (phase === 'review') return '상호 검토 단계: 이번 독립 조사에서 완료된 모든 AI 답변과 최신 사용자 발언을 읽고, 서로 다른 주장과 근거를 비교하세요. 중요한 오류나 불일치를 지적하고 실용적인 후보를 우선순위로 정리하세요. 이미 말한 내용을 반복하지 마세요.';
  return '';
}

// Independent work has a frozen input snapshot. A review receives all completed
// research answers, plus any later human messages. No mid-flight prompt injection.
export function newParallelPlan(room) {
  return { phase:'research', snapshotIds:room.messages.filter(m=>m.status==='complete').map(m=>m.id), researchDone:[], reviewDone:[] };
}

export async function runParallelCycle(engine,room,job,buildPrompt) {
  const plan=room.parallelPlan;
  const signal=job.controller.signal;
  const stopped=()=>signal.aborted || job.pauseRequested;
  const members=cycleMembers(room);
  const round=room.cycleNumber;
  const touch=()=>{room.updatedAt=new Date().toISOString();};
  const active=()=>{room.currentSpeakers=room.messages.filter(m=>m.status==='streaming').map(m=>m.participantId);room.currentSpeaker=room.currentSpeakers[0]||null;};
  async function prepare(participant,phase) {
    const p={...participant};
    const role=engine.roleResolver ? await engine.roleResolver(p.provider) : undefined;
    if(role)p.persona=role.content;
    const contextRoom=phase==='research'?{...room,messages:room.messages.filter(m=>plan.snapshotIds.includes(m.id))}:room;
    const {prompt,contextInfo}=buildPrompt(contextRoom,p,phase);
    const finalReview=phase==='review'&&plan.reviewDone.length===members.length-1;
    const cwd=path.join(engine.workDir,room.id,p.id);
    await mkdir(cwd,{recursive:true});
    return {p,prompt:finalReview?prompt+'\n이번 검토의 마지막 발언입니다. 지금까지의 모든 조사·검토 결과를 종합해 사용자가 결정할 수 있도록 우선순위, 추천 이유, 다음 행동, 남은 불확실성을 정리하세요. 합의하지 않은 내용을 합의했다고 말하지 마세요.':prompt,cwd,message:{id:randomUUID(),participantId:p.id,provider:p.provider,profileId:p.provider,name:p.name,kind:'speech',text:'',round,phase,status:'streaming',startedAt:new Date().toISOString(),completedAt:null,model:p.model,effort:p.effort,contextInfo,roleFile:role?.filename,roleHash:role?.hash}};
  }
  async function execute(task,done) {
    const {p,prompt,cwd,message}=task;
    try {
      if(signal.aborted)throw new Error('사용자가 진행을 중지했습니다.');
      const result=await engine.runProvider({provider:p.provider,model:p.model,effort:p.effort,prompt,cwd,access:room.config.access||'chat',signal,onDelta:delta=>{
        if(signal.aborted||message.status!=='streaming')return;
        message.text+=String(delta);
        engine.broadcast({type:'delta',roomId:room.id,messageId:message.id,delta:String(delta)});
      }});
      if(signal.aborted)throw new Error('사용자가 진행을 중지했습니다.');
      if(!result.text?.trim())throw new Error('AI가 표시할 응답을 반환하지 않았습니다.');
      Object.assign(message,{text:redact(result.text),status:'complete',completedAt:new Date().toISOString(),model:result.model||message.model,effort:result.effort||message.effort,durationMs:result.durationMs,usage:result.usage,tools:(result.tools||[]).filter(t=>['web','terminal','files'].includes(t))});
      if(!done.includes(p.id)){done.push(p.id);room.nextTurn++;}
    } catch(error) {
      Object.assign(message,{status:'error',error:redact(error.message),completedAt:new Date().toISOString()});
    }
    // Move the completed response ahead of still-running placeholders, in
    // completion order, without moving any human messages.
    const at=room.messages.indexOf(message);
    if(at!==-1)room.messages.splice(at,1);
    const pending=room.messages.findIndex(m=>m.status==='streaming');
    room.messages.splice(pending===-1?room.messages.length:pending,0,message);
    active();touch();await engine.save(room);engine.emit(room);
    return message.status==='complete';
  }
  async function group(list,phase,done) {
    if(stopped()||!list.length)return true;
    await engine.refreshProfiles(room);
    const tasks=await Promise.all(list.map(p=>prepare(p,phase)));
    if(stopped())return true;
    room.round=round;room.phase=phase;
    room.messages.push(...tasks.map(t=>t.message));active();touch();await engine.save(room);engine.emit(room);
    const outcomes=await Promise.allSettled(tasks.map(t=>execute(t,done)));
    const failure=outcomes.find(x=>x.status==='rejected');
    if(failure)throw failure.reason;
    return outcomes.every(x=>x.value);
  }
  let failed=false;
  if(plan.phase==='research'&&!stopped()){
    let pending=members.filter(p=>!plan.researchDone.includes(p.id));
    if(job.single)pending=pending.slice(0,1);
    if(!await group(pending,'research',plan.researchDone))failed=true;
    if(plan.researchDone.length===members.length)plan.phase='review';
    if(job.single||failed||stopped())return finish();
  }
  if(plan.phase==='review'&&!stopped()){
    // Review in actual research completion order, not a fixed vendor order.
    const reviewOrder=plan.researchDone.map(id=>members.find(p=>p.id===id)).filter(Boolean);
    for(const p of reviewOrder.filter(p=>!plan.reviewDone.includes(p.id))){
      if(stopped())break;
      if(!await group([p],'review',plan.reviewDone)){failed=true;break;}
      if(job.single)break;
    }
  }
  return finish();
  async function finish(){
    room.currentSpeakers=[];room.currentSpeaker=null;room.pausePending=false;
    room.cycleComplete=plan.reviewDone.length===members.length;
    room.status=signal.aborted?'stopped':failed?'error':'paused';
    room.error=failed&&!signal.aborted?'일부 AI 응답에 실패했습니다. 연결을 확인한 뒤 계속하면 실패한 차례만 다시 실행합니다.':null;
    if(room.cycleComplete)room.phase=null;
    touch();await engine.save(room);engine.emit(room);
  }
}
