---
name: zen-help
description: Answer questions about Zencode and Paseo platform, including setup, configuration, connectivity, providers, workspaces, fleet swarm, updates, logs, and troubleshooting. Use when a user asks how Zencode or Paseo works, how to configure it, or why something is broken; use the zen skill instead to operate agents and workspaces through MCP or the CLI.
---

# Zen Help

You are helping a user understand, configure, or troubleshoot Zencode and the underlying Paseo core. Answer their question directly, verify the answer against documentation, and include relevant references. Do not send the user away to read docs in place of helping them.

**User's question:** $ARGUMENTS

## Use documentation

Check local docs and online references:

- Local docs: `docs/` in the Zencode workspace.
- Official Paseo index: [https://paseo.sh/llms.txt](https://paseo.sh/llms.txt) and [Common problems](https://paseo.sh/docs/troubleshooting.md).
- Fleet & Governance: `RULES.md` and `docs/governance/` in the Zencode workspace.

Prefer current docs over memory. Answer the user directly, then link relevant `.md` files or pages as supporting documentation.

## Establish the topology first

Identify the daemon involved before diagnosing versions, paths, providers, logs, updates, or connectivity:

1. **Where and how the daemon runs**
   - **Desktop-managed / AppImage:** Zencode Desktop App bundles, starts, and manages a daemon on that computer.
   - **Standalone:** the daemon was installed separately, running through `zencode.sh` or npm CLI.
   - **Docker:** the daemon, home, and credentials live in the container runtime.
2. **How the affected client reaches it**
   - same-machine local connection
   - relay connection
   - direct LAN, VPN, or Tailscale connection
   - daemon-served web UI

Use **Settings → About** to compare the app version with each connected host. For the affected host, open **Settings → your host → Overview → Full status**. On the daemon machine, `zencode daemon status --json` or `paseo daemon status --json` reports facts such as server ID, hostname, version, home, listen address, and process owner.

## Diagnostic checks

Use the smallest relevant read-only checks:

```bash
zencode --version
zencode daemon status --json
zencode provider diagnostic <provider> --json
```

Probe `http://127.0.0.1:6767/api/health` or read daemon logs only when appropriate. Do not restart the daemon, edit config, or expose a network listener without the user's explicit permission.

## Logs and local files

Defaults on the machine where the daemon or Desktop app runs:

- Daemon config: `~/.paseo/config.json`
- Daemon log: `~/.paseo/daemon.log`
- Agent state directory: `~/.paseo/agents/`
- Default managed worktree root: `~/.paseo/worktrees/`
- Linux desktop log: `~/.config/Paseo/logs/main.log` or `~/.config/Zencode/logs/main.log`

Read narrow slices and redact credentials, pairing offers, tokens, passwords, and user code before sharing logs.
