# Development notes

记录实现过程中真实踩到的坑，按「现象 → 根因 → 现在怎么做」写。都属于**静默失败**类，不记下来下次还会踩。

## 1. WSL 会回收裸 `&` 的后台进程

**现象**：`exec` 里跑 `xterm ... >log 2>&1 &`，返回码 0、无输出，但窗口不出现，连日志文件都不存在。
**根因**：脚本由 `bash -s` 执行完立刻退出，WSL 在会话结束时清理进程组，子进程在 `fork/exec` 完成前就被杀掉。
**验证**：同样一条命令，后面加 `sleep 0.4` 或加 `< /dev/null` 就能活。
**现在**：`launch` 工具把「`nohup ... </dev/null >log 2>&1 &` + 0.6s settle + `kill -0` 校验」固化下来。`exec` 保持原语义，文档里明确写「后台进程请用 launch」。

## 2. 端口分配要先占位

**现象**：websockify 与 viewer 外壳都拿到 6084，外壳偶发起不来。
**根因**：`desktop_up` 先跑，websockify 扫描到 6084（6082/6083 被上次测试残留占用）；viewer 后起，撞车后靠重试漂到 6085。
**现在**：`desktop_up` 先 `ensureViewer()` 把 viewer 端口占住，再启动桌面。e2e 里加了「viewer 端口 != web 端口」与「viewer HTTP 可达」两条断言。

## 3. 窗口管理器检测必须按 display 作用域

**现象**：测试显示 `:98` 上没有窗口管理器，xterm 窗口没有边框。
**根因**：判断写成了 `pgrep -f openbox`——用户在 `:99` 已经跑了一个 openbox，于是脚本认为「WM 已经在了」，跳过了 `:98` 的启动。
**现在**：用 `DISPLAY=$D xprop -root _NET_SUPPORTING_WM_CHECK` 判断，天然按显示隔离。

## 4. `xdotool type` 打不出中文

**现象**：`xdotool type '中文ABC'` 只进去 `ABC`。
**根因**：xdotool 把字符映射到 keysym，CJK 没有现成键位。
**现在**：`type_text` 的 `auto` 模式分裂成两条路——纯 ASCII 走 `xdotool type`（所有 toolkit 都吃），含非 ASCII 走剪贴板 + 粘贴。

## 5. xterm 只认中键/PRIMARY，`ctrl+shift+v` 也不行

**现象**：剪贴板路径在 Electron/Chromium 里正常，但写进 xterm 一律为空；`ctrl+v`、`ctrl+shift+v`、`shift+Insert` 全失败。
**根因**：xterm 的粘贴绑定走 PRIMARY selection / 中键，且终端是行缓冲——不按回车，`cat` 一个字节都拿不到。
**现在**：剪贴板路径**同时写 CLIPBOARD 与 PRIMARY**，并支持 `pasteChord: "middle"`（`xdotool click 2`）。e2e 用它验证中文落地：
`md 中文测试 → xterm → /tmp/wslcu-in.txt` 逐字节比对。

## 6. MCP 图片内容块会被桥丢弃

**现象**：`snapshot` 若返回 image content，模型侧收不到。
**根因**：`dsh-mcp-client` 不转 MCP image 块。
**现在**：截图一律返回**文件路径**（Windows 侧是 `\\wsl.localhost\...` UNC），由模型用 `read_image` 打开。

## 7. WSL 里没有 `ss`，端口的回环断言要自己解析

**现象**：`ss -ltn` 报 command not found。
**现在**：`scripts/lib.sh` 的 `port_busy` 用 `/dev/tcp` 探测兜底；测试里的「只绑回环」断言直接解析 `/proc/net/tcp{,6}` 的 `0A`（LISTEN）行，判断地址是否为 `0100007F`/`::1`。

## 8. 中文路径不要经 stdin 传给 WSL

**现象**：`bash -s` 里 `cd /mnt/d/<中文目录>/...` 报 file not found，但 `wsl.exe -- bash -lc "ls '/mnt/d/<中文目录>/...'"` 正常。
**根因**：PowerShell 往 `wsl.exe` 的 stdin 管道写 UTF-8 时编码路径被破坏（argv 走的是正常转换）。
**现在**：仓库在 WSL 侧统一通过 ASCII 软链访问（例如 `/opt/wslcu-src` 指向真实目录）；脚本参数尽量 ASCII。

## 9. 「黑屏」不等于「截图失败」

**现象**：`snapshot` 只有 287 字节，误判为失败。
**根因**：1280×960 的纯黑 PNG 压缩后就是几百字节；反过来，截图字节小也可能只是画面单调。
**现在**：用 `identify -format '%[fx:mean]'` 判断亮度，`blank = mean < 0.02`；测试断言 `mean > 0.01` 而不是字节数阈值。

## 10. `pgrep -c` 计数为 0 时退出码是 1

**现象**：`$(pgrep -c -f 'Xvfb :98' || echo 0)` 得到两行 `0`，`Number()` 变 `NaN`，断言从「通过」变「失败」。
**现在**：统一用 `pgrep -cf ... || true` 取第一行再 `Number()`。
