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
| npm 发布 | ⏳ 本机 `npm whoami` = ENEEDAUTH；`~/.npmrc` 指向 npmmirror，发布会失败。需 `npm login --registry https://registry.npmjs.org` 后 `npm publish --registry https://registry.npmjs.org --access public`（dry-run 已通过：32 files / 981.9 kB） |
| 清单 PR | ✅ https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11904 |

> 清单接受 GitHub-only 条目，所以 PR 不必等 npm。

## 发布被 2FA 挡住时（403 Two-factor authentication required）

现象：

```
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/dsh-balance-strip
npm error 403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

说明账号开了 2FA，而当前的登录方式（密码会话）发布时必须带一次性验证码。三条路，任选：

**A. 带 OTP 发布（最快，30 秒内有效）**

```powershell
npm publish --otp=123456
```

**B. Automation token（classic）—— 天然跳过 2FA，适合长期用**

npmjs.com → 头像 → Access Tokens → Generate New Token → **Classic** → 类型选 **Automation** → 复制 token：

```powershell
$env:NODE_AUTH_TOKEN = '<automation-token>'
npm publish            # publishConfig 已把 registry 钉到 npmjs，不必再写 --registry
```

**C. Granular token + 勾选 Bypass 2FA**

npmjs.com → Access Tokens → **Granular** → Permissions 选 `Read and write`（或只勾本包）→ 勾 **Bypass 2FA for publish** → 复制：

```powershell
npm config set //registry.npmjs.org/:_authToken=<granular-token>
npm publish
```

> 本机 `~/.npmrc` 的默认 registry 是 `https://registry.npmmirror.com`（只读镜像）。`package.json` 里已经加了
> `"publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }`，
> 所以**发布永远去 npmjs**，本地安装仍走镜像，不需要来回切。

发布成功后自查：

```powershell
npm view dsh-balance-strip version
dsh plugin --profile desktop add dsh-balance-strip
```

## 0. 名字与现状

| 项 | 值 | 说明 |
|---|---|---|
| npm 包名 | `dsh-balance-strip` | `dsh-balance-bar` 在 npm 上**已被别人占用**（registry 返回 200），所以改用了 `-strip`；`dsh-balance-bar-ui`、`balance-bar-dsh` 也空着，但 `-strip` 更准确 |
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
npm view dsh-balance-strip version dist.tarball
```

## 4. 从 npm 安装验证（换一个干净 profile）

```powershell
dsh plugin --profile strip-check add dsh-balance-strip
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
