const assert = require('node:assert/strict');
const test = require('node:test');
const {
  listNewReleases, searchNewReleases, searchNewReleasesDetailed, matchNewReleases, newReleaseFromRow, collectRows,
  clearNewReleaseCache, DEFAULT_PAGES, MAX_RESULTS,
} = require('./hongguo-app-new');

const row = (id, title, extra = {}) => ({
  series_id: id, title, content_type: 1, episode_cnt: 24,
  cover: 'https://p3-reading-sign.fqnovelpic.com/novel-pic/abc~tplv-81nmtwyey9-superreso-aifit:400:0.heic?lk3s=1',
  video_desc: '短剧简介', tag_info: { text: '新剧' },
  sub_title_list: [{ content: '今日上新' }, { content: '都市' }],
  ...extra,
});

const page = (rows, more = false, next = rows.length, session = 'session-1') => ({
  code: 0,
  data: { video_data: rows, has_more: more, next_offset: next, session_id: session },
});

test('new-release rows keep today flag, tags and a compatible cover', () => {
  const item = newReleaseFromRow(row('7700000000000000001', '<b>当天</b>新剧'));
  assert.equal(item.series_id, '7700000000000000001');
  assert.equal(item.series_title, '当天新剧');
  assert.equal(item.released_today, true);
  assert.equal(item.new_release, true);
  assert.equal(item.episode_count, 24);
  assert.deepEqual(item.tags, ['都市']);
  assert.equal(item.cover, 'https://p3-novel.byteimg.com/novel-pic/abc~tplv-shrink:640:0.image');
  assert.equal(newReleaseFromRow({ title: '缺编号' }), null);
  assert.equal(newReleaseFromRow({ series_id: '1', title: '  ' }), null);
});

test('duplicate ids from real and AI lists merge without losing today', () => {
  const items = collectRows([
    row('1', '同一部剧', { sub_title_list: [{ content: '新剧' }] }),
    row('1', '同一部剧', { description: '另一份简介' }),
    row('2', '另一部'),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].released_today, true);
  assert.equal(items[0].description, '短剧简介');
});

test('new-release matching tolerates punctuation and partial season titles', () => {
  const items = [
    null,
    'not-a-row',
    newReleaseFromRow(row('1', '言出法随，诸天万界')),
    newReleaseFromRow(row('2', '西北往事之我与我家第一季')),
    newReleaseFromRow(row('3', '闪婚')),
    newReleaseFromRow(row('4', '无关剧名')),
  ];
  assert.deepEqual(matchNewReleases(items, '言出法随 诸天万界').map(item => item.series_id), ['1']);
  assert.deepEqual(matchNewReleases(items, '西北往事之我与我家').map(item => item.series_id), ['2']);
  assert.deepEqual(matchNewReleases(items, '我想看闪婚').map(item => item.series_id), ['3']);
  assert.deepEqual(matchNewReleases(items, '闪'), []);
  assert.deepEqual(matchNewReleases(items, '完全不存在的剧'), []);
});

test('today releases rank before older new releases with the same title score', () => {
  const items = [
    newReleaseFromRow(row('1', '重生第一季', { sub_title_list: [{ content: '都市' }] })),
    newReleaseFromRow(row('2', '重生第一季', { sub_title_list: [{ content: '今日上新' }] })),
  ];
  assert.deepEqual(matchNewReleases(items, '重生第一季').map(item => item.series_id), ['2', '1']);
});

test('both genres page through the App list, cache the full result and stay queryable', async () => {
  clearNewReleaseCache();
  const calls = [];
  const request = async (signed) => {
    const body = JSON.parse(signed.body.toString());
    const genre = body.select_items.genre[0];
    calls.push({ genre, offset: body.offset, session: body.session_id, sort: body.select_items.sort, days: body.select_items.online_time });
    if (genre === 'short_play') {
      return body.offset === 0 ? page([row('1', '今日新剧')], true, 50, 's1') : page([row('2', '昨日新剧')], false, 0, 's1');
    }
    return page([row('3', 'AI 新剧')], false, 0, 's2');
  };
  const first = await listNewReleases({ pages: 2, request });
  assert.equal(first.cached, false);
  assert.equal(first.partial, false);
  assert.deepEqual(first.items.map(item => item.series_id).sort(), ['1', '2', '3']);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.sort[0] === 'online_time' && call.days[0] === 'days_7'));
  assert.ok(calls.some(call => call.genre === 'short_play' && call.offset === 50 && call.session === 's1'));

  const cached = await listNewReleases({ pages: 2, request: async () => { throw new Error('must not refetch'); } });
  assert.equal(cached.cached, true);
  assert.equal(cached.items.length, 3);

  const matched = await searchNewReleases('今日新剧', { request: async () => { throw new Error('must use cache'); } });
  assert.deepEqual(matched.map(item => item.series_id), ['1']);
  clearNewReleaseCache();
});

