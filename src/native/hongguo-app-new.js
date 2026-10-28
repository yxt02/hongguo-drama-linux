// App「近期上新」目录补搜：官网搜索索引与 App 不同步时，用 App 分类接口
// （线上时间倒序）补齐当天刚上线、官网搜索还查不到的短剧。
const { signedMetadataRequest, parseSearchInteger, requestJson } = require('./app-source');
const { cleanTitle } = require('./hongguo-app-search');
const { catalogCover } = require('./hongguo-app-catalog');

const CATEGORY_API = '/reading/distribution/category/landpage/v/';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 1000;
const PAGE_LIMIT = 50;
// 默认翻两页（真人 + AI 各最多 100 条），降低繁忙日当天新剧落在首屏之外的概率。
const DEFAULT_PAGES = 2;
const MAX_RESULTS = 20;
// 真人剧与 AI 剧使用同一分类接口、不同筛选值；两者都能出现在搜索结果里。
const GENRES = [
  { reqScene: 'default', genre: 'short_play' },
  { reqScene: 'ai_series', genre: 'ai_series' },
];

let cache = null; // { expires, pages, items }
let inflight = null; // { pages, task }

function appError(message, code) {
  return Object.assign(new Error(message), { code });
}

function normalizeTitle(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function newReleaseFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.series_id ?? '');
  if (!/^\d{1,30}$/.test(id)) return null;
  const title = cleanTitle(row.title || row.series_title || row.series_name);
  if (!title) return null;
  const labels = [];
  const addLabel = (value) => {
    const text = cleanTitle(value);
    if (text && !labels.includes(text)) labels.push(text);
  };
  // 「新剧」标签在 tag_info，上线日期在 sub_title_list；两处都保留用于展示和排序。
  addLabel(row.tag_info?.text);
  for (const item of Array.isArray(row.sub_title_list) ? row.sub_title_list : []) addLabel(item?.content);
  const releasedToday = labels.includes('今日上新');
  return {
    series_id: id,
    series_title: title,
    cover: catalogCover(row.cover),
    episode_count: parseSearchInteger(row.episode_cnt) || 0,
    description: cleanTitle(row.video_desc || row.series_intro),
    tags: labels.filter(label => label !== '新剧' && label !== '今日上新').slice(0, 4),
    new_release: true,
    ...(releasedToday ? { released_today: true } : {}),
    source: 'hongguo',
    url: `https://hongguoduanju.com/detail?series_id=${id}`,
  };
}

function collectRows(rows) {
  const seen = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = newReleaseFromRow(row);
    if (!item) continue;
    const existing = seen.get(item.series_id);
    if (!existing) { seen.set(item.series_id, item); continue; }
    // 同一部剧可能同时出现在真人/AI 列表；保留「今日上新」标记和更完整的字段。
    existing.released_today = existing.released_today || item.released_today;
    existing.tags = [...new Set([...existing.tags, ...item.tags])].slice(0, 4);
    if (!existing.cover) existing.cover = item.cover;
    if (!existing.description) existing.description = item.description;
    if (!existing.episode_count) existing.episode_count = item.episode_count;
  }
  return [...seen.values()];
}

async function defaultRequest(signed, deadline) {
  const remaining = Math.max(1, deadline - Date.now());
  try {
    return await requestJson(signed.url, { method: 'POST', headers: signed.headers, data: signed.body },
      deadline, AbortSignal.timeout(remaining));
  } catch (error) {
    if (error.code === 'ETIMEDOUT' || error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw appError('App 上新请求超时', 'APP_TIMEOUT');
    }
    if (/未返回有效数据|空响应/i.test(error.message || '')) throw appError('App 上新返回空响应', 'APP_EMPTY');
    throw appError(error.message || 'App 上新请求失败', error.code || 'APP_NETWORK');
  }
}

function pageBody({ reqScene, genre }, offset, sessionId) {
  return {
    filter_ids: '',
    req_scene: reqScene,
    offset,
    need_selector_panel: false,
    limit: PAGE_LIMIT,
    select_items: {
      genre: [genre],
      sort: ['online_time'],
      category_dim_theme: [],
      category_dim_role: [],
      category_dim_epoch: [],
      gender: [],
      online_time: ['days_7'],
      creation_status: [],
    },
    session_id: sessionId,
    req_type: offset ? 'only_content' : 'default',
    client_req_type: 3,
  };
}

