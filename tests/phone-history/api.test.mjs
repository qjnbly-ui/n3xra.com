import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url), account=require('../../api/_account-phone.js'), records=require('../../api/_phone-records.js');
const user=randomUUID(),id=randomUUID(),website=randomUUID(),session=randomUUID();
let identity={id:user},owner=true,found=true,paths=[],apply=null;
account.authenticatedUser=async()=>identity;
records.isPhoneRecordOwner=async()=>owner;
records.phoneInstruction=async()=>({instruction:'',expected_effect:'',version:null});
records.phoneRecordStore=async(path,opts={})=>{
 paths.push(path);
 if(path.startsWith('ai_phone_conversations?'))return found?[{id,user_id:user,website_id:website,call_id:'CA'+'b'.repeat(32)}]:[];
 if(path.startsWith('ai_phone_events?'))return [];
 if(path.startsWith('website_build_events?metadata'))return [{id:10,session_id:session,message:'Make a rocket',metadata:{model:'builder-model'}}];
 if(path.startsWith('website_build_events?session'))return [{id:11,event_type:'user_message',message:'Other request'}];
 if(path.startsWith('rpc/'))return apply;
 return [];
};
const handler=require('../../api/phone-history.js');
async function run(method='GET',body){let result={headers:{}};const res={setHeader(k,v){result.headers[k]=v;},status(n){result.status=n;return this;},json(v){result.data=v;return this;}};await handler({method,headers:{},query:{id},body},res);return result;}
test('requires authenticated owner; denies other users before loading transcripts',async()=>{
 identity=null;assert.equal((await run()).status,401);identity={id:user};owner=false;paths=[];assert.equal((await run()).status,403);assert.deepEqual(paths,[]);owner=true;
 found=false;assert.equal((await run()).status,404);found=true;
});
test('history scopes actor, website, call and conversation; does not borrow a later request reply',async()=>{
 paths=[];const result=await run();assert.equal(result.status,200);assert.equal(result.headers['Cache-Control'],'private, no-store');
 assert.equal(result.data.builds[0].reply,null);assert.equal(result.data.builds[0].outcome,'unavailable');
 assert.ok(paths.some(p=>p.includes(`user_id=eq.${user}`)));assert.ok(paths.some(p=>p.includes(`website_id=eq.${website}&actor_user_id=eq.${user}`)));
});
test('applying requires reviewed fields and rejects stale concurrent instruction versions',async()=>{
 assert.equal((await run('POST',{id,action:'apply',instruction:'x',expectedEffect:''})).status,400);
 const body={id,action:'apply',instruction:'Preserve intent',expectedEffect:'Fewer substitutions',expectedVersion:null};
 apply=null;assert.equal((await run('POST',body)).status,409);
 apply={instruction:'Preserve intent',version:randomUUID()};assert.equal((await run('POST',body)).status,200);
 assert.equal((await run('POST',{id,action:'publish'})).status,400);
});
