const { signedMetadataRequest, parseSearchInteger, requestJson } = require('./app-source');
const { cleanTitle, appCover } = require('./hongguo-app-search');

const SITE = 'https://hongguoduanju.com';
const CATEGORY_API = '/reading/distribution/category/landpage/v/';
const RANK_API = '/reading/bookapi/bookmall/cell/change/v';
const CATEGORIES = { 'real-drama': ['default', 'short_play'], 'comic-drama': ['comic_series', 'comic_series'], 'ai-drama': ['ai_series', 'ai_series'] };
const RANKS = { 'hot-drama': ['all', 'ranklist_hot_play_sc'], 'hot-real-drama': ['human', 'human_hot_play'],
  'hot-comic-drama': ['comic_series_rank', 'comic_series_hot_play'], 'hot-ai-drama': ['ai_playlet', 'ai_playlet_hot_play'] };
const TIMEOUT_MS = 4000, CACHE_MS = 120000, MAX_SESSIONS = 32, MAX_PAGES = 8;
const sessions = new Map();
const appError = (message, code = 'APP_SCHEMA') => Object.assign(new Error(message), { code });
const fail = (error, sourceUrl) => ({ success: false, error: `${error.message}，可重试或切换官网`, code: error.code || 'APP_NETWORK', sourceUrl });

function discard(key, state) {
  for (const request of state.pending.values()) request.controller.abort();
  sessions.delete(key);
}

function catalogCover(value) {
  const compatible = appCover(value);
  try {
    const url = new URL(value);
    if (!/\.heic$/i.test(url.pathname)) return compatible;
    if (!['http:', 'https:'].includes(url.protocol) || !/(^|\.)(fqnovelpic\.com|byteimg\.com)$/i.test(url.hostname) ||
        !url.pathname.startsWith('/novel-pic/') || !url.pathname.includes('~')) return '';
    // Verified public JPEG object variant (aston314/hongguo-tv); do not reuse HEIC signatures.
    return `https://p3-novel.byteimg.com${url.pathname.split('~', 1)[0]}~tplv-shrink:640:0.image`;
  } catch (_) { return compatible; }
}

function cards(rows, contentTypes) {
  const seen = new Set();
  return rows.flatMap(video => {
    const rawId = video?.series_id;
    if (typeof rawId === 'number' && !Number.isSafeInteger(rawId)) return [];
    const id = String(rawId || ''), title = cleanTitle(video?.title || video?.series_title || video?.series_name);
    if (!/^\d{1,30}$/.test(id) || !title || seen.has(id) || !contentTypes.includes(Number(video.content_type))) return [];
    seen.add(id);
    const tags = Array.isArray(video.sub_title_list) ? video.sub_title_list.map(item => cleanTitle(item?.content)).filter(Boolean).slice(0, 4) : [];
    return [{ series_id: id, series_title: title, cover: catalogCover(video.cover), episode_count: parseSearchInteger(video.episode_cnt) || 0,
      description: cleanTitle(video.video_desc || video.series_intro), tags, completion_status: 'unknown',
      source: 'hongguo', url: `${SITE}/detail?series_id=${id}` }];
  });
}

