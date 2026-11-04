/**
 * dsh-balance-strip / 宿主半区
 *
 * 两条取数通道，同源路由 `/dsh-balance-strip/state` 对浏览器只暴露一条：
 *   1) API Key 通道：DSH 凭据 `DEEPSEEK_API_KEY`（或 config.apiKey）→ 官方 `GET /user/balance`
 *   2) 账号通道：DSH 账号登录的 grant（`deepseek-account-platform/default`）→
 *      `GET {platform}/api/v0/users/get_user_summary`（头 `x-dsh-auth-token`），
 *      取 normal_wallets + bonus_wallets。这条让「用账号登录、没有 API Key」的人也能看到余额。
 *
 * 浏览器永远不接触密钥/token；`normalizeConfig` 也不保留 `apiKey`。
 */
import { normalizeConfig } from './shared/core.cjs'

export const name = 'dsh-balance-strip'

/** 依赖宿主 webServer（路由载体）。credentials / account 是可选服务，用 ctx.get 软取。 */
export const inject = ['webServer']

const ROUTE_PATH = '/dsh-balance-strip/state'
const TIMEOUT_MS = 8_000
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_PLATFORM_ISSUER = 'https://platform.deepseek.com'
const DEFAULT_PLATFORM_CREDENTIAL = 'deepseek-account-platform/default'
const PLATFORM_BALANCE_PATH = '/api/v0/users/get_user_summary'

/** 只允许 https，或本机回环代理的 http。 */
export function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_BASE_URL
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new TypeError('dsh-balance-strip: config.baseUrl 必须是绝对 URL')
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('dsh-balance-strip: config.baseUrl 只允许 https（回环地址可用 http）')
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

