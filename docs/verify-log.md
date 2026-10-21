# 安装 / 组合验收记录

每次发版都在这份文件里追加一条"装进真实 DSH 之后长什么样"的记录。
测试（`scripts/verify.sh`）证明的是仓库内部自洽；这里证明的是**发布产物装进官方 DSH 后能被正确组合**。

环境约定：隔离环境用 `DSH_HOME=/root/.dsh-lab`、`--profile lab`，不碰宿主正在用的 DSH。

## 2026-10-21 · v0.1.6

| 项 | 值 |
|---|---|
| 产物 | `dsh-computer-use-wsl-0.1.6.tgz` |
| 大小 | 38,464 B |
| SHA-256 | `a91ed789abbe6c9735d4b24abf7bfe058a8cad7b61cf68b7740ad6e079c8f844` |
| DSH | `0.2.1-rc.2`（`dsh.compatibility.dshReleases` 声明值） |
| 包管理器 | pnpm 12.14.0（DSH 内置） |

安装：

```bash
dsh plugin --profile lab add /opt/wslcu-dist/dsh-computer-use-wsl-0.1.6.tgz
# dependencies:
# + dsh-computer-use-wsl 0.1.6
# Done in 287ms using pnpm v12.14.0
```

组合结果（`dsh --profile lab --dump-config`）：

```yaml
- id: mcp-dsh-computer-use-wsl
  name: dsh-computer-use-wsl
  config:
    mode: full
```

说明：`mode: full` 来自 `cordis.patch.yml` 里这一行的 `config`，是 **MCP 客户端桥**要的字段，
不是插件自己的设置项；插件设置（`display`、`stateDir` 等）走 `DSH` 的设置面板 / `WSLCU_SETTINGS_JSON`。

测试基线（同版本）：`bash scripts/verify.sh` → L0/L1/L2/L2b/L4/L5/L6/L7 **全绿**。
