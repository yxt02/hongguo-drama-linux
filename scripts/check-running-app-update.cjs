const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const u = require('../src/native/linux-update');
(async()=>{
  // A host-mounted /proc in a nested PID namespace reports IDs that process.kill
  // cannot address. This fixture must run with /proc mounted in its own namespace.
  const status = await fs.readFile('/proc/self/status', 'utf8');
  if (Number(status.match(/^Pid:\s+(\d+)/m)?.[1]) !== process.pid) {
    console.log('SKIP process guard: /proc and runtime use different PID namespaces');
    return;
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hongguo-process-test-'));
  const target = path.join(temp, 'selected'), other = path.join(temp, 'other'); const children = [];
  try {
    for (const root of [target, other]) {
      await fs.mkdir(path.join(root, 'app'), { recursive: true });
      await fs.copyFile(process.execPath, path.join(root, 'app/hongguo-downloader')); await fs.chmod(path.join(root, 'app/hongguo-downloader'), 0o755);
      const child = spawn(path.join(root, 'app/hongguo-downloader'), ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); children.push(child);
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    }
    assert.deepEqual((await u.runningProcesses(target)).map(p => p.pid), [children[0].pid]);
    await u.closeRunning(target);
    assert.equal((await u.runningProcesses(target)).length, 0);
    assert.equal((await u.runningProcesses(other)).length, 1, 'another installation must stay alive');
    assert.doesNotThrow(()=>process.kill(children[1].pid,0));
    console.log('PASS update process guard: real binary detection, close selected old instance, wait for exit, leave other installation untouched');
  } finally { for(const child of children) { try { child.kill(); } catch (_) {} } await fs.rm(temp,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1});
