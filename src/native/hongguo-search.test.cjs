'use strict';
// 官网搜索接口解析、重试与缓存；全部离线，不访问真实站点。
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  searchHongguo,
  parseSearchResponse,
  classifyRequestError,
  clearSearchCache,
  HongguoSearchError,
} = require('./hongguo-search');

const payload = {
  searchList: [
    { doc_type: 23, name: '甲剧', video_data: { series_id: '1234567', series_title: '甲剧', series_cover: 'https:\\/\\/img.example\\/a.jpg', episode_cnt: 20, tags: [{ name: '玄幻' }, '穿越'] } },
    { doc_type: 23, video_data: { series_id: '1234567', series_title: '重复条目' } },
    { doc_type: 23, video_data: { series_id: '7654321', series_name: '乙剧', episode_right_text: '全88集', category_list: ['都市'] } },
    { doc_type: 24, video_data: {} },
  ],
  totalCount: '2',
  pageNum: '1',
  totalPages: '1',
  hasMore: false,
};

test('search payload maps to app results, cleans covers and drops duplicates', () => {
  const parsed = parseSearchResponse(payload);
  assert.equal(parsed.results.length, 2);
  assert.deepEqual(parsed.results[0], {
    series_id: '1234567',
    series_title: '甲剧',
    cover: 'https://img.example/a.jpg',
    episode_count: 20,
    tags: ['玄幻', '穿越'],
    description: '',
    url: 'https://hongguoduanju.com/detail?series_id=1234567',
  });
  assert.equal(parsed.results[1].episode_count, 88);
  assert.deepEqual(parsed.results[1].tags, ['都市']);
  assert.equal(parsed.total, 2);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.hasMore, false);
});

test('empty video_data falls back to the item keyword id and name', () => {
  const parsed = parseSearchResponse({
    searchList: [
      { doc_type: 23, name: '谁说纨绔不能当状元', keyword: '7673067074104593432', video_data: {}, user_info: {}, video_list: [] },
    ],
  });
  assert.equal(parsed.results[0].series_id, '7673067074104593432');
  assert.equal(parsed.results[0].series_title, '谁说纨绔不能当状元');
  assert.equal(parsed.results[0].cover, '');
});

test('unsafe covers are dropped and HTML entities are decoded', () => {
  const parsed = parseSearchResponse({
    searchList: [
      { video_data: { series_id: '1111111', series_title: '甲 &amp; 乙', series_cover: 'javascript:alert(1)' } },
      { video_data: { series_id: '2222222', series_title: '丙', series_cover: 'http://img.example/c.png' } },
    ],
  });
  assert.equal(parsed.results[0].series_title, '甲 & 乙');
  assert.equal(parsed.results[0].cover, '');
  assert.equal(parsed.results[1].cover, 'http://img.example/c.png');
});

test('missing searchList is a format error so the caller can fall back to page sniffing', () => {
  assert.throws(() => parseSearchResponse({}), (error) => error instanceof HongguoSearchError && error.kind === 'format' && error.fallback === true);
  assert.throws(() => parseSearchResponse({ searchList: null }), (error) => error.kind === 'format' && error.fallback === true);
  assert.throws(() => parseSearchResponse(null), (error) => error.kind === 'upstream');
  assert.throws(() => parseSearchResponse(''), (error) => error.kind === 'upstream');
  assert.throws(() => parseSearchResponse('<html>challenge</html>'), (error) => error.kind === 'upstream');
});

test('an error code with an empty list stays an error and is not cached as an empty success', async () => {
  clearSearchCache();
  let calls = 0;
  const request = async () => { calls++; return { code: 'upstream_unavailable', message: 'Search is temporarily unavailable.', searchList: [] }; };
  await assert.rejects(searchHongguo('错误码空列表', { request, cache: true, retries: 1 }), /暂不可用/);
  assert.equal(calls, 2, 'service errors are retryable');
  await assert.rejects(searchHongguo('错误码空列表', { request, cache: true, retries: 0 }), /暂不可用/);
  assert.equal(calls, 3, 'the error must not be served from cache');
});

test('a non-empty list without recognizable video entries is a format error, not an empty result', () => {
  assert.throws(
    () => parseSearchResponse({ searchList: [{ doc_type: 99, name: '无法识别的条目' }] }),
    (error) => error instanceof HongguoSearchError && error.kind === 'format' && error.fallback === true,
  );
});

test('request errors are classified for retry and fallback decisions', () => {
  assert.equal(classifyRequestError({ code: 'ECONNABORTED' }).kind, 'timeout');
  assert.equal(classifyRequestError({ response: { status: 408 } }).kind, 'timeout');
  assert.equal(classifyRequestError({ response: { status: 429 } }).kind, 'upstream');
  assert.equal(classifyRequestError({ response: { status: 502 } }).kind, 'upstream');
  const changed = classifyRequestError({ response: { status: 404 } });
  assert.equal(changed.kind, 'format');
  assert.equal(changed.fallback, true);
  assert.match(classifyRequestError({ response: { status: 403 } }).message, /接口已变化/);
});

test('a transient failure is retried once and then succeeds', async () => {
  clearSearchCache();
  let calls = 0;
  const request = async () => {
    calls++;
    if (calls === 1) throw new Error('temporary');
    return payload;
  };
  const result = await searchHongguo('甲剧', { request, retries: 1, cache: false, timeout: 1000 });
  assert.equal(calls, 2);
  assert.equal(result.results.length, 2);
});

test('format errors are not retried because another attempt cannot fix the shape', async () => {
  clearSearchCache();
  let calls = 0;
  const request = async () => { calls++; throw new HongguoSearchError('接口已变化', 'format', { fallback: true }); };
  await assert.rejects(searchHongguo('甲剧', { request, retries: 2, cache: false }), /接口已变化/);
  assert.equal(calls, 1);
});

test('successful lookups are cached briefly', async () => {
  clearSearchCache();
  let calls = 0;
  const request = async () => { calls++; return payload; };
  await searchHongguo('缓存测试', { request, cache: true });
  const second = await searchHongguo('缓存测试', { request, cache: true });
  assert.equal(calls, 1);
  assert.equal(second.results.length, 2);
});

test('an expired total deadline rejects without starting another request', async () => {
  let calls = 0;
  await assert.rejects(searchHongguo('超时测试', { deadline: Date.now() - 1, request: async () => { calls++; return payload; } }), /搜索超时/);
  assert.equal(calls, 0);
});

test('empty keywords are rejected without a request', async () => {
  let calls = 0;
  await assert.rejects(searchHongguo('   ', { request: async () => { calls++; } }), /搜索词/);
  assert.equal(calls, 0);
});
