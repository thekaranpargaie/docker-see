# Changelog

All notable changes to DockerSee are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Initial release

### Added

- **Compose detection** for `docker-compose.yml`, `docker-compose.yaml`, `compose.yml` and
  `compose.yaml`, plus override/environment variants, plus manual selection of any file.
- **Compose parser** producing a strongly typed project model from every shorthand the Compose
  specification allows (short and long `ports`, `volumes` and `depends_on`, string or mapping
  `build`, list or mapping `environment`/`labels`, `healthcheck`, `deploy`, `profiles`, `networks`
  with aliases, external networks and volumes, `configs` and `secrets`).
- **Variable interpolation** — `$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}`,
  `${VAR:?error}`, `${VAR:+alternative}` and `$$`, resolved from the project `.env` file and the
  extension host environment.
- **Graph builder** creating service, network and volume nodes with dependency, network attachment
  and volume mount edges.
- **Interactive diagram** built with React and React Flow: zoom, pan, node dragging, fit to screen,
  minimap, reset layout, four layout directions and node selection.
- **Service details panel** showing image, build, container name, ports, dependencies, dependents,
  networks, volumes, environment variables, env files, health check, runtime, deploy limits,
  profiles, labels and keys that are not visualized.
- **Dependency highlighting** that dims unrelated nodes and marks direct dependencies and dependents.
- **Search** over service names, images, ports, environment variables, networks and volumes.
- **Network display modes** — nodes, translucent groups, badges, or hidden.
- **Live updates** driven by editor changes (before saving), file system changes and `.env` changes,
  with a configurable debounce and a manual refresh command.
- **PNG and SVG export** of the diagram.
- **Error handling** that never crashes: YAML syntax errors report the exact line and column, the
  last good diagram stays on screen, and every other problem is listed in a Problems drawer with a
  clickable position.
- **Commands** for visualizing, selecting a file, refreshing, resetting the layout, fitting the
  graph, searching, exporting and opening the log.
- **Settings** for auto refresh, refresh delay, layout direction, network display, volume and bind
  mount visibility, the default network, dependency highlighting, minimap, interpolation and env
  file.
- **Panel restore** after a window reload.
