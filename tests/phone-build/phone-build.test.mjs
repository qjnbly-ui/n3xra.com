import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { PhoneBuildConversation, signPhoneRequest, isPhoneBuildRequest } = require('../../api/_phone-build.js');
const { verifyPhoneRequest } = require('../../dist/build-worker/phone-access.js');
const website = randomUUID(), user = randomUUID(), call = 'CA' + 'a'.repeat(32), secret = 'fixture'.repeat(8);

test('phone authorization binds owner, demo, HTTP action, body and expiry; prevents replay', () => {
  const path = '/v1/projects/open', body = JSON.stringify({ websiteId: website });
  const token = signPhoneRequest(user, call, website, 'POST', path, body, secret, 100000);
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, secret, randomUUID(), 100000));
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, '{}', secret, website, 100000));
  assert.throws(() => verifyPhoneRequest(token, 'GET', path, body, secret, website, 100000));
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, 'other'.repeat(10), website, 100000));
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, secret, website, 146000));
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, secret, website, 90000));
  assert.equal(verifyPhoneRequest(token, 'POST', path, body, secret, website, 100000).id, user);
  assert.throws(() => verifyPhoneRequest(token, 'POST', path, body, secret, website, 100000), /already received/);
});
test('even signed phone requests cannot login, push, or visit another website', () => {
  for (const path of ['/v1/account/connect', `/v1/sessions/${randomUUID()}/push`, `/v1/projects/${randomUUID()}/active`]) {
    const method = path.endsWith('active') ? 'GET' : 'POST';
    const token = signPhoneRequest(user, call, website, method, path, '', secret);
    assert.throws(() => verifyPhoneRequest(token, method, path, '', secret, website));
  }
});

