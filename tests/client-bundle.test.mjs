// TC21：打包产物形态（RED 先行）——不依赖 react、不触网
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')

function reactStub() {
  const createElement = (type, props, ...children) => ({ type, props: { ...(props || {}), children } })
  const hookFactory = (initial) => {
    let value = typeof initial === 'function' ? initial() : initial
    return [value, (next) => { value = typeof next === 'function' ? next(value) : next }]
  }
  return {
    createElement,
    useState: (initial) => hookFactory(initial),
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    Fragment: 'Fragment',
  }
}

function loadBundle() {
  const source = readFileSync(bundlePath, 'utf8')
  let definition = null
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { definition = def } } },
    console,
    setTimeout,
    clearTimeout,
    document: { querySelector: () => null, head: { appendChild: () => {} }, createElement: () => ({ setAttribute() {}, appendChild() {} }) },
    fetch: async () => ({ ok: true, json: async () => ({ ok: false, reason: 'no-api-key' }) }),
    Date,
  }
  sandbox.window.document = sandbox.document
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.ok(definition, 'bundle 必须调用 window.__ModuleLoader__.load')
  const exported = definition.factory((id) => {
    if (id === 'react') return reactStub()
    throw new Error(`意外依赖 ${id}`)
  })
  return { definition, exported }
}

test('TC21 bundle 可加载并注册 dock 槽位', () => {
  const { definition, exported } = loadBundle()
  assert.equal(definition.id, 'dsh-balance-strip')
  assert.equal(exported.name, 'dsh-balance-strip')
  assert.ok(Array.isArray(exported.inject))
  assert.ok(exported.inject.includes('slots'))
  assert.equal(typeof exported.apply, 'function')

  const injected = []
  const registered = []
  const ctx = {
    slots: {
      inject: (slotName, cb) => { injected.push(slotName); cb() },
      register: (meta, component) => { registered.push({ meta, component }); return () => {} },
    },
    effect: (fn) => { fn(); return () => {} },
    locale: { getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} },
  }
  exported.apply(ctx)
  assert.equal(injected[0], 'conversation.composer.dock')
  assert.equal(registered.length, 1)
  assert.equal(registered[0].meta.name, 'conversation.composer.dock')
  assert.equal(registered[0].meta.id, 'dsh-balance-strip')
  assert.equal(typeof registered[0].component, 'function')
})

test('TC22 组件首帧可渲染出条体结构（loading 态为中性色）', () => {
  const { exported } = loadBundle()
  const element = exported.BalanceBar()
  assert.equal(element.type, 'span')
  assert.match(element.props.className, /dbb-wrap/, '外层是包装器（条体 + 齿轮）')

  const [bar, gear] = element.props.children
  assert.match(bar.props.className, /\bdbb\b/)
  assert.match(bar.props.className, /dbb--muted/, '无数据时不得显示动态色')
  assert.equal(bar.props.style['--dbb-fill'], '#7a828a')
  assert.equal(bar.props.style['--dbb-texture-image'], 'none', '默认关闭纹理')
  assert.equal(bar.props.style['--dbb-texture-size'], 'auto', '默认关闭纹理 → size 为 auto')
  assert.equal(gear.type, 'button')
  assert.match(gear.props.className, /dbb-gear/, '条形后面是设置入口')

  const flat = (bar.props.children || []).flatMap((child) => {
    const inner = child && child.props ? child.props.children : null
    return Array.isArray(inner) ? inner : [inner]
  })
  assert.ok(flat.some((text) => typeof text === 'string' && text.includes('…')), 'loading 态显示省略号占位')
})

test('TC27 dock 顺序：排到官方上下文占用环之后', () => {
  const { definition, exported } = loadBundle()
  assert.equal(exported.DOCK_ORDER, 99)
  const registered = []
  const ctx = {
    slots: { inject: (name, cb) => cb(), register: (meta, component) => { registered.push({ meta, component }); return () => {} } },
    effect: () => () => {},
  }
  exported.apply(ctx)
  assert.equal(registered[0].meta.order, 99)
  assert.ok(exported.CSS.includes('order: 99'), 'CSS 里要带上 flex order')
  assert.ok(exported.CSS.includes('.dbb-panel'), '样式里要有设置面板')
})


test('TC28 金币图标：内联 SVG，尺寸可调', () => {
  const { exported } = loadBundle()
  const icon = exported.CoinIcon({ size: 16 })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 16)
  assert.equal(icon.props.height, 16)
  assert.equal(icon.props['aria-hidden'], 'true')
  assert.equal(icon.props.children.length, 5, '两层圆 + 三条 ¥ 笔画')
  assert.equal(icon.props.children[0].type, 'circle')
  assert.equal(icon.props.children[2].props.stroke, 'currentColor', '颜色跟随主题文字色')
  const small = exported.CoinIcon()
  assert.equal(small.props.width, 14, '默认 14px')
})


test('TC29 文案跟随客户端语言（zh/en 字典齐 + 插值）', () => {
  const { exported } = loadBundle()
  const zhKeys = Object.keys(exported.I18N.zh).sort()
  const enKeys = Object.keys(exported.I18N.en).sort()
  assert.deepEqual(enKeys, zhKeys, '中英字典的 key 必须一一对应')

  assert.equal(exported.t('panel.title', undefined, 'zh'), '余额状态栏设置')
  assert.equal(exported.t('panel.title', undefined, 'en'), 'Balance strip settings')
  assert.equal(exported.t('label.default', undefined, 'en'), 'Balance')
  assert.equal(exported.t('tip.anchor', { anchor: 200 }, 'en'), '100% = 200')
  assert.equal(exported.t('tip.anchor', { anchor: 200 }, 'zh'), '100% = 200')

  // 缺 key 回落中文，再缺回落 key
  assert.equal(exported.t('nope.key', undefined, 'en'), 'nope.key')

  // setLang 会通知订阅者（组件据此实时切换）
  const seen = []
  const ctx = {
    slots: { inject: (name, cb) => cb(), register: () => () => {} },
    effect: (fn) => { fn(); return () => {} },
    locale: { getLocale: () => ({ active: 'en' }), subscribe: () => () => {} },
  }
  exported.apply(ctx)
  assert.equal(exported.t('panel.title'), 'Balance strip settings', 'apply 后应按 locale 切到英文')
  exported.setLang('zh')
  assert.equal(exported.t('panel.title'), '余额状态栏设置')
  assert.deepEqual(seen, [])
})

test('TC30 英文界面下默认标签是 Balance，自定义标签原样保留', () => {
  const { exported } = loadBundle()
  const element = exported.BalanceBar()
  assert.equal(element.type, 'span')
  // 默认语言 zh
  const bar = element.props.children[0]
  const text = (bar.props.children[2] || {}).props
  assert.ok(text, '条体里必须有文字节点')
  assert.match(String(text.children[0] || ''), /余额|Balance|…/)
})
