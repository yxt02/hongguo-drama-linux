// Persistent automatic playback cache. Downloaded originals are never managed here.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const RADIUS = 5;
const MAX_EPISODE_BYTES = 1024 * 1024 * 1024;
const cacheKey = (vid, quality = 'auto') => 'disk:' + quality + ':' + String(vid);
function windowEntries({ seriesId, vidIndex, episodes, quality = 'auto' } = {}) {
  if (!seriesId || !Number.isInteger(vidIndex) || vidIndex < 1 || !Array.isArray(episodes)) throw new Error('缓存窗口无效');
  if (!['auto', '1080p', '720p'].includes(quality)) throw new Error('播放清晰度无效');
  const selected = episodes.filter(e => typeof e.vid === 'string' && e.vid && Number.isInteger(e.vidIndex)
    && e.vidIndex > 0 && Math.abs(e.vidIndex - vidIndex) <= RADIUS);
  if (selected.length > RADIUS * 2 + 1 || new Set(selected.map(e => e.vidIndex)).size !== selected.length) throw new Error('缓存窗口最多保留前后各五集');
  return { seriesId: String(seriesId), vidIndex, quality, keys: new Set(selected.map(e => cacheKey(e.vid, quality))) };
}
function manifest(entry) {
  return { version: 1, vid: entry.vid, seriesId: entry.seriesId, vidIndex: entry.vidIndex, quality: entry.quality,
    source: entry.source, codec: entry.codec, width: entry.width, height: entry.height, actualQuality: entry.actualQuality, size: entry.size, fileMtime: entry.fileMtime, lastUsed: entry.lastUsed };
}
function save(entry) {
  fs.writeFileSync(path.join(entry.disk.directory, 'metadata.json'), JSON.stringify(manifest(entry)), { mode: 0o600 });
}
function restore(root) {
  fs.mkdirSync(root, { recursive: true });
  const entries = [];
  for (const name of fs.readdirSync(root)) {
    if (!/^episode-[a-f0-9]{12}-[A-Za-z0-9]+$/.test(name)) continue;
    const directory = path.join(root, name);
    try {
      if (!fs.lstatSync(directory).isDirectory()) continue;
      const metadata = path.join(directory, 'metadata.json'), filePath = path.join(directory, 'video.mp4');
      if (!fs.lstatSync(metadata).isFile() || !fs.lstatSync(filePath).isFile()) throw new Error('Invalid cache');
      const e = JSON.parse(fs.readFileSync(metadata, 'utf8'));
      if (e.version !== 1 || typeof e.vid !== 'string' || !e.vid || typeof e.seriesId !== 'string'
        || !Number.isInteger(e.vidIndex) || e.vidIndex < 1 || !['auto', '1080p', '720p'].includes(e.quality)
        || !Number.isFinite(e.size) || e.size <= 0 || fs.statSync(filePath).size !== e.size) throw new Error('Incomplete cache');
      entries.push({ ...e, filePath, complete: true, disk: { directory, readers: 0, managed: true } });
    } catch (_) { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  return entries;
}
function temporaryPrefix(root, key) {
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, 'episode-' + createHash('sha256').update(key).digest('hex').slice(0, 12) + '-');
}
module.exports = { RADIUS, MAX_EPISODE_BYTES, cacheKey, windowEntries, save, restore, temporaryPrefix };
