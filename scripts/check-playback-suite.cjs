// Offline regression suite; all application data and media mutations use temporary fixtures.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const checks = [
  "check-playback-cache.cjs",
  "check-playback-media.cjs",
  "check-next-cache.cjs",
  "check-decode-watch.cjs",
  "check-decode-fallback.cjs",
  "check-compat-lifecycle.cjs",
  "check-player-resume.cjs",
  "check-player-fallback.cjs",
  "check-player-navigation.cjs",
  "check-player-download-state.cjs",
  "check-player-controls.cjs",
  "check-playback-speed.cjs",
  "check-picture-mode.cjs",
  "check-player-shortcuts.cjs",
  "check-download-manager.cjs",
  "check-download-quality.cjs",
  "check-download-quality-integration.cjs",
  "check-download-media-validity.cjs",
  "check-download-safety.cjs",
  "check-download-selection-delete.cjs",
  "check-online-disk-lifecycle.cjs",
  "check-media-recovery.cjs",
  "check-streaming.cjs",
  "check-source-recovery.cjs",
  "check-source-routing.cjs",
  "check-source-retry.cjs",
  "check-app-source.cjs",
  "check-app-media.cjs",
  "check-hls-media.cjs",
  "check-decrypt-worker.cjs",
  "check-media-access.cjs",
  "check-linux-package.cjs",
  "check-app-update.cjs",
  "check-linux-update.cjs",
  "check-linux-update-controller.cjs",
  "check-update-controls.cjs",
  "check-app-lifecycle.cjs",
  "check-app-shutdown.cjs",
  "check-window-controls.cjs",
  "check-running-app-update.cjs"
];
let failed = 0;
for (const file of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8', timeout: 45000 });
  if (result.status !== 0) { failed++; console.error('FAIL ' + file); console.error(result.stdout || '', result.stderr || '', result.error?.message || ''); }
  else console.log('PASS ' + file);
}
console.log((checks.length - failed) + '/' + checks.length + ' playback regression scripts passed');
process.exitCode = failed ? 1 : 0;
