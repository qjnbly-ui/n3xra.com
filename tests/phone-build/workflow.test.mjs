import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {PhoneBuildConversation}=require('../../api/_phone-build.js');
const tool=(name,args={})=>({role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const confirm=(_m,c)=>tool('confirm_action',{confirmation_id:c.pending.id});
const action=(action,instruction='')=>tool('execute_action',{action,instruction});
function fixture(){
 let now=100000,state={id:randomUUID(),state:'ready',codexAuthenticated:true,canClose:false},event={id:'old',message:'Old rocket completed.'},failure='';
 const calls=[],speech=[],plans=[],contexts=[];let statusWait;
 const holdStatus=()=>new Promise(resolve=>{statusWait=resolve;});
 const rpc=async(path,input)=>{calls.push({path,input});if(path.endsWith('/phone-status')&&statusWait){const ready=statusWait;statusWait=undefined;await new Promise(resolve=>ready(resolve));}if(failure&&path.endsWith(failure))throw Error('lost response');
  if(path.endsWith('/messages')){state={...state,state:'working',cancellable:true};return {accepted:true};}
  if(/\/(save|publish)$/.test(path))state={...state,canClose:true};
  return {session:{...state},latestReply:event};
 };
 const agent=async(messages,context,signal)=>{contexts.push(context);const p=plans.shift();if(!p)throw Error('No plan');return typeof p==='function'?p(messages,context,signal):p;};
 const flow=new PhoneBuildConversation(rpc,t=>speech.push(t),randomUUID(),'Demo',()=>now,agent);
 const handle=async(text,...p)=>{plans.push(...p);await flow.handle(text);};
 const open=async()=>{flow.begin();await handle('Yes',(_m,c)=>tool('confirm_action',{confirmation_id:c.pending.id}));};
 return {flow,calls,speech,contexts,handle,open,holdStatus,tick:()=>{now+=31000;},finish:()=>{state={...state,state:'ready',cancellable:false};event={id:'new',message:'Polar bear added.'};},fail:v=>{failure=v;}};
}
test('clear edit reaches builder; later save confirms once and publishes without destination questions',async()=>{
 const f=fixture();try{await f.open();f.tick();await f.flow.poll();assert.ok(!f.speech.includes('Old rocket completed.'));
 await f.handle('Add a polar bear next to the rocket',action('edit','Add a polar bear next to the rocket.'));
 const edit=f.calls.filter(c=>c.path.endsWith('/messages'));assert.equal(edit.length,1);assert.match(edit[0].input.text,/Add a polar bear next to the rocket/);
 assert.ok(!f.speech.some(s=>/branch|Shall I make/.test(s)));assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 f.finish();f.tick();await f.flow.poll();assert.equal(f.speech.at(-1),'Polar bear added.');
 await f.handle('Okay save',action('save'));await f.handle('Yes',confirm);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);assert.match(f.speech.at(-1),/Saved to main on GitHub/);assert.doesNotMatch(f.speech.at(-1),/now live/);
 f.tick();await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);
 }finally{f.flow.dispose();}
});
test('later main sets preference without publishing; explicit draft is remembered for later saves',async()=>{
 const f=fixture();try{await f.open();await f.handle('Eventually main',tool('set_save_destination',{destination:'main'}),tool('respond',{text:'I will use main when you ask to save.'}));
 assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 await f.handle('Save a draft',action('draft'));await f.handle('Yes',confirm);assert.equal(f.calls.filter(c=>c.path.endsWith('/save')).length,1);
 await f.handle('Save',action('save'));await f.handle('Yes',confirm);assert.equal(f.calls.filter(c=>c.path.endsWith('/save')).length,2);assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 }finally{f.flow.dispose();}
});
test('save during an edit waits for completion and does not interrupt caller speech',async()=>{
 const f=fixture();try{await f.open();await f.handle('Change title',action('edit','Change title to Welcome.'));
 await f.handle('Save it',action('save'));await f.handle('Yes',confirm);assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 f.finish();f.tick();f.flow.listening();const n=f.speech.length;await f.flow.poll();assert.equal(f.speech.length,n);
 await f.handle('Thanks',tool('respond',{text:'You are welcome.'}));f.tick();await f.flow.poll();await f.flow.poll();
 assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);
 }finally{f.flow.dispose();}
});
test('cancelled queued save never publishes; a lost publish response is not retried by polling',async()=>{
 const f=fixture();try{await f.open();await f.handle('Edit',action('edit','Add a bear.'));await f.handle('Save',action('save'));await f.handle('Yes',confirm);
 await f.handle('Do not save',tool('dismiss_action'),tool('respond',{text:'I will not save.'}));f.finish();f.tick();await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 f.fail('/publish');await f.handle('Save now',action('save'));await f.handle('Yes',confirm);f.fail('');f.tick();await f.flow.poll();await f.flow.poll();assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);assert.match(f.speech.join(' '),/could not confirm/);
 }finally{f.flow.dispose();}
});
test('interruption aborts obsolete planning before a mutation can execute',async()=>{
 const f=fixture();try{await f.open();let finish;const p=f.handle('Save',()=>new Promise(r=>finish=r));f.flow.interrupted('');finish(action('save'));await p;
 assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 }finally{f.flow.dispose();}
});

test('caller speech during status lookup stops a stale save before it is sent',async()=>{
 const f=fixture();try{await f.open();await f.handle('Save',action('save'));const waiting=f.holdStatus();const saving=f.handle('Yes',confirm);const release=await waiting;
 f.flow.listening();release();await saving;
 assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 }finally{f.flow.dispose();}
});
