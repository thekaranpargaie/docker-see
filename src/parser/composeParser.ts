/**
 * ComposeParser — Docker Compose YAML → strongly typed application model
 * (spec §Phase 3).
 *
 * Design rules:
 *  - Never throws. Every problem becomes a `ComposeDiagnostic`.
 *  - Never depends on `vscode` or the filesystem, so it is directly testable.
 *  - Accepts every shorthand the Compose specification allows and normalizes it.
 */

import { LineCounter, parseDocument, isMap, isScalar, type Document } from 'yaml';
import {
	type ComposeBuild,
	type ComposeConfigOrSecret,
	type ComposeDependency,
	type ComposeDeploy,
	type ComposeDiagnostic,
	type ComposeHealthcheck,
	type ComposeKeyValue,
	type ComposeNetwork,
	type ComposePort,
	type ComposeProject,
	type ComposeService,
	type ComposeServiceNetwork,
	type ComposeVolume,
	type ComposeVolumeMount,
	type DiagnosticCode,
	type DiagnosticSeverity,
	type ParseResult,
	type SourceLocation,
	type VolumeMountType,
} from './composeTypes';
import { basename } from './composeDetector';
import { interpolateTree, type InterpolationIssue, type VariableMap } from './interpolate';

export interface ParseOptions {
	/** Absolute path of the file being parsed (used for display only). */
	filePath?: string;
	/** Variables available for `${VAR}` substitution. */
	variables?: VariableMap;
	/** Set to false to keep `${VAR}` references verbatim. Defaults to true. */
	interpolate?: boolean;
	/** Fallback project name when the file has no `name:` key. */
	projectName?: string;
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
	'version',
	'name',
	'services',
	'networks',
	'volumes',
	'configs',
	'secrets',
	'include',
]);

const KNOWN_SERVICE_KEYS = new Set([
	'annotations',
	'attach',
	'blkio_config',
	'build',
	'cap_add',
	'cap_drop',
	'cgroup',
	'cgroup_parent',
	'command',
	'configs',
	'container_name',
	'cpu_count',
	'cpu_percent',
	'cpu_period',
	'cpu_quota',
	'cpu_rt_period',
	'cpu_rt_runtime',
	'cpu_shares',
	'cpus',
	'cpuset',
	'credential_spec',
	'depends_on',
	'deploy',
	'develop',
	'device_cgroup_rules',
	'devices',
	'dns',
	'dns_opt',
	'dns_search',
	'domainname',
	'entrypoint',
	'env_file',
	'environment',
	'expose',
	'extends',
	'external_links',
	'extra_hosts',
	'group_add',
	'healthcheck',
	'hostname',
	'image',
	'init',
	'ipc',
	'isolation',
	'labels',
	'links',
	'logging',
	'mac_address',
	'mem_limit',
	'mem_reservation',
	'mem_swappiness',
	'memswap_limit',
	'network_mode',
	'networks',
	'oom_kill_disable',
	'oom_score_adj',
	'pid',
	'pids_limit',
	'platform',
	'ports',
	'post_start',
	'pre_stop',
	'privileged',
	'profiles',
	'pull_policy',
	'read_only',
	'restart',
	'runtime',
	'scale',
	'secrets',
	'security_opt',
	'shm_size',
	'stdin_open',
	'stop_grace_period',
	'stop_signal',
	'storage_opt',
	'sysctls',
	'tmpfs',
	'tty',
	'ulimits',
	'user',
	'userns_mode',
	'uts',
	'volumes',
	'volumes_from',
	'working_dir',
]);

/** Service keys DockerSee understands well enough not to flag as "not visualized". */
const MODELLED_SERVICE_KEYS = new Set([
	'build',
	'command',
	'container_name',
	'depends_on',
	'deploy',
	'entrypoint',
	'env_file',
	'environment',
	'expose',
	'extends',
	'healthcheck',
	'image',
	'labels',
	'links',
	'networks',
	'ports',
	'profiles',
	'restart',
	'user',
	'volumes',
	'volumes_from',
	'working_dir',
]);

const VALID_DEPENDS_ON_CONDITIONS = new Set([
	'service_started',
	'service_healthy',
	'service_completed_successfully',
]);

const DEFAULT_NETWORK_NAME = 'default';

/** Maps a YAML node path onto a source position, for precise diagnostics. */
class Locator {
	constructor(
		private readonly doc: Document.Parsed,
		private readonly lineCounter: LineCounter,
	) {}

	/** Position of the key (preferred) or the value at `path`. */
	locate(path: (string | number)[]): SourceLocation | undefined {
		const last = path[path.length - 1];

		if (path.length > 0 && typeof last === 'string') {
			const parent = this.nodeAt(path.slice(0, -1));
			if (isMap(parent)) {
				const pair = parent.items.find(
					(item) => isScalar(item.key) && String(item.key.value) === last,
				);
				const key = pair?.key as { range?: [number, number, number] } | undefined;
				if (key?.range) {
					return this.fromOffset(key.range[0]);
				}
			}
		}

		const node = this.nodeAt(path) as { range?: [number, number, number] } | undefined;
		return node?.range ? this.fromOffset(node.range[0]) : undefined;
	}

	private nodeAt(path: (string | number)[]): unknown {
		try {
			return path.length === 0 ? this.doc.contents : this.doc.getIn(path, true);
		} catch {
			return undefined;
		}
	}

	fromOffset(offset: number): SourceLocation {
		const pos = this.lineCounter.linePos(offset);
		return { line: pos.line, column: pos.col, offset };
	}
}

/** Collects diagnostics while the model is being built. */
export class DiagnosticSink {
	readonly items: ComposeDiagnostic[] = [];

	constructor(private readonly locator?: Locator) {}

	add(
		severity: DiagnosticSeverity,
		code: DiagnosticCode,
		message: string,
		path?: (string | number)[],
		hint?: string,
	): void {
		const diagnostic: ComposeDiagnostic = { severity, code, message };
		if (path) {
			diagnostic.path = formatPath(path);
			const location = this.locator?.locate(path);
			if (location) {
				diagnostic.location = location;
			}
		}
		if (hint) {
			diagnostic.hint = hint;
		}
		this.items.push(diagnostic);
	}
}

