import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const twilio = require('twilio');
const website = randomUUID(), user = randomUUID(), sid = 'CA'+'b'.repeat(32);
process.env.TWILIO_AUTH_TOKEN='socket-test-secret';process.env.TWILIO_ACCOUNT_SID='AC'+'c'.repeat(32);
process.env.N3XRA_PHONE_BUILD_ENABLED='true';process.env.N3XRA_PHONE_BUILD_SECRET='fixture'.repeat(8);
process.env.N3XRA_PHONE_BUILD_WORKER_URL='https://worker.example.test';process.env.N3XRA_PHONE_BUILD_WEBSITE_ID=website;
const account = require('../../api/_account-phone.js');
account.getCallerAccount = async () => ({ user_id:user, phone_e164:'+15555550123' });
account.verifyCallerPin = async (_caller, pin) => ({ok:pin==='1234',reason:'invalid'});
const phone = require('../../api/_phone-build.js');
const actions=[];const session={id:randomUUID(),state:'ready',codexAuthenticated:true};
phone.createPhoneBuildRpc=()=>async(path,input)=>{actions.push({path,input});return {session};};
const agent=require('../../api/_phone-build-agent.js');
let agentTurn=0;
agent.requestBuildAgent=async(_messages,context)=>{
 agentTurn++;
 if(agentTurn===1||agentTurn===3)return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'confirm_action',arguments:JSON.stringify({confirmation_id:context.pending?.id})}}]};
 if(agentTurn===2)return {role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'propose_action',arguments:JSON.stringify({action:'edit',instruction:'Add one rocket to the homepage.'})}}]};
 return {role:'assistant',content:'The builder already accepted your request.'};
};
const records=require('../../api/_phone-records.js');
const captured=[];let captureStarts=0;
const start=records.PhoneRecorder.start.bind(records.PhoneRecorder);
records.PhoneRecorder.start=async(u,c,w)=>{
 captureStarts++;
 return start(u,c,w,async(path,options={})=>{
  if(path.startsWith('platform_admins'))return [{user_id:user}];
  if(path.startsWith('ai_phone_instructions'))return [];
  if(path.startsWith('ai_phone_events'))captured.push(...JSON.parse(options.body));
  return [];
 });
};
let callbackFixture=null;
require('../../api/_phone-callbacks.js').callbackForCall=async()=>callbackFixture;
const server = require('../../api/receptionist/conversation.js');
const waitFor = async fn => { for(let i=0;i<100;i++){if(fn())return;await delay(10);}throw new Error('Socket test timed out'); };
test('signed phone connection requires keypad PIN and two confirmations before editing', {timeout:10000}, async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const host=`127.0.0.1:${server.address().port}`, path='/api/receptionist/conversation';
  const signature=twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN,`wss://${host}${path}`,{});
  const ws=new WebSocket(`ws://${host}${path}`,{headers:{'x-twilio-signature':signature}});const speech=[], frames=[];
  ws.on('message',raw=>{const data=JSON.parse(raw);if(data.type==='text'){speech.push(data.token);frames.push(data);}});
  const send=x=>ws.send(JSON.stringify(x));
  const prompt=voicePrompt=>send({type:'prompt',voicePrompt,last:true});
  try {
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    send({type:'setup',callSid:sid,accountSid:process.env.TWILIO_ACCOUNT_SID,from:'+15555550123'});
    prompt('I want to access Build Studio');await waitFor(()=>speech.join(' ').includes('four digit'));
    prompt('yes');await waitFor(()=>speech.join(' ').includes('do not say it aloud'));assert.equal(actions.length,0);
    for(const digit of '0000')send({type:'dtmf',digit});await waitFor(()=>speech.join(' ').includes('did not match'));assert.equal(actions.length,0);
    assert.equal(captureStarts,0);assert.equal(captured.length,0);
    for(const digit of '1234')send({type:'dtmf',digit});await waitFor(()=>speech.join(' ').includes('website you want'));
    assert.equal(actions.length,0,'successful PIN alone cannot start a workspace');
    prompt('yes');await waitFor(()=>actions.some(a=>a.path.endsWith('/open')));
    prompt('Add a rocket');await waitFor(()=>speech.join(' ').includes('Shall I make that change'));
    assert.equal(actions.filter(a=>a.path.endsWith('messages')).length,0);
    prompt('yes');await waitFor(()=>actions.some(a=>a.path.endsWith('messages')));
    prompt('yes');await delay(40);assert.equal(actions.filter(a=>a.path.endsWith('messages')).length,1);
    assert.equal(actions[0].input.websiteId,website);
    const buildFrames=frames.filter(f=>f.token.includes('Shall I make') || f.token.includes('sending the agreed change'));
    assert.ok(buildFrames.length);
    assert.ok(buildFrames.every(f=>f.preemptible===false && f.interruptible===true));
    send({type:'interrupt',utteranceUntilInterrupt:'The builder accepted'});
    await waitFor(()=>captured.some(e=>e.kind==='interrupt'));
    assert.ok(captured.some(e=>e.kind==='caller'&&e.text==='Add a rocket'));
    assert.ok(captured.some(e=>e.kind==='nex_sent'&&e.text.includes('Shall I make')));
    assert.doesNotMatch(JSON.stringify(captured),/1234|0000|I want to access Build Studio/);
  } finally {ws.terminate();await new Promise(r=>server.close(r));}
});

test('callback resumes the saved request only after a fresh correct keypad PIN', {timeout:10000}, async()=>{
 actions.length=0;callbackFixture={userId:user,phone:'+15555550123',sessionId:session.id,request:'Improve the rocket.',result:'The rocket has been improved.'};
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const host=`127.0.0.1:${server.address().port}`,path='/api/receptionist/conversation';
 const signature=twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN,`wss://${host}${path}`,{});
 const ws=new WebSocket(`ws://${host}${path}`,{headers:{'x-twilio-signature':signature}}),speech=[];
 ws.on('message',raw=>{const d=JSON.parse(raw);if(d.type==='text')speech.push(d.token)});
 const send=x=>ws.send(JSON.stringify(x));
 try{
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  send({type:'setup',callSid:sid,accountSid:process.env.TWILIO_ACCOUNT_SID,from:'+15555550999',to:'+15555550123',customParameters:{n3xraCallback:'true'}});
  for(const digit of '0000')send({type:'dtmf',digit});await waitFor(()=>speech.join(' ').includes('did not match'));
  assert.equal(actions.length,0);assert.doesNotMatch(speech.join(' '),/rocket/);
  for(const digit of '1234')send({type:'dtmf',digit});await waitFor(()=>speech.join(' ').includes('rocket has been improved'));
  assert.equal(actions.filter(a=>a.path.endsWith('/phone-status')).length,1);assert.equal(actions.filter(a=>a.path.endsWith('/open')||a.path.endsWith('/messages')).length,0);
 }finally{callbackFixture=null;ws.terminate();await new Promise(r=>server.close(r));}
});
