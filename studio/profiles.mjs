import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const IDS = ['codex', 'claude', 'gemini', 'user'];
const MAX_IMAGE_BYTES = 96 * 1024;
const DEFAULTS = {
  codex: { id: 'codex', displayName: 'Codex', avatar: { kind: 'emoji', value: '◈' }, color: '#e5eee7' },
  claude: { id: 'claude', displayName: 'Claude', avatar: { kind: 'emoji', value: '✳' }, color: '#f3e5dd' },
  gemini: { id: 'gemini', displayName: 'Gemini', avatar: { kind: 'emoji', value: '✦' }, color: '#eae6f2' },
  user: { id: 'user', displayName: '나', avatar: { kind: 'emoji', value: '🙂' }, color: '#f5e7bb' },
};
function requireId(id) {
  if (!IDS.includes(id)) throw new Error('지원하지 않는 프로필입니다.');
  return id;
}
function imageDimensions(bytes, type) {
  if (type === 'png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (type === 'jpeg' && bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (sof.has(marker) && length >= 8) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      offset += length;
    }
  }
  if (type === 'webp' && bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    if (chunk === 'VP8L' && bytes[20] === 0x2f) return [1 + ((bytes[22] & 0x3f) << 8 | bytes[21]), 1 + ((bytes[24] & 15) << 10 | bytes[23] << 2 | bytes[22] >> 6)];
  }
  throw new Error('PNG, JPEG, WebP 사진을 선택해 주세요.');
}
function normalizeAvatar(avatar) {
  if (!avatar || typeof avatar !== 'object' || Array.isArray(avatar)) throw new Error('프로필 사진을 확인해 주세요.');
  if (avatar.kind === 'emoji') {
    const value = typeof avatar.value === 'string' ? avatar.value.trim() : '';
    if (!value || [...value].length > 8 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/u.test(value)) throw new Error('아이콘은 1~8자로 입력해 주세요.');
    return { kind: 'emoji', value };
  }
  if (avatar.kind === 'image' && typeof avatar.value === 'string') {
    const match = avatar.value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('프로필 사진은 96KB 이하의 PNG, JPEG, WebP여야 합니다.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw new Error('프로필 사진 형식을 확인해 주세요.');
    const [width, height] = imageDimensions(bytes, match[1]);
    if (!width || !height || width > 512 || height > 512) throw new Error('프로필 사진은 512×512 이하로 저장해 주세요.');
    return { kind: 'image', value: avatar.value };
  }
  throw new Error('프로필 아이콘 또는 사진을 선택해 주세요.');
}
export function normalizeProfile(id, input) {
  requireId(id);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('프로필 정보를 확인해 주세요.');
  if (typeof input.displayName !== 'string') throw new Error('이름을 입력해 주세요.');
  const displayName = input.displayName.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!displayName || [...displayName].length > 32) throw new Error('이름은 1~32자로 입력해 주세요.');
  if (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error('프로필 색상을 확인해 주세요.');
  return { id, displayName, avatar: normalizeAvatar(input.avatar), color: input.color.toLowerCase() };
}
export function createProfileStore(filename) {
  let profiles = structuredClone(DEFAULTS);
  let loaded;
  let pending = Promise.resolve();
  async function load() {
    if (!loaded) loaded = (async () => {
      let value;
      try { value = JSON.parse(await readFile(filename, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return; throw new Error('저장된 프로필을 읽지 못했습니다.'); }
      if (value.version !== 1 || !Array.isArray(value.profiles)) throw new Error('저장된 프로필 형식이 올바르지 않습니다.');
      const next = structuredClone(DEFAULTS);
      for (const item of value.profiles) {
        const profile = normalizeProfile(item.id, item);
        next[profile.id] = { ...profile, updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null };
      }
      profiles = next;
    })();
    await loaded;
  }
  return {
    async getProfile(id) { requireId(id); await load(); return structuredClone(profiles[id]); },
    async getProfiles() { await load(); return IDS.map(id => structuredClone(profiles[id])); },
    async saveProfile(id, input) {
      requireId(id);
      const job = pending.catch(() => {}).then(async () => {
        await load();
        const next = { ...normalizeProfile(id, { ...profiles[id], ...input }), updatedAt: new Date().toISOString() };
        const all = { ...profiles, [id]: next };
        await mkdir(path.dirname(filename), { recursive: true });
        const temporary = `${filename}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: 1, profiles: IDS.map(key => all[key]) }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, filename);
        profiles = all;
        return structuredClone(next);
      });
      pending = job;
      return job;
    },
  };
}
const store = createProfileStore(path.join(import.meta.dirname, 'data', 'profiles.json'));
export const getProfiles = store.getProfiles;
export const getProfile = store.getProfile;
export const saveProfile = store.saveProfile;
