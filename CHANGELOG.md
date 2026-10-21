# Changelog

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
