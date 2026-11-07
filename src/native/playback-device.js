// SPDX-License-Identifier: GPL-3.0-only
// ttEncrypt and registration fields adapted from tsukiyo-zero/hongguoTV,
// commit 388931852ddc614db8b00775a3dc54c5ede6307f,
// kotlin-tv/core/src/main/kotlin/com/hongguotv/core/DeviceRegister.kt
// (itself adapted from charlie901208/HGTV feat/phone-login, GPL-3.0-only).
// Changes: fixed anonymous phone profile; process-only identity; no cookies or tokens.
const crypto = require('node:crypto');
const { gzipSync } = require('node:zlib');

const REGISTER_URL = 'https://log5-applog-lf.fqnovel.com/service/2/device_register/?tt_data=a&cronet_version=8d40f833_2026-03-03&ttnet_version=4.2.243.31-douyin&use_store_region_cookie=1';
const KDF_SALT = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');
// 快速恢复参数：两次会话更新的启动至少相隔 10 秒；注册失败后退避 60 秒（实测依据见 docs/linux-app-source-recovery-plan.md）。
const FAST_UPDATE_INTERVAL = 10000;
const FAST_UPDATE_BACKOFF = 60000;
let registration;
let refreshAfter = 0;
let retryAfter = 0;
let lastRegisterStart = 0;
let registerTask = null; // 任意在途注册（首次、普通或快速更新），供后续更新共享
let fastRetryAfter = 0;

function trackRegister(promise) {
    registerTask = promise;
    Promise.resolve(promise).catch(() => {}).finally(() => { if (registerTask === promise) registerTask = null; });
    return promise;
}

function updateCooldownError(retryAt) {
    return Object.assign(new Error('会话快速更新仍在冷却'), { code: 'DEVICE_UPDATE_COOLDOWN', retryAt });
}

// 新会话重取仍返回空正文时由取源流程调用：从失败时起暂停快速更新 60 秒。
function pauseFastDeviceUpdates() {
    fastRetryAfter = Math.max(fastRetryAfter, Date.now() + FAST_UPDATE_BACKOFF);
}

function canceledWaitError() {
    return Object.assign(new Error('已取消会话更新等待'), { code: 'ERR_CANCELED' });
}

