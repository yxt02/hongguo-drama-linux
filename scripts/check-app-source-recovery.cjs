// Offline App playback-source checks: empty 200 responses and automatic quality locking.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(__dirname, '../src/native/app-source.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const vid = '7700946421087751193';

function load(axios, { realDevice = false, playbackDevice, now } = {}) {
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(name) {
      if (name === 'node:crypto') return crypto;
      if (name === './sm3') return require('../src/native/sm3');
      if (name === './download-quality') return require('../src/native/download-quality');
      if (name === './playback-device') return playbackDevice ? playbackDevice : realDevice ? require('../src/native/playback-device')
        : { getPlaybackDevice: async () => ({ device_id: '1000000000000001', iid: '1000000000000002', cdid: 'fixture' }) };
      if (name === 'axios') return axios;
      return require(name);
    },
    Date: class extends Date { static now() { return now ? now() : Date.now(); } },
    Buffer,
    URL,
    AbortSignal,
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(source, context, { filename: sourcePath });
  return module.exports;
}

function modelResponse(rows) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({
      code: 0,
      data: {
        [vid]: {
          video_model: {
            fallback_api: 'https://api5-normal-sinfonlineb.fqnovel.com/fallback',
          },
        },
      },
    }),
  };
}

function fallbackResponse(rows) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({ code: 0, video_info: { data: { video_list: rows } } }),
  };
}

function row(definition, width, height, suffix) {
  return {
    codec_type: 'h264',
    quality_desc: definition,
    video_meta: { codec_type: 'h264', definition, vwidth: width, vheight: height },
    main_url: `https://qznovelvod.com/${suffix}.mp4`,
    backup_url: `https://fqnovelvod.com/${suffix}-backup.mp4`,
  };
}

