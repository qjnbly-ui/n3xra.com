import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { VercelWorkspace, workspaceName } from '../../dist/build-worker/vercel-workspace.js';

const env={N3XRA_VERCEL_TOKEN:'platform-token-never-in-vm',N3XRA_VERCEL_PROJECT_ID:'main-project',N3XRA_VERCEL_TEAM_ID:'team',N3XRA_BUILD_SANDBOX_SECRET:'test-secret-only'};
const identity=()=>({id:randomUUID(),websiteId:randomUUID(),userId:randomUUID(),cwd:'/unused/local/workspace'});
async function fixture({installFails=false}={}){
 const machines=new Map();let creates=0;
 const sdk={
  async get({name}){if(!machines.has(name))throw Object.assign(new Error('Not found'),{response:{status:404}});return machines.get(name);},
  async create(params){
   creates++;let config={},healthy=false;const files=new Map();const commands=[];const events=[];let stops=0;
   const server=createServer(async(req,res)=>{
    if(!healthy||req.headers.authorization!==`Bearer ${config.secret}`){res.writeHead(401);res.end('{}');return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/health'){res.end(JSON.stringify({ok:true,version:config.version,generation:'generation'}));return;}
    if(req.url.startsWith('/events')){res.end(JSON.stringify(events.filter(e=>e.sequence>Number(new URL(req.url,'http://fixture').searchParams.get('after')))));return;}
    const chunks=[];for await(const c of req)chunks.push(c);const q=JSON.parse(Buffer.concat(chunks));
    if(q.method==='turn/start')events.push({sequence:events.length+1,method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}});
    res.end(JSON.stringify({result:q.method==='turn/start'?{turn:{id:'turn'}}:{}}));
   });await new Promise(r=>server.listen(0,'127.0.0.1',r));
   const machine={params,files,commands,get stops(){return stops;},server,
    domain(){return `http://127.0.0.1:${server.address().port}`;},
    async extendTimeout(){},
    async writeFiles(values){for(const f of values){files.set(f.path,Buffer.from(f.content));if(f.path.endsWith('/config.json'))config=JSON.parse(f.content);}},
    async readFileToBuffer({path}){return files.get(path)||null;},
    async runCommand(cmd,args){const q=typeof cmd==='string'?{cmd,args}:cmd;commands.push(q);if(installFails&&q.cmd==='sh')return {exitCode:1};if(q.cmd==='node')healthy=true;return {exitCode:0,stdout:async()=>'',stderr:async()=>''};},
    async stop(){stops++;healthy=false;}
   };machines.set(params.name,machine);return machine;
  }
 };
 return {sdk,machines,get creates(){return creates;},async close(){await Promise.all([...machines.values()].map(m=>new Promise(r=>{m.server.closeAllConnections();m.server.close(r);})));}};
}
test('workspace identity separates websites, users, and sessions',()=>{
 const a=identity();assert.equal(workspaceName(a),workspaceName({...a}));
 for(const field of ['websiteId','userId','id'])assert.notEqual(workspaceName(a),workspaceName({...a,[field]:randomUUID()}));
 assert.match(workspaceName(a),/^n3xra-[a-f0-9]{40}$/);
});
test('workspace creation is single-flight, private, bounded, and resumes saved files',async()=>{
 const f=await fixture();const a=new VercelWorkspace(identity(),env,f.sdk);const b=new VercelWorkspace(identity(),env,f.sdk);
 try{
  await Promise.all([a.start(),a.start(),a.start()]);assert.equal(f.creates,1);
  const machine=[...f.machines.values()][0];assert.equal(machine.params.timeout,900000);assert.equal(machine.params.resources.vcpus,1);
  assert.equal(machine.params.env,undefined);assert.ok(!JSON.stringify([...machine.files.values()].map(b=>b.toString())).includes(env.N3XRA_VERCEL_TOKEN));
  await b.start();assert.notEqual(a.target.authorization,b.target.authorization);
  assert.equal((await fetch(a.target.origin+'/health',{headers:{Authorization:b.target.authorization}})).status,401);
  await a.write('unfinished.html','saved work');await a.stop();assert.equal(a.running,false);assert.throws(()=>a.target,/paused/);assert.equal(machine.stops,1);
  await a.start();assert.equal(f.creates,2);assert.equal(await a.read('unfinished.html'),'saved work');
  await a.command('git',['push','origin','work'],{N3XRA_GITHUB_TOKEN:'repository-token'});
  const cmd=machine.commands.at(-1);assert.deepEqual(cmd.env,{N3XRA_GITHUB_TOKEN:'repository-token'});assert.deepEqual(cmd.args.slice(0,4),['-c','core.hooksPath=/dev/null','-c','credential.helper=']);
 }finally{await a.stop();await b.stop();await f.close();}
});
test('remote turn completion reaches the coordinator without affecting another workspace',async()=>{
 const f=await fixture();const a=new VercelWorkspace(identity(),env,f.sdk);const b=new VercelWorkspace(identity(),env,f.sdk);
 try{
  let wrong=0;b.onEvent(()=>wrong++);const completed=new Promise(resolve=>a.onEvent((method,params)=>{if(method==='turn/completed')resolve(params);}));
  await a.rpc('turn/start',{threadId:'thread'});const result=await Promise.race([completed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No event')),3000))]);
  assert.equal(result.turn.status,'completed');assert.equal(wrong,0);
 }finally{await a.stop();await b.stop();await f.close();}
});

test('preview install recovers incomplete lockfiles without masking unrelated failures',async()=>{
 const a=new VercelWorkspace(identity(),env);a.exists=async()=>true;
 const calls=[];a.command=async(cmd,args)=>{calls.push(args);if(args[0]==='ci')throw Error('npm error Missing: @emnapi/runtime@1.11.3 from lock file');};
 await a.installNpm();assert.equal(calls.length,2);assert.ok(calls[1].includes('--package-lock=false'));
 a.command=async()=>{throw Error('network denied');};await assert.rejects(a.installNpm(),/network denied/);
});

test('runtime installation failure prevents an outdated bridge from starting',async()=>{
 const f=await fixture({installFails:true});const a=new VercelWorkspace(identity(),env,f.sdk);
 try{await assert.rejects(()=>a.start(),/Codex update failed/);const machine=[...f.machines.values()][0];assert.equal(machine.commands.some(c=>c.cmd==='node'),false);assert.equal(machine.stops,1);}
 finally{await a.stop();await f.close();}
});