export class ComposeParser {
	parse(text: string, options: ParseOptions = {}): ParseResult {
		const filePath = options.filePath ?? 'docker-compose.yml';
		const fileName = basename(filePath);

		if (text.trim().length === 0) {
			return {
				diagnostics: [
					{
						severity: 'error',
						code: 'empty-file',
						message: `${fileName} is empty.`,
						hint: 'Add a `services:` section to describe your application.',
					},
				],
				ok: false,
			};
		}

		const lineCounter = new LineCounter();
		let doc: Document.Parsed;
		try {
			doc = parseDocument(text, { lineCounter, uniqueKeys: true, strict: false });
		} catch (error) {
			return {
				diagnostics: [
					{
						severity: 'error',
						code: 'yaml-syntax',
						message: error instanceof Error ? error.message : String(error),
					},
				],
				ok: false,
			};
		}

		const locator = new Locator(doc, lineCounter);
		const sink = new DiagnosticSink(locator);

		for (const error of doc.errors) {
			sink.items.push({
				severity: 'error',
				code: 'yaml-syntax',
				message: cleanYamlMessage(error.message),
				location: yamlErrorLocation(error, locator),
				hint: 'Invalid YAML syntax.',
			});
		}

		// A syntax error means the document below the error point is unreliable;
		// stop here so the UI can show a precise "unable to parse" message.
		if (doc.errors.length > 0) {
			return { diagnostics: sink.items, ok: false };
		}

		for (const warning of doc.warnings) {
			sink.items.push({
				severity: 'warning',
				code: 'yaml-syntax',
				message: cleanYamlMessage(warning.message),
				location: yamlErrorLocation(warning, locator),
			});
		}

		let raw: unknown;
		try {
			raw = doc.toJS({ maxAliasCount: 200 });
		} catch (error) {
			return {
				diagnostics: [
					...sink.items,
					{
						severity: 'error',
						code: 'yaml-syntax',
						message: error instanceof Error ? error.message : String(error),
					},
				],
				ok: false,
			};
		}

		if (raw === null || raw === undefined) {
			return {
				diagnostics: [
					...sink.items,
					{
						severity: 'error',
						code: 'empty-file',
						message: `${fileName} does not contain any Compose configuration.`,
						hint: 'Add a `services:` section to describe your application.',
					},
				],
				ok: false,
			};
		}

		if (!isRecord(raw)) {
			return {
				diagnostics: [
					...sink.items,
					{
						severity: 'error',
						code: 'root-not-mapping',
						message: 'The Compose file must contain a YAML mapping at the top level.',
						location: locator.locate([]),
						hint: 'Expected keys such as `services:`, `networks:` and `volumes:`.',
					},
				],
				ok: false,
			};
		}

		let root: Record<string, unknown> = raw;
		if (options.interpolate !== false) {
			const issues: InterpolationIssue[] = [];
			root = interpolateTree(raw, options.variables ?? {}, issues);
			for (const issue of dedupeIssues(issues)) {
				sink.add(issue.severity, 'interpolation', issue.message);
			}
		}

		const project = this.buildProject(root, sink, locator, filePath, fileName, options);
		const ok = !sink.items.some((diagnostic) => diagnostic.severity === 'error');
		return { project, diagnostics: sink.items, ok };
	}

	private buildProject(
		raw: Record<string, unknown>,
		sink: DiagnosticSink,
		locator: Locator,
		filePath: string,
		fileName: string,
		options: ParseOptions,
	): ComposeProject {
		for (const key of Object.keys(raw)) {
			if (!KNOWN_TOP_LEVEL_KEYS.has(key) && !key.startsWith('x-')) {
				sink.add(
					'info',
					'unknown-key',
					`Top-level key "${key}" is not part of the Compose specification and is ignored.`,
					[key],
				);
			}
		}

		if (raw.version !== undefined) {
			sink.add(
				'info',
				'obsolete-version',
				'The top-level `version` key is obsolete and ignored by Docker Compose.',
				['version'],
				'It can safely be removed from the file.',
			);
		}

		if (raw.include !== undefined) {
			sink.add(
				'warning',
				'unsupported-feature',
				'`include` is not resolved by DockerSee; services from included files are not shown.',
				['include'],
			);
		}

		const services = this.parseServices(raw.services, sink);
		const networks = this.parseNetworks(raw.networks, sink);
		const volumes = this.parseVolumes(raw.volumes, sink);
		const configs = this.parseConfigsOrSecrets(raw.configs, 'configs', sink);
		const secrets = this.parseConfigsOrSecrets(raw.secrets, 'secrets', sink);

		this.attachServiceReferences(services, raw, sink);
		this.linkNetworks(services, networks, sink);
		this.linkVolumes(services, volumes, sink);
		this.linkConfigsAndSecrets(services, raw, configs, secrets);
		this.validate(services, sink);

		for (const service of services) {
			service.location = locator.locate(['services', service.name]);
		}
		for (const network of networks) {
			if (!network.implicit) {
				network.location = locator.locate(['networks', network.name]);
			}
		}
		for (const volume of volumes) {
			if (!volume.implicit) {
				volume.location = locator.locate(['volumes', volume.name]);
			}
		}
		for (const config of configs) {
			config.location = locator.locate(['configs', config.name]);
		}
		for (const secret of secrets) {
			secret.location = locator.locate(['secrets', secret.name]);
		}

		return {
			name: asString(raw.name) ?? options.projectName,
			version: asString(raw.version),
			services,
			networks,
			volumes,
			configs,
			secrets,
			filePath,
			fileName,
		};
	}

	// ---------------------------------------------------------------- services

