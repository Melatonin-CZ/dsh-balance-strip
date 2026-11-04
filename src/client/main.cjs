'use strict'
/*
 * dsh-balance-strip / 客户端半区（浏览器）
 *
 * 构建时由 scripts/build.mjs 拼进 `window.__ModuleLoader__` 的 factory：
 *   - `core` 变量指向 core.cjs 的导出
 *   - `require('react')` 由宿主模块加载器解析（不打包 react）
 *
 * 布局：注册到 `conversation.composer.dock`。该 dock 是 flex 容器，官方的
 * 上下文占用环（ContextMeter）是在槽位之后渲染的，所以这里用 `order` 把自己
 * 排到它右边；条形后面跟一个金币入口。
 *
 * 文案：全部走 i18n，跟随 DSH 客户端语言（locale 服务的 active）实时切换；
 * 只维护本文件里的 zh/en 两份字典，避免和平台字典漂移。
 *
 * 刷新：只有**首次**加载显示占位符；有数据后刷新沿用上一次数值（不闪）。
 * 设置：图形面板写入 localStorage，覆盖宿主下发的 config；宿主 config 仍是基线。
 */

const React = require('react')
const { createElement: h, useState, useEffect, useRef, useCallback, useMemo } = React

const PLUGIN_ID = 'dsh-balance-strip'
const SLOT = 'conversation.composer.dock'
const STATE_URL = '/dsh-balance-strip/state'
const STYLE_ID = 'dsh-balance-strip/style'
const STORAGE_KEY = 'dsh-balance-strip:settings:v2'
const CACHE_MS = 10_000
/** 官方 ContextMeter 在槽位之后渲染（flex order 默认 0），这里排到它后面 */
const DOCK_ORDER = 99

// ---------------------------------------------------------------- i18n

