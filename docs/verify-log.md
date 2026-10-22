# 安装 / 组合验收记录

每次发版都在这份文件里追加一条"装进真实 DSH 之后长什么样"的记录。
测试（`scripts/verify.sh`）证明的是仓库内部自洽；这里证明的是**发布产物装进官方 DSH 后能被正确组合**。

环境约定：隔离环境用 `DSH_HOME=/root/.dsh-lab`、`--profile lab`，不碰宿主正在用的 DSH。

## 2026-10-21 · v0.1.6

| 项 | 值 |
|---|---|
| 产物 | `dsh-computer-use-wsl-0.1.6.tgz` |
| 大小 | 38,464 B |
| SHA-256 | `a91ed789abbe6c9735d4b24abf7bfe058a8cad7b61cf68b7740ad6e079c8f844` |
| DSH | `0.2.1-rc.2`（`dsh.compatibility.dshReleases` 声明值） |
| 包管理器 | pnpm 12.14.0（DSH 内置） |

安装：

```bash
dsh plugin --profile lab add /opt/wslcu-dist/dsh-computer-use-wsl-0.1.6.tgz
# dependencies:
# + dsh-computer-use-wsl 0.1.6
# Done in 287ms using pnpm v12.14.0
```

组合结果（`dsh --profile lab --dump-config`）：

```yaml
- id: mcp-dsh-computer-use-wsl
  name: dsh-computer-use-wsl
  config:
    mode: full
```

说明：`mode: full` 来自 `cordis.patch.yml` 里这一行的 `config`，是 **MCP 客户端桥**要的字段，
不是插件自己的设置项；插件设置（`display`、`stateDir` 等）走 `DSH` 的设置面板 / `WSLCU_SETTINGS_JSON`。

测试基线（同版本）：`bash scripts/verify.sh` → L0/L1/L2/L2b/L4/L5/L6/L7 **全绿**。
## 2026-10-21 · v0.1.7

| 项 | 值 |
|---|---|
| 产物 | `dsh-computer-use-wsl-0.1.7.tgz` |
| 大小 | 39,335 B |
| SHA-256 | `f7806936ce8ea5d631ba5674d327dd1a9d82044d34b11749ae5037ad2605c68d` |
| DSH | `0.2.1-rc.2` |
| 升级路径 | 0.1.6 → 0.1.7（同 profile 就地升级成功） |

```bash
dsh plugin --profile lab add /opt/wslcu-dist/dsh-computer-use-wsl-0.1.7.tgz
# dependencies:
# - dsh-computer-use-wsl 0.1.6
# + dsh-computer-use-wsl 0.1.7
# Done in 103ms using pnpm v12.14.0
```

`--dump-config` 仍正确组合出 `id: mcp-dsh-computer-use-wsl`；工具面 18 个（新增 `read_all_text`）。

实机验证（`:99` 上的华为云控制台页）：`read_all_text` 返回 `{"bytes":2296,"truncated":false}` 并给出可 grep 的页面正文。
## 2026-10-21 · v0.1.8

| 项 | 值 |
|---|---|
| 产物 | `dsh-computer-use-wsl-0.1.8.tgz` |
| 大小 | 40646 B |
| SHA-256 | `6fc34048b2b954afaba414d6cd65283e63f3604e486be6c1b24ce9d905a3d8d1` |
| DSH | `0.2.1-rc.2`（同 profile 就地升级 0.1.7 → 0.1.8） |
| 工具面 | 19 个（新增 `wait_text`） |

实机验证（`:99` 华为云控制台）：

    wait_text {contains:"公测"}  → {"matched":true,"waitedMs":542,"bytes":2296}
    wait_text {contains:"不存在的词"} → {"matched":false,"waitedMs":1574}   # 超时正确返回 false
## 2026-10-21 · v0.1.9（补验 DSH 0.2.0-rc.2）

背景：宿主部署实测为 **DSH 0.2.0-rc.2**，比此前验证的 0.2.1-rc.2 低一个版本。
装上之前必须补验，否则"兼容"只是声明。

