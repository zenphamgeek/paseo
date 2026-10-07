---
name: zen-plugin
description: Build and manage trusted local Zencode and Paseo plugins. Use when the user asks to create, edit, install, reload, enable, disable, remove, or troubleshoot a plugin; add lifecycle hooks; transform agent configuration, environment, MCP servers, or workspace creation; automate permissions or turn follow-ups; add a screen, sidebar header or footer item, or workspace panel; add Command Center items or slash commands; add composer pills or attachment sources; transform, render, or append agent timeline items; contribute a theme; use Zencode/Paseo from plugin code; or add plugin RPCs.
---

# Zen & Paseo Plugins

Build or manage the requested plugin directly. Use the current public docs to catch contract changes, but keep working from this skill if the network is unavailable.

**User's request:** $ARGUMENTS

## Check current documentation

Fetch [https://paseo.sh/llms.txt](https://paseo.sh/llms.txt) first. Select and fetch the current plugin Markdown pages from that index before changing a plugin:

- [Plugin quickstart](https://paseo.sh/docs/plugins.md) ([browser page](https://paseo.sh/docs/plugins))
- [Publishing](https://paseo.sh/docs/plugins/publishing.md): npm package contents, dependencies, Git preparation, and private registries.
- [Plugin reference](https://paseo.sh/docs/plugins/reference.md) ([browser page](https://paseo.sh/docs/plugins/reference))

In the Zencode repository, use `public-docs/plugins/reference.md` for the checkout's API, including unreleased changes. Use `docs/plugins.md` for maintainer guidance.

## What a plugin can contribute

| Contribution              | Registration                                                | Use it when                                                                                                   | Reference                                                                                          |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Screen and sidebar item   | `addScreen` + `addSidebarHeaderItem`/`addSidebarFooterItem` | A full screen of plugin UI, or sidebar header or footer rows that open a screen or popover                    | reference.md → Screens and sidebar items                                                           |
| Workspace panel           | `addWorkspacePanel`                                         | UI that lives as a tab beside agents, terminals, files, and diffs; `locations: ["explorer"]` for the Explorer | reference.md → Workspace panels                                                                    |
| Command Center item       | `addCommandCenterItem`                                      | A global, workspace, or agent action reachable from ⌘K                                                        | reference.md → Command Center items                                                                |
| Client slash command      | `addSlashCommand`                                           | A `/command args` in the composer that runs plugin code instead of prompting the agent                        | reference.md → Slash commands                                                                      |
| Composer pill             | `addComposerPill`                                           | A per-agent button in the composer track bar next to Tasks and Subagents                                      | reference.md → Composer pills                                                                      |
| Timeline transformer      | `addTimelineTransformer` + `addTimelineRenderer`            | Replace, explode, or hide a built-in timeline item, including while it streams                                | reference.md → Timeline items; `plugin-examples/timeline-items`, `plugin-examples/inline-thinking` |
| Timeline row              | `paseo.agents.ref(id).timeline.append(...)`                 | Push a plugin-owned row into an agent timeline from a server handler and update it later                      | reference.md → Append a timeline row from the daemon                                               |
| Attachment source         | `client.addAttachmentSource` + `server.handle`              | Let the user attach a searchable external resource, such as an issue, to a prompt                             | reference.md → Add a composer attachment source; `plugin-examples/linear`                          |
| Theme                     | `addTheme`                                                  | A light or dark palette under Settings → Appearance                                                           | reference.md → Contribute a theme; `plugin-examples/catppuccin`                                    |
| Plugin RPC                | `defineRpc` + `server.handle` + `useRpc`                    | Daemon-side work that is not a normal Paseo operation: vendor APIs, credentials, local files                  | reference.md → Add plugin-specific backend behavior                                                |
| Lifecycle events          | `server.on`                                                 | Observe agent/workspace lifecycle, inspect ended turns, and answer permission requests                        | [Lifecycle hooks](https://paseo.sh/docs/plugins/reference.md#lifecycle-hooks)                      |
| Creation and launch hooks | `server.before`                                             | Change agent config, provider options, MCP servers, environment, or workspace isolation before the operation  | [Before hooks](https://paseo.sh/docs/plugins/reference.md#before-hooks)                            |
| Zencode / Paseo SDK       | `usePaseo()` / handler `{ paseo }`                          | Normal operations: workspaces, agents, providers, config                                                      | reference.md → Use the Paseo SDK                                                                   |

## Create the project

Use an absolute path on the daemon machine. `init` writes files but does not install packages.

```bash
zencode plugin init /absolute/path/to/my-plugin
cd /absolute/path/to/my-plugin
npm install
```

The generated project contains:

```text
my-plugin/
  paseo-plugin.json
  package.json
  tsconfig.json
  index.client.tsx
  index.server.ts
  client/greeting.tsx
  server/greeting.ts
  shared/greeting.ts
```

The manifest supplies the default install ID and supported versions:

```json
{ "id": "my-plugin", "requirements": { "paseo": ">=0.8.0" } }
```

Keep `requirements.paseo` correct whenever creating or editing a plugin.
