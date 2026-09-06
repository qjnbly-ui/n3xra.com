import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {organizeTasks}=createRequire(import.meta.url)('../../dist/build-worker/task-history.js');
test('task titles and grouping survive new conversations and deliberate reopening',()=>{
 const rows=[
  {id:1,event_type:'user_message',message:'Add a rocket',metadata:{taskThreadId:'thread-a'}},
  {id:2,event_type:'status',metadata:{conversationStart:true,taskId:'new'}},
  {id:3,event_type:'user_message',message:'Change the colors',metadata:{taskThreadId:'thread-b'}},
  {id:4,event_type:'status',metadata:{conversationStart:true,taskId:'original'}},
  {id:5,event_type:'user_message',message:'Make it larger'},
 ];
 const result=organizeTasks(rows);
 assert.equal(result.currentId,'original');
 assert.equal(result.tasks.length,2);
 const rocket=result.tasks.find(t=>t.id==='original');
 assert.equal(rocket.title,'Add a rocket');assert.equal(rocket.threadId,'thread-a');assert.equal(rocket.messages.length,2);
 assert.equal(result.eventTasks.get(1),result.eventTasks.get(5));
});
