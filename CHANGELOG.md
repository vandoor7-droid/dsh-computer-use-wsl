# Changelog

## 0.2.8 — 2026-10-22（真机修正）

首次在真实宿主里跑通（DSH 0.2.0-rc.2，`dsh web`，独立 `DSH_HOME=~/.dsh-lab`），
修掉五个只有真机才暴露的错：

1. **装错 profile**：`dsh web` 组合的是 `web` profile（`profiles/web/`），不是
   `--profile lab`。装进 lab profile 时该行在 `--dump-config` 里看得见，但运行中的
   宿主根本不挂载，`apply` 从不执行。判据：`%LOCALAPPDATA%\wslcu\settings.json`
   是否被生成。
2. **路由必须挂在 `/api/` 下**：注册 `/wslcu/status` 时 `register()` 照样返回
   disposer（看着像成功），但请求永远命不中处理器（404）；改成
   `/api/wslcu/status` 后立刻 200。
3. **`apply` 不能有返回值**：`async apply` 末尾 `return connection`（Fiber 对象）
   → cordis 把插件体的返回值当 effect 收集 → `TypeError: Invalid effect`，条目
   「未激活」。返回 `undefined` 即好。
4. **注册要两段式**：`ctx.inject(['connection','webServer'], c => …)` 里用
   `c.get('webServer')`（裸 `ctx.get()` 取不到），并在 `c.effect()` 内注册；请求
   先过 `connection.requestRejection()` 信任围栏（未认证 401，浏览器同源 200）。
5. **清单形状**：`dsh.engines.dsh` 是版本范围；`dsh.compatibility.dshReleases`
   是 `{版本: "compatible"}` 映射，不是数组。

真机证据（截图见 `docs/evidence/`）：

- 插件页 7 个配置项全部渲染（内存 4 / 核心 2 / swap 2 / disabled / 两个目录 / 闲置 30）
- 对话框上方状态徽标渲染「未启动」（WSL 当时停机）
- `GET /api/wslcu/status` → `200 {"state":"off","label":"未启动",…,"idleReleaseMin":30}`
## 0.2.0 — 2026-10-22

首次把「配置面」放进插件自己身上，而不是全局设置页。

- **插件页配置表单**（`plugins.item` 槽位 + 宿主 `configForms` 服务）：
  WSL2 内存上限 / 逻辑核心 / swap / autoMemoryReclaim、发行版磁盘落盘目录、
  产物落盘目录、闲置释放分钟数。保存走官方 `savePatch`（`remote.settings.mutate`
  → `configForms.describe().acceptView`），失败回滚并显示原因。
- **声明式设置 schema**：`lib/index.js` 导出 `Config`（schemastery，全字段
  `.volatile()`）。volatile 值以 live ref 形式到达，统一经 `derefConfig()` 读取；
  变更经 `loader/volatile-update` 热发布，不重载插件。
- **配置热中继**：bridge 的 env 只在 spawn 时固定，因此宿主把编辑后的设置写进
  `%LOCALAPPDATA%\wslcu\settings.json`，MCP 进程按 mtime 重读——改 `idleReleaseMin`
  之类的开关不需要重启后台。
- **闲置自动释放**：`idleReleaseMin`（默认 30，0=关）分钟没有 `mcp__wslcu__*` 调用
  就 `wsl --terminate <distro>` 释放 vmmem；数据不动，下次调用自动冷启动。判定是
  纯函数 `shouldRelease()`，周期 30s 检查，与 `dsh-browser-cdp` 的 idle reaper 同形。
- **对话框状态徽标**（`conversation.input.dock`）：五态
  未启动 / 空闲 / DSH 操作中 / 已人工接管 / 已释放，2s 轮询宿主路由
  `/wslcu/status`。该路由服务端合并「查看器 /state + releasedAt 标记 + 发行版运行态」，
  浏览器不必跨源访问 VNC 查看器。
- **三个新工具**：`wsl_apply_perf`（写 .wslconfig，可选重启 VM；写前备份）、
  `wsl_release`（立即释放）、`wsl_move_distro`（`wsl --manage --move`，需 confirm）。
  `health` 增加 `wsl` 概览（发行版状态、.wslconfig 现值、闲置倒计时、产物目录）。
- 测试：单测 22（新增 .wslconfig 合并/幂等、释放阈值、五态映射、status 合并、
  字段 clamp），verify.sh 八层全绿。

> 说明：没有加 `dsh-plugin.json`。查证后它的 `x-dsh-tui.SettingsSection` 只服务
> TUI 宿主；Web GUI 的插件页表单走的是 `plugins.item` + `configForms`（官方
> `dsh-computer-use-win` 同一做法），因此按 Web 契约实现。

