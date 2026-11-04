# 资料收集（RESEARCH）

> 目标：为「底部栏余额状态栏」的**连续色带**与**高级感叠加层**找可辩护的数值依据，不做拍脑袋配色。
> 采集时间：2026-11-04。以下每条都给出「结论 → 依据 → 落进本插件的参数」。

## 1. 色带必须用感知均匀空间插值，不能直接 RGB 混

- 结论：绿→红连续过渡在 sRGB 里插值会经过**发灰发褐的中间段**（尤其绿红是对向色相），观感廉价；`color-mix()` 的官方说明里明确：想要「避免混色发灰、全程保持色度」用 **Oklch**；「sRGB 既非线性光也不感知均匀，会产生偏暗或发灰的混合」。
  依据：[MDN `color-mix()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix)（Color space 选择一节）
- 落地：核心函数在 **OKLCH** 里做分段插值（L/C/H 各自线性，色相走最短弧），同时保留 `interpolation: 'srgb'` 作为对照/降级开关。自定义两端色时自动检测色相间距，>60° 就**插入一个高亮中间站**（L≈0.80、C 取两端较大值），从而绕开「泥褐色中点」。

## 2. 多色相渐变优于单色相深浅渐变（在「状态」语境下）

- 结论：多色相（绿→黄→红）比单色相深浅渐变有更大的段间对比，读者更容易分辨区间；但**必须让各段亮度不同**，否则灰度打印与色觉障碍读者都分不开。
  依据：[Datawrapper, Which color scale to use](https://www.datawrapper.de/blog/which-color-scale-to-use-in-data-vis)（Sequential 一节：多色相提升段间对比；色相要有不同 lightness 才能适应色盲与灰度）
- 落地：默认色阶 `aurora` 三段 L 分别为 0.74 / 0.80 / 0.62，**亮度不单调**但相邻差值 ≥0.06，避免「只靠色相区分」；`signal` 预设加一段琥珀→橙（4 站）给需要更强分段感的场景。

## 3. 不能只靠红绿表达状态（色觉可访问性）

- 结论：红绿对立是最常见的色觉障碍组合（红绿色盲约占男性 8%）。状态色必须同时有**文字/数字**编码，且文字与底色的对比度要够（WCAG 正文 4.5:1）。
  依据：[WCAG 2.1 理解 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html)、[WebAIM Contrast](https://webaim.org/articles/contrast/)
- 落地：
  - 条内**始终显示数字**（金额 + 百分比），颜色只是辅助编码 —— 需求 R6。
  - 文字颜色**自适应**：`pickReadableText()` 在白/近黑两候选中取对比度更高者，并用单元测试锁死「全色带 0–100% 任一点 ≥ 4.5:1」这条不变量（TC13）。
  - 提供 `mono` 预设（低色度中性色带），给完全不想用红绿的场景。

## 4. 「高级感」= 极细描边 + 顶部内阴影 + 克制的柔光，而不是重投影

- 结论：把 DSH 自己的材质语言抄过来最稳：它用 0.5px 发丝描边 + 极淡双层柔光（`--dsw-elevation-panel`），阴影只有 `0 2px 4px #0000000d`；深色模式描边是 `#ffffff0f`、浅色是 `#0000000a`。
  依据：本机 DSH 主题包 token 表（`@deepseek-ai/dsh-client-ui-theme`，`design-platform.css` / `gradient-shadow-text.css`）
- 落地：条体 = 纯色低饱和底 + **自上而下黑色渐变**（顶部 0.34 → 55% 处 0.18 → 底部 0.06）+ **顶部 1px 内高光** `inset 0 1px 0 rgba(255,255,255,.16)` + 0.5px 外描边 + `0 1px 2px rgba(0,0,0,.10)`。整条 `opacity` 默认 0.94，可调 0.20–1.00。

## 5. 顶部黑色渐变的方向与力度

- 结论：让「上暗下亮」形成微弱的顶光灭失（像一块被压进面板的玻璃），文字落在中上部；纯平涂色在高亮色（绿/琥珀）上会显得像色块玩具。
  落地：默认 `overlay.direction = 'top-dark'`，`top=0.34 / bottom=0.06`，中间补 55% 处 0.18 的中间站让过渡不是直线（直线在大面积上会出现「带状分层」感）。可切 `bottom-dark`（数字压底部时更稳）、`uniform`、`off`。

## 6. 状态条的取值边界

- 百分比定义：`fraction = clamp(balance / budget, 0, 1)`，`budget` 为「额度/预算上限」（默认 20）。余额为负按 0%，超出上限按 100%。也支持 `mode: 'spent'`（`balance/(balance+今日花费)`），用于不设预算的人。
- 刷新：默认 30s（10–600s 可调），点击条体立即刷新，10s 内命中缓存。

## 参考资料

1. MDN — [`color-mix()`：色彩空间选择与 Oklch 抗发灰](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix)
2. Datawrapper — [Which color scale to use when visualizing data](https://www.datawrapper.de/blog/which-color-scale-to-use-in-data-vis)
3. W3C — [Understanding SC 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html)
4. WebAIM — [Contrast and Color Accessibility](https://webaim.org/articles/contrast/)
5. [ColorBrewer 2.0](https://colorbrewer2.org/)（RdYlGn 参考色阶，`signal` 预设的形态来源）
6. 本机 DSH：`@deepseek-ai/dsh-client-ui-theme`（`--dsw-*` token 表、elevation/描边数值）
