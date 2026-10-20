# Changelog

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
