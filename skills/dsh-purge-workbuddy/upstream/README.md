# 原版插件：dsh-purge-community（下载地址与说明）

本目录**只存说明，不存插件本体**。有这个文件是为了让你随时知道去哪里拿原版、拿哪一版、以及它和移植版到底差在哪。

## 官方下载地址

### 最新版（推荐）

```
https://github.com/kingcharleslzy-ai/dsh-purge/releases/latest
```

版本无关的固定链接（永远指向最新）：

```
https://github.com/kingcharleslzy-ai/dsh-purge/releases/latest/download/dsh-purge-community.tgz
```

### 指定版本（以下载 1.6.69 为例）

```
https://github.com/kingcharleslzy-ai/dsh-purge/releases/download/v1.6.69/dsh-purge-community-1.6.69.tgz
```

改版本号即可拿任意版本，形态是 `releases/download/v<版本>/dsh-purge-community-<版本>.tgz`。

### 校验文件

```
https://github.com/kingcharleslzy-ai/dsh-purge/releases/download/v1.6.69/SHA256SUMS.txt
```

### 仓库与其他入口

| 用途 | 地址 |
|---|---|
| 源码仓库 | https://github.com/kingcharleslzy-ai/dsh-purge |
| git 克隆 | `git clone https://github.com/kingcharleslzy-ai/dsh-purge.git` |
| 文档 | https://github.com/kingcharleslzy-ai/dsh-purge#readme |
| 问题反馈 | https://github.com/kingcharleslzy-ai/dsh-purge/issues |

> **npm 上没有这个包**。查 `https://registry.npmjs.org/dsh-purge-community` 返回 404，
> 所以 `npm i dsh-purge-community` 一定失败。只能走 GitHub Releases 或 git。

## 下载与校验

```powershell
# 拿最新
Invoke-WebRequest -Uri 'https://github.com/kingcharleslzy-ai/dsh-purge/releases/latest/download/dsh-purge-community.tgz' -OutFile dsh-purge-community.tgz

# 校验（和 SHA256SUMS.txt 里的值逐字比对）
(Get-FileHash .\dsh-purge-community.tgz -Algorithm SHA256).Hash.ToLower()
```

实测 1.6.69 的哈希：

```
f07235866f9adcc2069b4b4ac6c6560c6784a977bbc037073661d167548e4d6f
```

与官方 `SHA256SUMS.txt` 一致。

## 版本对照

| 版本 | 状态 | 说明 |
|---|---|---|
| **1.6.69** | 官方最新 | 2026-11-01 发布，1783 KB |
| 1.6.67 | 本机 DSH 实际安装版 | 移植版就是基于这个版本做的 |

**本机 DSH 装的是 1.6.67，落后官方两个小版本。**
若要跟进 1.6.69，需重新对照载荷和补丁表有没有变化（重点看 `lib/` 与 `rules/`）。

用 git 看两个版本的差异：

```powershell
git clone https://github.com/kingcharleslzy-ai/dsh-purge.git
cd dsh-purge
git diff v1.6.67 v1.6.69 --stat
```

## 它和移植版的根本区别

```
dsh-purge-community  （原版，本文件描述的对象）
  └─ 跑在 DSH(Cordis) 内核上
     清单: package.json 里的 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
     注入: lib/core.js 组装 + preset（agent.cordis.yml）
     补丁: cordis.patch.yml，80 条编号补丁
     面板: client.js（652 KB Web UI）

dsh-purge-workbuddy  （移植版，上一级目录）
  └─ 跑在 WorkBuddy(Electron) 上
     清单: .codebuddy-plugin/plugin.json
     注入: 直接内联 resources/templates/*.tpl + welcomemode/prompt.tpl
     补丁: 6 条，操作明文 tpl
     面板: 无（能力改为 MCP 工具 + CLI）
```

## 为什么原版在 WorkBuddy 上装不上

不是缺依赖，是**内核不存在**。对 WorkBuddy 的 `app.asar` 全量字节搜索：

```
cordis         命中 0
@deepseek-ai   命中 0
dsh-client     命中 0
```

所以 `cordis.patch.yml`、`dsh.bundle`、`client.js` 这一整套在 WorkBuddy 里**没有任何落点**。
它的 `peerDependencies` 声明 `@deepseek-ai/cordis ^4.0.1`，这个包在 WorkBuddy 环境里也装不进去。

**结论：要在 WorkBuddy 里用，只能用移植版。** 原版是参考基线，不是可安装件。

## 原版源码里该看什么（下载后对照）

| 路径 | 内容 | 移植时对应到 |
|---|---|---|
| `lib/core.js` | 核心 346 KB | 拆进 `../lib/patch.mjs` + `../rules/` |
| `lib/rules.js` | 规则管理 17 KB | `../rules/purge-core.md` |
| `lib/skills.js` | 技能装载 28 KB | `../skills/<名>/SKILL.md` |
| `lib/anchors.js` / `reapply.js` | 补丁锚点 + 升级重打 | `../lib/patch.mjs` 标记块 + `../hooks/repair.mjs` |
| `lib/rewind.js` / `rollback-transaction.js` | 备份回滚 | `../lib/backup.mjs` + `pristine/` |
| `lib/selfcheck.js` | 自检 | `../lib/selfcheck.mjs` |
| `lib/boost.js` | 尾部强化段 `BOOST_TEXT` | `../rules/purge-boost.md` |
| `presets/unrestricted/agent.cordis.yml` | 无限制模式人设 | `../agents/unrestricted.md` |
| `presets/redteam/agent.cordis.yml` | 红队五角色（27 KB） | `../agents/redteam.md` |
| `skills/redteam/*.md`（23 个） | 红队技能 | `../skills/*/SKILL.md`（frontmatter 已转写） |
| `client.js` | 652 KB Web 面板 | **无对应机制**，改为 MCP + CLI |
| `cordis.patch.yml` | 80 条宿主补丁 | **不适用**，改为 6 条 tpl 补丁 |

## 什么时候需要去下载原版

1. **要跟进新版本**：对比 `lib/` 和 `rules/` 看载荷是否更新
2. **要查某个能力原本怎么实现**：移植版做过改写，原版是原始答案
3. **要确认补丁语义**：`cordis.patch.yml` 里 80 条各自的意图，是移植时"哪些该保留"的依据
4. **要向上游反馈**：需要原始结构而非移植版

其余情况不需要原版——移植版已包含全部可用能力。