const I18N = {
  zh: {
    'label.default': '余额',
    'ph.loading': '…',
    'ph.nokey': '未配置',
    'ph.retry': '重试',
    'tip.noAnchor': '未设 100% 锚点（按 100 计，超出如实显示）',
    'tip.anchor': '100% = {anchor}',
    'tip.updated': '更新于 {time}',
    'tip.click': '点击刷新 · 金币按钮设置',
    'tip.noKey': '没有可用凭据：填入 API Key 或登录 DSH 账号',
    'tip.failed': '余额接口暂不可用，点击重试',
    'panel.title': '余额状态栏设置',
    'panel.close': '关闭',
    'panel.done': '完成',
    'panel.reset': '恢复默认',
    'panel.anchor': '100% = 金额',
    'panel.anchorPh': '留空 = 100',
    'panel.anchorDefault': '默认',
    'panel.dynamic': '动态变色',
    'panel.palette': '配色预设',
    'panel.colorHigh': '满格颜色',
    'panel.colorLow': '见底颜色',
    'panel.texture': '纹理',
    'panel.pattern': '纹理样式',
    'panel.cell': '方块大小',
    'panel.textureAlpha': '纹理浓度',
    'panel.shade': '叠加方向',
    'panel.top': '顶部黑度',
    'panel.mid': '中部黑度',
    'panel.bottom': '底部黑度',
    'panel.opacity': '整条不透明度',
    'panel.height': '条高',
    'panel.variant': '形态',
    'panel.poll': '刷新间隔',
    'panel.hint1': '改动即时生效，保存在本浏览器（localStorage）；',
    'panel.hint2': 'cordis.patch.yml 仍是基线。',
    'palette.aurora': 'aurora 绿→琥珀→红',
    'palette.signal': 'signal 四段',
    'palette.mono': 'mono 中性',
    'palette.custom': 'custom 自定义',
    'pattern.squares': '密集小方块',
    'pattern.dots': '点阵',
    'pattern.grid': '网格',
    'pattern.none': '无',
    'shade.topDark': '自上而下压暗',
    'shade.bottomDark': '自下而上压暗',
    'shade.vignette': '两端压暗',
    'shade.uniform': '均匀压暗',
    'shade.off': '关闭',
    'variant.pill': '胶囊 pill',
    'variant.rail': '细轨 rail',
    'poll.10': '10 秒',
    'poll.30': '30 秒',
    'poll.60': '60 秒',
    'poll.300': '5 分钟',
  },
  en: {
    'label.default': 'Balance',
    'ph.loading': '…',
    'ph.nokey': 'No key',
    'ph.retry': 'Retry',
    'tip.noAnchor': 'No 100% anchor set (100 by default; over-100 shown as-is)',
    'tip.anchor': '100% = {anchor}',
    'tip.updated': 'Updated {time}',
    'tip.click': 'Click to refresh · coin button for settings',
    'tip.noKey': 'No credentials: set an API key or sign in to DSH',
    'tip.failed': 'Balance endpoint unavailable, click to retry',
    'panel.title': 'Balance strip settings',
    'panel.close': 'Close',
    'panel.done': 'Done',
    'panel.reset': 'Reset',
    'panel.anchor': '100% = amount',
    'panel.anchorPh': 'empty = 100',
    'panel.anchorDefault': 'default',
    'panel.dynamic': 'Dynamic color',
    'panel.palette': 'Palette',
    'panel.colorHigh': 'Full color',
    'panel.colorLow': 'Empty color',
    'panel.texture': 'Texture',
    'panel.pattern': 'Pattern',
    'panel.cell': 'Cell size',
    'panel.textureAlpha': 'Texture strength',
    'panel.shade': 'Shade direction',
    'panel.top': 'Top darkness',
    'panel.mid': 'Middle darkness',
    'panel.bottom': 'Bottom darkness',
    'panel.opacity': 'Bar opacity',
    'panel.height': 'Height',
    'panel.variant': 'Shape',
    'panel.poll': 'Refresh every',
    'panel.hint1': 'Changes apply instantly and live in this browser (localStorage);',
    'panel.hint2': 'cordis.patch.yml stays the baseline.',
    'palette.aurora': 'aurora green→amber→red',
    'palette.signal': 'signal (4 stops)',
    'palette.mono': 'mono (neutral)',
    'palette.custom': 'custom',
    'pattern.squares': 'Squares',
    'pattern.dots': 'Dots',
    'pattern.grid': 'Grid',
    'pattern.none': 'None',
    'shade.topDark': 'Darker at top',
    'shade.bottomDark': 'Darker at bottom',
    'shade.vignette': 'Vignette (both ends)',
    'shade.uniform': 'Uniform',
    'shade.off': 'Off',
    'variant.pill': 'Pill',
    'variant.rail': 'Rail',
    'poll.10': '10 s',
    'poll.30': '30 s',
    'poll.60': '60 s',
    'poll.300': '5 min',
  },
}

let currentLang = 'zh'
const langListeners = new Set()

function normalizeLang(value) {
  return value === 'en' ? 'en' : 'zh'
}

function setLang(value) {
  const next = normalizeLang(value)
  if (next === currentLang) return
  currentLang = next
  for (const listener of [...langListeners]) listener(next)
}