/** 拒绝非本机同源发起的浏览器请求。 */
export function isTrustedRequest(req) {
  if (!req || req.method !== 'GET') return false
  const fetchSite = req.headers && req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') return false
  const origin = req.headers && req.headers.origin
  const host = req.headers && req.headers.host
  if (typeof origin === 'string' && typeof host === 'string') {
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(payload)
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function fetchJson(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      const detail = typeof res.text === 'function' ? await res.text().catch(() => '') : ''
      return { ok: false, status: res.status, message: `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 160)}` : ''}` }
    }
    const body = await res.json()
    return { ok: true, body }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** 通道 1：官方 API Key 余额。失败返回结构化结果，不抛异常。 */
export async function fetchBalance(apiKey, baseUrl) {
  const result = await fetchJson(`${baseUrl}/user/balance`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  })
  if (!result.ok) {
    return { ok: false, keyConfigured: true, reason: 'request-failed', message: result.message }
  }
  const data = result.body || {}
  const infos = Array.isArray(data.balance_infos) ? data.balance_infos : []
  if (infos.length === 0) {
    return { ok: false, keyConfigured: true, reason: 'bad-response', message: '官方接口未返回 balance_infos' }
  }
  const picked = infos.find((entry) => entry && entry.currency === 'CNY') || infos[0]
  return {
    ok: true,
    keyConfigured: true,
    source: 'api',
    isAvailable: data.is_available === true,
    balance: {
      currency: typeof picked.currency === 'string' ? picked.currency : 'CNY',
      total: toNumber(picked.total_balance),
      granted: toNumber(picked.granted_balance),
      toppedUp: toNumber(picked.topped_up_balance),
    },
  }
}

/**
 * 从 DSH 凭据里读账号 grant。credentials 服务同时支持 readRecord（结构化）与 resolve（取值），
 * 这里两条都试，谁可用用谁，读不到就返回 null。
 */
async function readAccountGrant(ctx, key) {
  if (!ctx || typeof ctx.get !== 'function') return null
  const credentials = ctx.get('credentials')
  if (!credentials) return null

  const asPayload = (value) => {
    if (value && typeof value === 'object' && typeof value.token === 'string') return value
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed.token === 'string') return parsed
      } catch {
        return { token: value }
      }
    }
    return null
  }

  if (typeof credentials.readRecord === 'function') {
    try {
      const record = await credentials.readRecord(key)
      if (record && record.kind === 'grant') {
        const payload = asPayload(record.payload)
        if (payload) return payload
      }
    } catch {
      // 落到 resolve
    }
  }
  if (typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(key)
      const value = resolved && typeof resolved === 'object' && 'value' in resolved ? resolved.value : resolved
      const payload = asPayload(value)
      if (payload) return payload
    } catch {
      // 无凭据即视为无账号通道
    }
  }
  return null
}

/** 通道 2：账号登录态的充值钱包余额（无需 API Key）。 */
export async function fetchPlatformBalance(ctx, options) {
  const opts = options || {}
  const key = opts.platformCredential || DEFAULT_PLATFORM_CREDENTIAL
  const grant = await readAccountGrant(ctx, key)
  if (!grant) return { ok: false, reason: 'no-account', message: '没有可用的账号登录凭据' }

  const issuer = (typeof grant.issuer === 'string' && grant.issuer.trim() !== '' ? grant.issuer.trim() : opts.platformBaseUrl || DEFAULT_PLATFORM_ISSUER)
  let origin
  try {
    origin = new URL(issuer).toString().replace(/\/$/, '')
  } catch {
    origin = DEFAULT_PLATFORM_ISSUER
  }

  const result = await fetchJson(`${origin}${PLATFORM_BALANCE_PATH}`, {
    method: 'GET',
    headers: { 'x-dsh-auth-token': grant.token, Accept: 'application/json' },
  })
  if (!result.ok) return { ok: false, reason: 'request-failed', message: result.message }

  const data = (result.body && result.body.data) || {}
  const biz = data.biz_data || {}
  const normal = Array.isArray(biz.normal_wallets) ? biz.normal_wallets : []
  const bonus = Array.isArray(biz.bonus_wallets) ? biz.bonus_wallets : []
  if (normal.length === 0 && bonus.length === 0) {
    return { ok: false, reason: 'bad-response', message: '账号接口未返回钱包' }
  }
  const pick = normal.find((row) => row && row.currency === 'CNY') || normal[0] || {}
  const bonusPick = bonus.find((row) => row && row.currency === (pick.currency || 'CNY')) || bonus[0] || {}
  const toppedUp = toNumber(pick.balance)
  const granted = toNumber(bonusPick.balance)
  const costs = Array.isArray(biz.total_costs) ? biz.total_costs : []
  const costPick = costs.find((row) => row && row.currency === (pick.currency || 'CNY')) || costs[0] || {}

  return {
    ok: true,
    source: 'platform',
    balance: {
      currency: typeof pick.currency === 'string' ? pick.currency : 'CNY',
      total: Math.round((toppedUp + granted) * 1e6) / 1e6,
      granted,
      toppedUp,
    },
    costsTotal: toNumber(costPick.amount),
  }
}

/**
 * 构造状态路由（独立出来便于测试与后续加设置页）。
 * @param {{ resolveApiKey?: () => Promise<string>, ctx?: object, config?: object, baseUrl?: string }} options
 */
export function buildStateRoute(options) {
  const opts = options || {}
  const resolveApiKey = typeof opts.resolveApiKey === 'function' ? opts.resolveApiKey : async () => ''
  const config = normalizeConfig(opts.config || {})
  const baseUrl = opts.baseUrl || normalizeBaseUrl(config.baseUrl)
  const raw = opts.config && typeof opts.config === 'object' ? opts.config : {}
  const platformOptions = {
    platformCredential: typeof raw.platformCredential === 'string' && raw.platformCredential.trim() !== '' ? raw.platformCredential.trim() : DEFAULT_PLATFORM_CREDENTIAL,
    platformBaseUrl: typeof raw.platformBaseUrl === 'string' && raw.platformBaseUrl.trim() !== '' ? raw.platformBaseUrl.trim() : DEFAULT_PLATFORM_ISSUER,
  }

  return {
    kind: 'exact',
    path: ROUTE_PATH,
    async handler(req, res) {
      if (req.method !== 'GET') {
        res.setHeader?.('Allow', 'GET')
        writeJson(res, 405, { ok: false, reason: 'method-not-allowed' })
        return
      }
      if (!isTrustedRequest(req)) {
        writeJson(res, 403, { ok: false, reason: 'cross-origin-request' })
        return
      }

      let apiKey = ''
      try {
        apiKey = (await resolveApiKey()) || ''
      } catch {
        apiKey = ''
      }

      const failures = []
      if (apiKey !== '') {
        const viaApi = await fetchBalance(apiKey, baseUrl)
        if (viaApi.ok) {
          writeJson(res, 200, { ...viaApi, spentToday: 0, fetchedAt: Date.now(), config })
          return
        }
        failures.push(viaApi)
      }

      // API Key 通道不可用时走账号登录态
      const viaAccount = await fetchPlatformBalance(opts.ctx, platformOptions)
      if (viaAccount.ok) {
        writeJson(res, 200, { ...viaAccount, spentToday: 0, fetchedAt: Date.now(), config })
        return
      }
      failures.push(viaAccount)

      const onlyNoAccount = failures.every((item) => item.reason === 'no-account' || item.reason === 'no-key')
      writeJson(res, 200, {
        ok: false,
        keyConfigured: apiKey !== '',
        reason: apiKey === '' && onlyNoAccount ? 'no-api-key' : failures[0].reason || 'request-failed',
        message:
          apiKey === '' && onlyNoAccount
            ? '没有可用凭据：既没有 DEEPSEEK_API_KEY，也没有 DSH 账号登录态。余额显示为 —，点击可重试。'
            : failures.map((item) => item.message).filter(Boolean).join(' / '),
        config,
      })
    },
  }
}

/**
 * 插件入口。
 * @param {object} ctx cordis Context
 * @param {object} config cordis.patch.yml 里的 config
 */
export function apply(ctx, config) {
  const source = config && typeof config === 'object' ? config : {}
  const explicitKey = typeof source.apiKey === 'string' ? source.apiKey.trim() : ''
  const baseUrl = normalizeBaseUrl(source.baseUrl)

  const resolveApiKey = async () => {
    if (explicitKey !== '') return explicitKey
    const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    if (credentials && typeof credentials.resolve === 'function') {
      const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
      const value = resolved && typeof resolved.value === 'string' ? resolved.value.trim() : ''
      if (value !== '') return value
    }
    return (process.env.DEEPSEEK_API_KEY || '').trim()
  }

  const route = buildStateRoute({ resolveApiKey, ctx, config: source, baseUrl })
  ctx.effect(() => ctx.webServer.register(route))
}
