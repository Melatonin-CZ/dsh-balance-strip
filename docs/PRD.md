# PRD — dsh-balance-strip（DSH 底部栏余额状态栏）

- 版本：v0.1（首版）
- 宿主：DeepSeek Harness Desktop / Web `0.2.1-rc.5`
- 槽位：`conversation.composer.dock`（输入框下方那条状态行，与官方 StatsLine 同槽）
- 关联文档：[RESEARCH.md](RESEARCH.md)（色彩与视觉依据）· [TDD.md](TDD.md)（架构与测试计划）

## 1. 背景与问题

DSH 输入框下方已有一行状态栏（轮次/步数、tok/s、`6.7M tok · 缓存命中中 96%`、`18%`）。它回答的是「这一轮跑得多快、上下文占了多少」，**不回答「我还剩多少钱」**。当前要查余额，只能装第三方插件（`dsh-cost-meter` 等），它们普遍是**整块卡片**、带预算/看板/多供应商，视觉与占地都超出「一眼看余额」的需求。

本需求只做一件事：**在底部栏放一条余额状态条**，用颜色把「还剩多少」变成直觉，并且**可关掉动态**（不想要彩色变化的人得到一条静态中性条）。

## 2. 目标 / 非目标

**目标**

1. 底部栏（`conversation.composer.dock`）出现一条余额状态条，显示金额 + 百分比。
2. 百分比驱动连续色带：**100% 绿 → 0% 红**；两端颜色都可用 RGB 选（`#rrggbb`）。
3. 动态可开关：`dynamic=false` 时整条退化为中性静态条（取主题 `label-tertiary` 系）。
4. 高级感叠加层：条体**自上而下黑色渐变**，强度与整条透明度可调，默认值经过设计校准。
5. 不污染宿主：数据走宿主同源代理，密钥不进浏览器；卸载即完全消失。

**非目标**

- 不做历史看板、不做多供应商、不做预算预警弹窗、不做 token/费用统计（已有插件在做）。
- 不提供图形化设置面板（首版走 `cordis.patch.yml` 配置；后续可加设置页）。

## 3. 用户故事

- **US-1** 作为使用者，我瞥一眼输入框下方就知道余额还剩多少、还剩几成。
- **US-2** 作为审美敏感者，我希望这条不要像个色块玩具：要有暗部渐变、细描边、柔光。
- **US-3** 作为不喜欢动效的人，我要能一键把「变色」关掉，只留一条安静的条。
- **US-4** 作为爱折腾的人，我要能把 100% 的颜色改成自己的绿（或任何 RGB），0% 改成自己的红。

## 4. 功能需求与验收标准

### R1 状态条渲染

- 在 `conversation.composer.dock` 注册，`id=dsh-balance-strip`，`order=20`（排在官方 StatsLine 之后，靠右）。
- **AC1**：插件启用且已取到余额时，dock 行右侧出现一条高 18px 的胶囊条，内含 `¥42.50 · 42.5%`。
- **AC2**：宿主重启、插件重载后条体自行恢复，不需要刷新页面（客户端每 `pollSeconds` 轮询，首帧先渲染骨架）。

### R2 百分比定义

- `fraction = clamp(balance / anchor, 0, 1)`；`mode='spent'` 时 `fraction = balance / (balance + spentToday)`。
- **100% 对应的金额由用户自定义**（`anchor`，默认本币 100 单位；余额接口返回 CNY 就是 ¥100，返回 USD 就是 $100）。想让它对应 ¥500 就写 `anchor: 500`。
- **超过 anchor 一律按 100% 显示**（色带钳制在绿端，不再继续变化，也不出现溢出/发光特效）。
- **AC3**：`balance=100, anchor=100` → 100%；`balance=260, anchor=100` → 100%；`balance=73, anchor=100` → 73%；`balance=250, anchor=500` → 50%；`balance=900, anchor=500` → 100%；`balance=0` → 0%；`balance=-3` → 0%。
- **AC4**：`anchor<=0` 且 `mode='anchor'` 时退化为 `spent` 计算；`normalizeConfig` 会把 0/负数/非数字的 anchor 回落为默认 100，不出现 `Infinity/NaN`。

