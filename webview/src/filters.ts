import type { GraphEdge, GraphModel, GraphNode } from '../../src/graph/graphTypes';
import type { ViewSettings } from '../../src/webview/messages';

export interface FilteredGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
	/** Networks not drawn as nodes, used for the "groups" and "badges" modes. */
	networks: GraphNode[];
}

/**
 * Applies the current view options to the full graph produced by the extension.
 * Everything happens locally so toolbar toggles feel instant.
 */
export function filterGraph(graph: GraphModel, settings: ViewSettings): FilteredGraph {
	const keepNetwork = (node: GraphNode): boolean =>
		!(node.network?.isDefault && !settings.showDefaultNetwork);

	const networks = graph.nodes.filter((node) => node.kind === 'network' && keepNetwork(node));

	const showNetworkNodes = settings.networkDisplay === 'nodes';
	const showVolumeNodes = settings.showVolumes;

	const nodes = graph.nodes.filter((node) => {
		if (node.kind === 'service') {
			return true;
		}
		if (node.kind === 'network') {
			return showNetworkNodes && keepNetwork(node);
		}
		if (!showVolumeNodes) {
			return false;
		}
		return node.volumeKind === 'bind' ? settings.showBindMounts : true;
	});

	const visible = new Set(nodes.map((node) => node.id));
	const edges = graph.edges.filter(
		(edge: GraphEdge) => visible.has(edge.source) && visible.has(edge.target),
	);

	return { nodes, edges, networks };
}

/** Ids of the nodes and edges directly related to the selection (spec §10). */
export interface HighlightSet {
	nodes: Set<string>;
	edges: Set<string>;
	dependencies: Set<string>;
	dependents: Set<string>;
}

export function computeHighlight(
	selectedId: string | undefined,
	edges: GraphEdge[],
): HighlightSet | undefined {
	if (!selectedId) {
		return undefined;
	}

	const nodes = new Set<string>([selectedId]);
	const related = new Set<string>();
	const dependencies = new Set<string>();
	const dependents = new Set<string>();

	for (const edge of edges) {
		if (edge.source === selectedId) {
			nodes.add(edge.target);
			related.add(edge.id);
			if (edge.kind === 'depends_on' || edge.kind === 'link') {
				dependencies.add(edge.target);
			}
		} else if (edge.target === selectedId) {
			nodes.add(edge.source);
			related.add(edge.id);
			if (edge.kind === 'depends_on' || edge.kind === 'link') {
				dependents.add(edge.source);
			}
		}
	}

	return { nodes, edges: related, dependencies, dependents };
}

/** Case-insensitive match against the haystack the graph builder assembled. */
export function matchesSearch(node: GraphNode, query: string): boolean {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) {
		return false;
	}
	return node.label.toLowerCase().includes(trimmed) || node.searchText.includes(trimmed);
}
