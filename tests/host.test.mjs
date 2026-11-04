// TC16–TC20：宿主路由契约（RED 先行）
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, buildStateRoute, name, inject } from '../src/index.js'

function fakeCtx({ credentials } = {}) {
  const routes = new Map()
  return {
    routes,
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get(service) {
      return service === 'credentials' ? credentials : undefined
    },
    webServer: {
      register(def) {
        routes.set(def.path, def)
        return () => routes.delete(def.path)
      },
    },
  }
}

function fakeRes() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.status = status
      res.headers = headers || {}
      return res
    },
    end(payload) {
      res.body = payload ?? ''
      return res
    },
  }
  return res
}

const sameOriginReq = (method = 'GET') => ({
  method,
  url: '/dsh-balance-strip/state',
  headers: { host: '127.0.0.1:52926', origin: 'http://127.0.0.1:52926', 'sec-fetch-site': 'same-origin' },
})

function stubFetch(payload, capture) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (capture) capture.push({ url: String(url), init })
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => '',
    }
  }
  return () => { globalThis.fetch = original }
}

test('TC16 注册 /dsh-balance-strip/state 精确路由', () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  assert.equal(name, 'dsh-balance-strip')
  assert.deepEqual(inject, ['webServer'])
  const route = ctx.routes.get('/dsh-balance-strip/state')
  assert.ok(route, '必须注册状态路由')
  assert.equal(route.kind, 'exact')
  assert.equal(typeof route.handler, 'function')
})

test('TC17 同源守卫：跨站 403、POST 405、正常 GET 200', async () => {
  const ctx = fakeCtx({ credentials: { resolve: async () => ({ value: 'sk-test-123' }) } })
  apply(ctx, { apiKey: 'sk-test-123' })
  const route = ctx.routes.get('/dsh-balance-strip/state')

  const cross = fakeRes()
  await route.handler({ ...sameOriginReq(), headers: { ...sameOriginReq().headers, 'sec-fetch-site': 'cross-site' } }, cross)
  assert.equal(cross.status, 403)
  assert.match(cross.body, /cross-origin-request/)

  const foreignOrigin = fakeRes()
  await route.handler({ ...sameOriginReq(), headers: { ...sameOriginReq().headers, origin: 'https://evil.example' } }, foreignOrigin)
  assert.equal(foreignOrigin.status, 403)

  const post = fakeRes()
  await route.handler(sameOriginReq('POST'), post)
  assert.equal(post.status, 405)

  const restore = stubFetch({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '42.50', granted_balance: '0.00', topped_up_balance: '42.50' }],
  })
  try {
    const ok = fakeRes()
    await route.handler(sameOriginReq(), ok)
    assert.equal(ok.status, 200)
    const body = JSON.parse(ok.body)
    assert.equal(body.ok, true)
  } finally {
    restore()
  }
})

test('TC18 无 Key 时返回结构化 no-api-key 且带公开配置', async () => {
  const ctx = fakeCtx()
  const original = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  apply(ctx, { anchor: 12 })
  const route = ctx.routes.get('/dsh-balance-strip/state')
  const res = fakeRes()
  try {
    await route.handler(sameOriginReq(), res)
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = original
  }
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, false)
  assert.equal(body.reason, 'no-api-key')
  assert.equal(body.keyConfigured, false)
  assert.equal(body.config.anchor, 12)
})

test('TC19 成功分支：带 Bearer 调官方接口并解析金额', async () => {
  const ctx = fakeCtx({ credentials: { resolve: async () => ({ value: 'sk-live-abc' }) } })
  apply(ctx, {})
  const route = ctx.routes.get('/dsh-balance-strip/state')
  const calls = []
  const restore = stubFetch({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '42.50', granted_balance: '2.00', topped_up_balance: '40.50' }],
  }, calls)
  try {
    const res = fakeRes()
    await route.handler(sameOriginReq(), res)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.equal(body.balance.total, 42.5)
    assert.equal(body.balance.granted, 2)
    assert.equal(body.balance.toppedUp, 40.5)
    assert.equal(body.balance.currency, 'CNY')
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/user\/balance$/)
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-live-abc')
    assert.ok(calls[0].init.signal, '必须带超时 signal')
  } finally {
    restore()
  }
})