	private parseServices(rawServices: unknown, sink: DiagnosticSink): ComposeService[] {
		if (rawServices === undefined || rawServices === null) {
			sink.add(
				'error',
				'missing-services',
				'No `services` section found in the Compose file.',
				undefined,
				'A Compose file must declare at least one service.',
			);
			return [];
		}

		if (!isRecord(rawServices)) {
			sink.add(
				'error',
				'services-not-mapping',
				'`services` must be a mapping of service name to service definition.',
				['services'],
			);
			return [];
		}

		const names = Object.keys(rawServices);
		if (names.length === 0) {
			sink.add('error', 'missing-services', 'The `services` section is empty.', ['services']);
			return [];
		}

		return names.map((name) => this.parseService(name, rawServices[name], sink));
	}

	private parseService(name: string, rawService: unknown, sink: DiagnosticSink): ComposeService {
		const service: ComposeService = {
			name,
			profiles: [],
			ports: [],
			expose: [],
			dependsOn: [],
			networks: [],
			volumes: [],
			environment: [],
			envFiles: [],
			labels: [],
			volumesFrom: [],
			unsupportedKeys: [],
		};

		if (rawService === null || rawService === undefined) {
			sink.add(
				'error',
				'service-not-mapping',
				`Service "${name}" has no definition.`,
				['services', name],
				'Add at least an `image:` or a `build:` key.',
			);
			return service;
		}

		if (!isRecord(rawService)) {
			sink.add(
				'error',
				'service-not-mapping',
				`Service "${name}" must be a mapping, but a ${describeType(rawService)} was found.`,
				['services', name],
			);
			return service;
		}

		const path = ['services', name];

		service.image = asString(rawService.image);
		service.containerName = asString(rawService.container_name);
		service.user = asString(rawService.user);
		service.workingDir = asString(rawService.working_dir);
		service.restart = asString(rawService.restart);
		service.command = joinCommand(rawService.command);
		service.entrypoint = joinCommand(rawService.entrypoint);
		service.profiles = asStringArray(rawService.profiles);
		service.expose = asStringArray(rawService.expose);
		service.volumesFrom = asStringArray(rawService.volumes_from);
		service.envFiles = parseEnvFileList(rawService.env_file);
		service.build = parseBuild(rawService.build);
		service.ports = parsePorts(rawService.ports, [...path, 'ports'], name, sink);
		service.dependsOn = parseDependsOn(rawService.depends_on, [...path, 'depends_on'], name, sink);
		service.dependsOn.push(...parseLinks(rawService.links));
		service.networks = parseServiceNetworks(rawService.networks, [...path, 'networks'], name, sink);
		service.volumes = parseVolumeMounts(rawService.volumes, [...path, 'volumes'], name, sink);
		service.environment = parseKeyValues(rawService.environment, [...path, 'environment'], name, sink, 'environment');
		service.labels = parseKeyValues(rawService.labels, [...path, 'labels'], name, sink, 'labels');
		service.healthcheck = parseHealthcheck(rawService.healthcheck, [...path, 'healthcheck'], name, sink);
		service.deploy = parseDeploy(rawService.deploy);
		service.extends = parseExtends(rawService.extends);

		if (service.extends) {
			sink.add(
				'warning',
				'unsupported-feature',
				`Service "${name}" uses \`extends\`, which DockerSee does not resolve. Inherited configuration is not shown.`,
				[...path, 'extends'],
			);
		}

		if (rawService.network_mode !== undefined && service.networks.length > 0) {
			sink.add(
				'warning',
				'invalid-network-definition',
				`Service "${name}" declares both \`network_mode\` and \`networks\`, which Docker Compose rejects.`,
				[...path, 'network_mode'],
			);
		}

		if (typeof rawService.scale === 'number') {
			service.deploy = { ...(service.deploy ?? {}), replicas: rawService.scale };
		}

		for (const key of Object.keys(rawService)) {
			if (key.startsWith('x-')) {
				continue;
			}
			if (!KNOWN_SERVICE_KEYS.has(key)) {
				sink.add(
					'info',
					'unknown-key',
					`Service "${name}" uses unknown key "${key}".`,
					[...path, key],
				);
				continue;
			}
			if (!MODELLED_SERVICE_KEYS.has(key)) {
				service.unsupportedKeys.push(key);
			}
		}

		if (!service.image && !service.build) {
			sink.add(
				'warning',
				'service-without-image-or-build',
				`Service "${name}" declares neither \`image\` nor \`build\`.`,
				path,
				'Docker Compose cannot start this service.',
			);
		}

		return service;
	}

	// ---------------------------------------------------------------- networks

	private parseNetworks(rawNetworks: unknown, sink: DiagnosticSink): ComposeNetwork[] {
		if (rawNetworks === undefined || rawNetworks === null) {
			return [];
		}

		if (!isRecord(rawNetworks)) {
			sink.add(
				'error',
				'invalid-network-definition',
				'`networks` must be a mapping of network name to network definition.',
				['networks'],
			);
			return [];
		}

		return Object.entries(rawNetworks).map(([name, value]) => {
			const network: ComposeNetwork = {
				name,
				external: false,
				internal: false,
				attachable: false,
				labels: [],
				driverOpts: [],
				subnets: [],
				implicit: false,
				isDefault: name === DEFAULT_NETWORK_NAME,
				services: [],
			};

			if (value === null || value === undefined) {
				return network;
			}

			if (!isRecord(value)) {
				sink.add(
					'error',
					'invalid-network-definition',
					`Network "${name}" must be a mapping or empty.`,
					['networks', name],
				);
				return network;
			}

			network.driver = asString(value.driver);
			network.dockerName = asString(value.name);
			network.internal = value.internal === true;
			network.attachable = value.attachable === true;
			network.labels = keyValuesFromUnknown(value.labels);
			network.driverOpts = keyValuesFromUnknown(value.driver_opts);
			network.external = parseExternal(value.external);
			if (typeof value.external === 'object' && value.external !== null) {
				network.dockerName = network.dockerName ?? asString((value.external as Record<string, unknown>).name);
			}

			const ipam = value.ipam;
			if (isRecord(ipam) && Array.isArray(ipam.config)) {
				for (const entry of ipam.config) {
					const subnet = isRecord(entry) ? asString(entry.subnet) : undefined;
					if (subnet) {
						network.subnets.push(subnet);
					}
				}
			}

			return network;
		});
	}