## 0.1.10 — 2026-10-21

- Documented three traps found by a full end-to-end run on a local form page
  (click input → type CJK → click button → wait for result):
  1. windowed Chrome shifts page coordinates by the chrome height (~90 px);
     fullscreen (F11) makes page and screen coordinates agree;
  2. Chrome's "Restore pages?" bubble covers the top-left corner, swallows
     clicks, and Escape does not dismiss it — click its X;
  3. `read_all_text` reads the focused *input's* value when focus is in a text
     field, not the page, so `wait_text` can poll the wrong text. Call
     `read_all_text`'s description and the README now say so.
- The tool itself is unchanged; this is a documentation release, because these
  are usage rules rather than bugs.
- **prepack gate hardened**: scripts/pack-check.mjs now also runs
  
ode --check on every shipped module. An unescaped apostrophe in a tool
  description had slipped through packing and broke *every* runtime layer at
  once — a typo must fail the pack, not the test suite.
## 0.1.9 — 2026-10-21

- **Verified on DSH `0.2.0-rc.2` as well as `0.2.1-rc.2`**, and both are now
  declared in `dsh.compatibility.dshReleases`. The 0.2.0 check was added after
  inspecting the host deployment and finding it a minor version older than the
  one the package was tested against; installing on the host would otherwise
  have been an unverified claim. Composition checked with the real CLI on that
  release:
  `dsh plugin --profile lab add dsh-computer-use-wsl-0.1.9.tgz` →
  `+ dsh-computer-use-wsl 0.1.9`, and `--dump-config` still emits
  `mcp-dsh-computer-use-wsl`.
## 0.1.8 — 2026-10-21

- New tool **`wait_text`** (19 tools): poll `read_all_text` until the page text
  *contains* something, *loses* something, or *matches* a regex, with a timeout.
  Replaces blind `sleep` before asserting that a slow operation finished
  ("部署成功 出现", "加载中 消失"). The matcher lives in `mcp/text-match.mjs` so
  its AND semantics (contains + absent + regex) are unit-tested without a
  desktop; an invalid regex never matches instead of throwing mid-wait.
## 0.1.7 — 2026-10-21

- New tool **`read_all_text`** (18 tools): select-all + copy in the focused
  document, read the X clipboard, restore the caller's previous clipboard.
  Vision-free and greppable — for reading a page it is cheaper and far more
  reliable than a screenshot, and it avoids shipping another image into the
  model context. Changes the selection, so it is gated by the takeover state
  like every other mutating tool.
## 0.1.6 — 2026-10-21

- New setting **`startHeldByUser`** (default `false`). With `true` the desktop
  starts already held by the human — the agent is in `USER_IN_CONTROL` from the
  first call and must wait for 「交还给 DSH」. Default behaviour is unchanged:
  the agent drives until someone takes over. Motivated by a fair question after
  the takeover bug: "you couldn't even tell whether I had handed control back,
  so why not make the human own it unless they let go?"
- Tests: L0 asserts the default and the coercion; L7 boots a server with the
  option on and proves `control_state` reports `user` and `click` is refused.
## 0.1.5 — 2026-10-21

- Declare `dsh.compatibility.dshReleases: ["0.2.1-rc.2"]`, the release this
  package was actually composed and tested against (L5 runs the shipped
  `cordis.patch.yml` through the real `applyEntryPatches` + `entryListSchema`,
  L6 loads the client module through `__ModuleLoader__`).
- `package.json` is normalized (stable formatting, still BOM-free — a BOM broke
  `dsh plugin add` earlier).
## 0.1.4 — 2026-10-21

- **The badge now matches reality across instances.** `ControlState.get()` merged
  a shared `user` claim but ignored a shared `agent` one, so while a script or a
  second profile was moving the pointer the sidebar still said 「空闲」 — the
  human had no way to tell the agent was acting. Shared `agent` records are now
  merged too (with the owning instance id and the tool name).
- **The badge clears when the hold expires.** A shared record stays on disk
  until the staleness window (8 s) closes, so a plain `holder === 'agent'` check
  kept 「DSH 操作中」 lit for seconds after the last click. The merge is now
  bounded by `holdMs`, and the viewer ticker emits whenever the *reported* state
  changes, so the pill returns to 空闲 without waiting for another tool call.
- Tests: L7 gained "B sees A driving" and "badge falls back to idle when the
  driving hold expires", both of which failed before this change.
## 0.1.3 — 2026-10-21