const tool=(name,args={})=>({role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const say=content=>tool('respond',{text:content});
function fixture() {
 const calls=[],speech=[],plans=[],contexts=[],inputs=[],ended=[];let now=100000;
 let state={id:randomUUID(),state:'ready',cancellable:false,canClose:false,codexAuthenticated:true};let event=null,failure='',gatePath='',releaseGate;let gate;
 const rpc=async(path,input)=>{calls.push({path,input});if(gate && path.endsWith(gatePath))await gate;if(failure&&path.endsWith(failure))throw Error('lost');
  if(path.endsWith('/messages')){state={...state,state:'working',cancellable:true};return {accepted:true,requestId:'10'};}
  if(path.endsWith('/callback'))return {saved:true,mode:input.mode};
  if(path.endsWith('/save')||path.endsWith('/publish'))state={...state,state:'ready',canClose:true};
  if(path.endsWith('/cancel'))state={...state,state:'ready',cancellable:false};
  if(path.endsWith('/phone-page'))return {path:'/',headings:['Welcome'],images:[{index:1,description:'A mountain lake'}]};
  return {session:{...state},latestReply:event};};
 const agent=async(messages,context,signal)=>{contexts.push(context);inputs.push(messages.map(m=>({...m})));const plan=plans.shift();if(!plan)throw Error('No fixture plan');return typeof plan==='function'?plan(messages,context,signal):plan;};
 const flow=new PhoneBuildConversation(rpc,text=>speech.push(text),website,'Demo',()=>now,agent,'',()=>ended.push(true));
 const handle=async(text,...responses)=>{plans.push(...responses);await flow.handle(text);};
 const confirm=()=> (_m,c)=>tool('confirm_action',{confirmation_id:c.pending?.id||'none'});
 const open=async()=>{flow.begin();await handle('That is the one I mean',confirm());};
 return {flow,calls,speech,contexts,inputs,plans,ended,handle,confirm,open,hold:path=>{gatePath=path;gate=new Promise(resolve=>{releaseGate=resolve;});return ()=>{gate=undefined;releaseGate();};},setState:v=>{state={...state,...v};},setEvent:v=>{event=v;},fail:v=>{failure=v;},tick:n=>{now+=n;}};
}
test('model composes agreed ideas into an edit; separate confirmation executes exactly once',async()=>{
 const f=fixture();try{await f.open();await f.handle('That lake takes up too much room',tool('inspect_page',{path:'/'}),say('Should I reduce its height?'));
  assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,0);
  await f.handle('Yes, half as tall',tool('propose_action',{action:'edit',instruction:'On the homepage reduce the mountain lake image height by half; preserve other content.'}));
  assert.match(f.speech.at(-1),/half/);await f.handle('Sounds good, do that',f.confirm());
  assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,1);
  assert.match(f.calls.find(c=>c.path.endsWith('/messages')).input.text,/mountain lake/);
  await f.handle('Yep',f.confirm(),say('The builder already has the request.'));
  assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,1);
 }finally{f.flow.dispose();}
});
test('conversation can discuss saving and choose main without sending any edit',async()=>{
 const f=fixture();try{await f.open();await f.handle('Keep what we have',say('Should I save a draft to the working branch, or publish it to main?'));
  assert.equal(f.calls.filter(c=>/\/(save|publish)$/.test(c.path)).length,0);
  await f.handle('Let everyone see it',tool('propose_action',{action:'publish',instruction:''}));assert.match(f.speech.at(-1),/live website/);
  await f.handle('Go for it',f.confirm());
  assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,0);
 }finally{f.flow.dispose();}
});
test('model cannot execute an invented confirmation or unknown tool; no phrase fallback',async()=>{
 const f=fixture();try{await f.open();await f.handle('save to main',tool('confirm_action',{confirmation_id:'invented'}),say('Shall we publish?'));
  await f.handle('save to main',tool('run_shell',{command:'git push'}));
  assert.equal(f.calls.filter(c=>/\/(save|publish|messages)$/.test(c.path)).length,0);
  assert.match(f.speech.at(-1),/not sent a new action/);
 }finally{f.flow.dispose();}
});
test('proposal terminates the model loop and cannot confirm itself in the same caller turn',async()=>{
 const f=fixture();try{await f.open();await f.handle('Make it smaller',tool('propose_action',{action:'edit',instruction:'Reduce the selected image.'}));
  assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,0);assert.equal(f.plans.length,0);
  await f.handle('Actually never mind',tool('dismiss_action'),say('Okay, I will leave it as it is.'));
  await f.handle('yes',f.confirm(),say('There is no pending change.'));
  assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,0);
 }finally{f.flow.dispose();}
});
test('pending proposal expires and a fresh confirmation is required',async()=>{
 const f=fixture();try{await f.open();await f.handle('Publish',tool('propose_action',{action:'publish',instruction:''}));f.tick(121000);
 await f.handle('yes',f.confirm(),say('Please confirm a fresh publishing request.'));assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 }finally{f.flow.dispose();}
});
test('lost mutation response is not replayed and status can reconcile it',async()=>{
 const f=fixture();try{await f.open();await f.handle('Change title',tool('propose_action',{action:'edit',instruction:'Change the title to Welcome.'}));f.fail('/messages');await f.handle('yes',f.confirm());assert.match(f.speech.at(-1),/could not confirm/);
 await f.handle('yes',f.confirm(),say('Let me check before repeating anything.'));assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,1);
 f.fail('');await f.handle('What happened?',tool('get_status'),say('The workspace is ready.'));
 }finally{f.flow.dispose();}
});
test('save branch, close and PIN expiry retain lifecycle constraints',async()=>{
 const f=fixture();try{await f.open();await f.handle('Close it',tool('propose_action',{action:'close',instruction:''}),say('We need to save first.'));
 assert.equal(f.calls.filter(c=>c.path.endsWith('/close')).length,0);
 await f.handle('Save the draft',tool('propose_action',{action:'save',instruction:''}));await f.handle('yes',f.confirm());
 await f.handle('Close',tool('propose_action',{action:'close',instruction:''}));await f.handle('yes',f.confirm());assert.equal(f.flow.active,false);
 }finally{f.flow.dispose();}
 const expired=fixture();try{expired.flow.begin();expired.tick(16*60000);await expired.handle('Open');assert.equal(expired.flow.active,false);assert.equal(expired.calls.length,0);}finally{expired.flow.dispose();}
});
test('model errors, malformed arguments and multiple actions fail without mutations',async()=>{
 const f=fixture();try{await f.open();await f.handle('Publish',()=>{throw Error('provider unavailable');});
 await f.handle('Publish',{role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name:'propose_action',arguments:'bad json'}}]});
 const two=tool('propose_action',{action:'publish',instruction:''});two.tool_calls.push(tool('confirm_action',{confirmation_id:'x'}).tool_calls[0]);await f.handle('Publish',two);
 assert.equal(f.calls.filter(c=>/\/(publish|save|messages)$/.test(c.path)).length,0);
 }finally{f.flow.dispose();}
});
test('new caller statement supersedes unfinished planning without executing stale tools',async()=>{
 const f=fixture();try{await f.open();let finish;
 const first=f.handle('publish',()=>new Promise(resolve=>{finish=resolve;}));
 await f.handle('Wait, leave it alone',say('Okay, I will leave it alone.'));
 finish(tool('propose_action',{action:'publish',instruction:''}));await first;
 assert.equal(f.speech.at(-1),'Okay, I will leave it alone.');assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 }finally{f.flow.dispose();}
});
test('page results reach the model as tool data; invalid paths and failed inspections cannot fabricate content',async()=>{
 const f=fixture();try{await f.open();await f.handle('What picture?',tool('inspect_page',{path:'/'}),(messages)=>{assert.match(messages.at(-1).content,/mountain lake/);return say('The image description says a mountain lake.');});
 await f.handle('Read secrets',tool('inspect_page',{path:'/.env'}));assert.equal(f.calls.filter(c=>c.path.endsWith('/phone-page')).length,1);
 f.fail('/phone-page');await f.handle('Check again',tool('inspect_page',{path:'/'}),(messages)=>{assert.match(messages.at(-1).content,/could not inspect/);return say('I could not inspect the preview.');});
 }finally{f.flow.dispose();}
});
test('routine progress is coalesced and final replies are delivered once after pending discussion',async()=>{
 const f=fixture();try{await f.open();f.setState({state:'working',progress:'Reading'});const n=f.speech.length;await f.flow.poll();assert.equal(f.speech.length,n);
 f.tick(31000);await f.flow.poll();assert.equal(f.speech.length,n+1);f.setState({state:'ready'});f.setEvent({id:'r1',message:'Done.'});await f.flow.poll();assert.equal(f.speech.at(-1),'Done.');const done=f.speech.length;await f.flow.poll();assert.equal(f.speech.length,done);
 }finally{f.flow.dispose();}
});
test('natural phone entry requests are recognized',()=>{assert.equal(isPhoneBuildRequest('I want to access Build Studio'),true);});
test('failed preview is inspected once then a clear edit still reaches the builder',async()=>{
 const f=fixture();try{
  await f.open();f.fail('/phone-page');
  await f.handle('Remove the goldfish',tool('inspect_page',{path:'/'}),tool('inspect_page',{path:'/about'}),tool('execute_action',{action:'edit',instruction:'Remove the goldfish from the homepage.'}));
  assert.equal(f.calls.filter(c=>c.path.endsWith('/phone-page')).length,1);
  assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,1);
  assert.equal(f.calls.find(c=>c.path.endsWith('/messages')).input.text,'Remove the goldfish from the homepage.');
  assert.equal(f.contexts.at(-1).previewInspectionAvailable,false);
  assert.equal(f.speech.filter(s=>/Let me check/.test(s)).length,1);
 }finally{f.flow.dispose();}
});

