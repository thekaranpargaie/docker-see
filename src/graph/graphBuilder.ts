/**
 * GraphBuilder — Compose model → graph model (spec §Phase 4).
 *
 * Responsibilities:
 *  - create a node per service, network and volume;
 *  - create dependency edges from `depends_on` (and `links`);
 *  - create network attachment edges;
 *  - create volume mount edges.
 */

import type {
	ComposeProject,
	ComposeService,
	ComposeVolume,
} from '../parser/composeTypes';
import { nodeId, type GraphEdge, type GraphModel, type GraphNode } from './graphTypes';
import { pickServiceIcon } from './serviceIcons';

export class GraphBuilder {
	build(project: ComposeProject): GraphModel {
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];

		for (const service of project.services) {
			nodes.push(this.buildServiceNode(service));
		}

		for (const network of project.networks) {
			nodes.push({
				id: nodeId.network(network.name),
				kind: 'network',
				label: network.name,
				icon: network.external ? '🔗' : '🕸️',
				subtitle: describeNetwork(network.driver, network.external, network.internal),
				badges: compact([
					network.external ? 'external' : undefined,
					network.internal ? 'internal' : undefined,
					network.isDefault && network.implicit ? 'implicit' : undefined,
					network.attachable ? 'attachable' : undefined,
				]),
				ports: [],
				implicit: network.implicit,
				searchText: [network.name, network.driver, network.dockerName, ...network.subnets]
					.filter(Boolean)
					.join(' ')
					.toLowerCase(),
				network,
			});
		}

		for (const volume of project.volumes) {
			nodes.push({
				id: nodeId.volume(volume.name),
				kind: 'volume',
				label: volume.name,
				icon: volume.external ? '🔗' : '💽',
				subtitle: volume.external
					? 'external volume'
					: volume.driver
						? `driver: ${volume.driver}`
						: 'named volume',
				badges: compact([volume.external ? 'external' : undefined]),
				ports: [],
				volumeKind: 'named',
				implicit: volume.implicit,
				searchText: [volume.name, volume.driver, volume.dockerName]
					.filter(Boolean)
					.join(' ')
					.toLowerCase(),
				volume,
			});
		}

		// Bind mounts have no top-level declaration, so they are derived here and
		// merged per host path across services.
		const bindVolumes = new Map<string, ComposeVolume>();
		for (const service of project.services) {
			for (const mount of service.volumes) {
				if (mount.isNamedVolume || !mount.source) {
					continue;
				}
				let bind = bindVolumes.get(mount.source);
				if (!bind) {
					bind = {
						name: mount.source,
						external: false,
						labels: [],
						driverOpts: [],
						implicit: true,
						mounts: [],
					};
					bindVolumes.set(mount.source, bind);
				}
				bind.mounts.push({
					service: service.name,
					target: mount.target,
					readOnly: mount.readOnly,
				});
			}
		}

		for (const [source, bind] of bindVolumes) {
			nodes.push({
				id: nodeId.bind(source),
				kind: 'volume',
				label: source,
				icon: '📁',
				subtitle: 'bind mount (host path)',
				badges: ['bind'],
				ports: [],
				volumeKind: 'bind',
				implicit: true,
				searchText: source.toLowerCase(),
				volume: bind,
			});
		}

		const serviceNames = new Set(project.services.map((service) => service.name));

