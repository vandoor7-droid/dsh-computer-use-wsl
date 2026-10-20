# dsh-computer-use-wsl

Computer use for a **WSL / headless-Linux virtual desktop**, as a plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The model gets MCP tools (`mcp__wslcu__*`) to look at the screen, click and type.
The human gets the same screen live in the sidebar, a 「DSH 操作中」 badge while
the agent acts, and a 「我要接管」 button that takes the pointer back at once.

- Dual transport: `wsl` (Windows host driving a distribution) and `local`
  (inside the distribution), auto-detected, same code path.
- Idempotent, ownership-aware desktop lifecycle (Xvfb + openbox + x11vnc +
  websockify). A display that was already running is reused, never restarted.
- Fail-closed takeover: every mutating tool returns `USER_IN_CONTROL` while the
  human drives; observation tools stay live.
- `type_text` auto-routes ASCII through synthetic keys and CJK through the
  clipboard (both X selections written; `pasteChord: "middle"` for xterm).

## Install

```bash
dsh plugin add ./dsh-computer-use-wsl-0.1.0.tgz
```

Then, once WSL has the X stack (`bootstrap` installs it):

```
health → desktop_up → launch "xterm -e bash" → snapshot
```

Open `health.viewerUrl` (default `http://127.0.0.1:6081/`) in the sidebar — the
model can call `sidebar_open` with it.

See [README.md](./README.md) (Chinese, canonical), [docs/install-host.md](./docs/install-host.md)
and [docs/dev-notes.md](./docs/dev-notes.md) for the pitfalls this plugin encodes.

## Tests

```bash
npm test                      # L0 units
node test/mcp-handshake.mjs   # L1 protocol
node test/e2e.mjs             # L2 backend e2e on a dedicated display
node test/viewer-state.mjs    # L2b viewer state machine + SSE
node test/transport-stub.mjs  # L4 host mode via a wsl.exe stub
scripts/verify.sh             # all of the above
```

## License

MIT. Third-party components are not bundled; see [THIRD_PARTY.md](./THIRD_PARTY.md).