function parsePage(payload, category, genre, page, cursor, state, sourceUrl) {
  if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'code')) throw appError('App 目录返回异常数据');
  if (Number(payload.code) !== 0) throw appError('App 目录服务暂不可用', 'APP_BUSINESS');
  const data = payload.data;
  if (!data || typeof data !== 'object') throw appError('App 目录缺少列表数据');
  const ranking = RANKS[category], view = data.cell_view;
  let rows, genres = state.genres;
  if (ranking) {
    if (!Array.isArray(view?.cell_data)) throw appError('App 榜单结构异常');
    const selected = view.cell_selector?.outer_row?.items?.find(item => item.is_selected === true);
    const child = selected?.sub_cell_selector?.outer_row?.items?.find(item => item.is_selected === true);
    if (selected && (selected.selector_item_id !== ranking[0] || child?.selector_item_id !== ranking[1])) throw appError('App 返回了其他榜单');
    rows = view.cell_data.flatMap(cell => Array.isArray(cell?.video_data) ? cell.video_data : cell?.video_data ? [cell.video_data] : []);
    if (!rows.length && view.cell_data.some(cell => cell?.ugc_user_data?.length)) throw appError('App 返回了演员榜，未作为短剧展示');
  } else {
    if (!Array.isArray(data.video_data)) throw appError('App 分类结构异常');
    rows = data.video_data;
    if (Array.isArray(data.selector_rows) && (page === 1 || data.selector_rows.length)) {
      const themes = data.selector_rows.find(row => row?.type === 'category_dim_theme');
      const seen = new Set();
      genres = (Array.isArray(themes?.items) ? themes.items : []).flatMap(item => {
        const slug = String(item?.selector_item_id || ''), label = cleanTitle(item?.show_name);
        if (!/^cate_\d{1,8}$/.test(slug) || !label || seen.has(slug)) return [];
        seen.add(slug); return [{ slug, label }];
      });
      if (genre && !genres.some(item => item.slug === genre)) throw appError('App 题材已变化，请重新加载分类', 'APP_INPUT');
    }
  }
  const liveAction = category === 'real-drama' || category === 'hot-real-drama';
  const results = cards(rows, category === 'hot-drama' ? [1, 1004] : liveAction ? [1] : [1004]);
  if (rows.length && !results.length) throw appError('App 目录未返回有效短剧');
  const more = (data.has_more ?? view?.has_more) === true;
  const offset = parseSearchInteger(data.next_offset ?? view?.next_offset);
  const sessionId = data.session_id ?? view?.session_id;
  if (more && (offset === null || offset <= cursor.offset || typeof sessionId !== 'string' || !sessionId || sessionId.length > 4096)) {
    throw appError('App 分页游标无效，请重新加载第 1 页', 'APP_CURSOR');
  }
  return { response: { success: true, results, page, total: 0, totalPages: 0, hasMore: more && page < 50, genres, sourceUrl },
    next: more && page < 50 ? { offset, sessionId } : null };
}