	// ----------------------------------------------------------------- volumes

	private parseVolumes(rawVolumes: unknown, sink: DiagnosticSink): ComposeVolume[] {
		if (rawVolumes === undefined || rawVolumes === null) {
			return [];
		}

		if (!isRecord(rawVolumes)) {
			sink.add(
				'error',
				'invalid-volume-definition',
				'`volumes` must be a mapping of volume name to volume definition.',
				['volumes'],
			);
			return [];
		}

		return Object.entries(rawVolumes).map(([name, value]) => {
			const volume: ComposeVolume = {
				name,
				external: false,
				labels: [],
				driverOpts: [],
				implicit: false,
				mounts: [],
			};

			if (value === null || value === undefined) {
				return volume;
			}

			if (!isRecord(value)) {
				sink.add(
					'error',
					'invalid-volume-definition',
					`Volume "${name}" must be a mapping or empty.`,
					['volumes', name],
				);
				return volume;
			}

			volume.driver = asString(value.driver);
			volume.dockerName = asString(value.name);
			volume.labels = keyValuesFromUnknown(value.labels);
			volume.driverOpts = keyValuesFromUnknown(value.driver_opts);
			volume.external = parseExternal(value.external);
			if (typeof value.external === 'object' && value.external !== null) {
				volume.dockerName = volume.dockerName ?? asString((value.external as Record<string, unknown>).name);
			}

			return volume;
		});
	}

	private parseConfigsOrSecrets(
		raw: unknown,
		kind: 'configs' | 'secrets',
		sink: DiagnosticSink,
	): ComposeConfigOrSecret[] {
		if (raw === undefined || raw === null) {
			return [];
		}

		if (!isRecord(raw)) {
			sink.add('warning', 'unknown-key', `\`${kind}\` must be a mapping.`, [kind]);
			return [];
		}

		return Object.entries(raw).map(([name, value]) => {
			const entry: ComposeConfigOrSecret = { name, external: false, services: [] };
			if (isRecord(value)) {
				entry.file = asString(value.file);
				entry.environment = asString(value.environment);
				entry.external = parseExternal(value.external);
			}
			return entry;
		});
	}

	// -------------------------------------------------------------- resolution

	/** Records `configs:`/`secrets:` usage per service. */
	private linkConfigsAndSecrets(
		services: ComposeService[],
		raw: Record<string, unknown>,
		configs: ComposeConfigOrSecret[],
		secrets: ComposeConfigOrSecret[],
	): void {
		const rawServices = isRecord(raw.services) ? raw.services : {};

		for (const service of services) {
			const definition = rawServices[service.name];
			if (!isRecord(definition)) {
				continue;
			}
			for (const [key, pool] of [
				['configs', configs],
				['secrets', secrets],
			] as const) {
				for (const reference of referencedNames(definition[key])) {
					const target = pool.find((item) => item.name === reference);
					if (target && !target.services.includes(service.name)) {
						target.services.push(service.name);
					}
				}
			}
		}
	}

	/** Marks `depends_on` targets that do not exist. */
	private attachServiceReferences(
		services: ComposeService[],
		_raw: Record<string, unknown>,
		_sink: DiagnosticSink,
	): void {
		const known = new Set(services.map((service) => service.name));
		for (const service of services) {
			for (const dependency of service.dependsOn) {
				dependency.dangling = !known.has(dependency.service);
			}
		}
	}

	/**
	 * Connects services to networks, creating implicit network entries for
	 * networks that are referenced but never declared (including `default`).
	 */
	private linkNetworks(
		services: ComposeService[],
		networks: ComposeNetwork[],
		sink: DiagnosticSink,
	): void {
		const byName = new Map(networks.map((network) => [network.name, network]));

		for (const service of services) {
			if (service.networks.length === 0) {
				// Compose implicitly attaches services to the `default` network.
				let fallback = byName.get(DEFAULT_NETWORK_NAME);
				if (!fallback) {
					fallback = {
						name: DEFAULT_NETWORK_NAME,
						external: false,
						internal: false,
						attachable: false,
						labels: [],
						driverOpts: [],
						subnets: [],
						implicit: true,
						isDefault: true,
						services: [],
					};
					byName.set(DEFAULT_NETWORK_NAME, fallback);
					networks.push(fallback);
				}
				service.networks.push({ name: DEFAULT_NETWORK_NAME, aliases: [], undeclared: false });
				fallback.services.push(service.name);
				continue;
			}

			for (const reference of service.networks) {
				let network = byName.get(reference.name);
				if (!network) {
					reference.undeclared = true;
					network = {
						name: reference.name,
						external: false,
						internal: false,
						attachable: false,
						labels: [],
						driverOpts: [],
						subnets: [],
						implicit: true,
						isDefault: reference.name === DEFAULT_NETWORK_NAME,
						services: [],
					};
					byName.set(reference.name, network);
					networks.push(network);
					sink.add(
						'error',
						'undeclared-network',
						`Service "${service.name}" refers to undefined network "${reference.name}".`,
						['services', service.name, 'networks'],
						'Declare it under the top-level `networks:` section.',
					);
				}
				if (!network.services.includes(service.name)) {
					network.services.push(service.name);
				}
			}
		}
	}

