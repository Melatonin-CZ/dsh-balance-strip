'use strict'
/*
 * dsh-balance-strip / core.cjs — 纯函数层（无 React、无 DOM、无 Node API）
 *
 * 设计依据见 docs/RESEARCH.md：
 *  - 色带在 OKLCH 里分段插值（sRGB 混色会发灰，见 MDN color-mix 的色彩空间说明）
 *  - 多色相 + 相邻站亮度差 ≥0.06（Datawrapper：色相要有不同 lightness 才能适应色盲）
 *  - 条内文字自适应白/黑，任何百分比下对比度 ≥4.5:1（WCAG 1.4.3）
 *
 * 本文件同时被 Node 测试（require）与浏览器 bundle（拼接进 factory）使用，
 * 所以写成 CJS 且不 import 任何东西。
 */

// ---------------------------------------------------------------- 基础数学

function clamp(value, low, high) {
  const n = Number(value)
  if (!Number.isFinite(n)) return low
  return n < low ? low : n > high ? high : n
}

function clamp01(value) {
  return clamp(value, 0, 1)
}

function round(value, digits) {
  const k = Math.pow(10, digits)
  return Math.round(value * k) / k
}

/** 数字 → 紧凑字符串（0.30 → '0.3'，0.34 → '0.34'），用于生成 CSS。 */
function num(value) {
  return String(round(clamp(value, 0, 1), 3))
}

// ---------------------------------------------------------------- 颜色基础

function parseHex(input) {
  if (typeof input !== 'string') return null
  let s = input.trim().replace(/^#/, '')
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  }
}