async function browseList(options = {}) {
  const { category = 'real-drama', genre = '', page = 1, forceRefresh = false, catalogScope = 'default' } = options || {};
  const pg = parseSearchInteger(page), ranking = RANKS[category];
  const sourceUrl = `${SITE}/${ranking ? 'rank' : 'category'}/${encodeURIComponent(category)}${pg > 1 ? `?page=${pg}` : ''}`;
  if ((!Object.hasOwn(CATEGORIES, category) && !Object.hasOwn(RANKS, category) && category !== 'comic') ||
      !['default', 'browse'].includes(catalogScope) || typeof genre !== 'string' || (genre && (!/^cate_\d{1,8}$/.test(genre) || ranking)) || pg === null || pg < 1 || pg > 50) {
    return fail(appError('App 分类、题材或页码无效', 'APP_INPUT'), sourceUrl);
  }
  if (category === 'comic') return { success: true, results: [], page: 1, total: 0, totalPages: 0, hasMore: false, genres: [], sourceUrl,
    unsupported: true, emptyMessage: '漫画属于图文阅读，暂不支持视频播放或下载；请切换「漫剧」或打开官网阅读。' };
  // Recommendation refreshes must not invalidate the discovery page's cursor chain.
  const key = `${catalogScope}\0${category}\0${genre}`;
  let state = sessions.get(key);
  if (state && (state.expires <= Date.now() || (forceRefresh && pg === 1 && !state.pending.get(1)?.forceRefresh))) {
    discard(key, state); state = null;
  }
  if (!state) {
    if (pg !== 1) return fail(appError('App 分页记录已失效，请重新加载第 1 页', 'APP_CURSOR'), sourceUrl);
    state = { expires: Date.now() + CACHE_MS, genres: [], pages: new Map(), cursors: new Map([[1, { offset: 0, sessionId: '' }]]), pending: new Map() };
    sessions.set(key, state);
    if (sessions.size > MAX_SESSIONS) { const oldest = sessions.keys().next().value; discard(oldest, sessions.get(oldest)); }
  }
  if (state.pending.has(pg)) return state.pending.get(pg).promise;
  if (!forceRefresh && state.pages.has(pg)) return state.pages.get(pg);
  const cursor = state.cursors.get(pg);
  if (!cursor) return fail(appError('App 尚无这一页的游标，请逐页浏览或重新加载第 1 页', 'APP_CURSOR'), sourceUrl);
  if (forceRefresh) {
    for (const cachedPage of state.pages.keys()) if (cachedPage >= pg) state.pages.delete(cachedPage);
    for (const cursorPage of state.cursors.keys()) if (cursorPage > pg) state.cursors.delete(cursorPage);
    for (const [pendingPage, request] of state.pending) if (pendingPage > pg) {
      state.pending.delete(pendingPage); request.controller.abort();
    }
  }
  const controller = new AbortController(), deadline = Date.now() + TIMEOUT_MS;
  let timer, abort;
  const timeout = new Promise((_, reject) => {
    abort = () => reject(appError('App 目录请求已取消', 'APP_CANCELLED'));
    controller.signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { reject(appError('App 目录加载超时', 'APP_TIMEOUT')); controller.abort(); }, TIMEOUT_MS);
  });
  const task = Promise.resolve().then(async () => {
    if (controller.signal.aborted) throw appError('App 目录请求已取消', 'APP_CANCELLED');
    let values = {}, body = null;
    if (ranking) {
      values = { tab_type: pg === 1 ? '26' : '18', client_req_type: '2', client_template: '2', background_selected_items: '',
        category_id: '0', limit: '20', cell_sub_id: '0', gender: '2', cell_id: '7470092475068071998', selected_items: ranking[0],
        sub_selected_items: ranking[1], panel_selected_items: '', offset: String(cursor.offset), session_id: cursor.sessionId, filter_ids: '', unlimited_selector_change_type: '0' };
    } else {
      body = { filter_ids: '', req_scene: CATEGORIES[category][0], offset: cursor.offset, need_selector_panel: pg === 1, limit: 15,
        select_items: { genre: [CATEGORIES[category][1]], sort: ['hot_score'], category_dim_theme: genre ? [genre] : [],
          category_dim_role: [], category_dim_epoch: [], gender: [], online_time: [], creation_status: [] },
        session_id: cursor.sessionId, req_type: pg === 1 ? 'default' : 'only_content', client_req_type: 3 };
    }
    const signed = signedMetadataRequest(ranking ? RANK_API : CATEGORY_API, values, body);
    const payload = await requestJson(signed.url, { method: ranking ? 'GET' : 'POST', headers: signed.headers, data: signed.body }, deadline, controller.signal);
    const parsed = parsePage(payload, category, genre, pg, cursor, state, sourceUrl);
    if (sessions.get(key) === state && !controller.signal.aborted) {
      state.genres = parsed.response.genres;
      state.pages.set(pg, parsed.response);
      if (state.pages.size > MAX_PAGES) state.pages.delete([...state.pages.keys()].find(cachedPage => cachedPage !== 1));
      if (parsed.next) state.cursors.set(pg + 1, parsed.next);
      else state.cursors.delete(pg + 1);
    }
    return parsed.response;
  });
  const promise = Promise.race([task, timeout]).catch(error => fail(error.code?.startsWith('APP_') ? error
    : appError(/TIMEOUT|ETIMEDOUT|ECONNABORTED/.test(error.code || '') ? 'App 目录加载超时' : 'App 目录网络请求失败',
      /TIMEOUT|ETIMEDOUT|ECONNABORTED/.test(error.code || '') ? 'APP_TIMEOUT' : 'APP_NETWORK'), sourceUrl))
    .finally(() => {
      clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
      if (state.pending.get(pg)?.promise === promise) state.pending.delete(pg);
    });
  state.pending.set(pg, { promise, controller, forceRefresh });
  return promise;
}

module.exports = { browseList, catalogCover };
