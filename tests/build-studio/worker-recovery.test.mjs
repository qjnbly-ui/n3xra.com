import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '../..');
const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const waitFor = async (fn) => { for (let i = 0; i < 150; i++) { const value = await fn().catch(() => null); if (value) return value; await delay(50); } throw new Error('Timed out waiting for test condition'); };

// Exercise the real HTTP worker, Git repository, child processes and JSON-RPC.
// Only external Supabase/GitHub APIs, npm installation and model inference are fixtures.
test('worker restores sessions and Codex threads; edits, previews, checkpoints and pushes survive restart', { timeout: 40000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-recovery-'));
  const bin = join(dir, 'bin'); await mkdir(bin);
  const bare = join(dir, 'remote.git'); const seed = join(dir, 'seed');
  execFileSync(git, ['init', '--bare', bare]); execFileSync(git, ['init', '-b', 'main', seed]);
  const runGit = (...args) => execFileSync(git, args, { cwd: seed, env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test' } });
  await writeFile(join(seed, 'package.json'), JSON.stringify({ scripts: { dev: process.env.N3XRA_TEST_ASTRO_MODULES ? 'astro dev' : 'vite' }, devDependencies: { vite: 'fixture' } }));
  if (process.env.N3XRA_TEST_ASTRO_MODULES) {
    await mkdir(join(seed,'src','pages'),{recursive:true});await mkdir(join(seed,'public'));
    await writeFile(join(seed,'src','pages','index.astro'),'<h1>Starter</h1><script src="/asset.js"></script>');
    await writeFile(join(seed,'public','asset.js'),'window.assetLoaded=true');
  }
  await writeFile(join(seed, '.gitignore'), 'node_modules\n.astro/\ndist/\n');
  await writeFile(join(seed, 'index.html'), '<h1>Starter</h1>');
  runGit('add', '.'); runGit('commit', '-m', 'Starter'); runGit('remote', 'add', 'origin', bare); runGit('push', '-u', 'origin', 'main');
  execFileSync(git, ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bare });
  const executable = async (name, code) => writeFile(join(bin, name), `#!${process.execPath}\n${code}`, { mode: 0o755 });
  await executable('git', `const {spawnSync}=require('node:child_process');const a=process.argv.slice(2);if(a[0]==='clone')a[1]=process.env.TEST_REMOTE;const r=spawnSync(${JSON.stringify(git)},a,{stdio:'inherit'});process.exit(r.status??1);`);
  await executable('npm', `const fs=require('node:fs');const http=require('node:http');const a=process.argv.slice(2);if(a[0]==='ci'||a[0]==='install'){if(process.env.NODE_ENV!=='development')process.exit(4);if(process.env.N3XRA_TEST_ASTRO_MODULES){fs.symlinkSync(process.env.N3XRA_TEST_ASTRO_MODULES,'node_modules','dir');}else fs.mkdirSync('node_modules',{recursive:true});process.exit(0);}if(process.env.N3XRA_TEST_ASTRO_MODULES){const child=require('node:child_process').spawn(process.execPath,[process.env.N3XRA_TEST_ASTRO_MODULES+'/astro/bin/astro.mjs','dev',...a.slice(a.indexOf('--')+1)],{stdio:'inherit'});process.on('SIGTERM',()=>child.kill());child.on('exit',c=>process.exit(c??1));return;}const port=Number(a[a.indexOf('--port')+1]);const base=a[a.indexOf('--base')+1];const server=http.createServer((q,r)=>{if(q.url.startsWith(base)){r.setHeader('Content-Type',q.url.includes('asset.js')?'text/javascript':'text/html');r.end(q.url.includes('asset.js')?'window.assetLoaded=true':fs.readFileSync('index.html'));}else{r.writeHead(404);r.end();}});server.listen(port,'127.0.0.1');`);
  await executable('codex', `const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');const threads=new Map();const cancelled=new Set();let initialized=false;require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(!('id'in q))return;let result={};let error;const p=q.params;const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');if(q.method==='initialize')initialized=true;else if(!initialized)error={message:'Not initialized'};else if(q.method==='model/list')result={data:[{model:'fixture-model',displayName:'Fixture',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}],nextCursor:null};else if(q.method==='turn/interrupt'){cancelled.add(p.turnId);send({method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}}});}else if(q.method==='account/read')result={account:{type:'chatgpt'}};else if(q.method==='thread/start'){const id=randomUUID();fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});fs.writeFileSync(path.join(process.env.CODEX_HOME,id),p.cwd);threads.set(id,p.cwd);result={thread:{id}};}else if(q.method==='thread/resume'){try{threads.set(p.threadId,fs.readFileSync(path.join(process.env.CODEX_HOME,p.threadId),'utf8'));result={thread:{id:p.threadId}};}catch{error={message:'thread not found: '+p.threadId};}}else if(q.method==='turn/start'){if(!threads.has(p.threadId))error={message:'thread not found: '+p.threadId};else{const id=randomUUID();result={turn:{id}};setTimeout(()=>{if(cancelled.has(id))return;const failed=p.input[0].text.includes('FAIL_TEST');if(!failed)fs.writeFileSync(path.join(p.cwd,process.env.N3XRA_TEST_ASTRO_MODULES?'src/pages/index.astro':'index.html'),'<h1>Ready for liftoff</h1><svg aria-label="Rocket"></svg>');send({method:'item/completed',params:{threadId:p.threadId,turnId:id,item:{id:'progress',type:'agentMessage',phase:'commentary',text:'Inspecting the page.'}}});send({method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId:id,itemId:'answer',delta:JSON.stringify({message:'Added the rocket.',technicalNotes:'Updated index.html; checked the rocket.'})}});send({method:'turn/completed',params:{threadId:p.threadId,turn:{id,status:failed?'failed':'completed',...(failed?{error:{message:'Fixture model failure'}}:{})}}});},p.input[0].text.includes('CANCEL_TEST')?1500:100);}}send({id:q.id,...(error?{error}:{result})});});`);
  const websiteId = randomUUID(); const userId = randomUUID(); const rows = []; const events = [];
  const api = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'); const chunks=[];for await(const c of req)chunks.push(c);
    const body = chunks.length?JSON.parse(Buffer.concat(chunks)):null;
    res.setHeader('Content-Type','application/json'); let result=[];
    const matches = row => [...url.searchParams].every(([key,value]) => ['select','order','limit'].includes(key) || (value==='is.null'? row[key]==null : String(row[key])===value.replace(/^eq\./,'')));
    if(url.pathname==='/auth/v1/user') result={id:req.headers.authorization==='Bearer other'?randomUUID():userId};
    else if(url.pathname.endsWith('/platform_admins'))result=[{role:'owner'}];
    else if(url.pathname.endsWith('/client_websites'))result=[{id:websiteId,name:'Test demo'}];
    else if(url.pathname.endsWith('/website_repositories'))result=[{full_name:'test/demo',default_branch:'main'}];
    else if(url.pathname.endsWith('/website_build_sessions')){if(req.method==='POST'){rows.push(body);result=[body];}else{result=rows.filter(matches);if(req.method==='PATCH')result.forEach(row=>Object.assign(row,body));}}
    else if(url.pathname.endsWith('/website_build_events')){if(req.method==='POST'){const row={...body,id:events.length+1};events.push(row);result=[row];}else {result=events.filter(matches);if(url.searchParams.get("order")?.includes("desc"))result=result.slice().reverse();if(url.searchParams.has("limit"))result=result.slice(0,Number(url.searchParams.get("limit")));}}
    res.end(JSON.stringify(result));
  }); await new Promise(r=>api.listen(0,'127.0.0.1',r));
  const apiUrl=`http://127.0.0.1:${api.address().port}`;
  const preload=join(dir,'fetch.cjs'); await writeFile(preload, `const original=global.fetch;global.fetch=(url,opts)=>String(url).startsWith('https://api.github.com/')?Promise.resolve(new Response(JSON.stringify({token:'fixture'}),{status:200})):original(url,opts);`);
  const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const port=allocator.address().port;await new Promise(r=>allocator.close(r));
  const base=`http://127.0.0.1:${port}`; let worker; let logs='';
  const env={...process.env,PATH:`${bin}:${process.env.PATH}`,NODE_OPTIONS:`--require=${preload}`,NODE_ENV:'production',PORT:String(port),N3XRA_BUILD_PUBLIC_URL:base,N3XRA_BUILD_WORKSPACE_ROOT:join(dir,'workspaces'),CODEX_HOME:join(dir,'codex'),SUPABASE_URL:apiUrl,SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',GITHUB_APP_CLIENT_ID:'fixture',GITHUB_APP_INSTALLATION_ID:'fixture',GITHUB_APP_PRIVATE_KEY:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}),TEST_REMOTE:bare,N3XRA_BUILD_GIT_AUTHOR_NAME:'Verified fixture',N3XRA_BUILD_GIT_AUTHOR_EMAIL:'verified@example.test',GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.test',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.test'};
  env.N3XRA_BUILD_PREVIEW_IDLE_SECONDS='2';
  const start=async()=>{worker=spawn(process.execPath,[join(root,'dist/build-worker/server.js')],{env,detached:true,stdio:['ignore','pipe','pipe']});worker.stdout.on('data',c=>logs+=c);worker.stderr.on('data',c=>logs+=c);await waitFor(()=>fetch(base+'/healthz').then(r=>r.ok));};
  const stop=async()=>{if(!worker)return;const done=new Promise(r=>worker.once('exit',r));process.kill(-worker.pid,'SIGTERM');await done;worker=null;};
  const request=async(path,body,token='owner')=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};};
  try {
    await start();
    const [opened,duplicate]=await Promise.all([request('/v1/projects/open',{websiteId}),request('/v1/projects/open',{websiteId})]); assert.equal(opened.status,202);const id=opened.session.id;assert.equal(duplicate.session.id,id);
    const active=()=>request(`/v1/projects/${websiteId}/active`);
    let state=await waitFor(async()=>{const s=await active();return s.session?.previewState==='ready'?s:null;});
    const firstThread=rows[0].codex_thread_id;
    assert.equal((await request(`/v1/sessions/${id}/preview/restart`,{})).status,202);
    state=await waitFor(async()=>{const s=await active();return s.session?.previewState==='ready'?s:null;});
    let page=await fetch(state.session.previewUrl);const initialHtml=await page.text();assert.match(initialHtml,/Starter/);if(process.env.N3XRA_TEST_ASTRO_MODULES)assert.match(initialHtml,new RegExp('/preview/'+id+'/@vite/client'));
    const cookie=page.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/preview/${id}/asset.js`,{headers:{cookie}})).status,200);
    assert.equal((await fetch(`${base}/preview/${id}/asset.js`)).status,404);
    if (process.env.N3XRA_TEST_ASTRO_MODULES) {
      const clientCode=await (await fetch(`${base}/preview/${id}/@vite/client`,{headers:{cookie}})).text();
      assert.match(clientCode,/WebSocket/);
      const viteToken=clientCode.match(/(?:wsToken|webSocketToken)\s*=\s*["']([^"']+)/)?.[1];
      assert.ok(viteToken,'Vite HMR token is present');
      await new Promise((resolve,reject)=>{
        const socket=new WebSocket(`${base.replace('http:','ws:')}/preview/${id}/?token=${viteToken}`,'vite-hmr',{headers:{cookie,Origin:base}});
        const timer=setTimeout(()=>{socket.terminate();reject(new Error('HMR handshake timed out'));},3000);
        socket.once('open',()=>{clearTimeout(timer);socket.close();resolve();});
        socket.once('error',error=>{clearTimeout(timer);reject(error);});
      });
    }
    await stop(); await start(); // Nothing in memory; message request itself must restore the session.
    assert.equal((await request(`/v1/sessions/${id}/messages`,{text:'Draw a rocket'},'other')).status,404);
    const restoredMessage=await waitFor(async()=>{const r=await request(`/v1/sessions/${id}/messages`,{text:'Draw a rocket'});return r.status===409?null:r;});
    assert.equal(restoredMessage.status,202,JSON.stringify(restoredMessage));
    assert.equal((await request(`/v1/sessions/${id}/messages`,{text:'Duplicate'})).status,409);
    await waitFor(()=>Promise.resolve(events.find(e=>e.event_type==='agent_message')));
    assert.equal(rows[0].codex_thread_id,firstThread,'resume must preserve the stored conversation');
    assert.equal(events.find(e=>e.event_type==='agent_message').message,'Added the rocket.');
    assert.match(events.find(e=>e.event_type==='agent_message').technical_notes,/Inspecting the page/);
    state=await waitFor(async()=>{const s=await active();return s.session?.previewState==='ready'&&s.session.state==='ready'?s:null;});
    assert.equal(state.session.changedFileCount,1,execFileSync(git,['status','--short'],{cwd:join(dir,'workspaces',websiteId,id,'repository'),encoding:'utf8'})); assert.equal(state.session.hasUnpushedCommits,false);
    assert.match(await (await fetch(state.session.previewUrl)).text(),/Ready for liftoff/);
    assert.equal((await request(`/v1/sessions/${id}/checkpoint`,{message:'Rocket test'})).status,200);
    state=await active();assert.equal(state.session.changedFileCount,0);assert.equal(state.session.hasUnpushedCommits,true);
    assert.equal((await request(`/v1/sessions/${id}/push`,{})).status,200);
    state=await active();assert.equal(state.session.hasUnpushedCommits,false);
    assert.equal(execFileSync(git,['log','-1','--format=%an <%ae>|%cn <%ce>',state.session.workingBranch],{cwd:bare,encoding:'utf8'}).trim(),'Verified fixture <verified@example.test>|Verified fixture <verified@example.test>');
    assert.match(execFileSync(git,['show',`${state.session.workingBranch}:${process.env.N3XRA_TEST_ASTRO_MODULES?'src/pages/index.astro':'index.html'}`],{cwd:bare,encoding:'utf8'}),/Rocket/);
    const replies=events.filter(e=>e.event_type==='agent_message').length;
    await request(`/v1/sessions/${id}/messages`,{text:'FAIL_TEST'});
    await waitFor(()=>Promise.resolve(events.find(e=>e.event_type==='error'&&e.technical_notes?.includes('Fixture model failure'))));
    assert.equal(events.filter(e=>e.event_type==='agent_message').length,replies,'failed turn must not be reported as completed');
    await stop(); await rm(join(dir,'codex',firstThread)); await start();
    assert.equal((await request(`/v1/sessions/${id}/messages`,{text:'Draw a rocket again'})).status,202);
    assert.notEqual(rows[0].codex_thread_id,firstThread,'missing persisted thread gets an explicit new conversation');
    const controller=new AbortController();const stream=await fetch(`${base}/v1/sessions/${id}/events`,{headers:{Authorization:'Bearer owner'},signal:controller.signal});
    const reader=stream.body.getReader();let replay='';await waitFor(async()=>{const {value}=await reader.read();replay+=new TextDecoder().decode(value);return replay.includes('Added the rocket.');});controller.abort();
    assert.match(replay,/agent_message/);
    state=await waitFor(async()=>{const s=await active();return s.session?.previewState==='ready'&&s.session.state==='ready'?s:null;});
    const repository=join(dir,'workspaces',websiteId,id,'repository');
    const marker=join(repository,'node_modules','.n3xra-installed');
    const firstFingerprint=await readFile(marker,'utf8');
    assert.match(firstFingerprint,/^[a-f0-9]{64}$/);
    if(!process.env.N3XRA_TEST_ASTRO_MODULES) {
      const manifest=JSON.parse(await readFile(join(repository,'package.json'),'utf8'));
      manifest.description='Changed manifest must invalidate the dependency cache';
      await writeFile(join(repository,'package.json'),JSON.stringify(manifest));
      await request(`/v1/sessions/${id}/preview/restart`,{});
      await waitFor(async()=>{const s=await active();return s.session?.previewState==='ready';});
      assert.notEqual(await readFile(marker,'utf8'),firstFingerprint);
    }
    // No browser activity: pause the real child process but preserve the workspace.
    await waitFor(()=>Promise.resolve(events.find(e=>e.event_type==='preview'&&e.message.includes('paused after inactivity'))));
    assert.equal(rows[0].preview_state,'offline');
    assert.match(await readFile(join(repository,process.env.N3XRA_TEST_ASTRO_MODULES?'src/pages/index.astro':'index.html'),'utf8'),/Ready for liftoff/);
    await request(`/v1/sessions/${id}/preview/restart`,{});
    state=await waitFor(async()=>{const s=await active();return s.session?.previewState==='ready'?s:null;});
    assert.match(await (await fetch(state.session.previewUrl)).text(),/Ready for liftoff/);

    const catalog=await request(`/v1/sessions/${id}/models`);assert.equal(catalog.models[0].model,'fixture-model');
    assert.equal((await request(`/v1/sessions/${id}/messages`,{text:'Bad model',model:'nonexistent'})).status,500);
    assert.equal((await request(`/v1/sessions/${id}/messages`,{text:'CANCEL_TEST',model:'fixture-model',effort:'high'})).status,202);
    assert.equal((await request(`/v1/sessions/${id}/cancel`,{},'other')).status,404);
    assert.equal((await request(`/v1/sessions/${id}/close`,{})).status,409,'close must not race an active edit');
    assert.equal((await request(`/v1/sessions/${id}/publish`,{})).status,409,'publish must not race an active edit');
    assert.equal((await request(`/v1/sessions/${id}/cancel`,{})).status,202);
    await waitFor(()=>Promise.resolve(events.find(e=>e.message?.startsWith('Request canceled.'))));
    state=await waitFor(async()=>{const s=await active();return s.session?.state==='ready'?s:null;});
    assert.equal(state.session.selectedModel,'fixture-model');assert.equal(state.session.selectedEffort,'high');
    const previousThread=rows[0].codex_thread_id;
    const oldPreview=state.session.previewUrl;
    assert.equal((await request(`/v1/sessions/${id}/close`,{})).status,409,'must save before close');
    assert.equal((await request(`/v1/sessions/${id}/save`,{},'other')).status,404);
    const saved=await request(`/v1/sessions/${id}/save`,{});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.session.canClose,true);
    const savedHead=execFileSync(git,['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
    const closed=await request(`/v1/sessions/${id}/close`,{});assert.equal(closed.status,200,JSON.stringify(closed));
    assert.equal(execFileSync(git,['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),savedHead,'close creates no extra commit');
    assert.equal(rows[0].state,'stopped');assert.equal((await active()).closed,true);
    assert.equal((await fetch(oldPreview)).status,404,'old previews cannot reopen closed workspaces');
    await stop();await start();assert.equal((await active()).closed,true,'closed state survives worker restart');
    await writeFile(join(seed,'external.txt'),'Change made in another editor');runGit('add','external.txt');runGit('commit','-m','External edit');runGit('push','origin','main');
    await request('/v1/projects/open',{websiteId});
    state=await waitFor(async()=>{const s=await active();return s.session?.state==='ready'&&s.session.previewState==='ready'?s:null;});
    assert.equal(state.session.syncIssue,'',JSON.stringify(state.session));
    assert.notEqual(rows[0].codex_thread_id,previousThread,'reopening creates a fresh Codex conversation');
    assert.ok(state.events.some(e=>e.history && e.eventType==='user_message'),'previous conversation is retained as history');
    assert.ok(!state.events.some(e=>!e.history && e.eventType==='user_message'),'fresh conversation contains no old requests');
    const reopenedThread=rows[0].codex_thread_id;
    await request('/v1/projects/open',{websiteId});
    assert.equal(rows[0].codex_thread_id,reopenedThread,'opening an already-open workspace preserves its current conversation');
    assert.equal(await readFile(join(repository,'external.txt'),'utf8'),'Change made in another editor');
    assert.equal(state.session.selectedEffort,'high');
    assert.equal((await request(`/v1/sessions/${id}/publish`,{},'other')).status,404);
    const mainBefore=execFileSync(git,['rev-parse','main'],{cwd:bare,encoding:'utf8'}).trim();
    await writeFile(join(repository,'publish-test.txt'),'Publish only when explicitly requested');
    await writeFile(join(bare,'hooks','pre-receive'),'#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ]; then exit 1; fi\ndone\n',{mode:0o755});
    const blockedPublish=await request(`/v1/sessions/${id}/publish`,{});
    assert.equal(blockedPublish.status,409,JSON.stringify(blockedPublish));
    assert.equal(execFileSync(git,['rev-parse','main'],{cwd:bare,encoding:'utf8'}).trim(),mainBefore,'protected main stays unchanged');
    assert.equal((await active()).session.state,'ready');
    await rm(join(bare,'hooks','pre-receive'));
    const published=await request(`/v1/sessions/${id}/publish`,{});
    assert.equal(published.status,200,JSON.stringify(published));
    assert.equal(published.session.state,'ready','publishing does not close the workspace');assert.equal(published.session.canClose,true);
    assert.equal(execFileSync(git,['rev-parse','main'],{cwd:bare,encoding:'utf8'}).trim(),execFileSync(git,['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim());
    assert.equal(execFileSync(git,['show','main:publish-test.txt'],{cwd:bare,encoding:'utf8'}),'Publish only when explicitly requested');
    // Remote rejection must leave the workspace open and its commits intact.
    await writeFile(join(bare,'hooks','pre-receive'),'#!/bin/sh\nexit 1\n',{mode:0o755});
    await writeFile(join(repository,'close-test.txt'),'Saved before close');
    assert.equal((await request(`/v1/sessions/${id}/close`,{})).status,409,'close cannot silently save new edits');
    assert.equal((await active()).session.canClose,false);
    const refused=await request(`/v1/sessions/${id}/save`,{});assert.equal(refused.status,409);assert.ok(events.some(e=>e.technical_notes?.includes('pre-receive hook declined')),'push really reached the rejecting remote');
    assert.equal((await active()).session.state,'ready');assert.equal(await readFile(join(repository,'close-test.txt'),'utf8'),'Saved before close');
    await rm(join(bare,'hooks','pre-receive'));
    const savedAgain=await request(`/v1/sessions/${id}/save`,{});assert.equal(savedAgain.status,200,JSON.stringify(savedAgain));
    const retriedClose=await request(`/v1/sessions/${id}/close`,{});assert.equal(retriedClose.status,200,JSON.stringify(retriedClose)+' '+JSON.stringify(events.slice(-2)));
    assert.equal(execFileSync(git,['rev-parse',state.session.workingBranch],{cwd:bare,encoding:'utf8'}).trim(),execFileSync(git,['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim());
  } catch(error) { error.message+=`\nWorker logs:\n${logs}`;throw error; }
  finally { await stop();await new Promise(r=>api.close(r));await rm(dir,{recursive:true,force:true}); }
});
