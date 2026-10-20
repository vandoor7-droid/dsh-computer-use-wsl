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
dsh plugin add .\dist\dsh-computer-use-wsl-0.1.0.tgz
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
