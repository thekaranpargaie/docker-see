/**
 * Normalized domain model for a Docker Compose project.
 *
 * Everything the rest of DockerSee consumes is expressed with these types: the
 * parser is the only place that has to understand the many shorthand forms the
 * Compose specification allows.
 *
 * These types are shared with the webview (type-only imports, erased at build
 * time), so they must not reference `vscode` or any Node built-in.
 */

/** Zero-based position inside the Compose file, plus the 1-based display form. */
export interface SourceLocation {
	/** 1-based line, as shown to users. */
	line: number;
	/** 1-based column, as shown to users. */
	column: number;
	/** Absolute character offset in the file. */
	offset: number;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
	| 'yaml-syntax'
	| 'empty-file'
	| 'root-not-mapping'
	| 'missing-services'
	| 'services-not-mapping'
	| 'service-not-mapping'
	| 'service-without-image-or-build'
	| 'unknown-dependency'
	| 'self-dependency'
	| 'invalid-depends-on'
	| 'invalid-condition'
	| 'undeclared-network'
	| 'invalid-network-definition'
	| 'undeclared-volume'
	| 'invalid-volume-definition'
	| 'invalid-port-definition'
	| 'invalid-environment'
	| 'invalid-healthcheck'
	| 'duplicate-container-name'
	| 'obsolete-version'
	| 'unsupported-feature'
	| 'unknown-key'
	| 'interpolation';

/** A problem found while reading the Compose file. Never thrown — always collected. */
export interface ComposeDiagnostic {
	severity: DiagnosticSeverity;
	code: DiagnosticCode;
	message: string;
	/** Location in the Compose file, when it could be determined. */
	location?: SourceLocation;
	/** YAML path of the offending node, e.g. `services.api.depends_on[0]`. */
	path?: string;
	/** Optional extra explanation / hint shown under the message. */
	hint?: string;
}

/** A single published port, normalized from short or long syntax. */
export interface ComposePort {
	/** The original text as written in the Compose file. */
	raw: string;
	/** Host side of the mapping. Undefined when Docker assigns a random port. */
	hostPort?: string;
	/** Container side of the mapping. */
	containerPort: string;
	protocol: 'tcp' | 'udp' | string;
	hostIp?: string;
	/** `host` or `ingress` (long syntax only). */
	mode?: string;
	/** Pretty form used by the UI, e.g. `8080 → 80`. */
	display: string;
}

export type VolumeMountType = 'volume' | 'bind' | 'tmpfs' | 'npipe' | 'cluster';

/** A volume mounted by a service. */
export interface ComposeVolumeMount {
	raw: string;
	type: VolumeMountType;
	/** Named volume name, host path, or undefined for anonymous volumes. */
	source?: string;
	/** Mount point inside the container. */
	target: string;
	readOnly: boolean;
	/** True when `source` refers to a named volume rather than a host path. */
	isNamedVolume: boolean;
	/** Pretty form used by the UI. */
	display: string;
}

export interface ComposeBuild {
	context: string;
	dockerfile?: string;
	target?: string;
	args: ComposeKeyValue[];
	cacheFrom: string[];
	/** Extra build-time named contexts (`additional_contexts`). */
	additionalContexts: ComposeKeyValue[];
	/** Pretty form used by the UI. */
	display: string;
}

export interface ComposeKeyValue {
	key: string;
	/** `null` means "inherit from the host environment". */
	value: string | null;
}

export interface ComposeDependency {
	/** Name of the service being depended upon. */
	service: string;
	/** `service_started` (default), `service_healthy`, `service_completed_successfully`. */
	condition: string;
	required: boolean;
	/** True when the dependent service should be restarted with its dependency. */
	restart: boolean;
	/** True when the referenced service does not exist in the project. */
	dangling: boolean;
	/** How the relation was declared. */
	origin: 'depends_on' | 'links';
}

export interface ComposeServiceNetwork {
	name: string;
	aliases: string[];
	ipv4Address?: string;
	ipv6Address?: string;
	priority?: number;
	/** True when the network is not declared in the top-level `networks` section. */
	undeclared: boolean;
}

export interface ComposeHealthcheck {
	test?: string[];
	interval?: string;
	timeout?: string;
	retries?: number;
	startPeriod?: string;
	startInterval?: string;
	disabled: boolean;
	/** Pretty single-line form used by the UI. */
	display: string;
}

export interface ComposeDeploy {
	replicas?: number;
	mode?: string;
	cpuLimit?: string;
	memoryLimit?: string;
	cpuReservation?: string;
	memoryReservation?: string;
}

export interface ComposeService {
	name: string;
	image?: string;
	build?: ComposeBuild;
	containerName?: string;
	command?: string;
	entrypoint?: string;
	user?: string;
	workingDir?: string;
	restart?: string;
	profiles: string[];
	ports: ComposePort[];
	expose: string[];
	dependsOn: ComposeDependency[];
	networks: ComposeServiceNetwork[];
	volumes: ComposeVolumeMount[];
	environment: ComposeKeyValue[];
	envFiles: string[];
	labels: ComposeKeyValue[];
	healthcheck?: ComposeHealthcheck;
	deploy?: ComposeDeploy;
	/** `extends` target, which DockerSee reports but does not resolve. */
	extends?: { service: string; file?: string };
	/** Volumes shared from other services via `volumes_from`. */
	volumesFrom: string[];
	/** Keys present in YAML that DockerSee does not model. */
	unsupportedKeys: string[];
	location?: SourceLocation;
}

export interface ComposeNetwork {
	name: string;
	/** Explicit `name:` override used for the real Docker network name. */
	dockerName?: string;
	driver?: string;
	external: boolean;
	internal: boolean;
	attachable: boolean;
	labels: ComposeKeyValue[];
	driverOpts: ComposeKeyValue[];
	/** Subnets declared under `ipam.config`. */
	subnets: string[];
	/** True when the network is only referenced by a service, never declared. */
	implicit: boolean;
	/** True for the implicit `default` network Compose creates for a project. */
	isDefault: boolean;
	/** Services attached to this network. */
	services: string[];
	location?: SourceLocation;
}

export interface ComposeVolume {
	name: string;
	dockerName?: string;
	driver?: string;
	external: boolean;
	labels: ComposeKeyValue[];
	driverOpts: ComposeKeyValue[];
	/** True when the volume is only referenced by a service, never declared. */
	implicit: boolean;
	/** Services that mount this volume, with their mount points. */
	mounts: { service: string; target: string; readOnly: boolean }[];
	location?: SourceLocation;
}

export interface ComposeConfigOrSecret {
	name: string;
	file?: string;
	environment?: string;
	external: boolean;
	/** Services referencing it. */
	services: string[];
	location?: SourceLocation;
}

export interface ComposeProject {
	/** Project name (`name:` in the file, otherwise the containing folder). */
	name?: string;
	/** Obsolete `version:` key, kept so the UI can warn about it. */
	version?: string;
	services: ComposeService[];
	networks: ComposeNetwork[];
	volumes: ComposeVolume[];
	configs: ComposeConfigOrSecret[];
	secrets: ComposeConfigOrSecret[];
	/** Absolute path of the parsed file. */
	filePath: string;
	/** File name only, for display. */
	fileName: string;
}

/** Result of parsing a Compose file. `project` is undefined only for fatal errors. */
export interface ParseResult {
	project?: ComposeProject;
	diagnostics: ComposeDiagnostic[];
	/** True when no `error` diagnostics were produced. */
	ok: boolean;
}
