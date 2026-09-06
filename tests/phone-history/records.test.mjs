import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {PhoneRecorder,redactPhoneText}=require('../../api/_phone-records.js');
const user=randomUUID(), website=randomUUID(), call='CA'+'a'.repeat(32);
function storage(){
 const writes=[],events=new Map();let failures=0;
 const store=async(path,options={})=>{
  if(path.startsWith('platform_admins'))return [{user_id:user}];
  if(path.startsWith('ai_phone_instructions'))return [];
  const data=options.body?JSON.parse(options.body):null;writes.push({path,data});
  if(path.startsWith('ai_phone_events')){if(failures-->0)throw Error('offline');for(const e of data)events.set(e.id,e);}
  return [];
 };
 return {store,writes,events,fail:n=>failures=n};
}
test('captures ordered text, retries idempotently, and closes without credentials',async()=>{
 const f=storage();const {recorder}=await PhoneRecorder.start(user,call,website,f.store);
 recorder.record('caller','Make a rocket; use https://private.test/?token=secret and PIN 1234.');
 recorder.record('nex_sent','I will ask the builder to create it.');await recorder.close();
 const events=[...f.events.values()].sort((a,b)=>a.sequence-b.sequence);
 assert.deepEqual(events.map(e=>e.sequence),[1,2,3,4]);
 assert.equal(events[1].kind,'caller');assert.doesNotMatch(events[1].text,/secret|1234|https/);
 assert.equal(f.writes.at(-1).data.status,'closed');
});
test('owner check fails closed; no conversation row is created for a non-owner',async()=>{
 const paths=[];const result=await PhoneRecorder.start(user,call,website,async p=>{paths.push(p);return [];});
 assert.equal(result,null);assert.equal(paths.length,1);
});
test('failed event batches mark the conversation incomplete without blocking speech',async()=>{
 const f=storage();f.fail(10);const {recorder}=await PhoneRecorder.start(user,call,website,f.store);
 recorder.record('caller','hello');await recorder.close();
 assert.equal(f.writes.at(-1).data.status,'incomplete');assert.ok(f.writes.at(-1).data.dropped_events>0);
 const attempts=f.writes.filter(w=>w.path.startsWith('ai_phone_events'));
 assert.equal(attempts[0].data[0].id,attempts[1].data[0].id);
});
test('long inputs, raw credentials and backlogged calls stay bounded',async()=>{
 const safe=redactPhoneText('gsk_abcdefghijklmnop sk-secret12345678 eyJabc.def.ghi password: hunter2\n5678 '+ 'x'.repeat(20000));
 assert.ok(safe.length<=8000);assert.doesNotMatch(safe,/hunter2|5678|gsk_|eyJabc/);
 const f=storage();const {recorder}=await PhoneRecorder.start(user,call,website,f.store);
 for(let i=0;i<120;i++)recorder.record('caller','turn '+i);await recorder.close();
 assert.ok(f.events.size<=52);assert.equal(f.writes.at(-1).data.status,'incomplete');
});

test('successful PostgREST minimal 201 responses are not counted as dropped events',async()=>{
 const {phoneRecordStore}=require('../../api/_phone-records.js');
 const oldFetch=global.fetch,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
 try {
  global.fetch=async()=>new Response(null,{status:201});
  assert.equal(await phoneRecordStore('ai_phone_events',{method:'POST',headers:{Prefer:'return=minimal'}}),null);
  global.fetch=async()=>new Response('{"id":"saved"}',{status:201});
  assert.deepEqual(await phoneRecordStore('ai_phone_events'),{id:'saved'});
  global.fetch=async()=>new Response('denied',{status:403});
  await assert.rejects(()=>phoneRecordStore('ai_phone_events'),/unavailable/);
 } finally {global.fetch=oldFetch;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});
