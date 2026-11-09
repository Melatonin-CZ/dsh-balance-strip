# 发布到插件市场（Playbook）

目标：让 `dsh-balance-strip` 出现在 DSH 插件市场（dsh-market）和 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 列表里。

市场里的条目来自一个精选清单仓库 **awesome-dsh-plugin**：它由一个 YAML 数据文件生成，同时被发布成 npm 包 `dsh-plugin-catalog` 作为索引源。所以要「上架」，需要三件事：

1. 代码在 GitHub 上（公开仓库，`dsh.bundle` 清单齐全）；
2. 包发布到 npm（索引只为 npm 上可解析到版本的条目生成安装入口）；
3. 向清单仓库提一个 PR，加**一个 YAML 文件**。

---

## 进度（2026-11-04）

| 步骤 | 状态 |
|---|---|
| 元数据填充（Melatonin-CZ） | ✅ `node scripts/configure.mjs Melatonin-CZ` |
| GitHub 仓库 | ✅ https://github.com/Melatonin-CZ/dsh-balance-strip （`main` = `7000994`，tag `v0.4.0`） |
| 从 GitHub 安装验证 | ✅ `dsh plugin add github:Melatonin-CZ/dsh-balance-strip` → `+ dsh-balance-strip 0.4.0`（13.6s） |
| npm 发布 | ⏳（**注意**：`dsh-balance-strip` 于 2026-11-07 被 `mr_zinn`/`CPHWQ/dsh-balance-strip` 占用，本项目已改用作用域名 `@melatonin-cz/dsh-balance-strip`） 本机 `npm whoami` = ENEEDAUTH；`~/.npmrc` 指向 npmmirror，发布会失败。需 `npm login --registry https://registry.npmjs.org` 后 `npm publish --registry https://registry.npmjs.org --access public`（dry-run 已通过：32 files / 981.9 kB） |
| 清单 PR | ✅ **已合并** 2026-11-05T17:08Z（合并者 `fkysly`，merge commit `c9e6af32`）；条目页 https://awesome-dsh-plugin.com/p/Melatonin-CZ/dsh-balance-strip/ |

> 清单接受 GitHub-only 条目，所以 PR 不必等 npm。
>
> 门禁曾因「仓库 <1 天」失败（`repository is 0.0 days old (needs 1)`）；24h 后重跑需要上游 admin 权限，
> 所以推了一个空 commit 触发新一轮 `PR check` → gate 读到的年龄满足后转绿。

## 发布被 2FA 挡住时（403 Two-factor authentication required）

现象：

```
npm error 403 PUT https://registry.npmjs.org/dsh-balance-strip
npm error 403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

**背景（2025-11-05 起）**：npm 已**禁止新建 classic token**（网页 / CLI / API 都不行），并撤销了全部旧 classic token；
现在只有 **Granular Access Token**，而且新 token 只要带写权限就**默认强制 2FA**。
（出处：[GitHub Changelog 2025-11-05](https://github.blog/changelog/2025-11-05-npm-security-update-classic-token-creation-disabled-and-granular-token-changes/)）

所以「Classic → Automation」这条路已经不存在了。两条可行路径：

### A. 交互式带 OTP 发布（最快）

```powershell
cd dsh-balance-strip
npm publish --otp=123456     # 验证器里当前的 6 位码
```

### B. Granular token + 勾选 Bypass 2FA（适合长期 / CI）

[npmjs.com/settings/~/tokens](https://www.npmjs.com/settings/~/tokens) → **Generate New Token** → **Granular Access Token**：

1. 名称、过期时间（写权限 token 最长 90 天）；
2. **Packages and scopes** → 权限选 **Read and write**，范围选 **All packages**（包还没发布时无法按包授权）；
3. 勾选 **Bypass 2FA**（文档原话：*A new **Bypass 2FA** option is available for CI/CD workflows (unchecked by default)*）；
4. 生成后：

```powershell
$env:NODE_AUTH_TOKEN = '<granular-token>'
npm publish          # publishConfig 已把 registry 钉到 npmjs
```

> 本机 `~/.npmrc` 的默认 registry 是 `https://registry.npmmirror.com`（只读镜像）。`package.json` 已加
> `"publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }`，发布永远去 npmjs，本地安装仍走镜像。

发布成功后自查：

```powershell
npm view @melatonin-cz/dsh-balance-strip version
dsh plugin --profile desktop add @melatonin-cz/dsh-balance-strip
```

## 0. 名字与现状

