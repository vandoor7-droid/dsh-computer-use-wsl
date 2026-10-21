# 调研：DSH 的 WSL / Computer Use 相关插件，以及为什么要有 `dsh-computer-use-wsl`

> 结论先行：截至 2026-10-21，公开生态里的 Computer Use 插件**全部是"驱动宿主本机桌面"**这一条路线
> （Windows 用 UIA/SendInput，macOS 用 Accessibility），没有任何一个提供
> **"隔离的 Linux/WSL 虚拟桌面 + 侧边栏实时画面 + 人来随时接管 + 跨实例控制状态"** 这个组合。
> 所以本仓库不是重复造轮子，而是补上一个空缺；它和 Windows 原生插件是**互补**关系，不是替代。

## 1. 判据

要判断"是否已有相同方案"，按这 5 条看：

| # | 判据 | 为什么重要 |
|---|---|---|
| 1 | 操作对象是否**隔离**（虚拟显示器 / 容器），而不是宿主真实桌面 | 隔离才不会抢用户鼠标、不会把凭据暴露在被操作的桌面里 |
| 2 | 是否能在 **DSH 侧边栏里看到实时画面** | 用户要能"看着 agent 干活" |
| 3 | 是否支持**人工随时接管**，且接管期间 agent 的输入被拒绝 | 登录、扫码、验证码这类环节必须人来 |
| 4 | 控制状态是否**跨实例共享** | 同一个桌面被脚本 + 插件同时驱动时，"接管"必须对两边都生效 |
| 5 | 能否在 **WSL / 无头 Linux** 上跑 | 这是本项目的部署形态 |

## 2. 生态盘点（公开来源）

| 插件 | 平台 / 观测方式 | 与判据的差距 |
|---|---|---|
| [Yu-tao-Li/dsh-computer-use-win](https://github.com/Yu-tao-Li/dsh-computer-use-win) | Windows；UIA 树 + SendInput；23 项桌面工具 + 1 管理入口；MCP 前缀 `mcp__wincu__` | 直接操作**宿主真实桌面**（判据 1、4 不满足）；无侧边栏画面；无接管 |
| [gxpppp/dsh-computer-use](https://dsh-plugin.org/plugins/gxpppp/dsh-computer-use) | Windows；UIA + SendInput；6 个扁平工具；按应用授权 | 同上；无隔离、无侧边栏 |
| [anionex/dsh-computer-use](https://github.com/anionex/dsh-computer-use) | macOS；Accessibility 优先，拒绝过期观测，按 app/session 授权 | 平台不符，且是宿主桌面 |
| [xiaoheizi1212/dsh-computer-use](https://dsh.deepseek404.com/detail.php?id=xiaoheizi1212%2Fdsh-computer-use) | 隔离浏览器 + Windows 原生 helper | 隔离的是**浏览器**，不是整块桌面；无接管协议 |
| [Altairpaca/dsh-computer-use-windows](https://dsh.deepseek404.com/detail.php?id=Altairpaca%2Fdsh-computer-use-windows) | Windows；目标窗口绑定 + OCR + 点击后验证 | 宿主桌面；纯 OCR 路线 |
| [6Mikao9/dsh-wsl-workspace](https://github.com/6Mikao9/dsh-wsl-workspace) | WSL 工作区支持（文件/会话） | 只解决工作区，不提供**图形桌面**与输入注入 |
| [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) | 把 DSH 打包成桌面应用 | 与 Computer Use 无关 |

> 说明：上表信息来自各插件页面的公开简介（检索于 2026-10-21），**未逐个做源码级核对**；
> 结论只依赖"是否隔离 / 是否有侧边栏 / 是否可接管"这三个粗粒度特征，这类特征在简介里都写得很明确。
> 唯一例外是 `dsh-computer-use-win`：它在本机**已安装并可用**（本会话的工具列表里能看到
> `mcp__wincu__windows_computer_use_*`），因此它的能力边界是实测过的，不是看简介推测的。

## 3. 本项目的差异化设计

| 能力 | 实现 | 对应判据 |
|---|---|---|
| 隔离桌面 | WSL 内 `Xvfb :99` + `openbox`，与宿主桌面完全无关 | 1 |
| 侧边栏实时画面 | x11vnc + websockify + 自带 viewer 壳（`/`、`/state`、`/events` SSE） | 2 |
| 人工接管 | `takeover` 工具 + viewer 按钮：接管后所有**变更类**工具抛 `USER_IN_CONTROL`，观测类工具仍可用 | 3 |
| 跨实例控制 | `$stateDir/control.json`（原子写 + 心跳 + 8 s 过期 + 不抢占活着的 user） | 4 |
| 运行面 | WSL / 无头 Linux；也可在纯 Linux 上跑 | 5 |

工具面（17 个，前缀 `mcp__wslcu__`）：`health`、`control_state`、`desktop_up/down`、`bootstrap`、
`launch`、`snapshot`、`windows`、`wait_window`、`click`、`move`、`drag`、`scroll`、
`type_text`、`key`、`takeover`、`exec`。

## 4. 和 Windows 原生插件怎么配合

两者不冲突，按"操作哪块桌面"分工：

- 用户在看**自己的 Windows 桌面**时 → 用 `dsh-computer-use-win`（UIA 树，语义化，不需要模型识图）；
- 需要**隔离环境**（跑实验、开不受信任的网页、避免抢鼠标/泄露凭据）→ 用本插件。

## 5. 未核实 / 待定

- 上述 macOS/Linux 类插件的**实际工具清单与接管语义**未逐一核对源码；
- `dsh-computer-use-win` 的"按应用授权"是否会拦截**我们的** MCP 调用，未实测（两者是不同 MCP server，理论上互不影响）。