function toHex(rgb) {
  const part = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`
}

/** sRGB 8bit → 线性光 */
function toLinear(channel) {
  const v = channel / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** 线性光 → sRGB 8bit */
function fromLinear(value) {
  const v = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
  return clamp(v * 255, 0, 255)
}

/** OKLCH（L 0..1, C 0..0.4, H 度）→ 线性光 RGB 三元组 */
function oklchToLinear(L, C, H) {
  const rad = (H * Math.PI) / 180
  const a = C * Math.cos(rad)
  const b = C * Math.sin(rad)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
}

/**
 * OKLCH → sRGB（8bit）。超出色域时按 0.002 步长回收色度，
 * 保证结果永远是合法 sRGB 而不是被硬裁剪的脏色。
 */
function oklchToRgb(L, C, H) {
  const safeL = clamp(L, 0, 1)
  let chroma = Math.max(0, C)
  for (;;) {
    const lin = oklchToLinear(safeL, chroma, H)
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005) || chroma <= 0.002) {
      return {
        r: fromLinear(clamp01(lin[0])),
        g: fromLinear(clamp01(lin[1])),
        b: fromLinear(clamp01(lin[2])),
      }
    }
    chroma -= 0.002
  }
}

function oklchToHex(L, C, H) {
  return toHex(oklchToRgb(L, C, H))
}

/** sRGB（任意 #rgb/#rrggbb）→ OKLCH */
function srgbToOklch(hex) {
  const rgb = parseHex(hex)
  if (rgb === null) return { l: 0, c: 0, h: 0 }
  const r = toLinear(rgb.r)
  const g = toLinear(rgb.g)
  const b = toLinear(rgb.b)
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  const c = Math.sqrt(A * A + B * B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c, h }
}

// ---------------------------------------------------------------- 色阶

/** 内置预设：每站 { f: 百分比(0..1), l, c, h }，f 从大到小排列 */
const PALETTES = {
  // 默认：绿 → 琥珀 → 红，OKLCH 分段，亮度 0.74/0.80/0.62
  aurora: [
    { f: 1, l: 0.74, c: 0.17, h: 152 },
    { f: 0.5, l: 0.80, c: 0.16, h: 79 },
    { f: 0, l: 0.62, c: 0.22, h: 25 },
  ],
  // 分段感更强（ColorBrewer RdYlGn 形态，四站）
  signal: [
    { f: 1, l: 0.70, c: 0.19, h: 145 },
    { f: 0.66, l: 0.83, c: 0.18, h: 100 },
    { f: 0.33, l: 0.82, c: 0.19, h: 62 },
    { f: 0, l: 0.58, c: 0.23, h: 25 },
  ],
  // 完全不用红绿：中性单色相亮度带
  mono: [
    { f: 1, l: 0.55, c: 0.02, h: 250 },
    { f: 0, l: 0.85, c: 0.02, h: 250 },
  ],
}

const NEUTRAL_FILL = '#7a828a'

const DEFAULTS = Object.freeze({
  // 100% 对应的金额，由用户自己定（默认本币 100 单位）。超过它就一律按 100% 的颜色显示。
  anchor: 100,
  mode: 'anchor',
  dynamic: true,
  palette: 'aurora',
  colorHigh: '#22c55e',
  colorLow: '#e5484d',
  interpolation: 'oklch',
  overlay: Object.freeze({ enabled: true, direction: 'top-dark', top: 0.34, mid: 0.18, bottom: 0.06 }),
  // 底色纹理：**默认关闭**（保持原生干净的纯色胶囊）；开启后默认图案是密集小方块，也可选点阵/网格
  texture: Object.freeze({ enabled: false, pattern: 'squares', size: 4, alpha: 0.14 }),
  opacity: 0.94,
  variant: 'pill',
  height: 18,
  showAmount: true,
  showPercent: true,
  label: '余额',
  pollSeconds: 30,
  baseUrl: 'https://api.deepseek.com',
})

/** 色相最短弧插值 */
function lerpHue(h1, h2, t) {
  const delta = ((h2 - h1 + 540) % 360) - 180
  return (h1 + delta * t + 360) % 360
}

/** 色相最短弧间距（度） */
function hueGap(h1, h2) {
  return Math.abs(((h2 - h1 + 540) % 360) - 180)
}

/**
 * 解析成色阶站点数组（f 从大到小）。
 * custom 预设：两端色相间距 >60° 时插入高亮中间站，避开绿红直连的泥褐中点。
 */
function paletteStops(config) {
  const cfg = normalizeConfig(config || {})
  if (cfg.palette !== 'custom') {
    const preset = PALETTES[cfg.palette] || PALETTES.aurora
    return preset.map((stop) => ({ ...stop }))
  }
  const high = parseHex(cfg.colorHigh) || parseHex(DEFAULTS.colorHigh)
  const low = parseHex(cfg.colorLow) || parseHex(DEFAULTS.colorLow)
  const highHex = toHex(high)
  const lowHex = toHex(low)
  const a = srgbToOklch(highHex)
  const b = srgbToOklch(lowHex)
  const stops = [
    { f: 1, l: a.l, c: a.c, h: a.h, hex: highHex },
    { f: 0, l: b.l, c: b.c, h: b.h, hex: lowHex },
  ]
  if (hueGap(a.h, b.h) > 60) {
    const midChroma = Math.min(0.19, Math.max(a.c, b.c) * 0.9 + 0.02)
    const midHue = (a.h + (((b.h - a.h + 540) % 360) - 180) * 0.5 + 360) % 360
    stops.splice(1, 0, { f: 0.5, l: 0.80, c: midChroma, h: midHue })
  }
  return stops
}

function stopHex(stop) {
  return typeof stop.hex === 'string' ? stop.hex : oklchToHex(stop.l, stop.c, stop.h)
}

/**
 * 百分比 → 颜色。
 * @param {number} fraction 0..1
 * @param {object} config 归一化配置（internal 调用时已归一化，外部可传原始配置）
 */
function scaleAt(fraction, config) {
  const cfg = config && typeof config === 'object' && 'overlay' in config ? config : normalizeConfig(config || {})
  if (cfg.dynamic === false) return NEUTRAL_FILL
  const f = clamp01(fraction)
  const stops = paletteStops(cfg)
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (f >= first.f) return stopHex(first)
  if (f <= last.f) return stopHex(last)

  for (let i = 0; i < stops.length - 1; i += 1) {
    const upper = stops[i]
    const lower = stops[i + 1]
    if (f <= upper.f && f >= lower.f) {
      const span = upper.f - lower.f
      const t = span === 0 ? 0 : (upper.f - f) / span
      if (cfg.interpolation === 'srgb') {
        const from = parseHex(stopHex(upper))
        const to = parseHex(stopHex(lower))
        return toHex({
          r: from.r + (to.r - from.r) * t,
          g: from.g + (to.g - from.g) * t,
          b: from.b + (to.b - from.b) * t,
        })
      }
      return oklchToHex(
        upper.l + (lower.l - upper.l) * t,
        upper.c + (lower.c - upper.c) * t,
        lerpHue(upper.h, lower.h, t),
      )
    }
  }
  return stopHex(last)
}

// ---------------------------------------------------------------- 数值 → 比例

/**
 * 余额 → 百分比。
 * anchor 模式：分母是用户自定义的「100% 对应金额」；spent 模式：分母是「余额+今日花费」。
 * 超过锚点一律钳制到 1（100% 的颜色不再变化）。没有可用分母时返回 0，
 * 不夸大成 100%，由 UI 用 `—` 表达「未知」。
 */
function fractionFromBalance(input) {
  const options = input || {}
  const balance = Number(options.balance)
  const safeBalance = Number.isFinite(balance) ? balance : 0
  if (safeBalance <= 0) return 0
  const anchor = Number(options.anchor !== undefined ? options.anchor : options.budget)
  const spent = Number(options.spentToday)
  const useSpent = options.mode === 'spent' || !(Number.isFinite(anchor) && anchor > 0)
  if (useSpent) {
    if (!(Number.isFinite(spent) && spent > 0)) return 0
    return safeBalance / (safeBalance + spent)
  }
  return safeBalance / anchor
}

/** 颜色只认 0..1：比例超过 1（余额超过 anchor）时保持满格颜色。 */
function colorFraction(ratio) {
  return clamp01(ratio)
}

// ---------------------------------------------------------------- 叠加与对比度

function compositeOverBlack(hex, alpha) {
  const rgb = parseHex(hex)
  if (rgb === null) return '#000000'
  const a = clamp01(alpha)
  return toHex({ r: rgb.r * (1 - a), g: rgb.g * (1 - a), b: rgb.b * (1 - a) })
}

function relativeLuminance(hex) {
  const rgb = parseHex(hex)
  if (rgb === null) return 0
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return round((lighter + 0.05) / (darker + 0.05), 3)
}

const INK_CANDIDATES = ['#ffffff', '#000000']

/** 在给定底色上挑对比度更高的文字色（白/黑二选一，数学上不存在双失败区间） */
function pickReadableText(background) {
  let best = INK_CANDIDATES[0]
  let bestRatio = -1
  for (const ink of INK_CANDIDATES) {
    const ratio = contrastRatio(ink, background)
    if (ratio > bestRatio) {
      bestRatio = ratio
      best = ink
    }
  }
  return best
}

/**
 * 条体叠加层：自上而下（或反向）的黑色渐变。
 * 三段 alpha 让过渡不是直线，避免大面积上的带状分层。
 */
function overlayGradientCss(overlay) {
  const o = overlay || {}
  if (o.enabled === false || o.direction === 'off') return 'none'
  const top = num(clamp(o.top === undefined ? DEFAULTS.overlay.top : o.top, 0, 1))
  const mid = num(clamp(o.mid === undefined ? DEFAULTS.overlay.mid : o.mid, 0, 1))
  const bottom = num(clamp(o.bottom === undefined ? DEFAULTS.overlay.bottom : o.bottom, 0, 1))
  const rgba = (alpha) => `rgba(0, 0, 0, ${alpha})`
  if (o.direction === 'uniform') {
    return `linear-gradient(to bottom, ${rgba(top)} 0%, ${rgba(top)} 100%)`
  }
  if (o.direction === 'bottom-dark') {
    return `linear-gradient(to bottom, ${rgba(bottom)} 0%, ${rgba(mid)} 55%, ${rgba(top)} 100%)`
  }
  if (o.direction === 'vignette') {
    // 两端压暗、中间受光：顶部内阴影 + 底部回压，玻璃管质感。底部band强度用 bottom 值。
    return `linear-gradient(to bottom, ${rgba(top)} 0%, ${rgba(mid)} 46%, rgba(0, 0, 0, 0) 64%), linear-gradient(to top, ${rgba(bottom)} 0%, rgba(0, 0, 0, 0) 42%)`
  }
  return `linear-gradient(to bottom, ${rgba(top)} 0%, ${rgba(mid)} 55%, ${rgba(bottom)} 100%)`
}

// ---------------------------------------------------------------- 格式化

const SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', JPY: 'JP¥', HKD: 'HK$' }

function formatMoney(value, currency) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const symbol = SYMBOLS[currency]
  const prefix = symbol !== undefined ? symbol : currency ? `${currency} ` : ''
  const abs = Math.abs(n).toFixed(2)
  const sign = n < 0 ? '-' : ''
  return `${sign}${prefix}${abs}`
}

/** 比例 → 百分比文本。**不钳制**：余额超过 anchor 时如实显示 200%。 */
function formatPercent(fraction) {
  const n = Number(fraction)
  if (!Number.isFinite(n)) return '—'
  const rounded = round(n * 100, 1)
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

// ---------------------------------------------------------------- 配置归一

const DIRECTIONS = ['top-dark', 'bottom-dark', 'uniform', 'off', 'vignette']
const TEXTURE_PATTERNS = ['squares', 'dots', 'grid', 'none']
const PALETTE_NAMES = ['aurora', 'signal', 'mono', 'custom']
const VARIANTS = ['pill', 'rail']
const MODES = ['anchor', 'spent', 'budget'] // 'budget' 是 'anchor' 的旧别名

function hexOr(value, fallback) {
  return parseHex(value) === null ? fallback : toHex(parseHex(value))
}

function normalizeConfig(partial) {
  const input = partial && typeof partial === 'object' ? partial : {}
  const overlayIn = input.overlay && typeof input.overlay === 'object' ? input.overlay : {}
  const textureIn = input.texture && typeof input.texture === 'object' ? input.texture : {}
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

  // anchor：用户手填则用它；没填就默认 100，并把 anchorSet=false 交给 UI
  // （没填时余额超过 100 就按真实百分比显示，例如 200%）
  const rawAnchor = input.anchor !== undefined ? input.anchor : input.budget
  const anchorNumber = Number(rawAnchor)
  const anchorSet = Number.isFinite(anchorNumber) && anchorNumber > 0

  return {
    anchor: anchorSet ? anchorNumber : DEFAULTS.anchor,
    anchorSet,
    mode: MODES.includes(input.mode) ? (input.mode === 'budget' ? 'anchor' : input.mode) : DEFAULTS.mode,
    dynamic: bool(input.dynamic, DEFAULTS.dynamic),
    palette: PALETTE_NAMES.includes(input.palette) ? input.palette : DEFAULTS.palette,
    colorHigh: hexOr(input.colorHigh, DEFAULTS.colorHigh),
    colorLow: hexOr(input.colorLow, DEFAULTS.colorLow),
    interpolation: input.interpolation === 'srgb' ? 'srgb' : 'oklch',
    overlay: {
      enabled: bool(overlayIn.enabled, DEFAULTS.overlay.enabled),
      direction: DIRECTIONS.includes(overlayIn.direction) ? overlayIn.direction : DEFAULTS.overlay.direction,
      top: clamp(overlayIn.top === undefined ? DEFAULTS.overlay.top : overlayIn.top, 0, 1),
      mid: clamp(overlayIn.mid === undefined ? DEFAULTS.overlay.mid : overlayIn.mid, 0, 1),
      bottom: clamp(overlayIn.bottom === undefined ? DEFAULTS.overlay.bottom : overlayIn.bottom, 0, 1),
    },
    texture: {
      enabled: bool(textureIn.enabled, DEFAULTS.texture.enabled),
      pattern: TEXTURE_PATTERNS.includes(textureIn.pattern) ? textureIn.pattern : DEFAULTS.texture.pattern,
      size: Math.round(clamp(textureIn.size === undefined ? DEFAULTS.texture.size : textureIn.size, 2, 16)),
      alpha: clamp(textureIn.alpha === undefined ? DEFAULTS.texture.alpha : textureIn.alpha, 0, 0.6),
    },
    opacity: clamp(input.opacity === undefined ? DEFAULTS.opacity : input.opacity, 0.2, 1),
    variant: VARIANTS.includes(input.variant) ? input.variant : DEFAULTS.variant,
    height: Math.round(clamp(input.height === undefined ? DEFAULTS.height : input.height, 14, 28)),
    showAmount: bool(input.showAmount, DEFAULTS.showAmount),
    showPercent: bool(input.showPercent, DEFAULTS.showPercent),
    label: typeof input.label === 'string' ? input.label.slice(0, 12) : DEFAULTS.label,
    pollSeconds: Math.round(clamp(input.pollSeconds === undefined ? DEFAULTS.pollSeconds : input.pollSeconds, 10, 600)),
    baseUrl: typeof input.baseUrl === 'string' && input.baseUrl.trim() !== '' ? input.baseUrl.trim() : DEFAULTS.baseUrl,
  }
}

/**
 * 底色纹理：密集小方块（棋盘格）/ 点阵 / 网格。
 *
 * 关键坑：`background-image` **不接受** `position / size` 语法（那是 `background` 简写的），
 * 所以尺寸必须拆到 `background-size` 里，否则整条声明被浏览器丢弃 ——
 * 这正是「选了纹理样式没反应」的原因（v0.3 及以前）。
 *
 * @returns {{ image: string, size: string }} 分别塞进 background-image / background-size
 */
function textureParts(texture) {
  const off = { image: 'none', size: 'auto' }
  const t = texture || {}
  if (t.enabled === false) return off
  const pattern = TEXTURE_PATTERNS.includes(t.pattern) ? t.pattern : DEFAULTS.texture.pattern
  if (pattern === 'none') return off
  const size = Math.round(clamp(t.size === undefined ? DEFAULTS.texture.size : t.size, 2, 16))
  const alpha = clamp(t.alpha === undefined ? DEFAULTS.texture.alpha : t.alpha, 0, 0.6)
  if (alpha === 0) return off
  const ink = `rgba(0, 0, 0, ${num(alpha)})`
  const clear = 'rgba(0, 0, 0, 0)'

  if (pattern === 'dots') {
    return {
      image: `radial-gradient(circle at 1px 1px, ${ink} 0.6px, ${clear} 0.7px)`,
      size: `${size}px ${size}px`,
    }
  }
  if (pattern === 'grid') {
    return {
      image: `linear-gradient(to right, ${ink} 0.5px, ${clear} 0.5px), linear-gradient(to bottom, ${ink} 0.5px, ${clear} 0.5px)`,
      size: `${size}px ${size}px, ${size}px ${size}px`,
    }
  }
  // squares：轴对齐棋盘格，2×2 个方块铺一个 (2×size) 的周期
  return {
    image: `conic-gradient(from 90deg at 50% 50%, ${ink} 0deg 90deg, ${clear} 90deg 180deg, ${ink} 180deg 270deg, ${clear} 270deg 360deg)`,
    size: `${size * 2}px ${size * 2}px`,
  }
}

/** 只要 background-image 的值。 */
function textureCss(texture) {
  return textureParts(texture).image
}

/** 配套的 background-size 值；关闭时为 auto。 */
function textureSizeCss(texture) {
  return textureParts(texture).size
}

/** 组件用：一次算出全部 CSS 变量 */
function cssVarsFor(fraction, config, options) {
  const cfg = normalizeConfig(config || {})
  const opts = options || {}
  const fill = scaleAt(colorFraction(fraction), cfg)
  const shadeAlpha = (cfg.overlay.top + cfg.overlay.bottom) / 2
  const ink = pickReadableText(compositeOverBlack(fill, cfg.dynamic === false ? shadeAlpha * 0.5 : shadeAlpha))
  const ring = opts.dark === true ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.12)'
  return {
    '--dbb-fill': fill,
    '--dbb-ink': ink,
    '--dbb-shade': overlayGradientCss(cfg.overlay),
    '--dbb-texture-image': textureCss(cfg.texture),
    '--dbb-texture-size': textureSizeCss(cfg.texture),
    '--dbb-opacity': String(round(cfg.opacity, 2)),
    '--dbb-height': `${cfg.height}px`,
    '--dbb-radius': cfg.variant === 'rail' ? '3px' : '999px',
    '--dbb-ring': ring,
  }
}

/**
 * 组件视图状态（纯函数，测试直接覆盖「刷新不闪」）：
 * 已经有数据时，刷新期间必须继续显示上一次的金额与百分比，只有首次加载才显示占位符。
 * @param {{status?: string, data?: object|null, refreshing?: boolean}} state
 * @param {object} config 归一化配置
 */
function viewOf(state, config) {
  const cfg = normalizeConfig(config || {})
  const input = state && typeof state === 'object' ? state : {}
  const data = input.data && typeof input.data === 'object' ? input.data : null
  const hasBalance = Boolean(data && data.ok === true && data.balance)
  const view = {
    amountText: null,
    percentText: '',
    placeholder: '—',
    muted: true,
    stale: input.stale === true,
    title: '',
  }

  if (hasBalance) {
    const balance = data.balance
    const ratio = fractionFromBalance({
      balance: balance.total,
      anchor: cfg.anchor,
      spentToday: data.spentToday,
      mode: cfg.mode,
    })
    const spentOnly = cfg.mode === 'spent' && !(Number(data.spentToday) > 0)
    view.amountText = formatMoney(balance.total, balance.currency)
    view.percentText = spentOnly ? '' : formatPercent(ratio)
    view.placeholder = ''
    view.muted = false
    view.ratio = ratio
    return view
  }

  if (input.status === 'nokey') {
    view.placeholder = '未配置'
    view.title = typeof data?.message === 'string' ? data.message : ''
  } else if (input.status === 'error') {
    view.placeholder = '重试'
    view.title = typeof data?.message === 'string' ? data.message : ''
  } else {
    view.placeholder = '…'
  }
  return view
}

module.exports = {
  clamp,
  clamp01,
  round,
  num,
  parseHex,
  toHex,
  oklchToLinear,
  oklchToRgb,
  oklchToHex,
  srgbToOklch,
  lerpHue,
  hueGap,
  PALETTES,
  PALETTE_NAMES,
  NEUTRAL_FILL,
  DEFAULTS,
  paletteStops,
  scaleAt,
  fractionFromBalance,
  compositeOverBlack,
  relativeLuminance,
  contrastRatio,
  pickReadableText,
  overlayGradientCss,
  formatMoney,
  formatPercent,
  normalizeConfig,
  cssVarsFor,
  colorFraction,
  textureCss,
  textureSizeCss,
  textureParts,
  viewOf,
  TEXTURE_PATTERNS,
  DIRECTIONS,
}
