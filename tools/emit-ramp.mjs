// 输出五档色值 + 完整 CSS 变量，供预览图与人工核对使用。
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const core = require(join(root, 'src/shared/core.cjs'))

const presetArg = process.argv[2] || 'aurora'
const config = core.normalizeConfig({ palette: presetArg })

const steps = [1, 0.75, 0.5, 0.25, 0]
const rows = steps.map((fraction) => {
  const fill = core.scaleAt(fraction, config)
  const vars = core.cssVarsFor(fraction, config, { dark: false })
  const shade = (config.overlay.top + config.overlay.bottom) / 2
  return {
    fraction,
    percent: core.formatPercent(fraction),
    fill,
    ink: vars['--dbb-ink'],
    shade: vars['--dbb-shade'],
    contrast: core.contrastRatio(vars['--dbb-ink'], core.compositeOverBlack(fill, shade)),
    money: core.formatMoney(config.anchor * fraction, 'CNY'),
  }
})

const payload = { palette: presetArg, config, rows }

// 连续色带采样（给预览图用，避免 5 档插值出现断层）
const samples = []
for (let i = 0; i < 120; i += 1) {
  samples.push(core.scaleAt(1 - i / 119, config))
}
payload.samples = samples

const outPath = process.argv[3]
if (outPath) {
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`wrote ${outPath} (${samples.length} samples)`)
} else {
  console.log(JSON.stringify(payload, null, 2))
}
