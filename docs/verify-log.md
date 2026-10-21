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