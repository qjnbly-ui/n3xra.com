import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const thread=randomUUID(),user=randomUUID(),phone='+15555550123';
let row=null, consent='opt_in',profileStatus='active',inbox=[],aiCalls=0;
let credential={user_id:user,phone_e164:phone,updated_at:'2026-09-06T12:00:00+00:00'};
const store=async(path,opts={})=>{
 if(path.startsWith('profiles?'))return [{account_status:profileStatus}];
 assert.ok(path.startsWith('nex_sms_sessions?'));
 const query=new URLSearchParams(path.split('?')[1]);
 const match=()=>row && [...query].every(([k,v])=>{
  if(['select','limit','on_conflict'].includes(k))return true;
  if(v==='is.null')return row[k]===null;
  if(v.startsWith('eq.'))return String(row[k])===v.slice(3);
  if(v.startsWith('gt.'))return row[k] && new Date(row[k])>new Date(v.slice(3));
  throw Error('Unknown filter '+k);
 });
 if(opts.method==='POST'){row=JSON.parse(opts.body);return [row];}
 if(opts.method==='DELETE'){if(match())row=null;return [];}
 if(opts.method==='PATCH'){if(!match())return [];Object.assign(row,JSON.parse(opts.body));return [structuredClone(row)];}
 return match()?[structuredClone(row)]:[];
};
const auth=require('../../api/_account-phone.js');
auth.getCredentialByUser=async id=>id===user?credential:null;
auth.getCallerAccount=async p=>p===credential.phone_e164 && ['active','trialing'].includes(profileStatus)?{user_id:user}:null;
auth.authenticatedUser=async req=>req.headers.authorization==='Bearer valid'?{id:user}:null;
require('../../api/_communications.js').supabaseJson=store;
const consentModule=require('../../api/_sms-consent.js');consentModule.latestConsent=async()=>({event_type:consent});consentModule.recordSmsConsent=async v=>{consent=v.eventType||'opt_in';};
const core=require('../../api/_sms-verification.js');
const api=require('../../api/sms-verification.js');
function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;},send(data){this.data=data;return this;},end(data){this.data=data;return this;}};}
const fresh=async(now=Date.now())=>{row=null;const message=await core.issueSmsLink(thread,phone,store,now);return message.match(/#([a-f0-9]{64})/)[1];};
test('only hashed challenges are stored and repeated requests are bounded',async()=>{
 const token=await fresh();assert.notEqual(row.token_hash,token);assert.doesNotMatch(JSON.stringify(row),new RegExp(token));assert.match(await core.issueSmsLink(thread,phone,store),/wait a minute/);
});
test('checking does not approve and approval is single-use even under concurrency',async()=>{
 const token=await fresh();await core.verifySmsLink(token,user,store,auth.getCredentialByUser,Date.now(),false);assert.equal(row.verified_user_id,null);
 const results=await Promise.allSettled([core.verifySmsLink(token,user),core.verifySmsLink(token,user)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(row.verified_user_id,user);assert.ok(new Date(row.verified_until)-Date.now()<=1800000);
 await assert.rejects(()=>core.verifySmsLink(token,user));
});
test('expired links, wrong accounts and forged tokens cannot grant access',async()=>{
 const token=await fresh(Date.now()-601000);await assert.rejects(()=>core.verifySmsLink(token,user));
 const valid=await fresh();await assert.rejects(()=>core.verifySmsLink(valid,randomUUID()));await assert.rejects(()=>core.verifySmsLink('a'.repeat(64),user));assert.equal(row.verified_user_id,null);
});
test('verification expires, credential changes invalidate it, and LOCK removes it',async()=>{
 const token=await fresh();await core.verifySmsLink(token,user);assert.equal((await core.verifiedSmsUser(thread,phone)).id,user);
 const old=credential.updated_at;credential={...credential,updated_at:'2026-09-06T13:00:00+00:00'};assert.equal(await core.verifiedSmsUser(thread,phone),null);credential.updated_at=old;
 assert.equal(await core.verifiedSmsUser(thread,'+15555550999'),null);
 assert.equal(await core.verifiedSmsUser(thread,phone,store,auth.getCallerAccount,auth.getCredentialByUser,Date.now()+1801000),null);
 await core.revokeSmsAccess(phone);assert.equal(await core.verifiedSmsUser(thread,phone),null);
});
test('status is unavailable before verification and discloses only allowed status afterward',async()=>{
 row=null;assert.match(await core.smsAccountStatus(thread,phone),/VERIFY/);const token=await fresh();await core.verifySmsLink(token,user);assert.match(await core.smsAccountStatus(thread,phone),/account is active/);
 profileStatus='suspended';assert.match(await core.smsAccountStatus(thread,phone),/VERIFY/);profileStatus='active';
});
test('web approval requires authentication, explicit action and consent',async()=>{
 const token=await fresh();let r=res();await api({method:'POST',headers:{},body:{token,action:'approve'}},r);assert.equal(r.code,401);
 r=res();await api({method:'GET',headers:{authorization:'Bearer valid'},body:{token,action:'approve'}},r);assert.equal(r.code,405);assert.equal(row.verified_user_id,null);
 consent='opt_out';r=res();await api({method:'POST',headers:{authorization:'Bearer valid'},body:{token,action:'approve'}},r);assert.equal(r.code,403);consent='opt_in';
 r=res();await api({method:'POST',headers:{authorization:'Bearer valid'},body:{token,action:'check'}},r);assert.equal(r.code,200);assert.equal(row.verified_user_id,null);
 r=res();await api({method:'POST',headers:{authorization:'Bearer valid'},body:{token,action:'approve'}},r);assert.equal(r.code,200);assert.equal(r.data.verified,true);
});
const webhook=require('../../api/_twilio-webhook.js');webhook.validateTwilioWebhook=req=>req.headers?.signed===true;
const messages=require('../../api/_admin-communications.js');messages.recordIncomingMessage=async payload=>{inbox.push(payload.Body);return {thread_id:thread,message_id:randomUUID()};};messages.maybeReplyWithNex=async()=>{aiCalls++;};
const sms=require('../../api/receptionist/sms.js');
async function text(body,signed=true){const r=res();await sms({method:'POST',headers:{signed},body:{Body:body,From:phone,To:'+15555550999',MessageSid:'SMtest'}},r);return r;}
test('PIN texts are omitted before persistence and never forwarded to AI',async()=>{
 inbox=[];aiCalls=0;await text('1234');await text('My PIN is 4321');assert.deepEqual(inbox,['[PIN text omitted]','[PIN text omitted]']);assert.equal(aiCalls,0);
});
test('unsigned webhooks cannot issue links or store messages',async()=>{
 inbox=[];const r=await text('VERIFY',false);assert.equal(r.code,403);assert.equal(inbox.length,0);
});
test('secure text commands issue a link, enforce consent, and lock or STOP revokes',async()=>{
 row=null;consent='opt_in';const r=await text('VERIFY');assert.match(r.data,/account\/text-access\/#/);assert.equal(row.verified_user_id,null);
 let token=r.data.match(/#([a-f0-9]{64})/)[1];await core.verifySmsLink(token,user);await text('LOCK');assert.equal(row,null);
 token=await fresh();await core.verifySmsLink(token,user);await text('STOP');assert.equal(row,null);assert.equal(consent,'opt_out');assert.match((await text('VERIFY')).data,/START/);consent='opt_in';
});
