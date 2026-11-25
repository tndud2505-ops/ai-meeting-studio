import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const dir = path.join(import.meta.dirname, 'data');
const file = path.join(dir, 'settings.json');
export const DEFAULT_SETTINGS = Object.freeze({ fontScale: 100, answerStyle: 'brief', showTime: true, autoScroll: true });
export const ANSWER_STYLES = Object.freeze(['brief', 'normal', 'detailed']);

export function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const scale = Number(source.fontScale);
  return {
    fontScale: Number.isFinite(scale) ? Math.min(150, Math.max(85, Math.round(scale / 5) * 5)) : base.fontScale,
    answerStyle: ANSWER_STYLES.includes(source.answerStyle) ? source.answerStyle : base.answerStyle,
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
