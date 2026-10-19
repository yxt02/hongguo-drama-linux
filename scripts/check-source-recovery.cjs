const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nativeDir = path.join(__dirname, '../src/native');
const media = name => `https://v3-reading.qznovelvod.com/${name}.mp4`;
const webPage = (vid = '11', sid = '1', extra = {}) => `<script>window._ROUTER_DATA=${JSON.stringify({ loaderData: {
  'player_(series_id)/(vid)/page': { isSuccess: true, vid, series_id: sid, seriesDetail: { series_id: sid, vid_list: ['11'] },
    publicVideoSeo: { available: true, itemId: vid, seriesId: sid }, ...extra },
} })}</script><script type="application/ld+json">${JSON.stringify({ '@type': 'VideoObject', url: `https://hongguoduanju.com/player/${sid}/${vid}`, contentUrl: media('web') })}</script>`;
function load(file, dependencies) {
  const context = { Buffer, URL, URLSearchParams, AbortSignal, process: { env: {} }, module: { exports: {} },
    console: { warn() {} }, setTimeout: fn => fn(),
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name.startsWith('.') ? path.join(nativeDir, name) : name) };
  vm.runInNewContext(fs.readFileSync(path.join(nativeDir, file), 'utf8'), context);
  return context.module.exports;
}
function encodedKey(hex) {
  const plain = Buffer.from(`0${hex}`), raw = Buffer.alloc(34), previous = [246, 85];
  for (let i = 0; i < plain.length; i++) {
    raw[i + 1] = ((plain[i] + 21 + (i.toString(2).split('1').length - 1)) & 255) ^ previous[i & 1];
    previous[i & 1] = raw[i + 1];
  }
  raw[0] = 48 ^ raw[1] ^ raw[2];
  return raw.toString('base64');
}
function appFixture(rows) {
  const calls = [];
  const app = load('app-source.js', { axios: async config => {
    calls.push(config);
    return { status: 200, headers: {}, data: config.method === 'POST'
      ? { data: { '11': { video_model: { fallback_api: 'https://vod.snssdk.com/info' } } } }
      : { video_info: { data: { video_list: rows } } } };
  } });
  return { ...app, calls };
}
function routeFixture() {
  const state = { web: true, app: false, calls: [] };
  const native = load('hongguo.js', {
    axios: {
      get: async url => { state.calls.push('web'); return { data: state.web && url.endsWith('/11') ? webPage() : '' }; },
      post: async () => { state.calls.push('api'); return { status: 200, headers: {}, data: Buffer.alloc(0) }; },
    },
    './app-source': { fetchAppPlayUrl: async () => { state.calls.push('app'); if (!state.app) throw new Error('secret https://signed.invalid/?token=private'); return { url: media('app'), source: 'app' }; } },
  });
  return { ...native, state };
}
const checks = [
  ['App network failures retain only safe codes and aggregate into distinct reasons', async () => {
    for (const [code, expected] of [['ECONNABORTED', 'TIMEOUT'], ['ETIMEDOUT', 'TIMEOUT'],
      ['ENOTFOUND', 'NETWORK_ERROR'], ['ECONNRESET', 'NETWORK_ERROR'], ['ERR_NETWORK', 'NETWORK_ERROR'],
      ['secret-token-code', 'NETWORK_ERROR']]) {
      const app = load('app-source.js', { axios: async () => {
        throw Object.assign(new Error('secret https://signed.invalid/?token=private'), { code, config: { secret: true } });
      } });
      await assert.rejects(app.fetchAppPlayUrl('11'), error => {
        assert.equal(error.code, code === 'secret-token-code' ? 'ERR_NETWORK' : code);
        assert.doesNotMatch(error.message + JSON.stringify(error), /secret|signed\.invalid|private/);
        return true;
      });
      const f = load('hongguo.js', { './app-source': app });
      const result = await f.fetchPlayUrlSingle('11', '1', { quality: '720p' });
      assert.equal(result.sources[0].code, expected);
      assert.doesNotMatch(JSON.stringify(result), /secret|signed\.invalid|private/);
    }
  }],
  ['App distinguishes HTTP, business refusal, absent model, parsing and unsafe media', async () => {
    const first = { data: { '11': { video_model: { fallback_api: 'https://vod.snssdk.com/info' } } } };
    const cases = [
      [{ status: 403 }, null, 'HTTP_403'],
      [{ data: { code: 8, message: 'secret' } }, null, 'BUSINESS_REJECTED'],
      [{ data: { data: {} } }, null, 'MISSING_MODEL'],
      [{ data: 'not json secret' }, null, 'INVALID_RESPONSE'],
      [{ data: { data: { '11': { video_model: 'not json secret' } } } }, null, 'INVALID_RESPONSE'],
      [{ data: first }, { code: 8, message: 'secret' }, 'BUSINESS_REJECTED'],
      [{ data: first }, { video_info: { data: { video_list: { one: { codec_type: 'h264', width: 720, height: 1280, main_url: 'https://127.0.0.1/private' } } } } }, 'SECURITY_BLOCKED'],
    ];
    for (const [response, second, expected] of cases) {
      const app = load('app-source.js', { axios: async config => ({ status: 200, headers: {},
        ...(config.method === 'POST' ? response : { data: second }) }) });
      const f = load('hongguo.js', { './app-source': app });
      const result = await f.fetchPlayUrlSingle('11', '1', { quality: '720p' });
      assert.equal(result.sources[0].code, expected);
      assert.doesNotMatch(JSON.stringify(result), /secret|127\.0\.0\.1|private/);
    }
  }],
  ['Web diagnostic keeps null compatibility and safely reports failures without automatic fallback', async () => {
    for (const [failure, expected] of [
      [Object.assign(new Error('secret URL'), { response: { status: 404 } }), 'HTTP_404'],
      [Object.assign(new Error('secret URL'), { code: 'ETIMEDOUT' }), 'TIMEOUT'],
      [Object.assign(new Error('secret URL'), { code: 'ERR_WEB_MEDIA_ADDRESS' }), 'SECURITY_BLOCKED'],
      [webPage().replace(media('web'), 'https://127.0.0.1/private'), 'SECURITY_BLOCKED'],
      ['', 'MISSING_MODEL'],
    ]) {
      const f = load('hongguo.js', {
        axios: { get: async () => { if (typeof failure !== 'string') throw failure; return { data: failure }; } },
        './app-source': { fetchAppPlayUrl: async () => { throw new Error('unavailable'); } },
      });
      let reported;
      assert.equal(await f.fetchPlayUrlFromWeb('11', '1', error => { reported = error; }), null);
      assert.ok(reported);
      const result = await f.fetchPlayUrlSingle('11', '1', { force: true });
      assert.deepEqual(Array.from(result.sources, item => item.source), ['app']);
      assert.doesNotMatch(JSON.stringify(result), /secret|127\.0\.0\.1|private/);
      // Diagnostic web errors still preserve useful categories for an explicit caller.
      const code = reported.code || (reported.response?.status ? 'HTTP_' + reported.response.status : 'MISSING_MODEL');
      assert.equal(['SECURITY_BLOCKED', 'ERR_WEB_MEDIA_ADDRESS'].includes(code) ? 'SECURITY_BLOCKED' : code === 'ETIMEDOUT' ? 'TIMEOUT' : code, expected);
    }
  }],
  ['Default playback has no Web/legacy lookup delay and requests App highest quality', async () => {
    const calls = [];
    let available = true;
    const f = load('hongguo.js', {
      axios: { get: async () => { calls.push('web'); return { data: webPage() }; },
        post: async () => { calls.push('api'); throw new Error('must not request legacy playback'); } },
      './app-source': { fetchAppPlayUrl: async (_vid, options) => {
        calls.push({ quality: options.quality, preferQuality: options.preferQuality });
        if (!available) throw new Error('App 片源请求超时');
        return { url: media('app'), source: 'app' };
      } },
    });
    assert.equal((await f.fetchPlayUrlSingle('11', '1')).source, 'app');
    assert.deepEqual(calls, [{ quality: 'auto', preferQuality: true }]);
    available = false; calls.length = 0;
    assert.equal((await f.fetchPlayUrlSingle('11', '1', { force: true })).code, 'SOURCE_UNAVAILABLE');
    assert.deepEqual(calls, [{ quality: 'auto', preferQuality: true }]);
    assert.equal((await f.fetchEpisodeListFromWeb('1')).series_id, '1');
    assert.equal(calls.at(-1), 'web', 'catalog metadata remains separate from playback routing');
  }],
  ['Web rejects wrong or missing current episode identity even when vid_list contains the request', async () => {
    for (const data of [
      { vid: '10', seriesDetail: { series_id: '1', vid_list: ['10', '11'] } },
      { seriesDetail: { series_id: '1', vid_list: ['11'] } },
      { vid: '11', seriesDetail: { series_id: '2', vid_list: ['11'] } },
      { vid: '11' },
    ]) {
      const html = `window._ROUTER_DATA=${JSON.stringify({ loaderData: { player: data }, recommendation: { main_url: media('wrong') } })}`;
      const f = load('hongguo.js', { axios: { get: async () => ({ data: html }) } });
      assert.equal(await f.fetchPlayUrlFromWeb('11', '1'), null, 'unverified webpage must not be labelled as the requested episode');
    }
  }],
  ['Web accepts only an identity-bound VideoObject and ignores earlier recommended media', async () => {
    const unrelated = `<script type="application/ld+json">${JSON.stringify({ '@type': 'VideoObject', url: 'https://hongguoduanju.com/player/2/22', contentUrl: media('recommendation') })}</script>`;
    let html = unrelated + webPage();
    const f = load('hongguo.js', { axios: { get: async () => ({ data: html }) } });
    assert.equal((await f.fetchPlayUrlFromWeb('11', '1')).url, media('web'));
    for (const bad of [webPage('10'), webPage('11', '2'), webPage('11', '1', { vid: undefined }),
      webPage('11', '1', { publicVideoSeo: { available: true, itemId: '10', seriesId: '1' } }),
      webPage().replace('/player/1/11', '/player/1/10'), webPage().replace('https://hongguoduanju.com/player/', 'https://other.invalid/player/')]) {
      html = bad; assert.equal(await f.fetchPlayUrlFromWeb('11', '1'), null);
    }
  }],
  ['App preserves safe alternates and binds keys and request identity to each candidate', async () => {
    const key1 = '01'.repeat(16), key2 = '02'.repeat(16);
    const f = appFixture({ first: { main_url: media('main'), backup_url: media('backup'), backup_url_list: [media('extra'), media('backup'), 'https://127.0.0.1/private'], codec_type: 'h264', width: 1080, height: 1920, spade_a: encodedKey(key1) },
      second: { main_url: media('hevc'), codec_type: 'hevc', width: 1080, height: 1920, spade_a: encodedKey(key2) },
      listOnly: { backup_url_list: [media('list')], codec_type: 'hevc', width: 1080, height: 1920 } });
    const result = await f.fetchAppPlayUrl('11');
    assert.ok(Array.isArray(result.variants), 'media candidates must survive address lookup');
    assert.deepEqual(Array.from(result.variants, v => v.url), ['main', 'backup', 'extra', 'hevc', 'list'].map(media));
    for (const candidate of result.variants) {
      assert.equal(candidate.source, 'app'); assert.equal(candidate.vid, '11');
      assert.equal(candidate.userAgent, f.calls[0].headers['User-Agent']);
      assert.equal(candidate.referer, undefined);
      assert.equal(candidate.omitReferer, true);
      assert.equal(candidate.variants, undefined);
    }
    assert.equal(result.variants[2].contentKey, key1); assert.equal(result.variants[3].contentKey, key2);
    assert.equal(result.variants[4].contentKey, null); assert.equal(f.calls.length, 2, 'no media preflight');
  }],
  ['Strict quality alternatives never include smaller or unknown-size streams', async () => {
    const f = appFixture({ low: { main_url: media('low'), codec_type: 'h264', width: 720, height: 1280 },
      unknown: { main_url: media('unknown'), codec_type: 'h264' },
      high: { main_url: media('high'), backup_url_list: [media('high2')], codec_type: 'hevc', width: 1080, height: 1920 } });
    const result = await f.fetchAppPlayUrl('11', { quality: '1080p' });
    assert.ok(result.variants, 'strict-quality candidate list missing');
    assert.deepEqual(Array.from(result.variants, v => v.url), ['high', 'high2'].map(media));
    assert.ok(result.variants.every(v => v.width === 1080 && v.quality === '1080p'));
  }],
  ['App unavailable never falls back to an otherwise working website; retry can recover', async () => {
    const f = routeFixture();
    const failed = await f.fetchPlayUrlSingle('11', '1');
    assert.equal(failed.url, null); assert.equal(failed.code, 'SOURCE_UNAVAILABLE');
    assert.deepEqual(f.state.calls, ['app']);
    f.state.app = true; f.state.calls.length = 0;
    assert.equal((await f.fetchPlayUrlSingle('11', '1')).source, 'app');
    assert.deepEqual(f.state.calls, ['app']);
  }],
  ['Unavailable source reports safe per-route reasons without declaring web metadata a global block', async () => {
    const f = routeFixture(); f.state.web = false;
    const unavailable = await f.fetchPlayUrlSingle('11', '1');
    assert.equal(unavailable.code, 'SOURCE_UNAVAILABLE');
    assert.deepEqual(Array.from(unavailable.sources, item => item.source), ['app']);
    assert.doesNotMatch(JSON.stringify(unavailable), /secret|signed\.invalid|private|前.*集|付费|会员/);
    assert.ok(unavailable.sources.every(item => item.code && item.message));
    f.state.app = true;
    assert.equal((await f.fetchPlayUrlSingle('11', '1')).source, 'app', 'failures must not be cached');
  }],
];
(async () => {
  let failed = 0;
  for (const [name, run] of checks) { try { await run(); console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); } }
  console.log(`${checks.length - failed}/${checks.length} source recovery checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
