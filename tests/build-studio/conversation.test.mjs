import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { ConversationTurn, redactNotes } = createRequire(import.meta.url)('../../dist/build-worker/conversation.js');

test('final conversation excludes commentary and preserves developer diagnostics', () => {
 const turn = new ConversationTurn();
 turn.item({id:'one',type:'agentMessage',phase:'commentary',text:'Inspecting src/pages/index.astro'},true);
 assert.equal(turn.item({id:'cmd',type:'commandExecution'},false),'Checking the website…');
 turn.item({id:'cmd',type:'commandExecution',command:'npm run build',aggregatedOutput:'Build passed',exitCode:0},true);
 turn.delta('final','{"message":"The rocket is ready.",');
 turn.delta('final','"technicalNotes":"Checked the homepage."}');
 turn.item({id:'final',type:'agentMessage',phase:'final_answer'},false);
 turn.item({id:'private',type:'reasoning',text:'DO NOT STORE'},true);
 const reply = turn.finish();
 assert.equal(reply.message,'The rocket is ready.');
 assert.match(reply.technicalNotes,/npm run build/);assert.match(reply.technicalNotes,/Inspecting/);
 assert.doesNotMatch(reply.message,/astro|npm|Inspecting/);assert.doesNotMatch(reply.technicalNotes,/DO NOT STORE/);
});
test('malformed replies and failures remain readable without false success', () => {
 const turn = new ConversationTurn();turn.delta('raw','Stack trace: internal failure');
 const reply=turn.finish();assert.doesNotMatch(reply.message,/Stack trace/);assert.match(reply.technicalNotes,/Stack trace/);
 const failed=turn.finish('Fixture process exited 1');assert.match(failed.message,/couldn’t finish/);assert.match(failed.technicalNotes,/exited 1/);
});
test('notes redact credentials and bound retained output', () => {
 process.env.N3XRA_TEST_SECRET='private-test-credential';
 try { const safe=redactNotes('private-test-credential https://test/?token=xyz Bearer abc');assert.doesNotMatch(safe,/private-test-credential|xyz|abc/); }
 finally { delete process.env.N3XRA_TEST_SECRET; }
 assert.ok(redactNotes('x'.repeat(100000)).length<=32000);
});
