import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {phonePagePath,summarizePhonePage}=createRequire(import.meta.url)('../../dist/build-worker/phone-page.js');
test('page inspection restricts paths and returns bounded semantic content, not scripts or signed queries',()=>{
 for(const path of ['https://other.test','//other.test','/../secrets','/.env','/%2e','/a?token=secret','/a\\b'])assert.throws(()=>phonePagePath(path));
 assert.equal(phonePagePath('/about/'),'/about/');
 const result=summarizePhonePage('<script>secret()</script><h1>Hello &amp; welcome</h1><img src="/lake.jpg?token=secret" alt="Mountain lake"><p>Home</p>','/');
 assert.deepEqual(result.headings,['Hello & welcome']);assert.equal(result.images[0].description,'Mountain lake');assert.equal(result.images[0].sourcePath,'/lake.jpg');assert.doesNotMatch(result.text,/secret/);assert.match(result.limitations,/not a screenshot/);
});