/** 取文案；缺失时回落到中文，再回落到 key 本身。 */
function t(key, vars, lang) {
  const dict = I18N[normalizeLang(lang || currentLang)] || I18N.zh
  let text = dict[key]
  if (text === undefined) text = I18N.zh[key]
  if (text === undefined) return key
  if (vars === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
}

function useLang() {
  const [lang, setLocal] = useState(currentLang)
  useEffect(() => {
    const listener = (next) => setLocal(next)
    langListeners.add(listener)
    setLocal(currentLang)
    return () => langListeners.delete(listener)
  }, [])
  return lang
}

/**
 * 面板要逃出 composer 的裁剪层：优先用 react-dom 的 portal 挂到 document.body；
 * 取不到 react-dom 时退回到「锚在按钮上方的绝对定位」。
 */
let reactDomCache
function getReactDom() {
  if (reactDomCache !== undefined) return reactDomCache
  reactDomCache = null
  try {
    const candidate = require('react-dom')
    if (candidate && typeof candidate.createPortal === 'function') reactDomCache = candidate
  } catch {
    reactDomCache = null
  }
  return reactDomCache
}

/** 金币图标（与 assets/coin.svg 同几何）：外环 + ¥，颜色跟随 currentColor。 */
function CoinIcon(props) {
  const size = props && Number.isFinite(props.size) ? props.size : 14
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    'aria-hidden': 'true',
    focusable: 'false',
    style: { display: 'block' },
  },
  h('circle', { cx: 8, cy: 8, r: 6.1, fill: 'currentColor', opacity: 0.14 }),
  h('circle', { cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.85 }),
  h('path', { d: 'M4.6 4.4 8 8.2l3.4-3.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  h('path', { d: 'M8 8.2v3.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
  h('path', { d: 'M5.4 8.6h5.2M5.4 10.6h5.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
  )
}

const CSS = `
.dbb-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  order: ${DOCK_ORDER};
  min-width: 0;
}
.dbb {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--dbb-height, 18px);
  min-width: 108px;
  padding: 0 9px;
  border-radius: var(--dbb-radius, 999px);
  background-color: var(--dbb-fill, #7a828a);
  background-image: var(--dbb-texture-image, none);
  background-size: var(--dbb-texture-size, auto);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.10), 0 0 0 0.5px var(--dbb-ring, rgba(0, 0, 0, 0.12));
  opacity: var(--dbb-opacity, 0.94);
  overflow: hidden;
  isolation: isolate;
  font-size: 11px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--dbb-ink, #ffffff);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background-color 500ms ease-out, opacity 200ms ease-out;
}
.dbb:hover { opacity: 1; }
.dbb:focus-visible,
.dbb-gear:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6); outline-offset: 2px; }
.dbb__shade {
  position: absolute;
  inset: 0;
  background: var(--dbb-shade, none);
  pointer-events: none;
}
.dbb__gloss {
  position: absolute;
  inset: 0 0 auto 0;
  height: 52%;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0));
  pointer-events: none;
}
.dbb__text { position: relative; z-index: 1; letter-spacing: 0.01em; }
.dbb--rail { height: 3px; min-width: 72px; padding: 0; border-radius: 3px; }
.dbb--rail .dbb__text { display: none; }
.dbb--muted { background-color: #7a828a; }
.dbb--busy .dbb__text { opacity: 0.72; }
.dbb-gear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8a9099);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: color 150ms ease-out, background 150ms ease-out;
}
.dbb-gear:hover {
  color: var(--dsw-alias-label-primary, #e8eaed);
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.16));
}
.dbb-panel-wrap { position: fixed; z-index: 2147483000; }
.dbb-panel-wrap--inline { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 2147483000; }
.dbb-panel {
  width: 296px;
  max-height: 72vh;
  overflow: auto;
  padding: 12px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, #1c2027);
  color: var(--dsw-alias-label-primary, #e8eaed);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.16);
  font-size: 11px;
  line-height: 1.5;
}
.dbb-panel__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
}
.dbb-panel__brand { display: inline-flex; align-items: center; gap: 6px; }
.dbb-panel__brand svg { color: #f4af1f; }
.dbb-panel__row {
  display: grid;
  grid-template-columns: 82px 1fr auto;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}
.dbb-panel__row > label { color: var(--dsw-alias-label-secondary, #9aa1ab); }
.dbb-panel__ctl { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dbb-panel input[type="number"],
.dbb-panel input[type="text"],
.dbb-panel select {
  min-width: 0;
  width: 100%;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.3));
  background: var(--dsw-alias-bg-layer-3, rgba(127, 127, 127, 0.12));
  color: inherit;
  font-size: 11px;
}
.dbb-panel input[type="range"] { width: 100%; }
.dbb-panel input[type="color"] {
  width: 30px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.3));
  border-radius: 5px;
  background: transparent;
}
.dbb-panel__val { min-width: 34px; text-align: right; color: var(--dsw-alias-label-secondary, #9aa1ab); }
.dbb-panel__hint { color: var(--dsw-alias-label-tertiary, #848b95); font-size: 10px; margin-top: 8px; }
.dbb-panel__actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
.dbb-panel button {
  padding: 3px 10px;
  border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.3));
  background: var(--dsw-alias-bg-layer-3, rgba(127, 127, 127, 0.12));
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}
.dbb-panel button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.2)); }
.dbb-panel button.dbb-primary {
  background: var(--dsw-alias-state-business-primary, #4176e6);
  border-color: transparent;
  color: #fff;
}
`

function injectCss() {
  if (typeof document === 'undefined') return
  if (typeof document.getElementById === 'function' && document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  const host = document.head || document.body
  if (host && typeof host.appendChild === 'function') host.appendChild(style)
}

function isDarkTheme() {
  if (typeof document === 'undefined') return false
  const root = document.body || document.documentElement
  if (!root || typeof root.hasAttribute !== 'function') return false
  return root.hasAttribute('data-ds-dark-theme')
}

function readSaved() {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSaved(patch) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patch))
  } catch {
    // 存不了就只在本次会话生效
  }
}

/** 宿主 config ← 本地覆盖（overlay/texture 深合并） */
function mergeConfig(hostConfig, saved) {
  const base = hostConfig && typeof hostConfig === 'object' ? hostConfig : {}
  const override = saved && typeof saved === 'object' ? saved : {}
  return core.normalizeConfig({
    ...base,
    ...override,
    overlay: { ...(base.overlay || {}), ...(override.overlay || {}) },
    texture: { ...(base.texture || {}), ...(override.texture || {}) },
  })
}

/** 宿主 config 里的 label 默认值是中文「余额」；英文界面下换成 Balance。 */
function labelOf(config, lang) {
  const fallback = t('label.default', undefined, lang)
  const raw = typeof config.label === 'string' ? config.label : ''
  if (raw === '' || raw === '余额' || raw === 'Balance') return fallback
  return raw
}

function labelText(view, config, lang) {
  const label = labelOf(config, lang)
  if (view.amountText === null) return label ? `${label} ${view.placeholder}` : view.placeholder
  const parts = []
  if (label) parts.push(label)
  if (config.showAmount) parts.push(view.amountText)
  if (config.showPercent && view.percentText !== '') parts.push(view.percentText)
  return parts.length > 0 ? parts.join(' ') : '—'
}

function titleText(view, config, state, lang) {
  if (view.amountText === null) {
    return view.title || t(state.status === 'nokey' ? 'tip.noKey' : 'tip.failed', undefined, lang)
  }
  const parts = [view.amountText]
  parts.push(config.anchorSet ? t('tip.anchor', { anchor: config.anchor }, lang) : t('tip.noAnchor', undefined, lang))
  if (state.fetchedAt) parts.push(t('tip.updated', { time: new Date(state.fetchedAt).toLocaleTimeString() }, lang))
  parts.push(t('tip.click', undefined, lang))
  return parts.join(' · ')
}

// ---------------------------------------------------------------- 设置面板

function row(label, control, trailing) {
  return h('div', { className: 'dbb-panel__row' },
    h('label', null, label),
    h('div', { className: 'dbb-panel__ctl' }, control),
    h('span', { className: 'dbb-panel__val' }, trailing === undefined ? '' : trailing),
  )
}

function rangeRow(label, value, min, max, step, onChange) {
  return row(label,
    h('input', { type: 'range', min, max, step, value, onChange: (event) => onChange(Number(event.target.value)) }),
    String(value),
  )
}

function selectRow(label, value, options, onChange) {
  return row(label, h('select', {
    value,
    onChange: (event) => onChange(event.target.value),
  }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label))))
}