### R3 连续色带（核心）

- 默认预设 `aurora`，OKLCH 分段插值：`1.00 → oklch(0.74 0.17 152)`、`0.50 → oklch(0.80 0.16 79)`、`0.00 → oklch(0.62 0.22 25)`。
- **AC5**：`scaleAt(1)` 为绿端、`scaleAt(0)` 为红端、`scaleAt(0.5)` 命中中间站（容差 ±2/255 每通道）。
- **AC6**：色相沿最短弧单调变化（152°→79°→25°），中途不出现「灰/褐」：任意 f 的 OKLCH 色度 C ≥ 0.10。
- **AC7**：`interpolation='srgb'` 时结果与 oklch 模式在 f=0.25 处差 ≥ 8/255（说明两种模式真的不同，不是同一个近似）。

### R4 自定义两端色

- `colorHigh` / `colorLow` 接受 `#rgb` / `#rrggbb`。
- **AC8**：自定义绿 `#00ff88` + 红 `#ff2d55` 时，f=1 精确等于 `#00ff88`，f=0 精确等于 `#ff2d55`。
- **AC9**：两端色相间距 > 60° 时自动插入中间站（L≈0.80、C=min(0.19, max(C1,C2)*0.9)），中点色度 ≥ 0.10（不出现泥褐）；间距 ≤ 60° 时不插站。

### R5 动态开关

- `dynamic=true`（默认）：底色随 `fraction` 变，`transition: background-color 500ms ease-out`。
- `dynamic=false`：底色固定为中性（`--dsw-alias-bg-layer-2` 系），不再随余额变化。
- **AC10**：`dynamic=false` 时 `cssVarsFor()` 返回的 `--dbb-fill` 等于中性值，且与 `fraction` 无关（f=0 与 f=1 结果相同）。

### R6 数字可读（可访问性）

- 条内始终有金额与百分比；文字颜色从 `#FFFFFF` / `#0B0F12` 中自适应选取。
- **AC11**：对 f∈[0,1] 每 0.02 采样一次，**文字与合成后底色的 WCAG 对比度 ≥ 4.5:1**（含黑色叠加层后的实际底色）。

### R7 黑色叠加层（高级感）

- `overlay.enabled`（默认 true）、`overlay.direction ∈ {top-dark, bottom-dark, uniform, off}`、`overlay.top=0.34`、`overlay.bottom=0.06`。
- 默认 CSS：`linear-gradient(to bottom, rgba(0,0,0,.34) 0%, rgba(0,0,0,.18) 55%, rgba(0,0,0,.06) 100%)`。
- 叠加：顶部 1px 内高光 `inset 0 1px 0 rgba(255,255,255,.16)`。
- **AC12**：`overlayGradientCss()` 生成的字符串按 `direction` 正确换向；`off`/`enabled=false` 返回 `none`；三个 alpha 值出现在对应位置。

### R8 透明度

- `opacity ∈ [0.2, 1]`，默认 `0.94`，作用于整条（不改文字对比度计算，因为文字在条内）。
- **AC13**：越界值被钳制（0.05 → 0.2，1.8 → 1.0）；非法字符串回落默认值。

### R9 几何与形态

- `variant: 'pill'`（默认，胶囊，`height` 14–28，默认 18）· `'rail'`（整行底部 3px 细轨，用于「几乎不想看见它」）。
- `radius`：pill 固定 999；rail 固定 3。
- **AC14**：`normalizeConfig({height: 40})` → `18`? 不，钳制到 28；`{height: 9}` → 14。

### R10 数据链路（安全）

- 客户端只请求同源 `/dsh-balance-strip/state`；宿主侧两条通道，浏览器都不碰密钥：
  1. **API Key 通道**：`config.apiKey` → DSH `credentials.resolve('DEEPSEEK_API_KEY')` → `process.env`，调官方 `GET /user/balance`。
  2. **账号通道**（无需 API Key）：读 DSH 账号登录 grant（`deepseek-account-platform/default`），带 `x-dsh-auth-token` 调 `GET {platform}/api/v0/users/get_user_summary`，取 `normal_wallets` + `bonus_wallets`（并读 `total_costs` 作累计消费）。