	/** Connects services to named volumes, creating implicit entries when needed. */
	private linkVolumes(
		services: ComposeService[],
		volumes: ComposeVolume[],
		sink: DiagnosticSink,
	): void {
		const byName = new Map(volumes.map((volume) => [volume.name, volume]));

		for (const service of services) {
			for (const mount of service.volumes) {
				if (!mount.isNamedVolume || !mount.source) {
					continue;
				}
				let volume = byName.get(mount.source);
				if (!volume) {
					volume = {
						name: mount.source,
						external: false,
						labels: [],
						driverOpts: [],
						implicit: true,
						mounts: [],
					};
					byName.set(mount.source, volume);
					volumes.push(volume);
					sink.add(
						'error',
						'undeclared-volume',
						`Service "${service.name}" refers to undefined volume "${mount.source}".`,
						['services', service.name, 'volumes'],
						'Declare it under the top-level `volumes:` section.',
					);
				}
				volume.mounts.push({
					service: service.name,
					target: mount.target,
					readOnly: mount.readOnly,
				});
			}
		}
	}

	/** Cross-service checks that can only run once every service is known. */
	private validate(services: ComposeService[], sink: DiagnosticSink): void {
		const known = new Set(services.map((service) => service.name));
		const containerNames = new Map<string, string>();

		for (const service of services) {
			for (const dependency of service.dependsOn) {
				if (dependency.service === service.name) {
					sink.add(
						'error',
						'self-dependency',
						`Service "${service.name}" depends on itself.`,
						['services', service.name, 'depends_on'],
					);
					continue;
				}
				if (!known.has(dependency.service)) {
					sink.add(
						'error',
						'unknown-dependency',
						`Service "${service.name}" depends on "${dependency.service}", which is not defined in this file.`,
						['services', service.name, dependency.origin],
						known.size > 0 ? `Known services: ${[...known].join(', ')}.` : undefined,
					);
				}
			}

			if (service.containerName) {
				const existing = containerNames.get(service.containerName);
				if (existing) {
					sink.add(
						'error',
						'duplicate-container-name',
						`Services "${existing}" and "${service.name}" both use container name "${service.containerName}".`,
						['services', service.name, 'container_name'],
					);
				} else {
					containerNames.set(service.containerName, service.name);
				}
			}
		}

		for (const cycle of findDependencyCycles(services)) {
			sink.add(
				'warning',
				'invalid-depends-on',
				`Circular dependency detected: ${cycle.join(' → ')}.`,
				['services', cycle[0], 'depends_on'],
				'Docker Compose cannot start services that depend on each other.',
			);
		}
	}
}

/** Convenience wrapper around {@link ComposeParser}. */
export function parseCompose(text: string, options: ParseOptions = {}): ParseResult {
	return new ComposeParser().parse(text, options);
}

// ---------------------------------------------------------------- field parsers

export function parsePorts(
	raw: unknown,
	path: (string | number)[],
	serviceName: string,
	sink: DiagnosticSink,
): ComposePort[] {
	if (raw === undefined || raw === null) {
		return [];
	}

	if (!Array.isArray(raw)) {
		sink.add(
			'error',
			'invalid-port-definition',
			`\`ports\` of service "${serviceName}" must be a list.`,
			path,
		);
		return [];
	}

	const ports: ComposePort[] = [];
	raw.forEach((entry, index) => {
		const port = parsePort(entry);
		if (port) {
			ports.push(port);
		} else {
			sink.add(
				'error',
				'invalid-port-definition',
				`Service "${serviceName}" has an invalid port definition: ${JSON.stringify(entry)}.`,
				[...path, index],
				'Use "HOST:CONTAINER", "CONTAINER" or the long syntax with `target`/`published`.',
			);
		}
	});
	return ports;
}

/** Normalizes both the short (`"8080:80/tcp"`) and long (mapping) port syntax. */
export function parsePort(entry: unknown): ComposePort | undefined {
	if (typeof entry === 'number') {
		return makePort(String(entry), undefined, String(entry), 'tcp');
	}

	if (typeof entry === 'string') {
		const trimmed = entry.trim();
		if (!trimmed) {
			return undefined;
		}

		let body = trimmed;
		let protocol = 'tcp';
		const slash = body.lastIndexOf('/');
		if (slash !== -1) {
			protocol = body.slice(slash + 1) || 'tcp';
			body = body.slice(0, slash);
		}

		const parts = body.split(':');
		let hostIp: string | undefined;
		let hostPort: string | undefined;
		let containerPort: string;

		if (parts.length === 1) {
			containerPort = parts[0];
		} else if (parts.length === 2) {
			hostPort = parts[0] || undefined;
			containerPort = parts[1];
		} else if (parts.length >= 3) {
			containerPort = parts[parts.length - 1];
			hostPort = parts[parts.length - 2] || undefined;
			hostIp = parts.slice(0, parts.length - 2).join(':') || undefined;
		} else {
			return undefined;
		}

		if (!isPortSpec(containerPort) || (hostPort !== undefined && !isPortSpec(hostPort))) {
			return undefined;
		}

		return makePort(trimmed, hostPort, containerPort, protocol, hostIp);
	}

	if (isRecord(entry)) {
		const target = entry.target;
		if (target === undefined || target === null) {
			return undefined;
		}
		const containerPort = String(target);
		if (!isPortSpec(containerPort)) {
			return undefined;
		}
		const published = entry.published === undefined || entry.published === null ? undefined : String(entry.published);
		if (published !== undefined && !isPortSpec(published)) {
			return undefined;
		}
		const protocol = asString(entry.protocol) ?? 'tcp';
		const hostIp = asString(entry.host_ip);
		const mode = asString(entry.mode);
		const raw = [hostIp, published, containerPort].filter(Boolean).join(':');
		return makePort(raw, published, containerPort, protocol, hostIp, mode);
	}

	return undefined;
}

function makePort(
	raw: string,
	hostPort: string | undefined,
	containerPort: string,
	protocol: string,
	hostIp?: string,
	mode?: string,
): ComposePort {
	const display = hostPort ? `${hostPort} → ${containerPort}` : `→ ${containerPort}`;
	const port: ComposePort = {
		raw,
		containerPort,
		protocol,
		display: protocol && protocol !== 'tcp' ? `${display} (${protocol})` : display,
	};
	if (hostPort !== undefined) {
		port.hostPort = hostPort;
	}
	if (hostIp !== undefined) {
		port.hostIp = hostIp;
	}
	if (mode !== undefined) {
		port.mode = mode;
	}
	return port;
}