function SettingsPanel(props) {
  const { config, onChange, onReset, onClose, anchorText, onAnchorText, lang } = props
  const set = (patch) => onChange(patch)
  const text = (key) => t(key, undefined, lang)
  const texture = config.texture
  const overlay = config.overlay

  return h('div', {
    className: 'dbb-panel',
    role: 'dialog',
    'aria-label': text('panel.title'),
    onClick: (event) => event.stopPropagation(),
  },
  h('div', { className: 'dbb-panel__title' },
    h('span', { className: 'dbb-panel__brand' }, h(CoinIcon, { size: 16 }), h('span', null, text('panel.title'))),
    h('button', { type: 'button', onClick: onClose }, text('panel.close')),
  ),

  row(text('panel.anchor'), h('input', {
    type: 'number',
    min: 1,
    step: 10,
    placeholder: text('panel.anchorPh'),
    value: anchorText,
    onChange: (event) => onAnchorText(event.target.value),
  }), config.anchorSet ? '' : text('panel.anchorDefault')),

  row(text('panel.dynamic'), h('input', {
    type: 'checkbox',
    checked: config.dynamic,
    onChange: (event) => set({ dynamic: event.target.checked }),
  })),

  selectRow(text('panel.palette'), config.palette, [
    { value: 'aurora', label: text('palette.aurora') },
    { value: 'signal', label: text('palette.signal') },
    { value: 'mono', label: text('palette.mono') },
    { value: 'custom', label: text('palette.custom') },
  ], (value) => set({ palette: value })),

  row(text('panel.colorHigh'), h('input', {
    type: 'color',
    value: config.colorHigh,
    onChange: (event) => set({ colorHigh: event.target.value, palette: 'custom' }),
  }), config.colorHigh),
  row(text('panel.colorLow'), h('input', {
    type: 'color',
    value: config.colorLow,
    onChange: (event) => set({ colorLow: event.target.value, palette: 'custom' }),
  }), config.colorLow),

  row(text('panel.texture'), h('input', {
    type: 'checkbox',
    checked: texture.enabled,
    onChange: (event) => set({ texture: { enabled: event.target.checked } }),
  })),
  selectRow(text('panel.pattern'), texture.pattern, [
    { value: 'squares', label: text('pattern.squares') },
    { value: 'dots', label: text('pattern.dots') },
    { value: 'grid', label: text('pattern.grid') },
    { value: 'none', label: text('pattern.none') },
  ], (value) => set({ texture: { pattern: value, enabled: value !== 'none' } })),
  rangeRow(text('panel.cell'), texture.size, 2, 16, 1, (value) => set({ texture: { size: value } })),
  rangeRow(text('panel.textureAlpha'), texture.alpha, 0, 0.6, 0.02, (value) => set({ texture: { alpha: value } })),

  selectRow(text('panel.shade'), overlay.direction, [
    { value: 'top-dark', label: text('shade.topDark') },
    { value: 'bottom-dark', label: text('shade.bottomDark') },
    { value: 'vignette', label: text('shade.vignette') },
    { value: 'uniform', label: text('shade.uniform') },
    { value: 'off', label: text('shade.off') },
  ], (value) => set({ overlay: { direction: value } })),
  rangeRow(text('panel.top'), overlay.top, 0, 0.8, 0.02, (value) => set({ overlay: { top: value } })),
  rangeRow(text('panel.mid'), overlay.mid, 0, 0.8, 0.02, (value) => set({ overlay: { mid: value } })),
  rangeRow(text('panel.bottom'), overlay.bottom, 0, 0.8, 0.02, (value) => set({ overlay: { bottom: value } })),

  rangeRow(text('panel.opacity'), config.opacity, 0.2, 1, 0.02, (value) => set({ opacity: value })),
  rangeRow(text('panel.height'), config.height, 14, 28, 1, (value) => set({ height: value })),
  selectRow(text('panel.variant'), config.variant, [
    { value: 'pill', label: text('variant.pill') },
    { value: 'rail', label: text('variant.rail') },
  ], (value) => set({ variant: value })),
  selectRow(text('panel.poll'), String(config.pollSeconds), [
    { value: '10', label: text('poll.10') },
    { value: '30', label: text('poll.30') },
    { value: '60', label: text('poll.60') },
    { value: '300', label: text('poll.300') },
  ], (value) => set({ pollSeconds: Number(value) })),

  h('div', { className: 'dbb-panel__hint' }, text('panel.hint1'), h('br'), text('panel.hint2')),
  h('div', { className: 'dbb-panel__actions' },
    h('button', { type: 'button', onClick: onReset }, text('panel.reset')),
    h('button', { type: 'button', className: 'dbb-primary', onClick: onClose }, text('panel.done')),
  ),
  )
}