function abortableWait(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        const abort = () => { clearTimeout(timer); reject(canceledWaitError()); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
}

// 只取消单个等待者；共享的更新继续为其他等待者运行。
function joinUpdate(task, signal) {
    if (!signal) return task;
    return new Promise((resolve, reject) => {
        const abort = () => reject(canceledWaitError());
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) return abort();
        task.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
            error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}

function responseId(response, name) {
    const preferred = response?.[`${name}_str`];
    const value = preferred === undefined || preferred === null || preferred === '' ? response?.[name] : preferred;
    if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : '';
    return typeof value === 'string' && /^\d{1,30}$/.test(value) && /[1-9]/.test(value) ? value : '';
}

async function registerPlaybackDevice(requestJson) {
    try {
            const now = Date.now();
            const cdid = crypto.randomUUID();
            const header = {
                display_name: '红果免费短剧', update_version_code: 73932, manifest_version_code: 73932,
                app_version_minor: '7.3.9.32', aid: 8662, channel: 'update_64', package: 'com.phoenix.read',
                app_version: '7.3.9.32', version_code: 73932, sdk_version: '3.7.0-rc.34-fanqie-xiaoshuo',
                sdk_target_version: 29, git_hash: '3a88f4e', os: 'Android', os_version: '16', os_api: 36,
                device_model: '25053RT47C', device_brand: 'Redmi', device_manufacturer: 'Redmi',
                cpu_abi: 'arm64-v8a', release_build: 'b5e187f', density_dpi: 520, display_density: 'mdpi',
                resolution: '1280x2772', language: 'zh', timezone: 8, access: 'wifi', not_request_sender: 0,
                carrier: 'CHINA MOBILE', mcc_mnc: '46000', rom: 'eng.root.20231116.160340',
                rom_version: 'W528JS release-keys', cdid,
                sig_hash: '56a962410c494bbaf0b58dba20cae56f', openudid: crypto.randomBytes(8).toString('hex'),
                clientudid: crypto.randomUUID(), ipv6_list: [], region: 'CN', tz_name: 'Asia/Shanghai',
                tz_offset: 28800, sim_region: 'cn', sim_serial_number: [], oaid_may_support: false,
                req_id: crypto.randomUUID(), device_platform: 'android',
                custom: { account_region_src: 'fallback', account_region: 'cn', host_bit: 64, dragon_device_type: 'phone' }, pre_installed_channel: '',
                apk_first_install_time: now, is_system_app: 0, sdk_flavor: 'china', guest_mode: 0,
            };
            const compressed = gzipSync(Buffer.from(JSON.stringify({ magic_tag: 'ss_app_log', header, _gen_time: now })));
            const random = crypto.randomBytes(32);
            const derived = crypto.createHash('sha512').update(Buffer.concat([
                crypto.createHash('sha512').update(random).digest(), KDF_SALT,
            ])).digest();
            const cipher = crypto.createCipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32));
            const plaintext = Buffer.concat([crypto.createHash('sha512').update(compressed).digest(), compressed]);
            const data = Buffer.concat([Buffer.from('746305100000', 'hex'), random, cipher.update(plaintext), cipher.final()]);
            const response = await requestJson(REGISTER_URL, {
                method: 'POST',
                headers: {
                    'User-Agent': 'com.phoenix.read/72232 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)',
                    Accept: 'application/json', 'Content-Type': 'application/octet-stream;tt-data=a',
                    'log-encode-type': 'gzip', 'x-ss-dp': '8662', 'x-ss-req-ticket': String(now),
                    'x-vc-bdturing-sdk-version': '4.0.3.cn', lc: '101', 'sdk-version': '2',
                    'passport-sdk-version': '5051452', 'x-neptune': '-8|50:51:59:30:40:47:49:39',
                    'x-ss-stub': crypto.createHash('md5').update(data).digest('hex').toUpperCase(),
                },
                data,
            }, Date.now() + 8000, AbortSignal.timeout(8000));
            const device_id = responseId(response, 'device_id');
            const iid = responseId(response, 'install_id');
            if (Number(response?.code ?? response?.Code ?? 0) !== 0) throw Object.assign(new Error('Registration rejected'), { code: 'BUSINESS_REJECTED' });
            if (!device_id || !iid) throw Object.assign(new Error('Invalid registration'), { code: 'INVALID_RESPONSE' });
        return Object.freeze({ device_id, iid, cdid });
    } catch (error) {
        const status = Number(error?.status);
        const registrationFailure = Number.isInteger(status) && status >= 300 && status <= 599 ? `HTTP_${status}`
            : ['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) ? 'TIMEOUT'
            : ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ERR_NETWORK', 'ERR_CANCELED'].includes(error?.code) ? 'NETWORK_ERROR'
            : ['EMPTY_RESPONSE', 'INVALID_RESPONSE', 'BUSINESS_REJECTED', 'SECURITY_BLOCKED'].includes(error?.code) ? error.code : 'UNKNOWN';
        throw Object.assign(new Error('匿名播放设备注册失败，请检查网络，10 秒后重试'), {
            code: 'DEVICE_REGISTRATION_FAILED', registrationFailure,
        });
    }
}

function getPlaybackDevice(requestJson, rejectedDevice) {
    if (retryAfter && Date.now() >= retryAfter) {
        registration = undefined;
        retryAfter = 0;
    }
    if (rejectedDevice && registration) {
        const previous = registration;
        return previous.then(current => {
            // Concurrent and late failures must share the newest device, with at most one renewal per minute.
            if (registration !== previous || current !== rejectedDevice) return registration;
            // 普通更新与快速更新共享同一次在途注册，不各自注册。
            if (registerTask) return registerTask;
            if (Date.now() < refreshAfter) return registration;
            refreshAfter = Date.now() + 60000;
            lastRegisterStart = Date.now();
            const renewal = Promise.resolve().then(() => registerPlaybackDevice(requestJson)).catch(error => {
                if (registration === renewal) registration = previous;
                throw error;
            });
            trackRegister(renewal);
            registration = renewal;
            return registration;
        });
    }
    // Share failures briefly to avoid concurrent retries, then allow recovery without restarting.
    if (!registration) {
        const initial = Promise.resolve().then(() => {
            lastRegisterStart = Date.now();
            return registerPlaybackDevice(requestJson);
        });
        trackRegister(initial);
        registration = initial.catch(error => {
            retryAfter = Date.now() + 10000;
            throw error;
        });
    }
    return registration;
}

// 取源快速恢复专用：当前集与紧邻的下一可播集可申请。等待期只受调用方约束；更新本身在进程内共享。
async function requestFastDeviceUpdate(requestJson, { rejectedDevice, waitMs = 0, signal } = {}) {
    for (;;) {
        if (signal?.aborted) throw canceledWaitError();
        // 已有在途注册（含普通更新）：直接共享，取消一个等待者不影响其他人。
        if (registerTask) return await joinUpdate(registerTask, signal);
        const previous = registration;
        if (rejectedDevice && previous) {
            const current = await joinUpdate(previous, signal);
            if (signal?.aborted) throw canceledWaitError();
            if (registration !== previous || registerTask) continue;
            if (current !== rejectedDevice) return current;
        }
        if (fastRetryAfter && Date.now() >= fastRetryAfter) fastRetryAfter = 0;
        if (fastRetryAfter) throw updateCooldownError(fastRetryAfter);
        // 同进程两次更新的启动至少相隔 10 秒；已满 10 秒立即更新。
        const nextSlot = lastRegisterStart + FAST_UPDATE_INTERVAL;
        const wait = nextSlot - Date.now();
        if (wait > 0) {
            if (wait > waitMs) throw updateCooldownError(nextSlot);
            await abortableWait(wait, signal);
            continue;
        }
        // 注册门槛在创建任务时同步生效，普通更新据此直接共享，而不是再注册一次。
        lastRegisterStart = Date.now();
        refreshAfter = Date.now() + 60000;
        const task = Promise.resolve().then(() => registerPlaybackDevice(requestJson)).then(identity => {
            registration = Promise.resolve(identity);
            return identity;
        }, error => {
            fastRetryAfter = Math.max(fastRetryAfter, Date.now() + FAST_UPDATE_BACKOFF);
            throw error;
        });
        trackRegister(task);
        return await joinUpdate(task, signal);
    }
}

module.exports = { getPlaybackDevice, registerPlaybackDevice, requestFastDeviceUpdate, pauseFastDeviceUpdates, FAST_UPDATE_INTERVAL, FAST_UPDATE_BACKOFF };
