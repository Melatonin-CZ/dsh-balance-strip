# Changelog

## 0.4.0

- **重命名**：插件 id / 包名 / 路由从 `dsh-balance-bar` 统一改为 **`dsh-balance-strip`**（npm 上 `dsh-balance-bar` 已被占用，`dsh-balance-strip` 可用）。宿主路由变为 `/dsh-balance-strip/state`，本地设置键变为 `dsh-balance-strip:settings:v2`。
- **i18n**：所有文案跟随 DSH 客户端语言（`locale` 服务的 `active`）实时切换，中英两份字典 key 完全对齐（TC29 断言）；英文界面下默认标签为 `Balance`，自定义 `label` 原样保留。面板、tooltip、占位符（未配置 / No key、重试 / Retry）全部覆盖。
- **发布元数据**：`package.json` 补齐 `repository / homepage / bugs / engines.dsh / keywords / files`，新增 `LICENSE`(MIT)、`screenshots.json`、`assets/icon-180.png`、`assets/icon-512.png`，新增 `node scripts/configure.mjs <owner>` 一次性填作者信息。
- 工具栏/市场卡片图标改为「胶囊条 + 绿→琥珀→红渐变 + 金币徽标」；产品 logo 见 `assets/logo.svg`。

## 0.3.2

- 纹理默认关闭：`DEFAULTS.texture.enabled = false`，默认渲染 `background-image: none` / `background-size: auto`，条体是干净的纯色胶囊。
- 图案、方块大小、浓度保留默认值（squares / 4px / 0.14），面板里勾上「纹理」立刻出现密集小方块。
- 本地覆盖键升到 `settings:v2`，避免旧版纹理参数把新默认顶掉；profile 的 `cordis.patch.yml` 同步成 `texture.enabled: false`。

## 0.3.1

- **修 bug**：纹理样式选了没反应。根因是 `background-image` 不接受 `position / size` 语法（那是 `background` 简写才有的），整条声明被浏览器丢弃——默认的方块纹理其实也从未渲染过。
  现在拆成 `--dbb-texture-image` + `--dbb-texture-size`，CSS 用 `background-image` / `background-size` 两个属性；棋盘格也改成轴对齐四象限 `conic-gradient`。
  TC25 增加回归断言：`image` 里不允许出现 `Npx Npx`，三种图案产出必须互不相同。

## 0.3.0

- 设置面板改为 **portal 到 `document.body`**（懒加载 `require('react-dom')`，取不到则退回锚定绝对定位）。之前 `position: fixed` 被 composer 的 transform 祖先当定位基准，面板被裁剪只剩一行标题。
- 面板按视口上下双向弹出、`max-height: 72vh` 内部滚动；容器带 `data-dbb-panel="above|below|inline"` 便于排查。
- ⚙ 换成**金币 ¥** 图标（内联 SVG、`currentColor`）；面板标题用它作品牌标记；新增 `assets/logo.svg`。
- 新增 `tools/ui-preview.py`：用实现同一套色值/纹理/叠加渲染「dock 行 + 浅/深色面板 + 图标四档」的效果图。

## 0.2.0

- 条形移到**上下文占用环右侧**：dock 是 flex 容器且 `ContextMeter` 在槽位之后渲染，改用 `order: 99` 排到它右边。
- `anchor` 语义：只在用户手填时生效；数字层**不钳制**（余额 ¥200 / anchor 100 → `200%`），颜色层单独钳到 0..1 保持满格绿。
- 新增图形化设置面板（anchor / 动态 / 配色 / 两端颜色 / 纹理 / 叠加三段黑度 / 透明度 / 条高 / 形态 / 刷新间隔），存 localStorage 并与宿主 config 深合并。
- 新增底色纹理（密集小方块 / 点阵 / 网格 / 无），参数开放。
- 刷新不闪：只有首次加载显示占位符，之后沿用上一次数值，失败保留旧值并标 `stale`。

## 0.1.0

- 首个可用版本：余额状态条挂在 `conversation.composer.dock`；宿主同源代理两条取数通道（API Key 的 `/user/balance`、账号登录态的 `get_user_summary`）；OKLCH 连续色带 100% 绿 → 0% 红；自顶向下黑色叠加 + 顶部内高光 + 发丝描边 + 可调透明度。