		for (const service of project.services) {
			const from = nodeId.service(service.name);

			// Dependency edges. `links` are deduplicated against `depends_on`.
			const emitted = new Set<string>();
			for (const dependency of service.dependsOn) {
				if (emitted.has(dependency.service)) {
					continue;
				}
				emitted.add(dependency.service);

				const dangling = !serviceNames.has(dependency.service);
				if (dangling) {
					// Render the missing target so the broken reference is visible.
					const missingId = nodeId.service(dependency.service);
					if (!nodes.some((node) => node.id === missingId)) {
						nodes.push({
							id: missingId,
							kind: 'service',
							label: dependency.service,
							icon: '❓',
							subtitle: 'undefined service',
							badges: ['missing'],
							ports: [],
							implicit: true,
							searchText: dependency.service.toLowerCase(),
						});
					}
				}

				edges.push({
					id: `dep:${service.name}->${dependency.service}`,
					source: from,
					target: nodeId.service(dependency.service),
					kind: dependency.origin === 'links' ? 'link' : 'depends_on',
					label:
						dependency.condition && dependency.condition !== 'service_started'
							? conditionLabel(dependency.condition)
							: undefined,
					condition: dependency.condition,
					dangling,
				});
			}

			for (const attachment of service.networks) {
				edges.push({
					id: `net:${service.name}->${attachment.name}`,
					source: from,
					target: nodeId.network(attachment.name),
					kind: 'network',
					label: attachment.aliases.length > 0 ? attachment.aliases.join(', ') : undefined,
				});
			}

			for (const mount of service.volumes) {
				if (!mount.source) {
					continue;
				}
				const target = mount.isNamedVolume ? nodeId.volume(mount.source) : nodeId.bind(mount.source);
				edges.push({
					id: `vol:${service.name}->${mount.source}:${mount.target}`,
					source: from,
					target,
					kind: 'volume',
					label: mount.target,
					readOnly: mount.readOnly,
				});
			}
		}

		return {
			nodes,
			edges,
			stats: {
				services: project.services.length,
				networks: project.networks.length,
				volumes: project.volumes.length + bindVolumes.size,
				dependencies: edges.filter((edge) => edge.kind === 'depends_on' || edge.kind === 'link').length,
				ports: project.services.reduce((total, service) => total + service.ports.length, 0),
			},
			projectName: project.name,
			filePath: project.filePath,
			fileName: project.fileName,
		};
	}

	private buildServiceNode(service: ComposeService): GraphNode {
		const replicas = service.deploy?.replicas;

		return {
			id: nodeId.service(service.name),
			kind: 'service',
			label: service.name,
			icon: pickServiceIcon(service.name, service.image),
			subtitle: service.image ?? (service.build ? `build: ${service.build.context}` : undefined),
			badges: compact([
				service.build && service.image ? 'build' : undefined,
				service.build && !service.image ? 'built image' : undefined,
				service.healthcheck && !service.healthcheck.disabled ? 'healthcheck' : undefined,
				replicas && replicas > 1 ? `×${replicas}` : undefined,
				service.profiles.length > 0 ? `profile: ${service.profiles.join(', ')}` : undefined,
				service.restart && service.restart !== 'no' ? service.restart : undefined,
			]),
			ports: service.ports.map((port) => port.display),
			searchText: [
				service.name,
				service.image,
				service.containerName,
				service.build?.context,
				service.command,
				...service.ports.map((port) => port.raw),
				...service.networks.map((network) => network.name),
				...service.volumes.map((volume) => volume.raw),
				...service.environment.map((entry) => `${entry.key}=${entry.value ?? ''}`),
				...service.dependsOn.map((dependency) => dependency.service),
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase(),
			service,
		};
	}
}

/** Convenience wrapper around {@link GraphBuilder}. */
export function buildGraph(project: ComposeProject): GraphModel {
	return new GraphBuilder().build(project);
}

function conditionLabel(condition: string): string {
	switch (condition) {
		case 'service_healthy':
			return 'when healthy';
		case 'service_completed_successfully':
			return 'when completed';
		default:
			return condition;
	}
}

function describeNetwork(driver: string | undefined, external: boolean, internal: boolean): string {
	const parts = [driver ? `driver: ${driver}` : 'network'];
	if (external) {
		parts.push('external');
	}
	if (internal) {
		parts.push('internal');
	}
	return parts.join(' · ');
}

function compact(values: (string | undefined)[]): string[] {
	return values.filter((value): value is string => Boolean(value));
}
