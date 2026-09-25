/**
 * dsh-kimi-quota —— 主机半边。
 *
 * 职责：向网页半区提供一个只读的 Kimi Code 额度代理路由
 *   GET /dsh-kimi-quota/api/usages
 * 上行接口：GET https://api.kimi.com/coding/v1/usages（Bearer sk-kimi key，只读不耗额度）。
 *
 * 要点：
 * 1. key 只存在于主机进程，三层解析（与 zh_pro credentials.js 同构）：
 *    ① 官方 credentials 服务（app 的 key 存在 ~/.dsh/.credentials.yaml，走这层）
 *    ② 环境变量（默认 KIMI_CODING_API_KEY） ③ 直读 .credentials.yaml 的 refs 段。
 *    可用插件 config 的 apiKey / apiKeyEnv 覆盖；key 永不下发浏览器。
 * 2. 仅应答回环来源（127.0.0.0/8、::1、::ffff:127.x）。经 remote-web-ui 配对通道
 *    来的请求由通道在回环上重新发起，因此手机遥控照常可用；局域网直连一律 403。
 * 3. 2 分钟内存缓存 + 10 秒上行超时；上行失败且持有旧缓存时回 200 并标 stale，
 *    无缓存才回 502。缓存是进程内的，Fiber 卸载即随插件消失。
 * 4. webServer 服务晚于本插件出现时，按 zh_pro 同款 internal/service 重试模式等待；
 *    路由注册经 ctx.effect 挂 Fiber，卸载即注销。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'dsh-kimi-quota';

const UPSTREAM_URL = 'https://api.kimi.com/coding/v1/usages';
const CACHE_MS = 120_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const ROUTE_PREFIX = '/dsh-kimi-quota/api';
const CREDENTIALS_FILE = '.credentials.yaml';

/** DSH 主目录：非空白的 $DSH_HOME，否则回退官方默认 ~/.dsh（zh_pro 同款回退）。 */
function dshHome() {
    const envHome = process.env.DSH_HOME;
    if (envHome !== undefined && envHome.trim().length > 0)
        return envHome;
    return join(homedir(), '.dsh');
}