| 项 | 值 | 说明 |
|---|---|---|
| npm 包名 | `@melatonin-cz/dsh-balance-strip`（作用域，因为 `dsh-balance-strip` 在 2026-11-07 被 `mr_zinn` 占用了） | `dsh-balance-bar` 在 npm 上**已被别人占用**（registry 返回 200），所以改用了 `-strip`；`dsh-balance-bar-ui`、`balance-bar-dsh` 也空着，但 `-strip` 更准确 |
| GitHub 仓库 | `dsh-balance-strip`（建议同名） | 目录名、包名、仓库名保持一致最省事 |
| 插件 id | `dsh-balance-strip` | 宿主路由 `/dsh-balance-strip/state`、槽位 `registrant` 都用它 |
| 分类 | `usage` | 清单要求的 category 取值之一 |

## 1. 本地收尾（一次命令）

```powershell
cd G:\WORKSHOP\vibe-coding\DSH-vibe-coding\dsh-balance-strip
node scripts/configure.mjs <你的 GitHub 用户名>
```

它会替换 `package.json` 的 `author / repository / homepage / bugs`、`LICENSE` 的版权行、README 里的链接，以及本文件里的占位。

然后确认能构建能测：

```powershell
.\dev.ps1 test        # build + 31 条测试
```

## 2. 建仓库并推送

在 GitHub 新建**空仓库** `dsh-balance-strip`（不要勾 README / .gitignore / license），然后：

```powershell
git init -b main
git add -A
git commit -m "feat: dsh-balance-strip v0.4.0"
git remote add origin https://github.com/<owner>/dsh-balance-strip.git
git push -u origin main
```

## 3. 发布到 npm

```powershell
npm login                      # 或用 granular token：npm config set //registry.npmjs.org/:_authToken=...
npm publish --access public
```

发完自查：

```powershell
npm view @melatonin-cz/dsh-balance-strip version dist.tarball
```

## 4. 从 npm 安装验证（换一个干净 profile）

```powershell
dsh plugin --profile strip-check add @melatonin-cz/dsh-balance-strip
dsh plugin --profile strip-check list --depth 0
```

装完开一次 `dsh --profile strip-check`，确认输入框下方状态行最右出现余额条 + 金币入口。

## 5. 提清单 PR（唯一需要别人合并的一步）

Fork [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，新增一个文件：

路径：`data/plugins/Melatonin-CZ__dsh-balance-strip.yml`

```yaml
url: https://github.com/<owner>/dsh-balance-strip
name: <owner>/dsh-balance-strip
category: usage
description:
  en: Balance strip in the composer dock — a green-to-red ramp driven by your DeepSeek balance, with a dynamic toggle, texture and a settings panel.
  zh: 输入框下方状态行里的余额状态条：色带随余额在绿与红之间变化，可关动态、换纹理，并带图形化设置面板。
icon: https://raw.githubusercontent.com/<owner>/dsh-balance-strip/main/assets/icon-180.png
```

要点（来自清单的 contributing.md）：

- 文件里 `description.en` 必填，`zh` 可选但建议写；
- 描述里出现 `: `（冒号+空格）**必须加引号**；
- 图标用 GitHub 托管的位图（我们已经生成 `assets/icon-180.png`，180×180）；
- 截图**不在这个 PR 里提交**——仓库根部的 `screenshots.json` 才是截图来源，市场夜间构建自动读取，之后换图推自己的仓库即可。

PR 标题写 `Add dsh-balance-strip` 就够。

## 6. 之后

| 场景 | 做法 |
|---|---|
| 发新版 | `npm version patch` → `git push --follow-tags` → `npm publish` |
| 换截图 | 改 `screenshots.json` 指向的图片 → push（下一次夜间构建生效） |
| 改描述/分类 | 只改清单里的那一个 YAML 文件，再提 PR |
| 下架 | 删除 npm 包版本或仓库；清单会因仓库消失而移除条目 |

## 7. 需要你提供的东西

| 需要 | 用途 | 备注 |
|---|---|---|
| GitHub 用户名 | 填 `package.json` / LICENSE / README / 清单 PR | 一条 `node scripts/configure.mjs <owner>` 就填好 |
| npm 账号 | `npm publish` | 若无 npm 账号，也可以只发 GitHub Release，但清单的索引条目需要 npm 上能解析到版本 |
| （可选）GitHub token + npm token | 让我直接代你 push / publish | 用最小权限：GitHub fine-grained token 只需 `Contents: write`（目标仓库）+ 对 fork 的 `Pull requests: write`；npm 用 granular token 只勾 `Read and write` 的发布权限 |

把用户名给我，我就能把仓库初始化、commit、写好清单 YAML；凭据给我就一路推送到 npm 与清单 PR（不给也行，上面命令你自己跑，每步都验证过路径）。