// ---------------------------------------------------------------- 主组件

function BalanceBar() {
  const lang = useLang()
  const [state, setState] = useState({ status: 'loading', data: null, refreshing: false, stale: false, fetchedAt: 0 })
  const [saved, setSaved] = useState(() => readSaved())
  const [open, setOpen] = useState(false)
  const [anchorText, setAnchorText] = useState(() => {
    const current = readSaved()
    return typeof current.anchor === 'number' && current.anchor > 0 ? String(current.anchor) : ''
  })
  const [panelPos, setPanelPos] = useState({ left: 8, top: 120, mode: 'above' })
  const stateRef = useRef(state)
  const savedRef = useRef(saved)
  const lastOk = useRef(0)
  const gearRef = useRef(null)
  stateRef.current = state
  savedRef.current = saved

  const hostConfig = state.data && state.data.config ? state.data.config : {}
  const config = useMemo(() => mergeConfig(hostConfig, saved), [hostConfig, saved])

  const load = useCallback(async (force) => {
    const now = Date.now()
    if (!force && lastOk.current !== 0 && now - lastOk.current < CACHE_MS) return
    // 有数据时只标记 refreshing，绝不清空 data（否则会闪成占位符）
    setState((prev) => (prev.data ? { ...prev, refreshing: true } : { ...prev, status: 'loading', refreshing: true }))
    try {
      const res = await fetch(STATE_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      const body = await res.json()
      if (body && body.ok === true && body.balance) {
        lastOk.current = Date.now()
        setState({ status: 'ok', data: body, refreshing: false, stale: false, fetchedAt: lastOk.current })
      } else if (body && body.reason === 'no-api-key') {
        setState({ status: 'nokey', data: body, refreshing: false, stale: false, fetchedAt: Date.now() })
      } else {
        setState((prev) => (prev.data && prev.data.ok === true
          ? { ...prev, refreshing: false, stale: true }
          : { status: 'error', data: body || null, refreshing: false, stale: false, fetchedAt: Date.now() }))
      }
    } catch (error) {
      setState((prev) => (prev.data && prev.data.ok === true
        ? { ...prev, refreshing: false, stale: true }
        : { status: 'error', data: { message: error instanceof Error ? error.message : String(error) }, refreshing: false, stale: false, fetchedAt: Date.now() }))
    }
  }, [])

  useEffect(() => {
    let alive = true
    let timer = null
    const loop = async () => {
      await load(true)
      if (!alive) return
      const cfg = mergeConfig(stateRef.current.data && stateRef.current.data.config, savedRef.current)
      timer = setTimeout(loop, Math.max(10, cfg.pollSeconds) * 1000)
    }
    void loop()
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (gearRef.current && event && event.target && gearRef.current.contains && gearRef.current.contains(event.target)) return
      setOpen(false)
    }
    const timer = setTimeout(() => {
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('mousedown', close)
      }
    }, 0)
    return () => {
      clearTimeout(timer)
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('mousedown', close)
      }
    }
  }, [open])

  const view = core.viewOf(state, config)
  if (view.amountText === null) {
    const key = state.status === 'nokey' ? 'ph.nokey' : state.status === 'error' ? 'ph.retry' : 'ph.loading'
    view.placeholder = t(key, undefined, lang)
  }
  const ratio = typeof view.ratio === 'number' ? view.ratio : 0
  const vars = core.cssVarsFor(ratio, config, { dark: isDarkTheme() })
  if (view.muted) vars['--dbb-fill'] = core.NEUTRAL_FILL

  const className = 'dbb'
    + (config.variant === 'rail' ? ' dbb--rail' : '')
    + (view.muted ? ' dbb--muted' : '')
    + (state.refreshing ? ' dbb--busy' : '')

  const applyChange = (patch) => {
    setSaved((prev) => {
      const next = {
        ...prev,
        ...patch,
        overlay: { ...(prev.overlay || {}), ...(patch.overlay || {}) },
        texture: { ...(prev.texture || {}), ...(patch.texture || {}) },
      }
      writeSaved(next)
      return next
    })
  }

  const applyAnchorText = (raw) => {
    setAnchorText(raw)
    setSaved((prev) => {
      const next = { ...prev }
      if (String(raw).trim() === '') delete next.anchor
      else {
        const n = Number(raw)
        if (Number.isFinite(n) && n > 0) next.anchor = n
      }
      writeSaved(next)
      return next
    })
  }

  const togglePanel = () => {
    const next = !open
    if (next && gearRef.current && typeof gearRef.current.getBoundingClientRect === 'function') {
      const rect = gearRef.current.getBoundingClientRect()
      const width = 296
      const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280
      const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
      const left = Math.max(8, Math.min(viewportW - width - 8, rect.right - width))
      const above = rect.top >= 360
      const top = above ? rect.top - 8 : Math.min(viewportH - 24, rect.bottom + 8)
      setPanelPos({ left, top, mode: above ? 'above' : 'below' })
    }
    setOpen(next)
  }

  function renderPanel() {
    const panel = h(SettingsPanel, {
      config,
      lang,
      anchorText,
      onAnchorText: applyAnchorText,
      onChange: applyChange,
      onReset: () => {
        setSaved({})
        setAnchorText('')
        try {
          if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY)
        } catch {
          // ignore
        }
      },
      onClose: () => setOpen(false),
    })

    const reactDom = getReactDom()
    const canPortal = reactDom !== null && typeof document !== 'undefined' && document.body
    if (canPortal) {
      const style = {
        left: `${panelPos.left}px`,
        top: `${panelPos.top}px`,
        transform: panelPos.mode === 'above' ? 'translateY(-100%)' : 'none',
      }
      return reactDom.createPortal(
        h('div', {
          className: 'dbb-panel-wrap',
          'data-dbb-panel': panelPos.mode,
          style,
          onMouseDown: (event) => event.stopPropagation(),
          onClick: (event) => event.stopPropagation(),
        }, panel),
        document.body,
      )
    }
    return h('div', {
      className: 'dbb-panel-wrap--inline',
      'data-dbb-panel': 'inline',
      onMouseDown: (event) => event.stopPropagation(),
      onClick: (event) => event.stopPropagation(),
    }, panel)
  }

  return h('span', {
    className: 'dbb-wrap',
    onClick: (event) => event.stopPropagation(),
  },
  h('span', {
    className,
    style: vars,
    title: titleText(view, config, state, lang),
    role: 'status',
    tabIndex: 0,
    onClick: () => { void load(true) },
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        void load(true)
      }
    },
  },
  h('span', { className: 'dbb__shade' }),
  h('span', { className: 'dbb__gloss' }),
  h('span', { className: 'dbb__text' }, labelText(view, config, lang)),
  ),

  h('button', {
    type: 'button',
    ref: gearRef,
    className: 'dbb-gear',
    title: t('panel.title', undefined, lang),
    'aria-label': t('panel.title', undefined, lang),
    onClick: togglePanel,
  }, h(CoinIcon)),

  open ? renderPanel() : null,
  )
}

const inject = ['slots', 'locale']

function apply(ctx) {
  injectCss()

  // 跟随客户端语言；locale 服务缺失时保持中文
  const syncLocale = () => {
    try {
      const snapshot = typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : null
      setLang(snapshot && snapshot.active === 'en' ? 'en' : 'zh')
    } catch {
      setLang('zh')
    }
  }
  syncLocale()
  if (ctx.locale && typeof ctx.locale.subscribe === 'function') {
    ctx.effect(() => ctx.locale.subscribe(syncLocale), 'dsh-balance-strip: locale subscription')
  }

  ctx.slots.inject(SLOT, () => ctx.slots.register({
    name: SLOT,
    id: PLUGIN_ID,
    order: DOCK_ORDER,
    registrant: PLUGIN_ID,
  }, BalanceBar))
}

module.exports = {
  name: PLUGIN_ID,
  inject,
  apply,
  BalanceBar,
  SettingsPanel,
  CoinIcon,
  CSS,
  DOCK_ORDER,
  I18N,
  t,
  setLang,
}