| 项 | 值 |
|---|---|
| 产物 | `dsh-computer-use-wsl-0.1.9.tgz` |
| 大小 | 40,870 B |
| SHA-256 | `f1d461d36a84a05b7e6400a552debf765e32066a70832ea4bab4f5196f388d9f` |
| DSH | `0.2.0-rc.2`（独立 prefix `/opt/dsh020`，独立 `DSH_HOME=/root/.dsh-lab-020`） |
| 结果 | 安装成功并正确组合 |

    dsh plugin --profile lab add dsh-computer-use-wsl-0.1.9.tgz
    # - dsh-computer-use-wsl 0.1.8
    # + dsh-computer-use-wsl 0.1.9
    # Done in 98ms using pnpm v12.14.0

    dsh --profile lab --dump-config
    # - id: mcp-dsh-computer-use-wsl
    #   name: dsh-computer-use-wsl

`dsh.compatibility.dshReleases` 因此更新为 `["0.2.0-rc.2", "0.2.1-rc.2"]`。
## 2026-10-21 · v0.1.10（集成演练 + 打包门禁）

### 长链路集成演练（本地表单页，不碰华为云会话）

页面 `file:///tmp/form-test.html`：固定坐标的输入框 + 提交按钮 + 800ms 后出结果。

    点击输入框 (230,111)        → state=agent
    type_text "上海旅游"        → method=clipboard (CJK 走剪贴板)
    点击提交 (120,170)          → state=agent
    wait_text "已提交：上海旅游" → matched:true, waitedMs=677
    read_all_text               → 表单测试就绪 / 上海旅游 / 提交已提交：上海旅游

**演练暴露的三个陷阱**（已写入 README「已知边界」）：

| 陷阱 | 现象 | 规避 |
|---|---|---|
| 页面坐标 ≠ 屏幕坐标 | 窗口化时点 `(120,172)` 落在地址栏附近，按钮没反应 | 全屏（F11）后两者一致 |
| Chrome「恢复上次会话」气泡 | 盖住左上角 0–305 × 30–287，**吞掉所有点击**，Escape 关不掉 | 点它的 X (278,70) |
| `read_all_text` 的读取范围 | 光标在输入框里时，`ctrl+a/ctrl+c` 取到的是**输入框内容**，`wait_text` 会一直看不到页面文本 | 先点空白处再读页面 |

### 打包门禁加固

`npm pack` 曾把一个**语法错误**打进包（工具描述里 `input's` 的撇号截断了单引号字符串），
结果 8 层里 5 层同时失败。`scripts/pack-check.mjs` 现在对 `mcp/` 与 `lib/` 下每个模块跑
`node --check`：

    正向：干净仓库        → pack-check ok
    负向：故意写坏语法    → pack-check failed: - syntax error in mcp/text-match.mjs:50

## 2026-10-22 · v0.1.10 回归复测（同代码，换机器状态）

代码停在 `a0fca64`（仅文档改动），在新一次 WSL 冷启动后把全部测试重跑一遍，确认没有环境残留依赖。

| 项 | 值 |
|---|---|
| 环境 | WSL UbuntuLab，2 核 / 3.8 GiB（`.wslconfig` 削减后） |
| 显示 | 测试统一用 `:98`，与实验桌面 `:99` 隔离，互不干扰 |
| 单元测试 | `unit.test.mjs` → **12 通过 / 0 失败** |
| viewer 状态 | `viewer-state.mjs` → **8/8**（SSE 推送 `agent->agent`） |
| 控制面共享 | `control-shared.mjs` → **all checks passed**（含 stale takeover 释放、`startHeldByUser` 启动即持锁） |
| MCP 握手 | `mcp-handshake.mjs` → **L1 OK**（19 个工具，`health/windows/takeover status` 均可用） |
| 端到端 | `e2e.mjs` → **15/15**：viewer 与 websockify 端口不共享、xterm 启动、PNG 快照、点击聚焦、ASCII 打字（xtest）、**CJK 打字（剪贴板）**、接管时全部变更类工具被拒、接管结束恢复、`desktop_down` 只停自己启动的显示 |
| 打包门禁 | `pack-check.mjs` → `pack-check ok` |
| 脚本门禁 | `bash scripts/verify.sh` → `L0 unit / L1 mcp handshake / L2 backend e2e / L2b viewer state / L4 host mode stub / L5 bundle patch / L6 client module / L7 shared control` **all layers passed** |

结论：代码在冷启动环境下可复现，接管闸门对"变更类工具"的拦截是真的（不是界面文案）。
## 0.2.8 — 真机核验（2026-10-22）

宿主：DSH `0.2.0-rc.2`，`dsh web --host 127.0.0.1 --port 3082`，`DSH_HOME=~/.dsh-lab`，
插件装入 `profiles/web`（`dsh plugin --profile web add dsh-computer-use-wsl-0.2.8.tgz`）。

