const axios = require('axios');
const { readRouterData, publicMetadata } = require('./catalog');
const SITE = 'https://hongguoduanju.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const cache = new Map();
const pending = new Map();
const count = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function reviews(value) {
  return { total: count(value?.total_count), items: (Array.isArray(value?.reviews) ? value.reviews : [])
    .filter(item => typeof item?.content === 'string' && item.content.trim()).slice(0, 50).map(item => {
      const created = count(item.create_time);
      return { author: typeof item.user_name === 'string' ? item.user_name.slice(0, 200) : '',
        avatar: typeof item.user_avatar === 'string' && /^https?:\/\//i.test(item.user_avatar) ? item.user_avatar.slice(0, 4096) : '',
        content: item.content.slice(0, 20000), created_at: created ? created * (created < 1e12 ? 1000 : 1) : null,
        likes: count(item.digg_count), rating: count(item.rating) };
    }) };
}

function parsePublicDetails(html, seriesId, vid = '') {
  const router = readRouterData(html);
  const data = Object.values(router.loaderData || {}).find(value => value?.seriesDetail && value.isSuccess !== false);
  if (!data) throw new Error('来源页面未返回公开剧集信息');
  if (String(data.seriesDetail.series_id) !== seriesId) throw new Error('来源页面剧集不匹配');
  if (vid && String(data.vid) !== vid) throw new Error('来源页面分集不匹配');
  const social = data.seriesSocialInfo || {};
  return { success: true, series_id: seriesId, episode_id: vid || null,
    ...publicMetadata(data.seriesDetail), rating: count(social.rating), rating_count: count(social.rating_count),
    like_count: count(social.series_like_count), favorite_count: count(social.series_favorite_count),
    reviews: reviews(social.reviews), episode_reviews: vid ? reviews(data.episodeSocialInfo?.reviews) : null,
    episode_like_count: vid ? count(data.episodeSocialInfo?.episode_like_count) : null,
    sourceUrl: vid ? `${SITE}/player/${seriesId}/${vid}` : `${SITE}/detail?series_id=${seriesId}` };
}

function isUnpublishedEpisodeRedirect(response, url) {
  if (response?.status !== 302 || !response.headers?.location) return false;
  try {
    const target = new URL(response.headers.location, url);
    return target.origin === SITE && target.pathname === new URL(url).pathname
      && target.searchParams.has('pc_locked_episode');
  } catch (_) { return false; }
}

async function fetchPublicDetails(seriesId, vid = '') {
  seriesId = String(seriesId || '');
  vid = String(vid || '');
  if (!/^\d{6,30}$/.test(seriesId) || (vid && !/^\d{6,30}$/.test(vid))) return { success: false, error: '仅支持有效的红果剧集和分集编号' };
  const url = vid ? `${SITE}/player/${seriesId}/${vid}` : `${SITE}/detail?series_id=${seriesId}`;
  if (cache.get(url)?.expires > Date.now()) return cache.get(url).data;
  if (pending.has(url)) return pending.get(url);
  const request = (async () => {
    try {
      // Axios defaults preserve the app's configured proxy; no cookies or account headers are added.
      const response = await axios.get(url, { timeout: 10000, signal: AbortSignal.timeout(10000),
        maxRedirects: 0, responseType: 'text', maxContentLength: 8 * 1024 * 1024,
        headers: { 'User-Agent': UA, Referer: `${SITE}/` } });
      const data = parsePublicDetails(response.data, seriesId, vid);
      cache.set(url, { expires: Date.now() + 30000, data });
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return data;
    } catch (error) {
      if (vid && isUnpublishedEpisodeRedirect(error.response, url)) {
        return { success: false, sourceUrl: url, code: 'EPISODE_COMMENTS_UNAVAILABLE', error: '官网未公开本集评论' };
      }
      return { success: false, sourceUrl: url, error: ['ECONNABORTED', 'ERR_CANCELED'].includes(error.code)
        ? '公开评论加载超时，请重试' : error.response ? `公开评论加载失败（HTTP ${error.response.status}）` : error.message };
    } finally { pending.delete(url); }
  })();
  pending.set(url, request);
  return request;
}

module.exports = { fetchPublicDetails, parsePublicDetails };
