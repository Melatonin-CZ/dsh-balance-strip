# TDD — dsh-balance-strip

- 关联：[PRD.md](PRD.md)（需求与验收）· [RESEARCH.md](RESEARCH.md)（色彩依据）
- 测试框架：**Node 内置 `node --test`**（零依赖，随宿主 `runtime/primary-runtime/dependencies/node` 即可跑）
- 原则：**先写测试（RED）→ 最小实现（GREEN）→ 再补 UI/宿主装配**。纯函数全部下沉到 `src/shared/core.cjs`，UI 只做取值与拼 CSS。

## 1. 架构

```
浏览器（DSH Web 客户端）                      宿主进程（cordis Context）
┌──────────────────────────────┐            ┌────────────────────────────────────┐
│ conversation.composer.dock   │            │ dsh-balance-strip (src/index.js)     │
│  ├ 组件 BalanceBar           │  GET       │  ├ GET /dsh-balance-strip/state      │
│  │   ├ core.scaleAt(f)       │ ─────────► │  │   ├ 同源守卫 + 方法守卫         │
│  │   ├ core.cssVarsFor(...)  │  same      │  │   ├ resolveApiKey()             │
│  │   └ <style> 注入一次      │  origin    │  │   │   config.apiKey → credentials│
│  └ 每 pollSeconds 拉一次     │            │  │   │   → process.env             │
└──────────────────────────────┘            │  │   └ fetch(api.deepseek.com      │
                                            │  │        /user/balance) 8s 超时   │
                                            │  └ 返回 {ok,balance,config}        │
                                            └────────────────────────────────────┘
```

关键约束：

- 客户端**不能**直连 `api.deepseek.com`（CORS + 密钥暴露），必须走宿主同源路由。
- 客户端 bundle 形态固定为 `window.__ModuleLoader__.load({ id, factory })`，`require('react')` 由宿主模块加载器解析 —— **不打包 react，不需要打包器**。
- 客户端拿不到宿主 `config`，所以配置**随 `/state` 一起下发**（`config` 字段，已归一化、已脱敏）。

## 2. 模块与单一职责

| 文件 | 职责 | 依赖 |
|---|---|---|
| `src/shared/core.cjs` | 颜色数学（sRGB↔OKLCH、色阶、插值）、合成/对比度、渐变 CSS、配置归一、比较与格式化 | 无（纯函数） |
| `src/client/main.cjs` | React 组件 + `<style>` 注入 + 轮询 + 槽位注册 | `require('react')`、`core` |
| `src/index.js` | 宿主路由、Key 解析、余额抓取、守卫、超时 | `ctx.webServer`、`fetch` |
| `scripts/build.mjs` | 把 `core.cjs` + `main.cjs` 拼成 `lib/client.js`；`src/index.js` → `lib/index.js` | 无 |
| `tools/emit-ramp.mjs` | 输出五档色值 JSON（给预览图用） | `core` |

## 3. 测试矩阵

| # | 用例 | 断言要点 | 覆盖 |
|---|---|---|---|
| TC01 | `clamp` / `clamp01` | 边界与 `NaN` 处理 | R2 |
| TC02 | `parseHex` | `#rgb`/`#rrggbb`/大小写/非法返回 `null` | R4 |
| TC03 | `oklchToHex` 往返 | `srgbToOklch(oklchToHex(L,C,H))` ≈ (L,C,H)，ΔL≤0.02、ΔC≤0.02、ΔH≤2° | R3 |
| TC04 | 色阶端点 | f=1 绿端、f=0 红端、f=0.5 中间站（±2/255） | AC5 |
| TC05 | 色度下限 | f∈[0,1] 步长 .02 全部 C≥0.10（不灰不褐） | AC6 |
| TC06 | 插值模式差异 | oklch vs srgb 在 f=0.25 差 ≥8/255 | AC7 |
| TC07 | 自定义两端 | f=1/f=0 精确等于自定义 hex | AC8 |
| TC08 | 色相间距规则 | 间距>60° 插中间站且中点 C≥0.10；≤60° 不插 | AC9 |
| TC09 | `fraction` | 100%/0%/负值/超锚点/自定义 anchor(500)/`anchor<=0` 退化/`spent` 模式 | AC3, AC4 |
| TC10 | 动态开关 | `dynamic=false` 时 f=0 与 f=1 的 `--dbb-fill` 相同且为中性 | AC10 |
| TC11 | 文字对比度 | 全色带 0–100% 每点 ≥4.5:1（含黑叠加） | AC11 |
| TC12 | 渐变 CSS | 四方向 + 关闭；三段 alpha 位置正确 | AC12 |
| TC13 | 配置归一 | height/opacity/pollSeconds 钳制、非法枚举回落、非法 hex 回落 | AC13, AC14, AC18 |
| TC14 | 格式化 | `formatMoney(42.5,'CNY')='¥42.50'`、负数、`formatPercent` | R1, R6 |
| TC15 | `cssVarsFor` 输出 | 含 `--dbb-fill/--dbb-ink/--dbb-shade/--dbb-opacity/--dbb-height` | R1, R7, R8 |
| TC16 | 宿主路由注册 | `webServer.register` 收到 `/dsh-balance-strip/state` + `kind:'exact'` | R10 |
| TC17 | 同源守卫 | `cross-site`→403、`origin` 不匹配→403、POST→405、正常 GET→200 | AC15 |
| TC18 | 无 Key 分支 | 200 + `reason:'no-api-key'` + 带 config | AC16 |
| TC19 | 成功分支 | 桩 `fetch` 返回 `balance_infos`，响应 `ok:true` 且金额正确 | R10 |
| TC20 | 密钥不外泄 | 响应 JSON 不含 key 明文；`config.apiKey` 被抹掉 | AC17 |
| TC21 | bundle 可加载 | 假 `ModuleLoader` + react 桩：导出 `{name,inject,apply}`，`apply` 注册 dock 槽 | AC19 |

