# DockerSee

**See your Docker architecture.**
<img width="1660" height="972" alt="image" src="https://github.com/user-attachments/assets/7302e212-9780-4b36-9efa-524d44114eb2" />


DockerSee is a Visual Studio Code extension that reads your Docker Compose files and turns them into an
interactive architecture diagram — services, dependencies, networks, volumes, ports, images and build
configuration — without ever starting Docker.

```
                 ┌──────────────┐
                 │     api      │
                 │  8080 → 8080 │
                 └──────┬───────┘
                        │
                ┌───────┴───────┐
                ▼               ▼
         ┌────────────┐    ┌─────────┐
         │  postgres  │    │  redis  │
         │ 5432 → 5432│    │6379→6379│
         └────────────┘    └─────────┘
```

## Features

| | |
|---|---|
| **Instant diagram** | Open a Compose file and run `DockerSee: Visualize Compose` from the Command Palette, the editor title bar, or the explorer context menu. |
| **Services as nodes** | Each service shows its glyph, name, image and published ports. Icons are inferred from the image (🐘 Postgres, 🧠 Redis, 🌐 nginx …). |
| **Dependency edges** | `depends_on` (including the long syntax with `condition:`) and `links` become directed edges. Conditions such as *when healthy* are labelled. |
| **Networks** | Rendered as nodes, as translucent groups around their services, as badges, or hidden — whichever reads best for your file. |
| **Volumes** | Named volumes become nodes with their mount path on the edge. Bind mounts can be shown too. |
| **Details panel** | Select a node to inspect image, build, container name, ports, dependencies, networks, volumes, environment variables, health check, deploy limits, profiles and labels. |
| **Dependency highlighting** | Selecting a service dims everything unrelated and marks its direct dependencies and dependents. |
| **Live updates** | The diagram follows the file as you type — no save required — and also reacts to changes made outside VS Code, plus changes to the project's `.env` file. |
| **Full graph interaction** | Zoom, pan, drag nodes, fit to screen, minimap, reset layout, and four layout directions. |
| **Search** | `Ctrl`/`Cmd`+`F` (or `/`) searches service names, images, ports, environment variables, networks and volumes. |
| **Export** | Save the diagram as PNG or SVG. |
| **Graceful errors** | Invalid YAML never crashes the extension: you get the message plus the exact line and column, and the last good diagram stays on screen. |
| **No Docker required** | Everything is derived from the Compose file. The Docker daemon is never contacted. |

## Getting started

