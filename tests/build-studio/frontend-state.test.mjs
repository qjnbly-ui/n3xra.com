import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function frontend(fetch = () => Promise.reject(new Error("Unexpected request"))) {
  let source=await readFile(new URL('../../n3xra-admin/build-studio/build-studio.js',import.meta.url),'utf8');
  source=source.replace(/^import .*;\n/gm,'');
  source=source.slice(0,source.indexOf('initialize().catch'));
  const elements=new Map();
  const element=()=>({hidden:false,disabled:false,textContent:'',value:'',dataset:{},style:{},children:[],classList:{toggle(){},add(){},remove(){}},append(...v){this.children.push(...v);},replaceChildren(){this.children=[];},handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},setAttribute(){},querySelector(){return get('send');}});
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const ctx={window:{RECORDS_APP_CONFIG:{buildWorkerUrl:'https://worker.test'}},document:{getElementById:get,createElement:element,querySelectorAll:()=>[]},URL,AbortController,TextDecoder,setTimeout,clearTimeout,console,fetch};
  vm.createContext(ctx);vm.runInContext(source+'\nglobalThis.api={renderSession,handleWorkerEvent};',ctx);
  return {api:ctx.api,get};
}
const session=(extra={})=>({id:'demo',state:'ready',workingBranch:'demo',previewState:'ready',previewUrl:'https://worker.test/preview/demo/?token=test',changedFileCount:1,hasUnpushedCommits:false,...extra});
test('checkpoint and push reflect separate Git states; active turns disable editing',async()=>{
 const {api,get}=await frontend();api.renderSession(session());assert.equal(get('build-checkpoint').disabled,false);assert.equal(get('build-push').disabled,true);
 api.renderSession(session({changedFileCount:0,hasUnpushedCommits:true}));assert.equal(get('build-checkpoint').disabled,true);assert.equal(get('build-push').disabled,false);
 api.renderSession(session({state:'working'}));assert.equal(get('build-prompt').disabled,true);assert.equal(get('build-push').disabled,true);
});
test('replayed events cannot restore stale state or duplicate messages; successful edits refresh preview',async()=>{
 const {api,get}=await frontend();api.renderSession(session());
 const event={id:1,eventType:'agent_message',message:'Added rocket',metadata:{conversationVersion:2,session:session({state:'failed'})},replay:true};
 api.handleWorkerEvent(event);api.handleWorkerEvent(event);assert.equal(get('build-messages').children.length,1);assert.equal(get('build-workspace').hidden,false);
 api.handleWorkerEvent({id:2,eventType:'agent_message',message:'Done',metadata:{session:session()}});assert.match(get('build-preview-frame').src,/refresh=/);
});
test('idle previews clearly pause, unload the old page, and reload when resumed',async()=>{
 const {api,get}=await frontend();api.renderSession(session());
 api.renderSession(session({previewState:'offline'}));
 assert.match(get('build-preview-status').textContent,/paused.*refresh to resume/);
 assert.equal(get('build-preview-frame').src,'about:blank');
 api.renderSession(session());
 assert.match(get('build-preview-frame').src,/https:\/\/worker.test\/preview\/demo/);
 assert.equal(get('build-preview-status').textContent,'Live preview');
});
test('each isolated workspace requires its own sign-in before editing',async()=>{
 const {api,get}=await frontend();api.renderSession(session({codexAuthenticated:false}));
 assert.equal(get('build-setup').hidden,false);assert.equal(get('build-connect').hidden,false);
 assert.equal(get('build-workspace').hidden,false);assert.equal(get('build-prompt').disabled,true);
 api.handleWorkerEvent({id:3,eventType:'session',metadata:{session:session({codexAuthenticated:true})}});
 assert.equal(get('build-setup').hidden,true);assert.equal(get('build-prompt').disabled,false);
});
test('historical diagnostic output is hidden without rewriting saved messages',async()=>{
 const {api,get}=await frontend();api.renderSession(session());
 api.handleWorkerEvent({id:10,eventType:'error',message:'Another astro dev server is already running.\nPID: 687\nStack trace: internal',replay:true});
 const text=get('build-messages').children[0].children[1].textContent;
 assert.match(text,/PID: 687/);assert.equal(get('build-messages').children[0].hidden,true);
});

test('live activity appears during work, clears on completion, and ignores other workspaces',async()=>{
 const {api,get}=await frontend();api.renderSession(session({state:'working'}));
 assert.equal(get('build-activity').hidden,false);assert.match(get('build-activity').textContent,/Working/);
 api.handleWorkerEvent({eventType:'progress',metadata:{session:session({state:'working',progress:'Checking the website…'})}});
 assert.equal(get('build-activity').textContent,'Checking the website…');
 api.handleWorkerEvent({eventType:'progress',metadata:{session:session({id:'other',state:'working',progress:'Wrong site'})}});
 assert.equal(get('build-activity').textContent,'Checking the website…');
 api.handleWorkerEvent({eventType:'agent_message',message:'Done',metadata:{session:session()}});
 assert.equal(get('build-activity').hidden,true);
});
test('technical notes stay separate, hidden by default, and toggle without duplicating history',async()=>{
 const {api,get}=await frontend();api.renderSession(session());
 const event={id:55,eventType:'agent_message',message:'Added the rocket.',technicalNotes:'Checked src/pages/index.astro',metadata:{conversationVersion:2},replay:true};
 api.handleWorkerEvent(event);api.handleWorkerEvent(event);
 const entries=get('build-messages').children;assert.equal(entries.length,2);
 assert.equal(entries[0].children[1].textContent,'Added the rocket.');assert.equal(entries[1].hidden,true);
 get('build-show-notes').checked=true;get('build-show-notes').handlers.change();assert.equal(entries[1].hidden,false);
 get('build-show-notes').checked=false;get('build-show-notes').handlers.change();assert.equal(entries[1].hidden,true);
});

test('sending immediately displays activity before the server accepts the request',async()=>{
 let resolveRequest;
 const {api,get}=await frontend(()=>new Promise(resolve=>{resolveRequest=resolve;}));
 api.renderSession(session());get('build-prompt').value='Check the rocket';
 const pending=get('build-composer').handlers.submit({preventDefault(){}});
 assert.equal(get('build-activity').hidden,false);assert.equal(get('build-activity').textContent,'Sending your request…');
 assert.equal(get('send').disabled,true);
 resolveRequest({ok:true,json:async()=>({accepted:true})});await pending;
});