async function fetchGenre(config, { pages, deadline, request }) {
  const rows = [];
  let offset = 0, sessionId = '';
  for (let page = 1; page <= pages; page++) {
    if (Date.now() >= deadline) break;
    const signed = signedMetadataRequest(CATEGORY_API, {}, pageBody(config, offset, sessionId));
    const payload = await request(signed, deadline);
    if (!payload || typeof payload !== 'object') throw appError('App 上新返回空响应', 'APP_EMPTY');
    if (Number(payload.code ?? 0) !== 0) throw appError('App 上新服务暂不可用', 'APP_BUSINESS');
    const data = payload.data;
    if (!data || !Array.isArray(data.video_data)) throw appError('App 上新数据结构异常', 'APP_SCHEMA');
    rows.push(...data.video_data);
    if (data.has_more !== true) break;
    const next = parseSearchInteger(data.next_offset);
    // 游标必须前进，否则上游异常时会在同一页空转。
    if (next === null || next <= offset) break;
    offset = next;
    sessionId = String(data.session_id || '');
  }
  // 一页都没读到就撞上截止时间，不能当成“确实没有上新”缓存下来。
  if (!rows.length && Date.now() >= deadline) throw appError('App 上新请求超时', 'APP_TIMEOUT');
  return rows;
}

function cachedItems(pages) {
  return cache && cache.expires > Date.now() && cache.pages >= pages ? cache.items : null;
}

/**
 * 读取 App 近 7 天上新列表（真人 + AI），按线上时间倒序，最多取 pages 页。
 * 结果在进程内短暂缓存；两种剧集任一失败仍可使用另一种的结果。
 */
async function listNewReleases(options = {}) {
  const { pages = DEFAULT_PAGES, deadline = 0, request = defaultRequest, useCache = true } = options || {};
  const count = Math.max(1, Math.min(8, Number(pages) || DEFAULT_PAGES));
  const cached = useCache ? cachedItems(count) : null;
  if (cached) return { items: cached, cached: true, partial: false };
  if (inflight && inflight.pages >= count) return inflight.task;
  const budget = Number(deadline) > 0 ? deadline : Date.now() + REQUEST_TIMEOUT_MS;
  if (budget <= Date.now()) throw appError('App 上新请求超时', 'APP_TIMEOUT');
  const task = (async () => {
    const settled = await Promise.allSettled(GENRES.map(config => fetchGenre(config, { pages: count, deadline: budget, request })));
    const rows = [], failures = [];
    for (const entry of settled) {
      if (entry.status === 'fulfilled') rows.push(...entry.value);
      else failures.push(entry.reason);
    }
    const items = collectRows(rows);
    if (!items.length && failures.length) throw failures[0];
    const result = { items, cached: false, partial: failures.length > 0 };
    // 只缓存完整结果；部分失败或空列表下次搜索重新请求，避免把上游一次空响应锁住一分钟。
    if (result.partial === false && items.length) cache = { expires: Date.now() + CACHE_TTL_MS, pages: count, items };
    return result;
  })();
  inflight = { pages: count, task };
  task.finally(() => { if (inflight?.task === task) inflight = null; }).catch(() => {});
  return task;
}

/**
 * 在 App 上新列表里按标题匹配：完整标题优先，其次包含搜索词，
 * 最后支持用户多打了季数/后缀时用剧名反向匹配。
 */
function matchNewReleases(items, keyword) {
  const query = normalizeTitle(keyword);
  if (query.length < 2 || !Array.isArray(items)) return [];
  const matches = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const title = normalizeTitle(item.series_title);
    if (!title) continue;
    let score = -1;
    if (title === query) score = 0;
    else if (title.includes(query)) score = 1;
    else if (title.length >= 2 && query.includes(title)) score = 2;
    if (score >= 0) matches.push({ item, score });
  }
  return matches.sort((a, b) => a.score - b.score
    || Number(!!b.item.released_today) - Number(!!a.item.released_today))
    .map(entry => entry.item).slice(0, MAX_RESULTS);
}

async function searchNewReleasesDetailed(keyword, options = {}) {
  const list = await listNewReleases(options);
  return {
    results: matchNewReleases(list.items, keyword),
    partial: list.partial === true,
    cached: list.cached === true,
  };
}

async function searchNewReleases(keyword, options = {}) {
  return (await searchNewReleasesDetailed(keyword, options)).results;
}

function clearNewReleaseCache() {
  cache = null; inflight = null;
}

module.exports = {
  listNewReleases,
  searchNewReleases,
  searchNewReleasesDetailed,
  matchNewReleases,
  newReleaseFromRow,
  collectRows,
  normalizeTitle,
  clearNewReleaseCache,
  CACHE_TTL_MS,
  DEFAULT_PAGES,
  MAX_RESULTS,
};