1. Install the extension (see [Installing](#installing-locally)).
2. Open a folder that contains a Compose file.
3. Press `Ctrl`+`Shift`+`P` and run **DockerSee: Visualize Compose**, or right-click the file in the
   explorer.

DockerSee recognises `docker-compose.yml`, `docker-compose.yaml`, `compose.yml` and `compose.yaml`
automatically, along with the usual variants such as `docker-compose.override.yml` and
`compose.prod.yaml`. Any other file can be chosen with **DockerSee: Select Compose File…**.

## Commands

| Command | What it does |
|---|---|
| `DockerSee: Visualize Compose` | Opens the diagram for the current / selected Compose file. |
| `DockerSee: Select Compose File…` | Picks a Compose file from the workspace or from disk. |
| `DockerSee: Refresh Diagram` | Rebuilds the diagram immediately. |
| `DockerSee: Reset Layout` | Discards manual node positions and re-runs the automatic layout. |
| `DockerSee: Fit Graph To Screen` | Zooms so the whole graph is visible. |
| `DockerSee: Search Service` | Focuses the search box. |
| `DockerSee: Export Diagram as PNG` / `as SVG` | Renders the diagram to an image file. |
| `DockerSee: Show Log` | Opens the DockerSee output channel. |

## Settings

| Setting | Default | Description |
|---|---|---|
| `dockersee.autoRefresh` | `true` | Rebuild the diagram when the Compose file changes. |
| `dockersee.refreshDelay` | `300` | Debounce delay in milliseconds before rebuilding. |
| `dockersee.layoutDirection` | `TB` | `TB`, `LR`, `BT` or `RL`. |
| `dockersee.networkDisplay` | `nodes` | `nodes`, `groups`, `badges` or `hidden`. |
| `dockersee.showVolumes` | `true` | Render volumes as graph nodes. |
| `dockersee.showBindMounts` | `false` | Also render host bind mounts. |
| `dockersee.showDefaultNetwork` | `false` | Render the implicit `default` network. |
| `dockersee.highlightDependencies` | `true` | Dim unrelated nodes when a service is selected. |
| `dockersee.showMinimap` | `true` | Show the minimap. |
| `dockersee.interpolateVariables` | `true` | Resolve `${VARIABLE}` references. |
| `dockersee.envFile` | `.env` | Env file used for interpolation, relative to the Compose file. |

Every toggle is also available in the diagram toolbar, and changes there are written back to your
settings.

## How it works

```
docker-compose.yml
        ↓
   YAML parser (yaml)
        ↓
   Compose model      ← normalizes every shorthand the Compose spec allows
        ↓
   Dependency graph
        ↓
   Visual graph       ← React + React Flow inside a VS Code webview
```

The extension host owns parsing, graph building and file watching. The webview owns rendering and
interaction. They talk over a small typed `postMessage` protocol
([`src/webview/messages.ts`](src/webview/messages.ts)).

### What the parser understands

Both the short and long syntax of `ports`, `volumes` and `depends_on`; `build` as a string or a
mapping; `environment` and `labels` as lists or mappings; `healthcheck` with a string or list `test`;
`deploy.replicas` and resource limits; `profiles`; `networks` with aliases and static addresses;
external networks and volumes; `configs` and `secrets`; and `${VAR}`, `${VAR:-default}`,
`${VAR:?error}`, `${VAR:+alternative}` and `$$` interpolation from the project `.env` file and the
environment.

### Problems it reports

Invalid YAML (with line and column), a missing or empty `services` section, services with neither
`image` nor `build`, `depends_on` targets that do not exist, self-dependencies, circular
dependencies, unknown `condition` values, undeclared networks and volumes, invalid port and volume
definitions, duplicate `container_name` values, the obsolete `version` key, unresolved `extends`
and `include`, and unknown keys. Nothing throws — everything shows up in the **Problems** drawer with
a clickable position.

## Development

```bash
npm install          # also installs the webview dependencies
npm run build        # webview bundle + extension bundle
npm test             # parser and graph-builder unit tests
npm run typecheck    # both TypeScript projects
```

Press `F5` in VS Code to launch an Extension Development Host. It opens the `examples/` folder, which
contains a realistic Compose project plus a deliberately broken file for testing error handling.

`npm run watch:extension` and `npm run watch:webview` run incremental builds; the default build task
(`Ctrl`+`Shift`+`B`) starts both.

### Project layout

```
src/
├── extension.ts               activation
├── commands/                  command registration and Compose file resolution
├── parser/                    detection, YAML → model, interpolation, diagnostics
├── graph/                     model → graph, service icons
├── services/                  file + env loading
├── watcher/                   live reload
├── util/                      logging, settings
└── webview/                   panel management and the message protocol

webview/src/
├── App.tsx                    state, messaging, keyboard shortcuts
├── layout.ts                  dagre automatic layout
├── filters.ts                 view options and highlighting
└── components/                graph, nodes, details, toolbar, diagnostics
```

## Building a VSIX

```bash
npm install -g @vscode/vsce
vsce package
```

This produces `dockersee-0.1.0.vsix`.

## Installing locally

```bash
code --install-extension dockersee-0.1.0.vsix
```

Or in VS Code: **Extensions → … → Install from VSIX…**.

## Roadmap

The current release covers the whole configuration-level picture. Runtime features are deliberately
out of scope for v0.1 — DockerSee never needs a Docker daemon.

- **v0.3** — connect to the Docker Engine and show container state, CPU and memory.
- **v0.4** — live container logs from the diagram.
- **v0.5** — start / stop / restart / rebuild actions.
- **v1.0** — a combined Compose + Engine + runtime architecture explorer.

## License

MIT — see [LICENSE](LICENSE).
