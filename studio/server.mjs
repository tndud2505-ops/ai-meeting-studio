import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { MeetingEngine, publicRoom, exportMarkdown, exportSrt } from './engine.mjs';
import { getProviders, runProvider, launchLogin, checkProvider } from './providers.mjs';
import { getRole, getRoles, saveRole } from './roles.mjs';
import { getProfile, getProfiles, saveProfile } from './profiles.mjs';
import { redact } from '../src/redactor.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.MEETING_STUDIO_PORT || 4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid MEETING_STUDIO_PORT');
const clients=new Set();
const broadcast=event=>{const line=`data: ${JSON.stringify(event)}\n\n`;for(const res of clients){if(!res.destroyed)res.write(line);else clients.delete(res);}};
const engine=new MeetingEngine({dataDir:path.join(root,'data','rooms'),workDir:path.join(root,'workdir'),runProvider,getProviders,roleResolver:getRole,profileResolver:getProfile,broadcast});
await engine.init();
const checks=new Set();
let closing=false;
const headers={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
async function body(req,maxBytes=128*1024){
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new Error('JSON 요청 형식이 필요합니다.');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error('요청이 너무 큽니다.');chunks.push(chunk);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('잘못된 요청입니다.');
  return value;
}
function allowed(req){
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return false;
  const origin=req.headers.origin;
  if(origin&&!['http://'+host].includes(origin))return false;
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  return true;
}
const server=http.createServer(async(req,res)=>{
  if(!allowed(req))return json(res,403,{error:'이 PC의 스튜디오 화면에서만 요청할 수 있습니다.'});
  let url;
  try{url=new URL(req.url,`http://127.0.0.1:${port}`);}catch{return json(res,400,{error:'잘못된 URL입니다.'});}
  const route=url.pathname;
  try{
    if(req.method==='GET'&&route==='/health')return json(res,200,{app:'AI Meeting Studio',version:'2.1.0',pid:process.pid,port});
    if(req.method==='GET'&&route==='/api/status')return json(res,200,{providers:await getProviders({refresh:url.searchParams.get('refresh')==='1'}),serverTime:new Date().toISOString()});
    if(req.method==='GET'&&route==='/api/rooms')return json(res,200,{rooms:engine.list()});
    if(req.method==='GET'&&route==='/api/roles')return json(res,200,{roles:await getRoles()});
    if(req.method==='GET'&&route==='/api/profiles')return json(res,200,{profiles:await getProfiles()});
    const profileMatch=route.match(/^\/api\/profiles\/(codex|claude|gemini|user)$/);
    if(req.method==='PUT'&&profileMatch){
      const profile=await saveProfile(profileMatch[1],await body(req,144*1024));
      broadcast({type:'profiles',profiles:await getProfiles()});
      return json(res,200,{profile});
    }
    const roleMatch=route.match(/^\/api\/roles\/(codex|claude|gemini)$/);
    if(req.method==='PUT'&&roleMatch){const input=await body(req);return json(res,200,{role:await saveRole(roleMatch[1],input.content)});}
    if(req.method==='POST'&&route==='/api/session/open'){
      const input=await body(req);
      const room=await engine.create({title:'회의',topic:'함께 논의할 내용',mode:'meeting',rounds:1,turnDelayMs:400,wordLimit:90,userLed:true,participants:input.participants});
      return json(res,201,{room:publicRoom(room)});
    }
    if(req.method==='POST'&&route==='/api/session/reset'){
      const input=await body(req);
      if(input.roomId){const job=engine.jobs.get(input.roomId);await engine.stop(input.roomId);if(job?.promise)await job.promise;}
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&route==='/api/rooms')return json(res,201,{room:publicRoom(await engine.create(await body(req)))});
    if(req.method==='GET'&&route==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive',...headers});
      res.write('retry: 2000\n\n');clients.add(res);
      const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n');},20000);
      req.on('close',()=>{clients.delete(res);clearInterval(heartbeat);});return;
    }
    const providerMatch=route.match(/^\/api\/providers\/(codex|claude|gemini)\/(login|check)$/);
    if(req.method==='POST'&&providerMatch){
      const input=await body(req);const [,provider,action]=providerMatch;
      if(action==='login'){
        if(engine.busy||engine.starting||checks.size)return json(res,409,{error:'현재 발언 또는 연결 확인이 끝난 뒤 로그인해 주세요.'});
        return json(res,200,await launchLogin(provider));
      }
      if(engine.busy||engine.starting||checks.size)return json(res,409,{error:'현재 발언 또는 연결 확인이 끝난 뒤 다시 확인해 주세요.'});
      checks.add(provider);
      try{
        const result=await checkProvider(provider,{model:input.model,effort:input.effort});
        const providers=await getProviders({refresh:true});
        broadcast({type:'status',providers});
        return json(res,result.ok?200:400,{...result,providers});
      }finally{checks.delete(provider);}
    }
    const roomMatch=route.match(/^\/api\/rooms\/([a-f0-9-]{36})(?:\/(start|pause|resume|stop|next|message|export))?$/);
    if(roomMatch){
      const [,id,action]=roomMatch;const room=engine.get(id);
      if(req.method==='GET'&&!action)return json(res,200,{room:publicRoom(room)});
      if(req.method==='GET'&&action==='export'){
        const format=url.searchParams.get('format')||'md';
        if(!['json','md','srt'].includes(format))throw new Error('지원하지 않는 내보내기 형식입니다.');
        const payload=format==='json'?JSON.stringify(publicRoom(room),null,2):format==='srt'?exportSrt(room):exportMarkdown(room);
        res.writeHead(200,{'Content-Type':format==='json'?'application/json; charset=utf-8':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="meeting-${id.slice(0,8)}.${format}"`,'Cache-Control':'no-store',...headers});res.end(payload);return;
      }
      if(req.method==='POST'&&action){
        const data=await body(req);let updated;
        if(['start','resume','next'].includes(action)){
          if(checks.size)throw new Error('연결 확인이 끝난 뒤 시작해 주세요.');
          updated=await engine.start(id,{single:action==='next',participants:data.participants});
        }else if(action==='pause')updated=await engine.pause(id);
        else if(action==='stop')updated=await engine.stop(id);
        else if(action==='message')updated=await engine.message(id,data.text);
        else throw new Error('지원하지 않는 동작입니다.');
        return json(res,200,{room:publicRoom(updated)});
      }
    }
    if(req.method==='POST'&&route==='/api/shutdown'){
      await body(req);json(res,200,{ok:true});setTimeout(shutdown,100);return;
    }
    const staticFiles={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/icons/icon.svg':'icons/icon.svg','/icons/icon-192.png':'icons/icon-192.png','/icons/icon-512.png':'icons/icon-512.png'};
    if(req.method==='GET'&&staticFiles[route]){
      const data=await readFile(path.join(root,'public',staticFiles[route]));
      const contentType=route.endsWith('.js')?'text/javascript; charset=utf-8':route.endsWith('.css')?'text/css; charset=utf-8':route.endsWith('.webmanifest')?'application/manifest+json; charset=utf-8':route.endsWith('.svg')?'image/svg+xml':route.endsWith('.png')?'image/png':'text/html; charset=utf-8';
      res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-cache',...headers});res.end(data);return;
    }
    if(req.method==='GET'&&route==='/favicon.ico'){res.writeHead(204);res.end();return;}
    json(res,404,{error:'요청한 페이지를 찾을 수 없습니다.'});
  }catch(error){if(!res.headersSent)json(res,400,{error:redact(error.message||'요청을 처리하지 못했습니다.')});else res.end();}
});
server.requestTimeout=240000;server.headersTimeout=15000;
async function shutdown(){
  if(closing)return;closing=true;
  await engine.shutdown();for(const res of clients)res.end();
  server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
server.on('error',error=>{console.error(redact(error.message));process.exitCode=1;});
server.listen(port,'127.0.0.1',async()=>{
  await mkdir(path.join(root,'data'),{recursive:true});
  await writeFile(path.join(root,'data','server.pid'),String(process.pid),'utf8');
  console.log(`AI Meeting Studio ready: http://127.0.0.1:${port}`);
});
