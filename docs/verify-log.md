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