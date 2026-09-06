import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHmac,randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {dispatchPhoneCallbacks,validCallbackDispatch}=require('../../api/_phone-callbacks.js');
const {setPhoneCallback}=require('../../dist/build-worker/phone-callbacks.js');
const {buildTwiML}=require('../../api/_receptionist.js');
function fixture({active=false,result=true,ambiguous=false}={}){
 const row={id:10,session_id:randomUUID(),actor_user_id:randomUUID(),metadata:{source:'phone',callId:'CA'+'a'.repeat(32),callback:{state:'pending',expiresAt:new Date(Date.now()+60000).toISOString()}}};let dialed=0;
 const store=async(path,options={})=>{
  if(options.method==='PATCH'){
   const expected=path.match(/metadata->callback->>state=eq\.([^&]+)/)?.[1];
   if(expected&&row.metadata.callback.state!==expected)return [];
   row.metadata=JSON.parse(options.body).metadata;return [row];
  }
  if(path.startsWith('platform_admins'))return [{user_id:row.actor_user_id}];
  if(path.startsWith('account_phone_credentials'))return [{phone_e164:'+15555550123'}];
  if(path.includes('completedRequestId'))return result?[{id:11,event_type:'agent_message',message:'Updated.'}]:[];
  if(path.includes('state=eq.pending'))return row.metadata.callback.state==='pending'?[structuredClone(row)]:[];
  return [row];
 };
 const calls=()=>({fetch:async()=>({direction:'inbound',from:'+15555550123',to:'+15555550999',status:active?'in-progress':'completed'})});
 calls.create=async opts=>{dialed++;assert.equal(opts.to,'+15555550123');assert.equal(opts.from,'+15555550999');if(ambiguous)throw Error('lost response');return {sid:'CA'+'b'.repeat(32)};};
 return {row,store,client:{calls},get dialed(){return dialed}};
}
test('callbacks wait for a terminal result and hangup, and only dial once',async()=>{
 for(const options of [{active:true},{result:false}]){const f=fixture(options);await dispatchPhoneCallbacks(f.client,f.store);assert.equal(f.dialed,0);}
 const f=fixture();await Promise.all([dispatchPhoneCallbacks(f.client,f.store),dispatchPhoneCallbacks(f.client,f.store)]);assert.equal(f.dialed,1);
 await dispatchPhoneCallbacks(f.client,f.store);assert.equal(f.dialed,1);
});
test('ambiguous provider acceptance is not redialed',async()=>{
 const f=fixture({ambiguous:true});await dispatchPhoneCallbacks(f.client,f.store);await dispatchPhoneCallbacks(f.client,f.store);assert.equal(f.dialed,1);assert.equal(f.row.metadata.callback.state,'unconfirmed');
});
test('wait cancels the persisted callback and invalid request identities are rejected',async()=>{
 const f=fixture();await setPhoneCallback(f.store,f.row.session_id,f.row.actor_user_id,f.row.metadata.callId,10,'wait');
 await dispatchPhoneCallbacks(f.client,f.store);assert.equal(f.dialed,0);
 await assert.rejects(()=>setPhoneCallback(f.store,f.row.session_id,f.row.actor_user_id,f.row.metadata.callId,'10&actor=other','callback'));
 await assert.rejects(()=>setPhoneCallback(async()=>[],f.row.session_id,randomUUID(),f.row.metadata.callId,10,'callback'));
});
test('dispatch signatures expire and callback greeting includes no private work',()=>{
 const time=String(Date.now()),secret='test'.repeat(10),signature=createHmac('sha256',secret).update(`phone-callback-dispatch:${time}`).digest('hex');
 assert.equal(validCallbackDispatch(time,signature,secret),true);assert.equal(validCallbackDispatch(time,signature,secret,Number(time)+31000),false);
 assert.equal(validCallbackDispatch(time,signature,'wrong'),false);
 const xml=buildTwiML({websocketUrl:'wss://example.test',callback:true,greeting:'Please enter your phone PIN.'});assert.match(xml,/<Parameter name="n3xraCallback" value="true"/);assert.doesNotMatch(xml,/rocket|goldfish/);
});