function isPortSpec(value: string): boolean {
	return /^\d{1,5}(-\d{1,5})?$/.test(value);
}

export function parseDependsOn(
	raw: unknown,
	path: (string | number)[],
	serviceName: string,
	sink: DiagnosticSink,
): ComposeDependency[] {
	if (raw === undefined || raw === null) {
		return [];
	}

	const make = (service: string, condition = 'service_started', required = true, restart = false): ComposeDependency => ({
		service,
		condition,
		required,
		restart,
		dangling: false,
		origin: 'depends_on',
	});

	if (typeof raw === 'string') {
		return [make(raw)];
	}

	if (Array.isArray(raw)) {
		const dependencies: ComposeDependency[] = [];
		raw.forEach((entry, index) => {
			if (typeof entry === 'string' && entry.trim()) {
				dependencies.push(make(entry.trim()));
			} else {
				sink.add(
					'error',
					'invalid-depends-on',
					`Service "${serviceName}" has an invalid \`depends_on\` entry: ${JSON.stringify(entry)}.`,
					[...path, index],
					'Each entry must be the name of another service.',
				);
			}
		});
		return dependencies;
	}

	if (isRecord(raw)) {
		return Object.entries(raw).map(([name, value]) => {
			if (value === null || value === undefined) {
				return make(name);
			}
			if (!isRecord(value)) {
				sink.add(
					'error',
					'invalid-depends-on',
					`\`depends_on.${name}\` of service "${serviceName}" must be a mapping with a \`condition\`.`,
					[...path, name],
				);
				return make(name);
			}
			const condition = asString(value.condition) ?? 'service_started';
			if (!VALID_DEPENDS_ON_CONDITIONS.has(condition)) {
				sink.add(
					'warning',
					'invalid-condition',
					`Unknown \`depends_on\` condition "${condition}" for service "${serviceName}".`,
					[...path, name, 'condition'],
					`Expected one of: ${[...VALID_DEPENDS_ON_CONDITIONS].join(', ')}.`,
				);
			}
			return make(name, condition, value.required !== false, value.restart === true);
		});
	}

	sink.add(
		'error',
		'invalid-depends-on',
		`\`depends_on\` of service "${serviceName}" must be a list or a mapping.`,
		path,
	);
	return [];
}

/** `links` also creates a start-order dependency, so it is modelled as one. */
export function parseLinks(raw: unknown): ComposeDependency[] {
	return asStringArray(raw).map((entry) => ({
		service: entry.split(':')[0],
		condition: 'service_started',
		required: true,
		restart: false,
		dangling: false,
		origin: 'links' as const,
	}));
}

export function parseServiceNetworks(
	raw: unknown,
	path: (string | number)[],
	serviceName: string,
	sink: DiagnosticSink,
): ComposeServiceNetwork[] {
	if (raw === undefined || raw === null) {
		return [];
	}

	if (typeof raw === 'string') {
		return [{ name: raw, aliases: [], undeclared: false }];
	}

	if (Array.isArray(raw)) {
		const networks: ComposeServiceNetwork[] = [];
		raw.forEach((entry, index) => {
			if (typeof entry === 'string' && entry.trim()) {
				networks.push({ name: entry.trim(), aliases: [], undeclared: false });
			} else {
				sink.add(
					'error',
					'invalid-network-definition',
					`Service "${serviceName}" has an invalid network reference: ${JSON.stringify(entry)}.`,
					[...path, index],
				);
			}
		});
		return networks;
	}

	if (isRecord(raw)) {
		return Object.entries(raw).map(([name, value]) => {
			const network: ComposeServiceNetwork = { name, aliases: [], undeclared: false };
			if (isRecord(value)) {
				network.aliases = asStringArray(value.aliases);
				network.ipv4Address = asString(value.ipv4_address);
				network.ipv6Address = asString(value.ipv6_address);
				if (typeof value.priority === 'number') {
					network.priority = value.priority;
				}
			} else if (value !== null && value !== undefined) {
				sink.add(
					'error',
					'invalid-network-definition',
					`Network options for "${name}" on service "${serviceName}" must be a mapping.`,
					[...path, name],
				);
			}
			return network;
		});
	}

	sink.add(
		'error',
		'invalid-network-definition',
		`\`networks\` of service "${serviceName}" must be a list or a mapping.`,
		path,
	);
	return [];
}

export function parseVolumeMounts(
	raw: unknown,
	path: (string | number)[],
	serviceName: string,
	sink: DiagnosticSink,
): ComposeVolumeMount[] {
	if (raw === undefined || raw === null) {
		return [];
	}

	if (!Array.isArray(raw)) {
		sink.add(
			'error',
			'invalid-volume-definition',
			`\`volumes\` of service "${serviceName}" must be a list.`,
			path,
		);
		return [];
	}

	const mounts: ComposeVolumeMount[] = [];
	raw.forEach((entry, index) => {
		const mount = parseVolumeMount(entry);
		if (mount) {
			mounts.push(mount);
		} else {
			sink.add(
				'error',
				'invalid-volume-definition',
				`Service "${serviceName}" has an invalid volume definition: ${JSON.stringify(entry)}.`,
				[...path, index],
				'Use "SOURCE:TARGET[:ro]", "TARGET" or the long syntax with `type`/`source`/`target`.',
			);
		}
	});
	return mounts;
}