- 顺序：先 Key 通道；Key 缺失或失败自动回落账号通道；两条都不可用才报错。
- **AC15**：跨站请求（`sec-fetch-site: cross-site` 或 `origin` host≠`host`）返回 403；非 GET 返回 405。
- **AC16**：两条通道都不可用时返回 200 + `{ok:false, reason:'no-api-key'|'no-account', message, config}`，前端显示「未配置 · 点击重试」而不是报错栈。
- **AC17**：响应体**绝不包含** API Key 或账号 grant token（测试断言序列化结果里既没有 `sk-` 形状字符串，也不含 `apiKey` 字段与 grant 明文）。
- **AC17b**：账号通道解析正确——`normal_wallets[CNY].balance=96.27029328`、`bonus=0` → `total=96.270293`（6 位小数归一）、`toppedUp` 原值透传、`costsTotal` 取自 `total_costs`。

### R11 刷新策略

- 首屏立即请求；之后每 `pollSeconds`（10–600，默认 30）；点击条体强制刷新（10s 内走缓存）；失败保留上一次好数据并标记 `stale`。
- **AC18**：`pollSeconds=5` → 归一为 10；`pollSeconds=9999` → 600。

### R12 交付形态

- 一个可 `dsh plugin --profile desktop add ./dsh-balance-strip` 安装的包：`lib/index.js`（宿主 ESM）+ `lib/client.js`（`window.__ModuleLoader__` 形态）+ `cordis.patch.yml`。
- **AC19**：`node --test` 全绿；`lib/client.js` 用假 `ModuleLoader` + `require('react')` 桩可加载，导出 `{name, inject, apply}`，`apply` 注册到 `conversation.composer.dock`。

## 5. 配置表（`cordis.patch.yml` → `config`）

> 只关心一件事时改这两行就够：`anchor`（100% 对应多少钱）+ `dynamic`（要不要变色）。

| 键 | 类型 | 默认 | 范围/取值 | 说明 |
|---|---|---|---|---|
| `anchor` | number | `100` | >0 | **100% 对应的本币金额，自己定义**；余额超出只显示满格颜色。旧键名 `budget` 仍兼容 |
| `mode` | string | `'anchor'` | `anchor` \| `spent` | 比例算法（旧值 `budget` 视作 `anchor`） |
| `dynamic` | boolean | `true` | — | 是否随余额变色 |
| `palette` | string | `'aurora'` | `aurora` \| `signal` \| `mono` \| `custom` | 色阶预设 |
| `colorHigh` | string | `'#22c55e'` | `#rgb`/`#rrggbb` | 100% 端颜色（`custom` 生效） |
| `colorLow` | string | `'#e5484d'` | `#rgb`/`#rrggbb` | 0% 端颜色（`custom` 生效） |
| `interpolation` | string | `'oklch'` | `oklch` \| `srgb` | 插值空间 |
| `overlay.enabled` | boolean | `true` | — | 黑色叠加层开关 |
| `overlay.direction` | string | `'top-dark'` | `top-dark`\|`bottom-dark`\|`uniform`\|`off` | 渐变方向 |
| `overlay.top` | number | `0.34` | 0–1 | 顶部黑度 |
| `overlay.bottom` | number | `0.06` | 0–1 | 底部黑度 |
| `texture.enabled` | boolean | `false` | — | 底色纹理开关（**默认关闭**） |
| `texture.pattern` | string | `'squares'` | squares/dots/grid/none | 纹理样式 |
| `texture.size` | number | `4` | 2–16 | 方块边长（px） |
| `texture.alpha` | number | `0.14` | 0–0.6 | 纹理浓度 |
| `opacity` | number | `0.94` | 0.2–1 | 整条不透明度 |
| `variant` | string | `'pill'` | `pill` \| `rail` | 形态 |
| `height` | number | `18` | 14–28 | 条高（pill） |
| `showAmount` | boolean | `true` | — | 显示金额 |
| `showPercent` | boolean | `true` | — | 显示百分比 |
| `label` | string | `'余额'` | 任意短文本 | 前缀词（留空则只显示数字） |
| `pollSeconds` | number | `30` | 10–600 | 轮询间隔 || `apiKey` | string | `''` | — | 显式 Key（留空走凭据服务） |
| `baseUrl` | string | `'https://api.deepseek.com'` | https（回环可 http） | 余额接口基址 |
| `platformCredential` | string | `'deepseek-account-platform/default'` | 凭据记录名 | 账号通道读取的 grant 记录（宿主专用，不下发前端） |
| `platformBaseUrl` | string | `'https://platform.deepseek.com'` | https | 账号通道接口基址（grant 里带 issuer 时以 issuer 优先） |

