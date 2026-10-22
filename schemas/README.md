# Vendored DSH manifests schemas

These files are third-party specifications kept here so the plugin can validate its
manifest **offline** (no network in the gate, no extra npm dependency).

## `dsh-plugin-0.15.schema.json`

| Field | Value |
|---|---|
| Upstream | https://github.com/T-Auto/dsh-std |
| Path | `packages/manifest/schema/dsh-plugin-0.15.schema.json` |
| Pinned commit (the one `dsh-plugin.json` cites) | `8a15541117cb3c13ddb8f2468308691b6051d162` |
| Fetched | 2026-10-22 |
| `sha256` | `49c9272bbf5bfce29eb69d2477211ced945ec91251294eda1cb5e3cd5c0d3a02` |
| Bytes | 4830 |
| Title | DSH Plugin Manifest Community Draft v0.15 |

The pinned commit and the `main` branch served **byte-identical** files at fetch time;
the pinned copy is what is vendored, because that is the URL our `dsh-plugin.json`
declares in `$schema`.

### Constraints worth remembering

- Root objects use `additionalProperties: false`: an unknown top-level key makes the
  manifest invalid.
- `contributes` accepts only `commands`, `panels` (max 0) and `^x-` keys; every `x-`
  contribution must be an **array**.
- There is **no published schema for the `x-dsh-tui` payload**. `SettingsSection`
  field shapes (`number` / `select` / `text` / `boolean`, `path`, `label`, `hint`)
  are a community convention taken from shipped plugins (`dsh-ops`,
  `dsh-browser-cdp`) — schema validation cannot guarantee the TUI will render them.

### Re-checking / refreshing

```bash
npm run check:manifest                 # offline: manifest vs vendored schema
npm run check:manifest -- --remote     # also compare the vendored copy with upstream main
```

If upstream publishes a new draft (0.16+), fetch it, vendor it next to this file,
update the table above **and** the `$schema` / `manifestVersion` in `dsh-plugin.json`.
`test/contracts.mjs` fails when the vendored file's digest stops matching this table.
