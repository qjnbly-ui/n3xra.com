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

test('image inspection checks preview-local delivery without fetching external assets',async()=>{
 const {inspectPhonePage}=createRequire(import.meta.url)('../../dist/build-worker/phone-page.js');const original=globalThis.fetch;const calls=[];
 try{globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});if(init.method==='HEAD')return new Response(null,{status:String(url).endsWith('missing.webp')?404:200,headers:{'content-type':'image/webp'}});return new Response('<img src="/images/banner.webp"><img src="/images/missing.webp"><img src="https://external.test/picture">',{headers:{'content-type':'text/html'}});};
 const page=await inspectPhonePage('https://workspace.test','private-auth','/preview/demo/','/');assert.deepEqual(page.images.map(i=>i.delivery),['available','unavailable','not_checked']);assert.equal(calls.length,3);assert.equal(calls[1].url,'https://workspace.test/preview/demo/images/banner.webp');assert.ok(calls.every(c=>c.url.startsWith('https://workspace.test/')));
 }finally{globalThis.fetch=original;}
});
