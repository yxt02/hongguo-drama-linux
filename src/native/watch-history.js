function totalEpisodes(series) {
  return Math.max(Number(series?.total) || 0, series?.episodes?.length || 0);
}

function isWatched(record) {
  return record && (record.watched === true || Number(record.currentTime) > 0)
    && Number.isFinite(record.updatedAt) && Number.isInteger(record.vid_index) && record.vid_index > 0;
}

function listHistory(series, playback, showSequels = true) {
  return series.filter(item => isWatched(playback[item.series_id])).map(item => {
    const record = playback[item.series_id];
    const sequels = showSequels && Array.isArray(record.sequels) ? record.sequels : [];
    const seen = new Set(record.seenSequelIds || []);
    return {
      series_id: item.series_id, series_title: item.series_title, cover: item.cover || '',
      total: Math.max(totalEpisodes(item), record.knownTotal || 0),
      vid_index: record.vid_index, currentTime: record.currentTime, updatedAt: record.updatedAt,
      unreadEpisodes: record.unreadEpisodes || 0, sequels,
      hasUpdates: record.unreadEpisodes > 0 || sequels.some(candidate => !seen.has(candidate.series_id)),
      lastCheckedAt: record.lastCheckedAt || 0, lastCheckError: record.lastCheckError || '',
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

function recordPlayback(previous, series, index, time, now = Date.now(), watchedEpisode = time > 0) {
  if (!Number.isInteger(index) || index < 1 || !Number.isFinite(time) || time < 0) throw new Error('无效的播放进度');
  const baseline = previous?.knownTotal ?? totalEpisodes(series);
  const watchedEpisodes = { ...previous?.watched_episodes };
  if (!previous?.watched_episodes && isWatched(previous)) watchedEpisodes[previous.vid_index] = previous.updatedAt;
  if (watchedEpisode) watchedEpisodes[index] = now;
  return { ...previous, vid_index: index, currentTime: time, updatedAt: now, watched: true, watched_episodes: watchedEpisodes,
    knownTotal: baseline, acknowledgedTotal: previous?.acknowledgedTotal ?? baseline };
}

// 旧版只有按剧季的续播位置：升级时用它标记对应分集，其余分集实际播放后逐步补齐。
function watchedIndexes(record) {
  const watched = record?.watched_episodes && typeof record.watched_episodes === 'object' ? record.watched_episodes : null;
  if (watched) {
    const indexes = Object.keys(watched).map(Number).filter(index => Number.isInteger(index) && index > 0 && watched[index]);
    return [...new Set(indexes)].sort((a, b) => a - b);
  }
  return isWatched(record) ? [record.vid_index] : [];
}

function applyEpisodeUpdate(record, oldSeries, freshSeries, now = Date.now()) {
  const baseline = record.knownTotal ?? totalEpisodes(oldSeries);
  const knownTotal = Math.max(baseline, totalEpisodes(freshSeries));
  const acknowledgedTotal = record.acknowledgedTotal ?? baseline;
  return { ...record, knownTotal, acknowledgedTotal,
    unreadEpisodes: Math.max(0, knownTotal - acknowledgedTotal), lastCheckedAt: now, lastCheckError: '' };
}

function seasonTitle(title) {
  const text = String(title || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const match = text.match(/^(.*?)(?:第([一二三四五六七八九十百零两\d]+)[季部]|[（(]([一二三四五六七八九十百零两\d]+)[）)]|season(\d+))$/i);
  if (!match) return { base: text, season: 1 };
  const value = match[2] || match[3] || match[4];
  let season = Number(value);
  if (!Number.isFinite(season)) {
    const digits = {零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    let n = 0, digit = 0;
    for (const char of value) {
      if (char === '十' || char === '百') { n += (digit || 1) * (char === '十' ? 10 : 100); digit = 0; }
      else digit = digits[char] || 0;
    }
    season = n + digit;
  }
  return { base: match[1], season };
}

function sourceOf(id) {
  if (/^\d{6,30}$/.test(id)) return 'hongguo';
  if (/^xifan:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(id)) return 'xifan';
  if (/^hema:\d+$/.test(id)) return 'hema';
  return null;
}

// shortcut: independent sequels have no authoritative relation; only exact base titles with higher explicit seasons qualify.
function findSequels(series, candidates) {
  const current = seasonTitle(series.series_title);
  const source = sourceOf(String(series.series_id));
  if (!current.base || !source) return [];
  const seen = new Set([String(series.series_id)]);
  return candidates.filter(candidate => {
    const id = String(candidate.series_id || '');
    const next = seasonTitle(candidate.series_title);
    if (seen.has(id) || sourceOf(id) !== source || next.base !== current.base || next.season <= current.season) return false;
    seen.add(id);
    return true;
  }).slice(0, 10).map(candidate => ({ series_id: String(candidate.series_id), series_title: String(candidate.series_title) }));
}

function sequelKeyword(series) { return seasonTitle(series.series_title).base; }

function acknowledge(record, snapshot) {
  const knownTotal = record.knownTotal || 0;
  const visibleTotal = snapshot ? Number(snapshot.total) || 0 : knownTotal;
  const acknowledgedTotal = Math.max(record.acknowledgedTotal || 0, Math.min(knownTotal, visibleTotal));
  const knownIds = new Set((record.sequels || []).map(item => item.series_id));
  const visibleIds = snapshot ? (Array.isArray(snapshot.sequelIds) ? snapshot.sequelIds : []) : [...knownIds];
  return { ...record, acknowledgedTotal, unreadEpisodes: Math.max(0, knownTotal - acknowledgedTotal),
    seenSequelIds: [...new Set([...(record.seenSequelIds || []), ...visibleIds.filter(id => knownIds.has(id))])] };
}

module.exports = { listHistory, recordPlayback, watchedIndexes, applyEpisodeUpdate, findSequels, sequelKeyword, acknowledge };