## 4. RED → GREEN 顺序

1. **RED-1**：写 `tests/core.test.mjs`（TC01–TC15），`node --test` 失败（模块不存在）。
2. **GREEN-1**：实现 `src/shared/core.cjs`，逐个把 TC 跑绿。色彩数值不达标时**调设计参数**（预设 L/C/H、叠加 alpha），**不改断言**。
3. **RED-2**：写 `tests/host.test.mjs`（TC16–TC20）+ `src/index.js` 骨架。
4. **GREEN-2**：实现路由与守卫，桩 `fetch` 跑绿。
5. **RED-3**：写 `tests/client-bundle.test.mjs`（TC21），先让 `lib/client.js` 不存在而失败。
6. **GREEN-3**：实现 `src/client/main.cjs` + `scripts/build.mjs`，bundle 测试转绿。
7. **观感验收**：`node tools/emit-ramp.mjs` → 五档色值 → 渲染预览图，人工看「是否像话」。

## 5. 契约细节（实现时必须照此）

**core 导出**

```js
module.exports = {
  clamp, clamp01, parseHex, toHex, oklchToHex, srgbToOklch, oklchToRgb,
  paletteStops, scaleAt, fractionFromBalance, compositeOverBlack,
  relativeLuminance, contrastRatio, pickReadableText, overlayGradientCss,
  formatMoney, formatPercent, normalizeConfig, cssVarsFor, NEUTRAL_FILL,
  PALETTES, DEFAULTS,
}
```

- `scaleAt(fraction, config)` → `'#rrggbb'`；`palette='custom'` 用 `colorHigh/colorLow`，其余用预设。
- `fractionFromBalance({ balance, anchor, spentToday, mode })`：`anchor` 是用户自定义的「100% 对应金额」，超出钳制到 1。
- `overlayGradientCss(overlay)` → 完整 `linear-gradient(...)` 或 `'none'`。
- `cssVarsFor(fraction, config, opts)` → `Record<--dbb-*, string>`，`opts.dark` 影响描边。
- `normalizeConfig(partial)` → 全量、已钳制、未知枚举回落；**不保留 `apiKey`**（宿主侧另有 `publicConfig`）。

**bundle 形态**（与 `dsh-usage-chart` 一致）

```js
window.__ModuleLoader__.load({ id: "dsh-balance-strip", factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  /* core + client 源码拼接 */
  return module.exports;
} });
```

**宿主路由**

```js
export const name = 'dsh-balance-strip'
export const inject = ['webServer']
export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-balance-strip/state', handler }))
}
```

## 6. 验证命令

```bash
cd dsh-balance-strip
node --test tests/          # 全部单元 + 集成（不需要网络、不需要装依赖）
node scripts/build.mjs      # 生成 lib/index.js、lib/client.js
node tools/emit-ramp.mjs    # 输出五档色值（预览图数据源）
```

## 7. 测试替身（不引入依赖的理由）

- `react` 用 6 个函数的桩（`createElement/useState/useEffect/useMemo/useRef/useCallback`），足够验证「模块能加载 + apply 注册槽位」这层的形状。
- `fetch` 用局部桩，不触网：宿主测试断言 URL、Header、超时设置与错误分支。
- `ctx` 用 `{ effect, get, webServer: { register } }` 假对象，`effect` 直接执行回调（cordis 语义里也允许同步注册）。
