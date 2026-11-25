import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const providers=['codex','claude','gemini'];
const roleDir=path.join(import.meta.dirname,'roles');
function filename(provider){if(!providers.includes(provider))throw new Error('지원하지 않는 모델 역할입니다.');return `${provider}.md`;}
export async function getRole(provider){const file=filename(provider);const content=(await readFile(path.join(roleDir,file),'utf8')).replace(/^\uFEFF/,'');if(content.length>16000)throw new Error(`${file} 역할 내용은 16,000자 이하여야 합니다.`);return {provider,filename:file,content,hash:createHash('sha256').update(content).digest('hex')};}
export async function getRoles(){return Promise.all(providers.map(getRole));}
const pending=new Map();
export async function saveRole(provider,content){const file=filename(provider);if(typeof content!=='string'||!content.trim()||content.length>16000)throw new Error('역할은 1~16,000자로 입력해 주세요.');const dest=path.join(roleDir,file);const previous=pending.get(provider)||Promise.resolve();const job=previous.catch(()=>{}).then(async()=>{await writeFile(`${dest}.tmp`,content.replaceAll('\0',''),'utf8');await rename(`${dest}.tmp`,dest);});pending.set(provider,job);await job;return getRole(provider);}
