import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const dir = path.join(import.meta.dirname, 'data');
const file = path.join(dir, 'settings.json');
export const DEFAULT_SETTINGS = Object.freeze({ fontScale: 100, answerStyle: 'brief', tone: 'default', showTime: true, autoScroll: true });
export const TONES = Object.freeze(['default', 'team', 'pro']);
export const ANSWER_STYLES = Object.freeze(['brief', 'normal', 'detailed']);

export function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const scale = Number(source.fontScale);
  return {
    fontScale: Number.isFinite(scale) ? Math.min(150, Math.max(85, Math.round(scale / 5) * 5)) : base.fontScale,
    answerStyle: ANSWER_STYLES.includes(source.answerStyle) ? source.answerStyle : base.answerStyle,
    tone: TONES.includes(source.tone) ? source.tone : base.tone,
    showTime: typeof source.showTime === 'boolean' ? source.showTime : base.showTime,
    autoScroll: typeof source.autoScroll === 'boolean' ? source.autoScroll : base.autoScroll,
  };
}

let current = { ...DEFAULT_SETTINGS };
export const currentSettings = () => current;

export async function loadSettings() {
  try { current = sanitizeSettings(JSON.parse(await readFile(file, 'utf8'))); }
  catch { current = { ...DEFAULT_SETTINGS }; }
  return current;
}

let pending = Promise.resolve();
export async function saveSettings(input) {
  const next = sanitizeSettings(input, current);
  const job = pending.catch(() => {}).then(async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(file + '.tmp', JSON.stringify(next, null, 2), 'utf8');
    await rename(file + '.tmp', file);
  });
  pending = job;
  await job;
  current = next;
  return current;
}

// Extra prompt rule that controls answer length. "normal" adds nothing.
export function answerStyleRule(style, access = 'chat') {
  if (style === 'brief') {
    const work = access === 'project' ? ' 파일 수정·검증 같은 실제 작업은 빠짐없이 수행하되, 최종 보고만 핵심(바꾼 것, 검증 결과, 남은 문제)으로 적으세요.' : '';
    return '\n\n[답변 길이: 핵심만] 위의 어절 수·문단 수 제한보다 이 규칙이 우선합니다. 인사, 서론, 앞 발언 되풀이, 장황한 배경 설명 없이 결론부터 2~3문장(약 70어절 이내)으로 답하세요. 근거는 가장 중요한 한 가지만 들고, 필요하면 다음 행동이나 질문을 한 개만 덧붙이세요. 긴 목록과 표는 쓰지 마세요. 조사 결과는 핵심 사실과 출처 URL만 적으세요.' + work;
  }
  if (style === 'detailed') return '\n\n[답변 길이: 자세히] 위의 어절 수 제한보다 이 규칙이 우선합니다. 필요하면 근거와 예시를 충분히 들어 설명해도 됩니다(약 400어절 이내).';
  return '';
}

// 분위기(말투) 프리셋. 내용·사실·결론의 정확성은 그대로 두고 말투만 바꾼다.
const SENIOR = '[말투: 숙련된 선배] 당신은 업무에 숙달된 경력 직원입니다. 실제 사람이 동료와 대화하듯 자연스럽고 차분한 구어체 존댓말로 말하세요. 보고서 문체, 번역투, 기계적인 나열은 피하고, 군더더기 없이 판단과 이유를 말하세요. 후배가 엉뚱한 말을 해도 핵심을 짚어 받아주고, 필요하면 가볍게 한마디 곁들이세요. 모르는 것은 모른다고 말하세요.';
const ROOKIE = '[말투: 엉뚱한 신입] 당신은 이 팀에 갓 들어온 엉뚱하고 우스꽝스러운 신입 사원입니다. 의욕이 넘치고 호기심이 많으며, 뜬금없는 비유나 귀여운 말실수, 과한 리액션(예: "헉", "오!")을 섞어 웃음을 주세요. 선배들을 "선배님"이라 부르며 존댓말을 쓰세요. 단, 웃기는 것이 목적이 아닙니다. 실제로 쓸모 있는 의견은 반드시 한 가지 담고, 사실이나 근거를 지어내거나 결론을 흐리지 마세요. 이모지는 쓰지 마세요.';
const PRO = '[말투: 전문가] 업무에 숙달된 전문가가 동료와 대화하듯 자연스럽고 차분한 존댓말로 말하세요. 군더더기와 과장 없이 판단과 이유를 분명히 말하세요.';
export function toneRule(tone, provider) {
  let rule = '';
  if (tone === 'team') rule = provider === 'gemini' ? ROOKIE : SENIOR;
  else if (tone === 'pro') rule = PRO;
  return rule ? '\n\n' + rule + ' 이 말투 규칙은 위의 분량·형식 규칙과 마커 규칙을 바꾸지 않습니다.' : '';
}

