/**
 * Graph model produced by the GraphBuilder and consumed by the webview.
 *
 * The builder always emits the complete graph (services, networks, volumes).
 * The webview filters it according to the current view options, so toggling a
 * setting never requires a round trip to the extension host.
 */

import type { ComposeNetwork, ComposeService, ComposeVolume } from '../parser/composeTypes';

export type GraphNodeKind = 'service' | 'network' | 'volume';

export type VolumeNodeKind = 'named' | 'bind';

export interface GraphNode {
	id: string;
	kind: GraphNodeKind;
	/** Text shown as the node title. */
	label: string;
	/** Emoji used as the node glyph. */
	icon: string;
	/** Secondary line on the node (image name, driver, host path...). */
	subtitle?: string;
	/** Short chips rendered on the node, e.g. `build`, `healthcheck`, `×3`. */
	badges: string[];
	/** Formatted port mappings (`8080 → 80`) shown on service nodes. */
	ports: string[];
	/** Lowercased haystack used by the search box. */
	searchText: string;
	/** Full detail payload for the details panel — exactly one is set. */
	service?: ComposeService;
	network?: ComposeNetwork;
	volume?: ComposeVolume;
	/** Only set for volume nodes. */
	volumeKind?: VolumeNodeKind;
	/** True for networks/volumes that were referenced but never declared. */
	implicit?: boolean;
}

export type GraphEdgeKind = 'depends_on' | 'link' | 'network' | 'volume';

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	kind: GraphEdgeKind;
	label?: string;
	/** `depends_on` condition when it is not the default `service_started`. */
	condition?: string;
	/** True when the edge points at a service that does not exist. */
	dangling?: boolean;
	/** True for read-only volume mounts. */
	readOnly?: boolean;
}

export interface GraphStats {
	services: number;
	networks: number;
	volumes: number;
	dependencies: number;
	ports: number;
}

export interface GraphModel {
	nodes: GraphNode[];
	edges: GraphEdge[];
	stats: GraphStats;
	projectName?: string;
	filePath: string;
	fileName: string;
}

/** Stable node id helpers, shared by builder and webview. */
export const nodeId = {
	service: (name: string) => `service:${name}`,
	network: (name: string) => `network:${name}`,
	volume: (name: string) => `volume:${name}`,
	bind: (source: string) => `bind:${source}`,
};
