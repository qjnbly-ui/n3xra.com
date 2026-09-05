import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stopProcessGroup } from '../../dist/build-worker/process-lifecycle.js';

test('preview shutdown waits for descendants even when the launcher exits first', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const launcher = spawn(process.execPath, ['-e', `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']});
    child.stdout.once('data',()=>process.stdout.write(String(child.pid)));
    process.on('SIGTERM',()=>process.exit(0));
  `], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const [chunk] = await once(launcher.stdout, 'data');
    const descendant = Number(String(chunk).trim());
    assert.ok(descendant > 0);
    await stopProcessGroup(launcher);
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
    await stopProcessGroup(launcher); // Stopping an already exited preview is safe.
  } finally {
    try { process.kill(-launcher.pid, 'SIGKILL'); } catch {}
  }
});

test('restored preview clears a dead PID lock before launch but preserves live locks',async()=>{
 const {mkdtemp,mkdir,writeFile,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {removeStaleAstroLock}=await import('../../dist/build-worker/process-lifecycle.js');
 const root=await mkdtemp(join(tmpdir(),'astro-lock-'));const path=join(root,'.astro','dev.json');
 try{await mkdir(join(root,'.astro'));await writeFile(path,JSON.stringify({pid:2147483647}));
 await removeStaleAstroLock(root);await assert.rejects(readFile(path),{code:'ENOENT'});
 const live=JSON.stringify({pid:process.pid});await writeFile(path,live);await removeStaleAstroLock(root);assert.equal(await readFile(path,'utf8'),live);
 }finally{await rm(root,{recursive:true,force:true});}
});