/** Normalizes short (`"data:/var/lib"`) and long (mapping) volume syntax. */
export function parseVolumeMount(entry: unknown): ComposeVolumeMount | undefined {
	if (typeof entry === 'string') {
		const trimmed = entry.trim();
		if (!trimmed) {
			return undefined;
		}

		const parts = splitMountString(trimmed);
		let source: string | undefined;
		let target: string;
		let mode = '';

		if (parts.length === 1) {
			target = parts[0];
		} else if (parts.length === 2) {
			[source, target] = parts;
		} else if (parts.length === 3) {
			[source, target, mode] = parts;
		} else {
			return undefined;
		}

		// The target must be an absolute path inside the container.
		const targetLooksAbsolute =
			target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\');
		if (!target || !targetLooksAbsolute) {
			return undefined;
		}

		const named = source !== undefined && isNamedVolumeSource(source);
		return makeMount(trimmed, named ? 'volume' : source === undefined ? 'volume' : 'bind', source, target, /(^|,)ro(,|$)/.test(mode), named);
	}

	if (isRecord(entry)) {
		const target = asString(entry.target);
		if (!target) {
			return undefined;
		}
		const type = (asString(entry.type) ?? 'volume') as VolumeMountType;
		const source = asString(entry.source);
		const readOnly = entry.read_only === true;
		const named = type === 'volume' && !!source;
		const raw = source ? `${source}:${target}` : target;
		return makeMount(raw, type, source, target, readOnly, named);
	}

	return undefined;
}

function makeMount(
	raw: string,
	type: VolumeMountType,
	source: string | undefined,
	target: string,
	readOnly: boolean,
	isNamedVolume: boolean,
): ComposeVolumeMount {
	const arrow = source ? `${source} → ${target}` : `(anonymous) → ${target}`;
	const mount: ComposeVolumeMount = {
		raw,
		type,
		target,
		readOnly,
		isNamedVolume,
		display: readOnly ? `${arrow} (read-only)` : arrow,
	};
	if (source !== undefined) {
		mount.source = source;
	}
	return mount;
}

/** Splits `a:b:c` while keeping Windows drive letters (`C:\data:/app`) intact. */
export function splitMountString(value: string): string[] {
	const parts: string[] = [];
	let current = '';

	for (let i = 0; i < value.length; i += 1) {
		const char = value[i];
		if (char === ':') {
			// `C:` at the start of a segment is a drive letter, not a separator.
			const isDriveLetter = current.length === 1 && /[A-Za-z]/.test(current) && /[\\/]/.test(value[i + 1] ?? '');
			if (isDriveLetter) {
				current += char;
				continue;
			}
			parts.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
}

/** A source is a named volume when it is not a path-like string. */
export function isNamedVolumeSource(source: string): boolean {
	if (!source) {
		return false;
	}
	if (
		source.startsWith('/') ||
		source.startsWith('./') ||
		source.startsWith('../') ||
		source.startsWith('~') ||
		source.startsWith('.\\') ||
		source.startsWith('\\') ||
		/^[A-Za-z]:[\\/]/.test(source) ||
		source === '.' ||
		source === '..'
	) {
		return false;
	}
	return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source);
}

export function parseBuild(raw: unknown): ComposeBuild | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}

	if (typeof raw === 'string') {
		return {
			context: raw,
			args: [],
			cacheFrom: [],
			additionalContexts: [],
			display: raw,
		};
	}

	if (!isRecord(raw)) {
		return undefined;
	}

	const context = asString(raw.context) ?? '.';
	const dockerfile = asString(raw.dockerfile) ?? (asString(raw.dockerfile_inline) ? '(inline)' : undefined);
	const target = asString(raw.target);
	const parts = [context];
	if (dockerfile) {
		parts.push(dockerfile);
	}
	if (target) {
		parts.push(`target: ${target}`);
	}

	const build: ComposeBuild = {
		context,
		args: keyValuesFromUnknown(raw.args),
		cacheFrom: asStringArray(raw.cache_from),
		additionalContexts: keyValuesFromUnknown(raw.additional_contexts),
		display: parts.join(' · '),
	};
	if (dockerfile) {
		build.dockerfile = dockerfile;
	}
	if (target) {
		build.target = target;
	}
	return build;
}

export function parseHealthcheck(
	raw: unknown,
	path: (string | number)[],
	serviceName: string,
	sink: DiagnosticSink,
): ComposeHealthcheck | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}

	if (!isRecord(raw)) {
		sink.add(
			'error',
			'invalid-healthcheck',
			`\`healthcheck\` of service "${serviceName}" must be a mapping.`,
			path,
		);
		return undefined;
	}

	const disabled = raw.disable === true;
	let test: string[] | undefined;
	if (typeof raw.test === 'string') {
		test = ['CMD-SHELL', raw.test];
	} else if (Array.isArray(raw.test)) {
		test = raw.test.map((item) => String(item));
	} else if (raw.test !== undefined && raw.test !== null) {
		sink.add(
			'error',
			'invalid-healthcheck',
			`\`healthcheck.test\` of service "${serviceName}" must be a string or a list.`,
			[...path, 'test'],
		);
	}

	const healthcheck: ComposeHealthcheck = {
		disabled,
		display: disabled ? 'disabled' : test ? test.join(' ') : 'inherited from image',
	};
	if (test) {
		healthcheck.test = test;
	}
	const interval = asString(raw.interval);
	const timeout = asString(raw.timeout);
	const startPeriod = asString(raw.start_period);
	const startInterval = asString(raw.start_interval);
	if (interval) {
		healthcheck.interval = interval;
	}
	if (timeout) {
		healthcheck.timeout = timeout;
	}
	if (startPeriod) {
		healthcheck.startPeriod = startPeriod;
	}
	if (startInterval) {
		healthcheck.startInterval = startInterval;
	}
	if (typeof raw.retries === 'number') {
		healthcheck.retries = raw.retries;
	}
	return healthcheck;
}

export function parseDeploy(raw: unknown): ComposeDeploy | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}

	const deploy: ComposeDeploy = {};
	if (typeof raw.replicas === 'number') {
		deploy.replicas = raw.replicas;
	}
	const mode = asString(raw.mode);
	if (mode) {
		deploy.mode = mode;
	}

	const resources = raw.resources;
	if (isRecord(resources)) {
		const limits = resources.limits;
		if (isRecord(limits)) {
			deploy.cpuLimit = asString(limits.cpus);
			deploy.memoryLimit = asString(limits.memory);
		}
		const reservations = resources.reservations;
		if (isRecord(reservations)) {
			deploy.cpuReservation = asString(reservations.cpus);
			deploy.memoryReservation = asString(reservations.memory);
		}
	}

	return Object.keys(deploy).length > 0 ? deploy : undefined;
}

