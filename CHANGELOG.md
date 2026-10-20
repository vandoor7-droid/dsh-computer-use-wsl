# Changelog

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