| 检查项 | 结果 |
|---|---|
| 条目激活（无 cordis 警告） | 通过：启动输出无 `did not activate`，出现 `[wslcu] ready transport=wsl display=:99` |
| 配置热中继 | 通过：`[wslcu] settings reloaded from …\wslcu\settings.json` |
| `GET /api/wslcu/status`（带 token 会话） | `200 {"state":"off","label":"未启动","idleReleaseMin":30,…}` |
| 未认证请求（无 token） | `401`（信任围栏生效） |
| 插件页配置表单 | 通过：7 项全部渲染（`docs/evidence/01-plugin-page-form.png`） |
| 对话框状态徽标 | 通过：渲染「未启动」（`docs/evidence/02-chat-dock-badge.png`） |
| 门禁 | `scripts/verify.sh` 八层全 PASS；单测 22/22 |

反例留痕（改动前，均为真机实测）：装错 profile → `apply` 不执行（settings.json 不生成）；
路由挂 `/wslcu/status` → 404；`apply` 返回 Fiber → `TypeError: Invalid effect` 未激活。
## 0.3.0 — 闲置释放真机核验（2026-10-22）

方式：不经宿主，直接驱动 MCP 服务器（`test/idle-release-live.mjs`）——
一次 `desktop_up` 把桌面拉起来，之后保持沉默，由回收器自己动手。

```
[server] [wslcu] ready transport=wsl display=:99
screenshot: ok
distro after start: Running
[server] [wslcu] idle release: terminated UbuntuLab after 1min without activity
releasedAt=2026-10-22T11:03:23.919Z distro=UbuntuLab
distro after idle: Stopped
PASS: the idle reaper terminated the managed distro
```

同时修掉两个会让回收静默失效的缺陷：

1. `distro` 默认值是空串，而桥接会把设置原样发布到 `settings.json`、后端再整体覆盖
   进内存 —— 空串把发行版名冲掉，回收器等于在 `wsl --terminate ""` 上打空。现在默认
   为 `UbuntuLab`，且**空串只表示「未配置」**：发布时省略、合并时忽略，不再清空已有值。
2. 回收器带 `live.ready` 前置条件（只回收自己启动的桌面），手工起的发行版不会被误杀 ——
   这是设计，不是缺陷，故用上面的脚本方式验证。
## 0.3.1 — 徽标与反向验证（2026-10-22）

徽标（真机，ego-browser 取计算样式）：

| 项 | 改前 | 改后 |
|---|---|---|
| 宽 | 744px（被 dock 拉伸成整行） | **70px** |
| 高 | 24px | 26px |
| 背景 | `rgba(0, 0, 0, 0)` | `rgba(155, 89, 182, 0.14)`（按状态色） |
| 边框 | 主题灰 | `1px solid rgba(155, 89, 182, 0.38)` |
| alignSelf | auto | flex-start |

反向验证输出（`npm run verify:reverse`）：

```
RESULT  LAYER     MUTATION                        EXPECTED TEST
PASS    L0        idle-release-never-fires        idle release
PASS    L0        vm-knobs-ignore-settings        settings map onto VM knobs
PASS    L0        badge-agent-looks-idle          five states
PASS    L0        clamp-dropped                   clamp instead of exploding
PASS    L0        status-forgets-release-marker   payload merges viewer state
PASS    L3        route-outside-api               status route lives under
PASS    L3        apply-returns-the-fiber         apply must not return
PASS    L3        manifest-releases-as-array      manifest keeps the shapes
PASS    L6        badge-slot-renamed              chat-dock status badge
PASS    L1        tool-renamed                    wsl_release
10/10 mutations turned the suite red
```

首轮是 8/10，暴露并修掉两个盲点：`client-module` 只断言了 `register` 的 meta 名、
没断言 `inject` 的槽位名；`mcp-handshake` 的 `EXPECTED` 漏了 `wsl_apply_perf` /
`wsl_release` / `wsl_move_distro` 三个新工具。补齐后 10/10。
## 0.3.2 — 0.2.1-rc.2 宿主上的对齐与动画实测（2026-10-22）

宿主：`dsh web`（App 自带 CLI，`--version` = **0.2.1-rc.2**），1256×774，插件 0.3.2。

### 对齐

