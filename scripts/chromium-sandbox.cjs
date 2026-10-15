// Decide whether Chromium can sandbox on this host, and build argv for it.
//
// Linux can use either the SUID chrome-sandbox helper or unprivileged user
// namespaces. Ubuntu 23.10+ sets kernel.apparmor_restrict_unprivileged_userns=1,
// which blocks the namespace sandbox for binaries without a matching AppArmor
// profile; a non-root chrome-sandbox then makes Chromium abort at startup.
// Callers pass --no-sandbox in that case so the app still runs, with a notice.
const fs = require('node:fs');
const path = require('node:path');

function readSysctl(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function canSandbox(electronPath) {
  if (process.env.HONGGUO_NO_SANDBOX === '1') return false;

  const helper = path.join(path.dirname(electronPath), 'chrome-sandbox');
  try {
    const stat = fs.statSync(helper);
    if ((stat.mode & 0o4000) && stat.uid === 0) return true;
  } catch { /* helper missing: fall through to namespace sandbox */ }

  const userns = readSysctl('/proc/sys/kernel/unprivileged_userns_clone');
  const apparmorRestrict = readSysctl('/proc/sys/kernel/apparmor_restrict_unprivileged_userns');
  const maxNamespaces = readSysctl('/proc/sys/user/max_user_namespaces');
  const namespacesAllowed = (userns === null || userns === '1') && (maxNamespaces === null || Number(maxNamespaces) > 0);
  return namespacesAllowed && apparmorRestrict !== '1';
}

function sandboxArgv(electronPath, extraArgs = []) {
  const passthrough = extraArgs.filter((arg) => arg !== '--no-sandbox');
  return canSandbox(electronPath) ? passthrough : ['--no-sandbox', ...passthrough];
}

const sandboxHelp = [
  '提示：本机的 Chromium 沙箱不可用，已用 --no-sandbox 启动。',
  '     要启用沙箱，可任选其一：',
  '     1) 安装带 SUID chrome-sandbox 的 deb/AppImage 包（打包器会处理）；',
  '     2) sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox',
  '     3) 将 kernel.apparmor_restrict_unprivileged_userns 设为 0（Ubuntu 24.04）。',
  '     仅本机自用时，--no-sandbox 通常可接受。',
].join('\n');

module.exports = { canSandbox, sandboxArgv, sandboxHelp };
