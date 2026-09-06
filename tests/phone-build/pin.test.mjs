import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'pin-test-fixture';
const require = createRequire(import.meta.url);
const { hashPin, verifyCallerPin } = require('../../api/_account-phone.js');

test('PIN verification reloads credentials and retries a raced counter without losing failures', async () => {
  const original = global.fetch;
  const { salt, hash } = await hashPin('1234');
  const credential = { user_id:'test-user', phone_e164:'+15555550123', pin_salt:salt, pin_hash:hash, failed_attempts:3, locked_until:null };
  let patches = 0;
  global.fetch = async (url, options) => {
    if (options.method !== 'PATCH') return new Response(JSON.stringify([{...credential}]));
    patches++;
    if (patches === 1) { credential.failed_attempts = 4; return new Response('[]'); }
    assert.match(String(url), /failed_attempts=eq\.4/);
    Object.assign(credential, JSON.parse(options.body));
    return new Response(JSON.stringify([credential]));
  };
  try {
    const result = await verifyCallerPin({...credential}, '0000');
    assert.equal(result.reason, 'locked'); assert.equal(credential.failed_attempts, 5);
    assert.ok(Date.parse(credential.locked_until) > Date.now());
    assert.equal((await verifyCallerPin({...credential, locked_until:null}, '1234')).reason, 'locked');
    assert.equal(patches,2,'locked calls do not write or compare more guesses');
  } finally { global.fetch = original; }
});
test('valid PIN clears old failures and a revoked phone number cannot verify', async () => {
  const original = global.fetch; const {salt,hash} = await hashPin('1234');
  const row = {user_id:'test-user',phone_e164:'+15555550123',pin_salt:salt,pin_hash:hash,failed_attempts:2,locked_until:null};
  global.fetch = async (_url, options) => { if(options.method==='PATCH') Object.assign(row,JSON.parse(options.body)); return new Response(JSON.stringify([row])); };
  try {
    assert.equal((await verifyCallerPin({...row},'1234')).ok,true);
    assert.equal(row.failed_attempts,0);assert.ok(row.last_authenticated_at);
    assert.equal((await verifyCallerPin({...row,phone_e164:'+15555550999'},'1234')).reason,'unrecognized');
  } finally {global.fetch=original;}
});