/** 直读凭据文件 refs 段取值（支持双引号 JSON 转义 / 单引号原样 / 裸值去注释）。 */
function credentialInFile(ref) {
    try {
        const lines = readFileSync(join(dshHome(), CREDENTIALS_FILE), 'utf8').split(/\r?\n/);
        let inRefs = false;
        for (const line of lines) {
            if (!inRefs) {
                if (/^refs:\s*(?:#.*)?$/.test(line))
                    inRefs = true;
                continue;
            }
            if (line.length > 0 && !/^\s/.test(line))
                break;
            const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
            if (match === null || match[1] !== ref)
                continue;
            let value = match[2] ?? '';
            if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
                try {
                    value = JSON.parse(value);
                }
                catch {
                    value = value.slice(1, -1);
                }
            }
            else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
                value = value.slice(1, -1).replace(/''/g, "'");
            }
            else {
                value = value.replace(/\s+#.*$/, '').trim();
            }
            return value.length > 0 ? value : undefined;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}

/**
 * 三层解析 API key：① credentials 服务（官方解析链，含热更新）
 * → ② 环境变量 → ③ 凭据文件 refs 段。三层都拿不到返回 undefined。
 */
async function resolveApiKey(ctx, ref) {
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined;
    if (credentials !== undefined && credentials !== null && typeof credentials.resolve === 'function') {
        try {
            const resolution = credentials.resolve(ref);
            if (resolution !== undefined && resolution !== null) {
                // Promise 迟到/失败都不得形成未处理 rejection
                void resolution.catch(() => undefined);
                const resolved = await resolution;
                if (resolved !== undefined && resolved !== null && typeof resolved.value === 'string' && resolved.value.length > 0) {
                    return resolved.value;
                }
            }
        }
        catch {
            // 服务失败继续走回退
        }
    }
    const envValue = process.env[ref];
    if (envValue !== undefined && envValue.length > 0)
        return envValue;
    const fileValue = credentialInFile(ref);
    if (fileValue !== undefined && fileValue.length > 0)
        return fileValue;
    return undefined;
}

function log(msg) {
    console.log(`[dsh-kimi-quota] ${msg}`);
}
function warn(msg) {
    console.warn(`[dsh-kimi-quota] ${msg}`);
}

function writeJson(res, status, body) {
    try {
        const payload = JSON.stringify(body);
        res.statusCode = status;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(payload);
    }
    catch {
        try { res.end(); } catch { /* socket 已毁 */ }
    }
}

function isLoopbackRequest(req) {
    const addr = req.socket?.remoteAddress ?? '';
    return addr === '::1'
        || addr.startsWith('127.')
        || addr.startsWith('::ffff:127.');
}

/** 进程内缓存：{ at, data }，data 为上游 usages JSON */
let cache = null;

async function fetchUpstream(key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
        const resp = await fetch(UPSTREAM_URL, {
            headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
            signal: controller.signal,
        });
        if (resp.status === 401) {
            const err = new Error('key 无效（401）');
            err.code = 'unauthorized';
            throw err;
        }
        if (!resp.ok) {
            const err = new Error(`上游 HTTP ${resp.status}`);
            err.code = 'upstream';
            throw err;
        }
        return await resp.json();
    }
    finally {
        clearTimeout(timer);
    }
}

async function getQuota(key) {
    if (cache !== null && Date.now() - cache.at < CACHE_MS) {
        return { data: cache.data, stale: false, cachedAt: cache.at };
    }
    try {
        const data = await fetchUpstream(key);
        cache = { at: Date.now(), data };
        return { data, stale: false, cachedAt: cache.at };
    }
    catch (error) {
        if (cache !== null) {
            warn(`上行失败，回退 ${Math.round((Date.now() - cache.at) / 1000)}s 前缓存：${error.message}`);
            return { data: cache.data, stale: true, cachedAt: cache.at };
        }
        throw error;
    }
}

export function apply(ctx, config) {
    const cfg = (config && typeof config === 'object') ? config : {};

    const install = function () {
        const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
        if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
            return false;
        }
        const handler = async (req, res) => {
            if (!isLoopbackRequest(req)) {
                writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } });
                return;
            }
            if (req.method !== 'GET') {
                writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } });
                return;
            }
            const ref = (typeof cfg.apiKeyEnv === 'string' && cfg.apiKeyEnv !== '') ? cfg.apiKeyEnv : 'KIMI_CODING_API_KEY';
            const key = (typeof cfg.apiKey === 'string' && cfg.apiKey !== '')
                ? cfg.apiKey
                : await resolveApiKey(ctx, ref);
            if (!key) {
                writeJson(res, 400, {
                    ok: false,
                    error: { code: 'no-key', message: `未找到 Kimi Code key（credentials 服务 / 环境变量 / 凭据文件均无 ${ref}）` },
                });
                return;
            }
            try {
                const result = await getQuota(key);
                writeJson(res, 200, { ok: true, value: result });
            }
            catch (error) {
                writeJson(res, 502, {
                    ok: false,
                    error: { code: error.code ?? 'upstream', message: error.message ?? String(error) },
                });
            }
        };
        const disposer = webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });
        ctx.effect(() => disposer, 'dsh-kimi-quota: /dsh-kimi-quota/api routes');
        log('「Kimi Code 额度」代理路由已就绪（仅回环）');
        return true;
    };

    if (!install()) {
        // webServer 晚于本插件出现：等待 internal/service 事件（zh_pro 同款模式）
        const retryService = function (name) {
            if (name === 'webServer') {
                try {
                    if (install() && typeof ctx.off === 'function')
                        ctx.off('internal/service', retryService);
                }
                catch { /* off 不可用时靠 Fiber 清理兜底 */ }
            }
        };
        ctx.on('internal/service', retryService);
        ctx.effect(function () {
            return function () {
                try {
                    if (typeof ctx.off === 'function')
                        ctx.off('internal/service', retryService);
                }
                catch { /* 忽略 */ }
            };
        }, 'dsh-kimi-quota: route retry');
    }
}