(async () => {
  const empty = await load(async () => ({
    status: 200,
    headers: { 'content-type': 'application/json', 'x-tt-logid': 'empty-log' },
    data: '',
  })).fetchAppPlayUrl(vid, { quality: 'auto' }).then(
    () => { throw new Error('empty 200 response must fail'); },
    error => error,
  );
  assert.equal(empty.code, 'EMPTY_RESPONSE');
  assert.match(empty.message, /空响应/);

  let call = 0;
  const api = load(async () => {
    call += 1;
    return call === 1
      ? modelResponse()
      : fallbackResponse([row('1080p', 1080, 1920, 'best'), row('720p', 720, 1280, 'lower')]);
  });
  const selected = await api.fetchAppPlayUrl(vid, { quality: 'auto' });
  assert.equal(selected.quality, '1080p');
  assert.equal(selected.variants.length, 2, 'main and backup URLs for the best rendition only');
  assert.ok(selected.variants.every(item => item.url.includes('best')), 'auto must not silently fall through to 720p');

  const inlineResponse = (rows, id = vid) => ({ status: 200, headers: {}, data: JSON.stringify({ code: 0,
    data: { [id]: { video_model: { video_list: rows, fallback_api: 'https://vod.snssdk.com/must-not-fetch' } } } }) });
  const plain = { ...row('1080p', 1080, 1920, 'inline'), encrypt_info: { encrypt: false } };
  const identities = [{ device_id: '11', iid: '12', cdid: 'fixture' }, { device_id: '21', iid: '22', cdid: 'fixture' }];
  let recoverCalls = 0, renewals = 0;
  const recovery = load(async config => {
    recoverCalls++;
    if (new URL(config.url).searchParams.get('device_id') === '11') return { status: 200, headers: {}, data: '' };
    return inlineResponse([plain]);
  }, { playbackDevice: { getPlaybackDevice: async (_request, rejected) => {
    if (rejected) { assert.equal(rejected, identities[0]); renewals++; }
    return identities[rejected ? 1 : 0];
  } } });
  const recovered = await recovery.fetchAppPlayUrl(vid);
  assert.equal(recovered.url, plain.main_url, 'empty model responses renew the device once and recover');
  assert.equal(recoverCalls, 3, 'main, backup, then one renewed retry');
  assert.equal(renewals, 1);
  assert.equal(recovered.recovery.sessionUpdated, true);
  for (const status of [200, 403, 404]) {
    let calls = 0, refreshed = 0;
    const unavailable = load(async () => { calls++; return { status, headers: {}, data: '' }; },
      { playbackDevice: { getPlaybackDevice: async (_request, rejected) => { if (rejected) refreshed++; return identities[rejected ? 1 : 0]; } } });
    await assert.rejects(unavailable.fetchAppPlayUrl(vid), error => status === 200 ? error.code === 'EMPTY_RESPONSE' : error.status === status);
    assert.equal(calls, status === 200 ? 3 : 1, 'one renewed retry only; HTTP rejection must not rotate devices');
    assert.equal(refreshed, status === 200 ? 1 : 0);
  }
  let cooldownCalls = 0;
  await assert.rejects(load(async () => { cooldownCalls++; return { status: 200, headers: {}, data: '' }; },
    { playbackDevice: { getPlaybackDevice: async () => identities[0] } }).fetchAppPlayUrl(vid), error => error.code === 'EMPTY_RESPONSE');
  assert.equal(cooldownCalls, 2, 'a throttled renewal permits one alternate route without a third model request');
  let clock = Date.now(), slowCalls = 0;
  const slowRegistration = load(async config => {
    slowCalls++;
    assert.ok(config.timeout > 11000, 'slow initial registration must not consume the model budget');
    return inlineResponse([plain]);
  }, { now: () => clock, playbackDevice: { getPlaybackDevice: async () => { clock += 7900; return identities[0]; } } });
  assert.equal((await slowRegistration.fetchAppPlayUrl(vid)).url, plain.main_url);
  assert.equal(slowCalls, 1);
  const hosts = [];
  const alternate = load(async config => {
    hosts.push(new URL(config.url).hostname);
    if (hosts.length === 1) return { status: 200, headers: {}, data: '' };
    assert.equal(config.headers.Connection, 'close');
    return inlineResponse([plain]);
  }, { playbackDevice: { getPlaybackDevice: async () => identities[0] } });
  const alternateResult = await alternate.fetchAppPlayUrl(vid, { role: 'foreground' });
  assert.equal(alternateResult.url, plain.main_url);
  assert.deepEqual(hosts, ['api5-normal-sinfonlineb.fqnovel.com', 'api5-normal-hl.fqnovel.com']);
  assert.equal(alternateResult.recovery.route, 'api5-normal-hl.fqnovel.com', 'result reports the backup route');
  assert.equal(alternateResult.recovery.sessionUpdated, false, 'backup entry success requires zero extra registration');

  // 备用入口成功且零额外注册（前台角色）：主入口空响应后立即用同会话试备用入口。
  let fastCalls = 0, fastUpdates = 0, stages = [], pauses = 0;
  const revived = load(async () => {
    fastCalls++;
    return fastCalls < 3 ? { status: 200, headers: {}, data: '' } : inlineResponse([plain]);
  }, { playbackDevice: {
    getPlaybackDevice: async () => identities[0],
    requestFastDeviceUpdate: async (_request, options) => {
      fastUpdates++;
      assert.equal(options.rejectedDevice, identities[0], 'reuse a newer session when the rejected one has already been replaced');
      assert.ok(options.waitMs > 0 && options.waitMs <= 10000, '当前集最多等剩余的短间隔');
      return identities[1];
    },
    pauseFastDeviceUpdates: () => { pauses++; },
  } });
  const revivedResult = await revived.fetchAppPlayUrl(vid, { role: 'foreground', onStage: stage => stages.push(stage) });
  assert.equal(revivedResult.url, plain.main_url);
  assert.equal(fastCalls, 3, '单轮最多三次模型请求');
  assert.equal(fastUpdates, 1, '主备均空后只快速更新一次');
  assert.equal(revivedResult.recovery.sessionUpdated, true);
  assert.ok(stages.includes('reconnecting'), 'recovery stage reaches the foreground UI');
  assert.equal(pauses, 0, '新会话重取成功时不触发退避');

  // 新会话重取仍返回空正文：从失败时起暂停快速更新 60 秒。
  let renewedEmptyCalls = 0, renewedEmptyPauses = 0;
  const renewedEmpty = await load(async () => {
    renewedEmptyCalls++;
    return { status: 200, headers: {}, data: '' };
  }, { playbackDevice: {
    getPlaybackDevice: async () => identities[0],
    requestFastDeviceUpdate: async () => identities[1],
    pauseFastDeviceUpdates: () => { renewedEmptyPauses++; },
  } }).fetchAppPlayUrl(vid, { role: 'foreground' }).then(() => null, error => error);
  assert.equal(renewedEmpty.code, 'EMPTY_RESPONSE');
  assert.equal(renewedEmpty.exhausted, true);
  assert.equal(renewedEmpty.recovery.sessionUpdated, true);
  assert.equal(renewedEmptyCalls, 3, '三次模型请求后结束本轮');
  assert.equal(renewedEmptyPauses, 1, '新会话仍为空时暂停快速更新 60 秒');

  // 切走取消：冷却等待随外部信号中止，不再注册，也不发第三次模型请求。
  const cancelController = new AbortController();
  let cancelledCalls = 0;
  const cancelledError = await load(async () => {
    cancelledCalls++;
    return { status: 200, headers: {}, data: '' };
  }, { playbackDevice: {
    getPlaybackDevice: async () => identities[0],
    requestFastDeviceUpdate: async (_request, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('已取消会话更新等待'), { code: 'ERR_CANCELED' })));
    }),
    pauseFastDeviceUpdates: () => {},
  } }).fetchAppPlayUrl(vid, {
    role: 'foreground',
    onStage: () => cancelController.abort(),
  }).then(() => null, error => error);
  assert.equal(cancelledError.code, 'ERR_CANCELED', '取消直接结束本轮，不再伪装成空响应');
  assert.equal(cancelledCalls, 2, '取消发生在主备两次请求之后、注册与第三次请求之前');

  // 快速更新仍在冷却：不再发第三次模型请求，错误里带下次可重试时间。
  let cooledCalls = 0;
  const cooledError = await load(async () => { cooledCalls++; return { status: 200, headers: {}, data: '' }; },
    { playbackDevice: {
      getPlaybackDevice: async () => identities[0],
      requestFastDeviceUpdate: async () => {
        throw Object.assign(new Error('会话快速更新仍在冷却'), { code: 'DEVICE_UPDATE_COOLDOWN', retryAt: Date.now() + 9500 });
      },
    } }).fetchAppPlayUrl(vid, { role: 'foreground' }).then(() => null, error => error);
  assert.equal(cooledError.code, 'EMPTY_RESPONSE');
  assert.equal(cooledError.exhausted, true, '主备均空是本轮终态');
  assert.equal(cooledError.recovery.fastUpdate, 'cooldown');
  assert.ok(cooledError.recovery.retryAt > Date.now());
  assert.equal(cooledCalls, 2, '冷却时不发第三次模型请求');

  // 更远的预取遇到主备均空：不申请更新，直接停止推进。
  let distantCalls = 0, distantUpdates = 0;
  const distantError = await load(async () => { distantCalls++; return { status: 200, headers: {}, data: '' }; },
    { playbackDevice: {
      getPlaybackDevice: async () => identities[0],
      requestFastDeviceUpdate: async () => { distantUpdates++; return identities[1]; },
    } }).fetchAppPlayUrl(vid, { role: 'distant' }).then(() => null, error => error);
  assert.equal(distantError.code, 'EMPTY_RESPONSE');
  assert.equal(distantError.recovery.fastUpdate, 'stopped');
  assert.equal(distantCalls, 2);
  assert.equal(distantUpdates, 0, 'distant prefetch never requests a fast update');

  // 补充媒体信息请求的空响应：独立提示，不进入主备快速恢复路径。
  let supplementCalls = 0;
  const supplementError = await load(async config => {
    if (config.method === 'POST') return modelResponse();
    supplementCalls++;
    return { status: 200, headers: {}, data: '' };
  }, { playbackDevice: { getPlaybackDevice: async () => identities[0] } })
    .fetchAppPlayUrl(vid).then(() => null, error => error);
  assert.equal(supplementError.code, 'EMPTY_RESPONSE');
  assert.equal(supplementError.recovery.stage, 'supplement');
  assert.match(supplementError.message, /补充播放信息返回空响应/);
  assert.equal(supplementError.exhausted, undefined, '补充空响应不是主备均空终态');
  assert.equal(supplementCalls, 1);

  // 新会话重取优先最近成功过的入口，缺少记录时用主入口。
  let routedCalls = 0; const routedHosts = [];
  const preferred = load(async config => {
    routedHosts.push(new URL(config.url).hostname);
    routedCalls++;
    return [2, 5].includes(routedCalls) ? inlineResponse([plain]) : { status: 200, headers: {}, data: '' };
  }, { playbackDevice: { getPlaybackDevice: async (_request, rejected) => identities[rejected ? 1 : 0] } });
  assert.equal((await preferred.fetchAppPlayUrl(vid)).url, plain.main_url, '第一轮：备用入口成功');
  assert.equal((await preferred.fetchAppPlayUrl(vid)).url, plain.main_url, '第二轮：更新后优先备用入口重取');
  assert.deepEqual(routedHosts, ['api5-normal-sinfonlineb.fqnovel.com', 'api5-normal-hl.fqnovel.com',
    'api5-normal-sinfonlineb.fqnovel.com', 'api5-normal-hl.fqnovel.com', 'api5-normal-hl.fqnovel.com'],
    '新会话重取使用最近成功过的入口');
  let inlineCalls = 0;
  const direct = load(async config => {
    inlineCalls++;
    assert.equal(new URL(config.url).searchParams.get('device_id'), '1000000000000001');
    assert.ok(config.headers['x-medusa']);
    assert.ok(config.headers['x-gorgon']);
    assert.equal(config.headers.Cookie, undefined);
    return inlineResponse([plain]);
  });
  assert.equal((await direct.fetchAppPlayUrl(vid)).url, plain.main_url);
  assert.equal(inlineCalls, 1, 'inline model must not fetch the obsolete fallback endpoint');
  assert.equal((await direct.fetchAppPlayUrl(vid, { quality: '1080p' })).width, 1080);

  // Encode a synthetic Spade key, so the real decoder is exercised without captured credentials.
  const keyHex = '0123456789abcdef0123456789abcdef';
  const raw = Buffer.alloc(34), previous = [246, 85], keyPlain = Buffer.from(`0${keyHex}`);
  for (let i = 0; i < keyPlain.length; i++) {
    raw[i + 1] = ((keyPlain[i] + 21 + i.toString(2).split('1').length - 1) & 255) ^ previous[i & 1];
    previous[i & 1] = raw[i + 1];
  }
  raw[0] = 48 ^ raw[1] ^ raw[2];
  const encrypted = { ...plain, encrypt_info: { encrypt: true, spade_a: raw.toString('base64') } };
  const keyed = await load(async () => inlineResponse([encrypted])).fetchAppPlayUrl(vid);
  assert.equal(keyed.contentKey, keyHex);
  for (const info of [{ encrypt: true }, {}, { encrypt: true, spade_a: 'bad' }]) {
    await assert.rejects(load(async () => inlineResponse([{ ...plain, encrypt_info: info }])).fetchAppPlayUrl(vid),
      error => error.code === 'INVALID_RESPONSE');
  }
  await assert.rejects(load(async () => inlineResponse([plain], '999')).fetchAppPlayUrl(vid),
    error => error.code === 'MISSING_MODEL');
  await assert.rejects(load(async () => inlineResponse([{ ...plain, main_url: 'https://127.0.0.1/private', backup_url: '' }])).fetchAppPlayUrl(vid),
    error => error.code === 'SECURITY_BLOCKED');
  let registrations = 0, modelCalls = 0;
  const registered = load(async config => {
    if (new URL(config.url).pathname === '/service/2/device_register/') {
      registrations++;
      assert.equal(config.method, 'POST');
      assert.ok(Buffer.isBuffer(config.data));
      assert.ok(config.timeout > 0 && config.timeout <= 8000);
      return { status: 200, headers: {}, data: '{"device_id_str":"9007199254740993","install_id_str":"9007199254741993","device_token":"synthetic-unused-token"}' };
    }
    modelCalls++;
    const query = new URL(config.url).searchParams;
    assert.equal(query.get('device_id'), '9007199254740993');
    assert.equal(query.get('iid'), '9007199254741993');
    assert.equal(config.headers.Cookie, undefined);
    return inlineResponse([plain]);
  }, { realDevice: true });
  const simultaneous = await Promise.all([registered.fetchAppPlayUrl(vid), registered.fetchAppPlayUrl(vid)]);
  assert.equal(registrations, 1, 'real device module and transport must share registration');
  assert.equal(modelCalls, 2);
  assert.ok(simultaneous.every(result => result.url === plain.main_url));
  assert.doesNotMatch(JSON.stringify(simultaneous), /synthetic-unused-token/);
  console.log('PASS app source recovery: empty response, legacy quality lock, inline URLs/keys and trust boundaries');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