test('TC20 响应不泄露密钥', async () => {
  const ctx = fakeCtx({ credentials: { resolve: async () => ({ value: 'sk-very-secret' }) } })
  apply(ctx, { apiKey: 'sk-configured-secret' })
  const route = ctx.routes.get('/dsh-balance-strip/state')
  const restore = stubFetch({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '1', granted_balance: '0', topped_up_balance: '1' }] })
  try {
    const res = fakeRes()
    await route.handler(sameOriginReq(), res)
    assert.equal(res.body.includes('sk-configured-secret'), false)
    assert.equal(res.body.includes('sk-very-secret'), false)
    assert.equal(/"apiKey"\s*:/.test(res.body), false, '响应里不得出现 apiKey 字段')
    assert.equal(/sk-[a-z0-9-]+/i.test(res.body), false, '响应里不得出现密钥形状的字符串')
  } finally {
    restore()
  }
})

test('buildStateRoute 可独立构造（便于后续加设置页）', () => {
  const route = buildStateRoute({ resolveApiKey: async () => '' })
  assert.equal(route.path, '/dsh-balance-strip/state')
  assert.equal(route.kind, 'exact')
})

test('TC23 无 API Key 时回落到账号登录态的钱包余额', async () => {
  const ctx = fakeCtx({
    credentials: {
      readRecord: async (key) => {
        assert.equal(key, 'deepseek-account-platform/default')
        return { kind: 'grant', payload: { token: 'grant-token-abc', issuer: 'https://platform.deepseek.com' } }
      },
    },
  })
  const original = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  apply(ctx, {})
  const route = ctx.routes.get('/dsh-balance-strip/state')

  const calls = []
  const restore = stubFetch({
    code: 0,
    msg: '',
    data: {
      biz_code: 0,
      biz_data: {
        normal_wallets: [{ currency: 'CNY', balance: '96.2702932800000000' }],
        bonus_wallets: [{ currency: 'CNY', balance: '0' }],
        total_costs: [{ currency: 'CNY', amount: '8.8970714000000000' }],
      },
    },
  }, calls)
  try {
    const res = fakeRes()
    await route.handler(sameOriginReq(), res)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.equal(body.source, 'platform')
    assert.equal(body.balance.currency, 'CNY')
    assert.equal(body.balance.total, 96.270293, 'total 归一化到 6 位小数')
    assert.equal(body.balance.toppedUp, 96.27029328, '充值钱包原值透传')
    assert.equal(body.balance.granted, 0)
    assert.equal(body.costsTotal, 8.8970714)
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/api\/v0\/users\/get_user_summary$/)
    assert.equal(calls[0].init.headers['x-dsh-auth-token'], 'grant-token-abc')
    assert.equal(res.body.includes('grant-token-abc'), false, '账号 token 不得下发浏览器')
  } finally {
    restore()
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = original
  }
})

test('TC24 API Key 失败时自动回落到账号通道', async () => {
  const ctx = fakeCtx({
    credentials: {
      resolve: async (key) => (key === 'DEEPSEEK_API_KEY' ? { value: 'sk-broken-key' } : undefined),
      readRecord: async () => ({ kind: 'grant', payload: { token: 'grant-token-abc', issuer: 'https://platform.deepseek.com' } }),
    },
  })
  apply(ctx, {})
  const route = ctx.routes.get('/dsh-balance-strip/state')

  const urls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    if (String(url).includes('/user/balance')) {
      return { ok: false, status: 401, json: async () => ({}), text: async () => 'unauthorized' }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { biz_data: { normal_wallets: [{ currency: 'CNY', balance: '12.5' }], bonus_wallets: [] } } }),
      text: async () => '',
    }
  }
  try {
    const res = fakeRes()
    await route.handler(sameOriginReq(), res)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.equal(body.source, 'platform')
    assert.equal(body.balance.total, 12.5)
    assert.equal(urls.length, 2, '应先试 API Key，再回落账号通道')
  } finally {
    globalThis.fetch = originalFetch
  }
})