## 6. 视觉规范（与 RESEARCH 对应）

| 元素 | 值 | 依据 |
|---|---|---|
| 色带插值 | OKLCH 分段，色相最短弧 | MDN `color-mix()`：Oklch 抗发灰 |
| 预设 `aurora` | `0.74/0.17/152` → `0.80/0.16/79` → `0.62/0.22/25` | 多色相 + 亮度差 ≥0.06 |
| 预设 `signal` | 4 站 RdYlGn 形态，C 更高 | ColorBrewer 形态 |
| 预设 `mono` | `L 0.55→0.85, C 0.02, H 250` | 完全不用红绿 |
| 黑叠加 | `0.34 / 0.18@55% / 0.06` | 顶部内阴影式压暗，避免带状分层 |
| 内高光 | `inset 0 1px 0 rgba(255,255,255,.16)` | 玻璃质感 |
| 外描边 | `0 0 0 .5px rgba(0,0,0,.12)` / 深色 `rgba(255,255,255,.08)` | 对齐 DSH `--dsw-alias-border-l1` |
| 柔光 | `0 1px 2px rgba(0,0,0,.10)` | 对齐 DSH `--dsw-shadow-lv1` |
| 文字 | 11px / `tabular-nums` / 自适应白或近黑，对比度 ≥4.5 | WCAG 1.4.3 + 1.4.1 |
| 动效 | 底色 `500ms ease-out`，无位移动画 | 轻量、不打断阅读 |

## 7. 数据结构（`GET /dsh-balance-strip/state`）

```json
{
  "ok": true,
  "apiKeyConfigured": true,
  "source": "api",
  "isAvailable": true,
  "balance": { "currency": "CNY", "total": 42.5, "granted": 0, "toppedUp": 42.5 },
  "spentToday": 0,
  "fetchedAt": 1762300000000,
  "config": { "budget": 20, "dynamic": true, "palette": "aurora", "...": "已归一化的公开配置" }
}
```

失败形态：`{ ok:false, apiKeyConfigured:false, reason:'no-api-key'|'request-failed'|'bad-response', message, config }`。

## 8. 交付清单

- [ ] `lib/index.js`：`/dsh-balance-strip/state` 同源代理 + 同源/方法守卫 + 8s 超时
- [ ] `lib/client.js`：dock 槽位组件（pill/rail 两形态、动态/静态、自适应文字、点击刷新）
- [ ] `cordis.patch.yml`：默认配置（可直接改）
- [ ] `tests/`：core / host / client-bundle 三组，`node --test` 全绿
- [ ] `docs/`：RESEARCH / PRD / TDD
- [ ] 预览图：100/75/50/25/0% 五档实渲染（色值取自实现本身）

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 账号登录态（`deepseek-account`）下没有 API Key | 返回 `no-api-key` 明确文案；`apiKey` 可显式配置；不改宿主认证 |
| 官方余额接口限流/抖动 | 8s 超时 + 30s 轮询 + 10s 缓存 + 保留上一次好数据 |
| dock 行宽度紧张 | `variant='rail'` 退化为 3px 细轨；`showAmount/showPercent` 可关 |
| 用户自定义两端色太难看出差异 | 自动插中间站；提供 `signal`/`mono`；文档给出示例值 |

---

> v0.2 的 5 项变更（位置/锚点语义/设置面板/纹理/刷新不闪）见 [CHANGELOG-v0.2.md](CHANGELOG-v0.2.md)。