export function parseExtends(raw: unknown): { service: string; file?: string } | undefined {
	if (typeof raw === 'string') {
		return { service: raw };
	}
	if (isRecord(raw)) {
		const service = asString(raw.service);
		if (!service) {
			return undefined;
		}
		const file = asString(raw.file);
		return file ? { service, file } : { service };
	}
	return undefined;
}

export function parseKeyValues(
	raw: unknown,
	path: (string | number)[],
	serviceName: string,
	sink: DiagnosticSink,
	label: string,
): ComposeKeyValue[] {
	if (raw === undefined || raw === null) {
		return [];
	}
	if (!isRecord(raw) && !Array.isArray(raw)) {
		sink.add(
			'error',
			'invalid-environment',
			`\`${label}\` of service "${serviceName}" must be a list or a mapping.`,
			path,
		);
		return [];
	}
	return keyValuesFromUnknown(raw);
}

/** Accepts both `KEY: value` mappings and `- KEY=value` lists. */
export function keyValuesFromUnknown(raw: unknown): ComposeKeyValue[] {
	if (raw === undefined || raw === null) {
		return [];
	}

	if (Array.isArray(raw)) {
		return raw
			.filter((entry) => entry !== null && entry !== undefined)
			.map((entry) => {
				const text = String(entry);
				const separator = text.indexOf('=');
				if (separator === -1) {
					return { key: text, value: null };
				}
				return { key: text.slice(0, separator), value: text.slice(separator + 1) };
			});
	}

	if (isRecord(raw)) {
		return Object.entries(raw).map(([key, value]) => ({
			key,
			value: value === null || value === undefined ? null : String(value),
		}));
	}

	return [];
}

export function parseEnvFileList(raw: unknown): string[] {
	if (raw === undefined || raw === null) {
		return [];
	}
	if (typeof raw === 'string') {
		return [raw];
	}
	if (Array.isArray(raw)) {
		return raw
			.map((entry) => {
				if (typeof entry === 'string') {
					return entry;
				}
				if (isRecord(entry)) {
					const path = asString(entry.path);
					return path ? (entry.required === false ? `${path} (optional)` : path) : undefined;
				}
				return undefined;
			})
			.filter((entry): entry is string => Boolean(entry));
	}
	return [];
}

function parseExternal(raw: unknown): boolean {
	if (raw === true) {
		return true;
	}
	if (isRecord(raw)) {
		return raw.external !== false;
	}
	return false;
}

/** Names referenced by a service's `configs:`/`secrets:` list. */
function referencedNames(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw
		.map((entry) => {
			if (typeof entry === 'string') {
				return entry;
			}
			if (isRecord(entry)) {
				return asString(entry.source);
			}
			return undefined;
		})
		.filter((entry): entry is string => Boolean(entry));
}

/** Depth-first search returning every `depends_on` cycle, each reported once. */
export function findDependencyCycles(services: ComposeService[]): string[][] {
	const graph = new Map(
		services.map((service) => [service.name, service.dependsOn.map((dependency) => dependency.service)]),
	);
	const cycles: string[][] = [];
	const seen = new Set<string>();
	const state = new Map<string, 'visiting' | 'done'>();
	const stack: string[] = [];

	const visit = (name: string): void => {
		const status = state.get(name);
		if (status === 'done') {
			return;
		}
		if (status === 'visiting') {
			const start = stack.indexOf(name);
			if (start !== -1) {
				const cycle = [...stack.slice(start), name];
				const key = [...cycle].sort().join('|');
				if (!seen.has(key)) {
					seen.add(key);
					cycles.push(cycle);
				}
			}
			return;
		}

		state.set(name, 'visiting');
		stack.push(name);
		for (const next of graph.get(name) ?? []) {
			if (graph.has(next)) {
				visit(next);
			}
		}
		stack.pop();
		state.set(name, 'done');
	};

	for (const service of services) {
		visit(service.name);
	}
	return cycles;
}

// ---------------------------------------------------------------------- utils

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return undefined;
}

function asStringArray(value: unknown): string[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (typeof value === 'string') {
		return [value];
	}
	if (Array.isArray(value)) {
		return value
			.filter((entry) => entry !== null && entry !== undefined)
			.map((entry) => String(entry));
	}
	return [];
}

function joinCommand(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry)).join(' ');
	}
	return undefined;
}

function describeType(value: unknown): string {
	if (Array.isArray(value)) {
		return 'list';
	}
	return typeof value;
}

function formatPath(path: (string | number)[]): string {
	return path
		.map((segment, index) =>
			typeof segment === 'number' ? `[${segment}]` : index === 0 ? segment : `.${segment}`,
		)
		.join('');
}

function cleanYamlMessage(message: string): string {
	return message.replace(/\s*at line \d+, column \d+:?[\s\S]*$/, '').trim();
}

function yamlErrorLocation(
	error: { linePos?: [{ line: number; col: number }, ...unknown[]]; pos?: [number, number] },
	locator: Locator,
): SourceLocation | undefined {
	if (error.linePos && error.linePos[0]) {
		return {
			line: error.linePos[0].line,
			column: error.linePos[0].col,
			offset: error.pos ? error.pos[0] : 0,
		};
	}
	return error.pos ? locator.fromOffset(error.pos[0]) : undefined;
}

function dedupeIssues(issues: InterpolationIssue[]): InterpolationIssue[] {
	const seen = new Set<string>();
	const result: InterpolationIssue[] = [];
	for (const issue of issues) {
		const key = `${issue.severity}:${issue.variable}:${issue.message}`;
		if (!seen.has(key)) {
			seen.add(key);
			result.push(issue);
		}
	}
	return result;
}
