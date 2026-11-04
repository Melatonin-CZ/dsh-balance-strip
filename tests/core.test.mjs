// TC01–TC15：core.cjs 纯函数契约（RED 先行）
import test from 'node:test'
import assert from 'node:assert/strict'
import core from '../src/shared/core.cjs'

const {
  clamp, clamp01, parseHex, toHex, oklchToHex, srgbToOklch,
  scaleAt, fractionFromBalance, compositeOverBlack, contrastRatio,
  pickReadableText, overlayGradientCss, formatMoney, formatPercent,
  normalizeConfig, cssVarsFor, NEUTRAL_FILL, DEFAULTS,
  textureCss, viewOf, colorFraction,
} = core

// TC01
test('TC01 clamp / clamp01 处理边界与 NaN', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(99, 0, 10), 10)
  assert.equal(clamp(Number.NaN, 2, 8), 2, 'NaN 回落到下界')
  assert.equal(clamp01(0.5), 0.5)
  assert.equal(clamp01(-0.2), 0)
  assert.equal(clamp01(1.5), 1)
})

// TC02
test('TC02 parseHex 支持 #rgb/#rrggbb，非法返回 null', () => {
  assert.deepEqual(parseHex('#22c55e'), { r: 0x22, g: 0xc5, b: 0x5e })
  assert.deepEqual(parseHex('#0f8'), { r: 0x00, g: 0xff, b: 0x88 })
  assert.deepEqual(parseHex('22C55E'), { r: 0x22, g: 0xc5, b: 0x5e })
  assert.equal(parseHex('#12345'), null)
  assert.equal(parseHex('red'), null)
  assert.equal(parseHex(undefined), null)
  assert.equal(toHex({ r: 34, g: 197, b: 94 }), '#22c55e')
})