test('accepted edits offer a choice and callback consent does not save or edit again',async()=>{
 const f=fixture();try{await f.open();await f.handle('Improve the rocket',tool('execute_action',{action:'edit',instruction:'Improve the rocket.'}));
 assert.match(f.speech.at(-1),/wait on the line.*call you back/);assert.equal(f.calls.filter(c=>c.path.endsWith('/callback')).length,0);
 await f.handle('Call me back',tool('completion_delivery',{mode:'callback'}));assert.deepEqual(f.calls.at(-1).input,{requestId:'10',mode:'callback'});assert.equal(f.speech.at(-1),'Okay, I’ll give you a call back.');assert.deepEqual(f.ended,[true]);assert.equal(f.flow.active,false);
 assert.equal(f.calls.filter(c=>/\/(messages|save|publish)$/.test(c.path)).length,1);
 }finally{f.flow.dispose();}
});

const queue=(steps,mode='append')=>tool('queue_actions',{steps,mode});
test('callback result is not followed by another ready greeting',async()=>{
 const f=fixture();try{f.setEvent({id:'10',message:'Removed lion.'});await f.flow.resumeCallback('session','Remove lion','Removed lion.');const count=f.speech.length;f.tick(6000);await f.flow.poll();assert.equal(f.speech.length,count);}finally{f.flow.dispose();}
});
test('confirmed list saves then closes without another request or intermediate completion speech',async()=>{
 const f=fixture();try{await f.open();await f.handle('Save to main then close',queue([{action:'publish'},{action:'close'}]));
 assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 await f.handle('Yes',f.confirm());assert.deepEqual(f.calls.filter(c=>/\/(publish|close)$/.test(c.path)).map(c=>c.path.split('/').at(-1)),['publish','close']);
 assert.equal(f.speech.at(-1),'Saved and closed.');assert.equal(f.speech.some(s=>s==='Saved to main on GitHub. Deployment is the next step.'),false);
 }finally{f.flow.dispose();}
});
test('ordered edits wait for their exact result and permit casual questions between steps',async()=>{
 const f=fixture();try{await f.open();await f.handle('Change the title then remove the lion',queue([{action:'edit',instruction:'Change the title.'},{action:'edit',instruction:'Remove the lion.'}]));
 assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,1);
 await f.handle('Can we talk while it works?',say('Of course.'));assert.equal(f.speech.at(-1),'Of course.');
 f.setState({state:'ready'});f.setEvent({id:'11',message:'Unrelated preview warning',completedRequestId:'9',type:'error'});await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,1);
 f.setEvent({id:'12',message:'Title changed.',completedRequestId:'10',type:'agent_message'});await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,2);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/messages'))[1].input.text,'Remove the lion.');
 }finally{f.flow.dispose();}
});
test('a question preserves the pending list confirmation',async()=>{
 const f=fixture();try{await f.open();await f.handle('Save then close',queue([{action:'publish'},{action:'close'}]));await f.handle('What does main mean?',say('It is the version connected to your live site.'));assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);await f.handle('Yes go ahead',f.confirm());assert.equal(f.calls.filter(c=>c.path.endsWith('/close')).length,1);}finally{f.flow.dispose();}
});
test('failed save never runs the dependent close or retries the save',async()=>{
 const f=fixture();try{await f.open();await f.handle('Save then close',queue([{action:'publish'},{action:'close'}]));f.fail('/publish');await f.handle('Yes',f.confirm());await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/close')).length,0);}finally{f.flow.dispose();}
});
test('failed edit pauses following steps',async()=>{
 const f=fixture();try{await f.open();await f.handle('Edit two things',queue([{action:'edit',instruction:'Title'},{action:'edit',instruction:'Image'}]));f.setState({state:'ready'});f.setEvent({id:'11',message:'Failed',completedRequestId:'10',type:'error'});await f.flow.poll();await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,1);assert.match(f.speech.at(-1),/paused/);}finally{f.flow.dispose();}
});
test('pause, revise, resume and cancel retain task order without replaying running work',async()=>{
 const f=fixture();try{await f.open();await f.handle('Edit two things',queue([{action:'edit',instruction:'Title'},{action:'edit',instruction:'Image'}]));await f.handle('Pause',tool('control_queue',{operation:'pause'}));f.setState({state:'ready'});f.setEvent({id:'11',message:'Title done',completedRequestId:'10',type:'agent_message'});await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,1);
 await f.handle('Instead change the footer next',queue([{action:'edit',instruction:'Footer'}],'replace'));assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).at(-1).input.text,'Footer');
 await f.handle('Add one more',queue([{action:'edit',instruction:'Logo'}]));await f.handle('Cancel remaining',tool('control_queue',{operation:'cancel'}));f.setState({state:'ready'});f.setEvent({id:'12',message:'Footer done',completedRequestId:'10',type:'agent_message'});await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).length,2);
 }finally{f.flow.dispose();}
});

test('adding steps during a running save does not copy or replay that save',async()=>{
 const f=fixture();try{await f.open();await f.handle('Save then edit the title',queue([{action:'publish'},{action:'edit',instruction:'Title'}]));const release=f.hold('/publish');const running=f.handle('Yes',f.confirm());
 for(let i=0;i<30&&!f.calls.some(c=>c.path.endsWith('/publish'));i++)await Promise.resolve();
 assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);
 await f.handle('Then change the footer',queue([{action:'edit',instruction:'Footer'}]));release();await running;
 assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).at(-1).input.text,'Title');
 f.setState({state:'ready'});f.setEvent({id:'11',message:'Title done',completedRequestId:'10',type:'agent_message'});await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/messages')).at(-1).input.text,'Footer');
 }finally{f.flow.dispose();}
});