test('one unavailable genre still returns the other and is not cached as complete', async () => {
  clearNewReleaseCache();
  const request = async (signed) => {
    const body = JSON.parse(signed.body.toString());
    if (body.select_items.genre[0] === 'short_play') return page([row('1', '真实新剧')], false);
    throw new Error('AI 目录超时');
  };
  const result = await listNewReleases({ pages: 1, request });
  assert.equal(result.partial, true);
  assert.deepEqual(result.items.map(item => item.series_id), ['1']);
  const second = await listNewReleases({ pages: 1, request: async (signed) => {
    const body = JSON.parse(signed.body.toString());
    return body.select_items.genre[0] === 'short_play'
      ? page([row('1', '真实新剧')], false)
      : page([row('2', 'AI 新剧')], false);
  } });
  assert.equal(second.partial, false);
  assert.equal(second.items.length, 2);
  clearNewReleaseCache();
});

test('detailed search preserves a partial catalog result', async () => {
  clearNewReleaseCache();
  const request = async (signed) => {
    const body = JSON.parse(signed.body.toString());
    if (body.select_items.genre[0] === 'short_play') return page([row('7500000000000000001', '部分新剧')], false);
    throw new Error('AI 目录超时');
  };
  const result = await searchNewReleasesDetailed('部分新剧', { pages: 1, request });
  assert.equal(result.partial, true);
  assert.deepEqual(result.results.map(item => item.series_id), ['7500000000000000001']);
  clearNewReleaseCache();
});

test('a past deadline fails before requesting', async () => {
  clearNewReleaseCache();
  await assert.rejects(listNewReleases({ deadline: Date.now() - 1 }), error => error.code === 'APP_TIMEOUT');
});

test('default search walks two pages per genre and finds a second-page today release', async () => {
  clearNewReleaseCache();
  const calls = [];
  const request = async (signed) => {
    const body = JSON.parse(signed.body.toString());
    const genre = body.select_items.genre[0];
    calls.push({ genre, offset: body.offset });
    if (genre === 'short_play') {
      return body.offset === 0
        ? page([row('7100000000000000001', '第一页旧剧')], true, 50, 'today-session')
        : page([row('7100000000000000002', '目标今日新剧')], false, 0, 'today-session');
    }
    return body.offset === 0
      ? page([row('7200000000000000001', 'AI 第一页')], true, 50, 'ai-session')
      : page([row('7200000000000000002', 'AI 第二页')], false, 0, 'ai-session');
  };
  const matched = await searchNewReleases('目标今日新剧', { request });
  assert.equal(DEFAULT_PAGES, 2);
  assert.equal(MAX_RESULTS, 20);
  assert.deepEqual(matched.map(item => item.series_id), ['7100000000000000002']);
  for (const genre of ['short_play', 'ai_series']) {
    assert.deepEqual(calls.filter(call => call.genre === genre).map(call => call.offset), [0, 50],
      genre + ' must query both the first and second page by default');
  }
  clearNewReleaseCache();
});

test('one-page cache does not satisfy a later two-page search', async () => {
  clearNewReleaseCache();
  let calls = 0;
  const shallow = async (signed) => {
    calls += 1;
    const body = JSON.parse(signed.body.toString());
    return page([row(body.select_items.genre[0] === 'short_play' ? '7300000000000000001' : '7300000000000000002', '第一页')], true, 50);
  };
  const first = await listNewReleases({ pages: 1, request: shallow });
  assert.equal(first.items.length, 2);
  assert.equal(calls, 2);
  const deepCalls = [];
  const deep = async (signed) => {
    const body = JSON.parse(signed.body.toString());
    deepCalls.push({ genre: body.select_items.genre[0], offset: body.offset });
    return body.offset === 0
      ? page([row('7400000000000000001', '深页第一页')], true, 50)
      : page([row('7400000000000000002', '深页第二页')], false, 0);
  };
  const second = await listNewReleases({ pages: 2, request: deep });
  assert.equal(deepCalls.length, 4, 'a two-page request must not be served by a one-page cache');
  assert.deepEqual(second.items.map(item => item.series_id).sort(), ['7400000000000000001', '7400000000000000002']);
  clearNewReleaseCache();
});