// TC03
test('TC03 sRGB ↔ OKLCH 往返稳定', () => {
  const samples = [[0.6, 0.1, 30], [0.75, 0.12, 150], [0.4, 0.05, 260], [0.85, 0.08, 90]]
  for (const [l, c, h] of samples) {
    const hex = oklchToHex(l, c, h)
    assert.match(hex, /^#[0-9a-f]{6}$/)
    const back = srgbToOklch(hex)
    assert.ok(Math.abs(back.l - l) <= 0.02, `ΔL ${back.l} vs ${l}`)
    assert.ok(Math.abs(back.c - c) <= 0.025, `ΔC ${back.c} vs ${c}`)
    assert.ok(Math.min(Math.abs(back.h - h), 360 - Math.abs(back.h - h)) <= 3, `ΔH ${back.h} vs ${h}`)
  }
})

// TC04
test('TC04 色阶端点命中预设，中点命中中间站', () => {
  const cfg = normalizeConfig({})
  const high = scaleAt(1, cfg)
  const low = scaleAt(0, cfg)
  const mid = scaleAt(0.5, cfg)

  const hueOf = (hex) => srgbToOklch(hex).h
  assert.ok(Math.abs(hueOf(high) - 152) <= 14, `100% 色相应偏绿，实际 ${hueOf(high).toFixed(1)}`)
  assert.ok(Math.abs(hueOf(low) - 25) <= 14, `0% 色相应偏红，实际 ${hueOf(low).toFixed(1)}`)
  assert.ok(Math.abs(hueOf(mid) - 79) <= 14, `50% 色相应偏琥珀，实际 ${hueOf(mid).toFixed(1)}`)

  // 中点是精确站点：直接等于该站的 oklch 转换结果
  const aurora = core.PALETTES.aurora.find((s) => s.f === 0.5)
  assert.equal(mid, oklchToHex(aurora.l, aurora.c, aurora.h))
})

// TC05
test('TC05 全色带色度不塌陷（不灰不褐）', () => {
  for (const palette of ['aurora', 'signal']) {
    const cfg = normalizeConfig({ palette })
    for (let i = 0; i <= 50; i += 1) {
      const f = i / 50
      const hex = scaleAt(f, cfg)
      const { c } = srgbToOklch(hex)
      assert.ok(c >= 0.1, `${palette} f=${f} 色度 ${c.toFixed(3)} 低于 0.10（发灰）`)
    }
  }
})

// TC06
test('TC06 oklch 与 srgb 插值确实不同', () => {
  const inOklch = scaleAt(0.25, normalizeConfig({ interpolation: 'oklch' }))
  const inSrgb = scaleAt(0.25, normalizeConfig({ interpolation: 'srgb' }))
  const a = parseHex(inOklch)
  const b = parseHex(inSrgb)
  const delta = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
  assert.ok(delta >= 8, `两种插值应有可见差异，实际最大通道差 ${delta}`)
})

// TC07
test('TC07 自定义两端色在端点上精确', () => {
  const cfg = normalizeConfig({ palette: 'custom', colorHigh: '#00ff88', colorLow: '#ff2d55' })
  assert.equal(scaleAt(1, cfg), '#00ff88')
  assert.equal(scaleAt(0, cfg), '#ff2d55')
  assert.equal(scaleAt(2, cfg), '#00ff88', '越界钳制到上端')
  assert.equal(scaleAt(-1, cfg), '#ff2d55', '越界钳制到下端')
})

// TC08
test('TC08 大色相间距自动插中间站，小间距不插', () => {
  // 绿→红：色相间距大
  const wide = normalizeConfig({ palette: 'custom', colorHigh: '#00ff88', colorLow: '#ff2d55' })
  const wideMid = scaleAt(0.5, wide)
  const { c: wideC, l: wideL } = srgbToOklch(wideMid)
  assert.ok(wideC >= 0.1, `中点色度 ${wideC.toFixed(3)} 不应塌陷`)
  assert.ok(wideL >= 0.62, `中点亮度 ${wideL.toFixed(3)} 不应发暗`)

  // 近似同色相（蓝 → 深蓝）：不应插站，中点趋近两端混合
  const narrow = normalizeConfig({ palette: 'custom', colorHigh: '#3b82f6', colorLow: '#1e3a8a' })
  const narrowMid = scaleAt(0.5, narrow)
  const stops = core.paletteStops(narrow)
  assert.equal(stops.length, 2, '同色相不应插中间站')
  assert.notEqual(narrowMid, scaleAt(1, narrow))
  assert.notEqual(narrowMid, scaleAt(0, narrow))
})

// TC09
test('TC09 百分比计算与退化分支', () => {
  assert.equal(fractionFromBalance({ balance: 20, anchor: 20 }), 1)
  assert.equal(fractionFromBalance({ balance: 10, anchor: 20 }), 0.5)
  assert.equal(fractionFromBalance({ balance: 0, anchor: 20 }), 0)
  assert.equal(fractionFromBalance({ balance: -3, anchor: 20 }), 0)
  assert.equal(fractionFromBalance({ balance: 35, anchor: 20 }), 1.75, '比例层不钳制，数字层要如实显示')
  // 本币 100 单位 = 100%；超出部分按 100% 钳制（颜色不再变化）
  assert.equal(fractionFromBalance({ balance: 100, anchor: 100 }), 1)
  assert.equal(fractionFromBalance({ balance: 100.01, anchor: 100 }), 1.0001)
  assert.equal(fractionFromBalance({ balance: 260, anchor: 100 }), 2.6)
  assert.equal(fractionFromBalance({ balance: 73, anchor: 100 }), 0.73)
  // 用户自定义 100% = 500：250 → 50%，500 → 100%，900 → 仍 100%
  assert.equal(fractionFromBalance({ balance: 250, anchor: 500 }), 0.5)
  assert.equal(fractionFromBalance({ balance: 500, anchor: 500 }), 1)
  assert.equal(fractionFromBalance({ balance: 900, anchor: 500 }), 1.8)
  // 锚点 <= 0 且 anchor 模式 → 退化到 spent
  assert.equal(fractionFromBalance({ balance: 30, anchor: 0, spentToday: 10, mode: 'budget' }), 0.75)
  assert.equal(fractionFromBalance({ balance: 30, spentToday: 10, mode: 'spent' }), 0.75)
  // 两者都不可用 → 0，不允许 NaN
  const degenerated = fractionFromBalance({ balance: 30, anchor: 0, spentToday: 0, mode: 'spent' })
  assert.equal(degenerated, 0)
  assert.ok(Number.isFinite(degenerated))
})

// TC10
test('TC10 dynamic=false 时颜色与余额无关且为中性', () => {
  const off = normalizeConfig({ dynamic: false })
  const a = cssVarsFor(0, off)['--dbb-fill']
  const b = cssVarsFor(1, off)['--dbb-fill']
  assert.equal(a, b, '静态模式下 f 不应影响底色')
  assert.equal(a, NEUTRAL_FILL)
  const on = normalizeConfig({ dynamic: true })
  assert.notEqual(cssVarsFor(0, on)['--dbb-fill'], cssVarsFor(1, on)['--dbb-fill'])
})

// TC11
test('TC11 条内文字在整条色带上对比度 ≥ 4.5:1', () => {
  for (const palette of ['aurora', 'signal', 'mono']) {
    const cfg = normalizeConfig({ palette, dynamic: true })
    const shade = (cfg.overlay.top + cfg.overlay.bottom) / 2
    for (let i = 0; i <= 50; i += 1) {
      const f = i / 50
      const fill = scaleAt(f, cfg)
      const bg = compositeOverBlack(fill, shade)
      assert.ok(pickReadableText(bg) !== null)
      const ratio = contrastRatio(pickReadableText(bg), bg)
      assert.ok(ratio >= 4.5, `${palette} f=${f} 对比度 ${ratio.toFixed(2)} < 4.5`)
    }
  }
})

// TC12
test('TC12 叠加层渐变按方向生成', () => {
  const top = overlayGradientCss({ enabled: true, direction: 'top-dark', top: 0.34, bottom: 0.06 })
  assert.match(top, /^linear-gradient\(to bottom, rgba\(0, 0, 0, 0\.34\) 0%, rgba\(0, 0, 0, 0\.18\) 55%, rgba\(0, 0, 0, 0\.06\) 100%\)$/)

  const bottom = overlayGradientCss({ enabled: true, direction: 'bottom-dark', top: 0.34, bottom: 0.06 })
  assert.match(bottom, /to bottom, rgba\(0, 0, 0, 0\.06\) 0%.*rgba\(0, 0, 0, 0\.34\) 100%/)

  const uniform = overlayGradientCss({ enabled: true, direction: 'uniform', top: 0.2, bottom: 0.2 })
  assert.match(uniform, /rgba\(0, 0, 0, 0\.2\) 0%.*rgba\(0, 0, 0, 0\.2\) 100%/)

  assert.equal(overlayGradientCss({ enabled: false, direction: 'top-dark', top: 0.3, bottom: 0.1 }), 'none')
  assert.equal(overlayGradientCss({ enabled: true, direction: 'off', top: 0.3, bottom: 0.1 }), 'none')

  // vignette：两层渐变，顶部一段 + 底部一段（两端压暗、中间受光）
  const vignette = overlayGradientCss({ enabled: true, direction: 'vignette', top: 0.4, mid: 0.1, bottom: 0.28 })
  assert.equal((vignette.match(/linear-gradient\(/g) || []).length, 2, 'vignette 必须是两层渐变')
  assert.match(vignette, /^linear-gradient\(to bottom, rgba\(0, 0, 0, 0\.4\) 0%/)
  assert.match(vignette, /linear-gradient\(to top, rgba\(0, 0, 0, 0\.28\) 0%/)
})

// TC13
test('TC13 normalizeConfig 钳制与回落', () => {
  assert.equal(normalizeConfig({ height: 40 }).height, 28)
  assert.equal(normalizeConfig({ height: 9 }).height, 14)
  assert.equal(normalizeConfig({ opacity: 0.05 }).opacity, 0.2)
  assert.equal(normalizeConfig({ opacity: 1.8 }).opacity, 1)
  assert.equal(normalizeConfig({ pollSeconds: 5 }).pollSeconds, 10)
  assert.equal(normalizeConfig({ pollSeconds: 9999 }).pollSeconds, 600)
  assert.equal(normalizeConfig({ palette: 'nope' }).palette, DEFAULTS.palette)
  assert.equal(normalizeConfig({ colorHigh: 'zzz' }).colorHigh, DEFAULTS.colorHigh)
  assert.equal(normalizeConfig({ overlay: { direction: 'diagonal' } }).overlay.direction, 'top-dark')
  assert.equal(normalizeConfig({ variant: 'x' }).variant, 'pill')
  assert.equal(normalizeConfig({ dynamic: 'yes' }).dynamic, DEFAULTS.dynamic)
  assert.equal('apiKey' in normalizeConfig({ apiKey: 'sk-secret' }), false, '归一化结果不得携带密钥')
  assert.equal(normalizeConfig({}).anchor, 100, '100% 锚点默认是本币 100 单位')
  // 用户可以自己定义 100% 对应的金额（旧键名 budget 仍兼容）
  assert.equal(normalizeConfig({ anchor: 500 }).anchor, 500)
  assert.equal(normalizeConfig({ budget: 250 }).anchor, 250)
  assert.equal(normalizeConfig({ anchor: -5 }).anchor, 100, '负数锚点回落到默认')
  assert.equal(normalizeConfig({ anchor: -5 }).anchorSet, false)
  assert.equal(normalizeConfig({ anchor: 250 }).anchorSet, true, '手填就标记为已设置')
  assert.equal(normalizeConfig({}).anchorSet, false, '没填时按默认 100 计算，但标记为未设置')
  assert.equal(normalizeConfig({ anchor: 0 }).anchor, 100, '0 不作为锚点')
  assert.equal(normalizeConfig({ anchor: 'x' }).anchor, 100)
})

// TC14
test('TC14 金额与百分比格式化', () => {
  assert.equal(formatMoney(42.5, 'CNY'), '¥42.50')
  assert.equal(formatMoney(0, 'CNY'), '¥0.00')
  assert.equal(formatMoney(-3.456, 'CNY'), '-¥3.46')
  assert.equal(formatMoney(12.3, 'USD'), '$12.30')
  assert.equal(formatPercent(0.425), '42.5%')
  assert.equal(formatPercent(1), '100%')
  assert.equal(formatPercent(2), '200%', '余额超过 anchor 时如实显示 200%')
  assert.equal(formatPercent(1.234), '123.4%')
  assert.equal(formatPercent(0), '0%')
  assert.equal(formatPercent(Number.NaN), '—')
})

// TC15
test('TC15 cssVarsFor 输出完整变量集', () => {
  const cfg = normalizeConfig({})
  const vars = cssVarsFor(0.42, cfg, { dark: false })
  for (const key of ['--dbb-fill', '--dbb-ink', '--dbb-shade', '--dbb-texture-image', '--dbb-texture-size', '--dbb-opacity', '--dbb-height', '--dbb-radius', '--dbb-ring']) {
    assert.ok(key in vars, `缺少 ${key}`)
  }
  assert.equal(vars['--dbb-opacity'], '0.94')
  assert.equal(vars['--dbb-height'], '18px')
  assert.match(vars['--dbb-shade'], /^linear-gradient\(to bottom,/)
  const dark = cssVarsFor(0.42, cfg, { dark: true })
  assert.notEqual(dark['--dbb-ring'], vars['--dbb-ring'], '深浅色描边应不同')
})


// TC25 底色纹理：棋盘格 / 点阵 / 网格 / 关闭（image 与 size 分开，避免 background-image 丢弃整条声明）
test('TC25 纹理生成与归一', () => {
  assert.equal(core.DEFAULTS.texture.enabled, false, '默认不显示纹理')
  assert.deepEqual(core.textureParts(core.DEFAULTS.texture), { image: 'none', size: 'auto' }, '默认渲染出的是无纹理')

  const squares = core.textureParts({ enabled: true, pattern: 'squares', size: 4, alpha: 0.14 })
  assert.match(squares.image, /^conic-gradient\(/)
  assert.doesNotMatch(squares.image, /\d+px \d+px/, 'image 里不能带 position/size，否则浏览器会整条丢弃')
  assert.match(squares.image, /rgba\(0, 0, 0, 0\.14\)/)
  assert.equal(squares.size, '8px 8px', '4px 方块 → 8px 周期')

  const dots = core.textureParts({ enabled: true, pattern: 'dots', size: 4, alpha: 0.2 })
  assert.match(dots.image, /^radial-gradient\(/)
  assert.equal(dots.size, '4px 4px')

  const grid = core.textureParts({ enabled: true, pattern: 'grid', size: 6, alpha: 0.1 })
  assert.equal((grid.image.match(/linear-gradient\(/g) || []).length, 2, '网格是两条线叠加')
  assert.equal(grid.size, '6px 6px, 6px 6px', '两层图各要一个 size')

  const off = { image: 'none', size: 'auto' }
  assert.deepEqual(core.textureParts({ enabled: false, pattern: 'squares', size: 4, alpha: 0.2 }), off)
  assert.deepEqual(core.textureParts({ enabled: true, pattern: 'none', size: 4, alpha: 0.2 }), off)
  assert.deepEqual(core.textureParts({ enabled: true, pattern: 'squares', size: 4, alpha: 0 }), off)

  const clamped = core.normalizeConfig({ texture: { size: 1, alpha: 0.9, pattern: 'nope' } })
  assert.equal(clamped.texture.size, 2, 'size 下限 2')
  assert.equal(clamped.texture.alpha, 0.6, 'alpha 上限 0.6')
  assert.equal(clamped.texture.pattern, core.DEFAULTS.texture.pattern, '未知图案回落默认')
  assert.equal(core.normalizeConfig({ texture: { size: 99 } }).texture.size, 16)

  // 面板切样式必须真的换 CSS：三种图案互不相同
  const images = ['squares', 'dots', 'grid'].map((pattern) => textureCss({ enabled: true, pattern, size: 4, alpha: 0.14 }))
  assert.equal(new Set(images).size, 3, '三种图案产出必须不同')
})

// TC26 刷新不闪：有数据时刷新期间必须继续显示上一次的金额与百分比
test('TC26 视图状态：刷新期间不出现空值/占位符', () => {
  const cfg = core.normalizeConfig({})
  const data = { ok: true, balance: { currency: 'CNY', total: 95.89, granted: 0, toppedUp: 95.89 }, spentToday: 0 }

  const firstLoad = viewOf({ status: 'loading', data: null }, cfg)
  assert.equal(firstLoad.placeholder, '…')
  assert.equal(firstLoad.amountText, null)

  const refreshing = viewOf({ status: 'loading', data, refreshing: true }, cfg)
  assert.equal(refreshing.amountText, '¥95.89', '刷新时必须沿用上次金额')
  assert.equal(refreshing.percentText, '95.9%')
  assert.equal(refreshing.placeholder, '', '刷新时不得显示占位符（会闪）')
  assert.equal(refreshing.muted, false)

  const failedKeep = viewOf({ status: 'error', data, stale: true }, cfg)
  assert.equal(failedKeep.amountText, '¥95.89', '失败也保留上一次数值')

  const over = viewOf({ status: 'ok', data: { ...data, balance: { ...data.balance, total: 200 } } }, cfg)
  assert.equal(over.percentText, '200%', '未设 anchor 时超过 100 如实显示')
  assert.equal(colorFraction(over.ratio), 1, '颜色仍然满格')

  const anchored = viewOf({ status: 'ok', data: { ...data, balance: { ...data.balance, total: 200 } } }, core.normalizeConfig({ anchor: 400 }))
  assert.equal(anchored.percentText, '50%')
})
