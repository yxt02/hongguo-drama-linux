const { createHash } = require('node:crypto');
const { fetchPublicDetails } = require('./public-details');

const NOTICE = '官网仅提供本集部分评论，暂未提供可用的公开翻页接口；更多评论请到红果短剧 App 查看。';

async function fetchEpisodeComments(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: '评论请求无效' };
  const { seriesId, episodeId, cursor = null, limit = 30 } = options;
  if (typeof seriesId !== 'string' || !/^\d{6,30}$/.test(seriesId) ||
      typeof episodeId !== 'string' || !/^\d{6,30}$/.test(episodeId) ||
      !Number.isInteger(limit) || limit < 1 || limit > 30) return { success: false, error: '评论请求编号或条数无效' };
  if (cursor !== null) return { success: false, source_limited: true, error: NOTICE };
  const details = await fetchPublicDetails(seriesId, episodeId);
  if (details.code === 'EPISODE_COMMENTS_UNAVAILABLE') {
    return { success: true, series_id: seriesId, episode_id: episodeId, items: [], next_cursor: null,
      has_more: false, total: null, source_limited: true, notice: '官网未公开本集评论，可切换到时间轴弹幕' };
  }
  if (!details.success) return details;
  const seen = new Set();
  const items = [];
  for (const review of details.episode_reviews?.items || []) {
    // The public preview has no comment IDs; hash stable fields, excluding changing like counts.
    const id = createHash('sha256').update(JSON.stringify([seriesId, episodeId, review.author, review.created_at, review.content])).digest('hex');
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, content: review.content });
    if (items.length >= limit) break;
  }
  // shortcut: anonymous SSR exposes a preview only; use real cursors when a public paging API exists.
  return { success: true, series_id: seriesId, episode_id: episodeId, items, next_cursor: null,
    has_more: false, total: details.episode_reviews?.total ?? null, source_limited: true, notice: NOTICE };
}

module.exports = { fetchEpisodeComments };