- **Control state is shared across instances.** Takeover used to live in process
  memory, so a second entry point driving the same desktop (a script, a second
  profile) still saw `idle` and kept moving the pointer after the human clicked
  「我要接管」. Ownership is now written to `$stateDir/control.json` with atomic
  writes and a heartbeat; a record older than 8 s is treated as released, and
  claiming `user` never steals a claim that is still alive.
- **New read-only tool `control_state`** (17 tools total): reports who owns the
  pointer, since when, and whether it is shared — so an agent can check before
  acting instead of discovering the takeover from an error. `health` carries the
  same `control` object.
- **Window-manager check fixed.** `_NET_SUPPORTING_WM_CHECK` survives the
  manager that set it, so a dead openbox looked healthy: the picture streamed
  fine while clicks never focused a window and every key press was dropped
  (exactly the "can see it but cannot type" failure). `wm_alive()` now verifies
  the WM window still exists before deciding to skip `openbox`.
- Tests: **L7 shared control** spawns two independent servers on one desktop and
  proves a takeover in one is enforced in the other, that handing back clears it,
  and that a stale holder cannot lock the desktop forever.

## 0.1.2 — 2026-10-21

- **Daemons now survive the launching session.** `nohup` alone was not enough:
  x11vnc installs its own `SIGHUP` handler and exited when the WSL shell that
  started it went away, leaving websockify with nothing to bridge and the
  sidebar stuck on "Failed to connect". `desktop-up.sh` starts Xvfb, openbox,
  x11vnc and websockify with `setsid nohup`, so they survive a closed session
  (verified across a 10-hour gap).
- Viewer: a 「重连画面」 button reloads the embedded noVNC without losing the
  state badge or the takeover control.

## 0.1.1 — 2026-10-20

Fixes found while dogfooding the viewer in a real WSL desktop.

- **x11vnc refused to start under WSL.** The shell exports `XDG_SESSION_TYPE=wayland`
  / `WAYLAND_DISPLAY`, which x11vnc trusts over `-display` and exits with
  "Wayland display server detected" — Xvfb and websockify stayed healthy, so the
  sidebar showed an empty noVNC frame ("Failed to connect to server").
  `desktop-up.sh` now scrubs those variables for every child it starts, and a
  new e2e step poisons the environment on purpose to keep it fixed.
- **"Ready" no longer lies.** `desktop_up`/`probe` require a listening VNC port
  in addition to X + websockify, and fail with `vnc_failed` plus a log path
  instead of reporting a usable desktop with no picture.
- **Viewer ownership label was inverted** (`本插件启动` / `复用已有桌面`).
- `desktop_up` is noticeably faster when the VNC wait succeeds first try.
- Docs: real screenshots of the shell badge (`docs/screenshots/`).
- Tests: **L5 real composition** — `cordis.patch.yml` is parsed with the DSH
  launcher's own `entryListSchema` and composed with its `applyEntryPatches`
  (against both the repo and the installed artifact), and **L6 client contract**
  — `lib/client.js` is loaded under `window.__ModuleLoader__.load` and must
  register the settings card without throwing on hosts that have no slots.

## 0.1.0 — 2026-10-20

First release.

- MCP stdio server exposing 16 tools: `health`, `desktop_up`, `desktop_down`,
  `bootstrap`, `launch`, `snapshot`, `windows`, `wait_window`, `click`, `move`,
  `drag`, `scroll`, `type_text`, `key`, `takeover`, `exec`.
- Dual transport: `wsl` (Windows host driving a distribution via `wsl.exe`) and
  `local` (inside the distribution). Auto-detected; same code path for both.
- Desktop lifecycle is idempotent and ownership-aware: a display that was
  already running is reused and never stopped by `desktop_down`.
- Sidebar viewer shell (`viewerUrl`): embeds noVNC, shows a 「DSH 操作中」 badge
  while the agent acts, and offers a 「我要接管」 button backed by a token-guarded
  POST. State reaches the shell over SSE with polling fallback.
- Takeover is fail-closed: `click`, `move`, `drag`, `scroll`, `type_text`, `key`,
  `launch` and `exec` are refused with `USER_IN_CONTROL` while the human drives.
  Observation tools (`health`, `snapshot`, `windows`, `wait_window`) stay live.
- `type_text` auto-routes ASCII through synthetic keys and CJK through the
  clipboard, writing both X selections; `pasteChord: "middle"` covers apps that
  only paste PRIMARY (verified against xterm).
- `exec` is off by default and always refuses a fixed list of destructive
  command shapes.
- Tests: L0 unit, L1 MCP handshake, L2 backend e2e on a dedicated display,
  L2b viewer state machine, L4 host-mode via a `wsl.exe` stub.
