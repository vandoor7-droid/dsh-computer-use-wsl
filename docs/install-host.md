# 在你的宿主 DSH 上安装（手动步骤）

本仓库发布时**不会**自动装进你的 DSH。按下面两条命令自己装，装完重启 DSH。

## 1. 确认前置

- Windows 10/11，WSL2 已启用，至少一个发行版（`wsl -l -v`）。
- 发行版里有 X 组件栈。没有的话，装完插件后先调用一次 `bootstrap` 工具：

```
bootstrap        # apt 安装 xvfb x11vnc xdotool imagemagick xclip openbox novnc websockify
```

## 2. 安装

```powershell
cd <解压后的仓库目录>
dsh plugin add .\dist\dsh-computer-use-wsl-0.1.8.tgz
```

装完重启 DSH。判断成功：

- 工具目录里出现 `mcp__wslcu__*`（16 个）。
- 调 `health`，应看到 `transport: "wsl"`、`distro: <你的发行版>`、`viewerUrl`。

## 3. 打开侧边栏视图

1. 调 `desktop_up`（或让模型调）。
2. 把 `health.viewerUrl`（默认 `http://127.0.0.1:6081/`）在侧边栏打开：
   - 让模型调 `sidebar_open { target: "<viewerUrl>", title: "WSL 虚拟桌面" }`，或
   - 设置 → 插件 → 「WSL 虚拟桌面」卡片里点「在侧边栏打开」。
3. 侧边栏里就是实时画面；模型操作时顶部显示「DSH 操作中」，点「我要接管」即可抢回。

## 4. 想换分辨率（4:3 / 16:9）

```
desktop_up { resolution: "1024x768" }   # 4:3
desktop_up { resolution: "1280x720" }   # 16:9
```

已经启动的桌面不会被重启（幂等），要换尺寸请先 `desktop_down` 再 `desktop_up`。

## 5. 回滚

```powershell
dsh plugin remove dsh-computer-use-wsl
```

如果插件卡住 DSH 启动（例如 Node 版本不符），把 `failOnStartupError` 保持默认 `false`，后端失败只会让工具报错，不会拖垮 DSH。

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| `health` 里 `transport: "local"` | 你在 WSL 里跑的 DSH；宿主侧应为 `wsl`。检查 `settings.transport` |
| `desktop_up` 报 `xvfb_failed` | 看 `health.missingTools`，跑 `bootstrap` |
| 侧边栏白屏 | 确认 `viewerUrl` 端口可达；`websockify` 默认只绑回环，跨机访问需自行改 `bindHost` |
| 画面能看不能点 | 你处于接管状态（胶囊显示「你正在操作」）；点「交还给 DSH」 |
| 中文打不进去 | 目标应用若不支持 `ctrl+v`，改用 `type_text { pasteChord: "middle" }` |
## 故障排查

### 桌面「整条栈消失」：Xvfb / x11vnc / noVNC 全都不在

现象：`curl http://127.0.0.1:6081/state` 连不上，`pgrep -af 'Xvfb :99'` 无输出，5900/6080/6081 全部 down。

原因：**WSL 被回收**（`vmIdleTimeout` 到期、`wsl --shutdown`、或系统休眠），VM 里所有进程随之消失——不是插件杀进程。

恢复：插件侧的 `desktop_up` 是幂等的，直接重新拉起即可：

```bash
# 在 WSL 里
node /path/to/mcp/server.mjs --self-test      # 或直接调用健康检查
```

最省事的做法是让宿主 DSH 重新 `health` + `desktop_up`（`desktop_up` 会重建 Xvfb → openbox → x11vnc → websockify）。
浏览器数据在磁盘上（`--user-data-dir`），重新打开 Chrome 时**登录态通常还在**，无需重新登录。

### 画面正常但键盘打不了字、点击也不聚焦

原因：窗口管理器（openbox）死了，但 `_NET_SUPPORTING_WM_CHECK` 属性残留在 root window 上，旧的存活检查被它骗过。

现在的实现：`wm_alive()` 会 `xwininfo -id <wm-window>` 校验那个窗口是否真的存在，不存在就重启 openbox。
手工确认：

```bash
DISPLAY=:99 xprop -root _NET_SUPPORTING_WM_CHECK   # 拿到 window id
DISPLAY=:99 xwininfo -id 0x<id>                    # 不存在 = WM 已死
DISPLAY=:99 setsid nohup openbox &
```

### x11vnc 启动即退出，日志里有 `Wayland display server detected`

原因：WSL 会话导出了 `XDG_SESSION_TYPE=wayland` / `WAYLAND_DISPLAY`，x11vnc 检测到就走 Wayland 分支并退出。

`scripts/desktop-up.sh` 开头已经 `unset WAYLAND_DISPLAY XDG_SESSION_TYPE XDG_SESSION_ID`；手工启动时必须同样处理。

### 侧边栏显示「Failed to connect」但桌面是活的

1. 确认 x11vnc 在跑：`pgrep -af x11vnc`；
2. 确认 websockify 在跑且指向 VNC 端口：`pgrep -af websockify`；
3. viewer 壳里点「重连画面」，或直接刷新侧边栏标签。

### `dsh plugin add` 报 `SyntaxError: Unexpected token '﻿'`

`package.json` 带了 UTF-8 BOM。DSH 用严格 JSON 解析，必须无 BOM：

```bash
node -e "const fs=require('fs');const p='package.json';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''))"
```