宿主 token（该版本实测）：`--dsh-composer-side-clearance: 16px`、
`--dsh-composer-card-max-width: calc(clamp(680px, calc(976px * .64), 920px) + 32px)`。
栈宽 744、卡片宽 712（两侧各 16 居中）。

| 阶段 | badge.left | card.left | gap |
|---|---|---|---|
| 修复前 | 393 | 409 | **-16** |
| 第一次修（多加了 clearance） | 425 | 409 | **+16** |
| 最终 | **409** | **409** | **0** |

### 呼吸动画（agent 态，间隔 800ms 采样两次以上）

```
t1  transform=scale(1.077)  dot-shadow=rgba(77,139,254,0.19) 0 0 0 3.44px  chip-shadow 0.024/0.66px
t2  transform=scale(1.323)  dot-shadow=rgba(77,139,254,0.267) 0 0 0 4.82px chip-shadow 0.094/2.74px
t3  transform=scale(1.007)  dot-shadow=rgba(77,139,254,0.165) 0 0 0 3.04px chip-shadow 0.004/0.06px
```

`未启动` 态（真实状态）：`transform=matrix(1,...)`, `box-shadow: none`，两次采样完全相同。

`prefers-reduced-motion: reduce`（客户端边界把 `matchMedia` 置为 matches）：
两次采样都是 `scale(1)` + `3.00px` 光环，**完全静止**。

**取证方式说明**：宿主的 `/api/wslcu/status` 只反映宿主进程内自己启动过的 desktop，
我用独立 MCP 实例起的桌面它看不到，路由始终回 `off`。所以动画验证在**客户端边界**做：
拦截 `/api/wslcu/status` 返回 `state: "agent"`，再实测样式确实在呼吸——证明的是客户端
渲染路径；后端状态机（off/idle/agent/user/released）由 L0 `five states`、L2b、L7 覆盖。

### 其它

- 反向验证 **13/13** 全红（新增：清单版本漂移、删对齐 padding、删 reduced-motion 分支）。
- `dsh-plugin.json` 由 `pack-check` 与 L3 契约双重校验（version 跟随 package.json、字段 ⊆ Config 键）。
### 窄窗复测（复现你截图那种宽度）

用 CDP `Emulation.setDeviceMetricsOverride` 把视口改到 851×473（实际 `innerWidth` 827）：

```
innerWidth=827  badge.left=82  card.left=82  gap=0   （卡片宽 712）
```

宽窗 1256：`badge.left=409 card.left=409 gap=0`。两种宽度都对齐，截图见
`docs/evidence/07-badge-narrow.png`。
## 0.3.3 — 官方 schema 核对（2026-10-22）

上游：`T-Auto/dsh-std` `packages/manifest/schema/dsh-plugin-0.15.schema.json`
标题 *DSH Plugin Manifest Community Draft v0.15*，4830 字节，
`sha256 49c9272bbf5bfce29eb69d2477211ced945ec91251294eda1cb5e3cd5c0d3a02`；
钉住 commit `8a15541…` 与 `main` **逐字节一致**。

真 `ajv`（2020-12，`strict:false, validateFormats:false`）对当前清单：**`valid = true`**。

子集校验器 vs 真 ajv 的交叉对照（9 个用例）：

| 用例 | ajv | 子集校验器 | 一致 |
|---|---|---|---|
| 原样 | valid | valid | ✅ |
| 根级多余属性 `licenseX` | invalid | invalid | ✅ |
| `manifestVersion: "0.16"` | invalid | invalid | ✅ |
| `id` 含大写 | invalid | invalid | ✅ |
| `facets.host.entry: "../lib/index.js"` | invalid | invalid | ✅ |
| command 缺 `title` | invalid | invalid | ✅ |
| `source` 缺 `repository` | invalid | invalid | ✅ |
| `contributes["x-extra"] = {}`（非数组） | invalid | invalid | ✅ |
| permission 缺 `scope` | invalid | invalid | ✅ |

`mismatches = 0`。

`node scripts/check-manifest.mjs --remote` 输出：

```
schema   : DSH Plugin Manifest Community Draft v0.15
schema   : schemas/dsh-plugin-0.15.schema.json sha256=49c9272bbf5bfce29eb69d2477211ced945ec91251294eda1cb5e3cd5c0d3a02
manifest : dsh-plugin.json dsh-computer-use-wsl@0.3.3
upstream : in sync (sha256=49c9272b…)
manifest ok
```