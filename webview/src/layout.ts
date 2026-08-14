import dagre from 'dagre';
import { Position, type Edge, type Node } from '@xyflow/react';
import type { LayoutDirection } from '../../src/webview/messages';
import type { GraphNode } from '../../src/graph/graphTypes';

/**
 * Automatic layout (spec §7: "the exact layout can be determined automatically
 * by the graph library"). Dagre gives a clean layered result for dependency
 * graphs, which is what Compose files mostly are.
 */

const RANK_SEPARATION = 90;
const NODE_SEPARATION = 55;
const EDGE_SEPARATION = 20;

/** Used before React Flow has measured the DOM nodes. */
export function estimateSize(node: GraphNode): { width: number; height: number } {
	if (node.kind === 'service') {
		const lines = node.ports.length + (node.badges.length > 0 ? 1 : 0);
		return { width: 232, height: 62 + lines * 20 };
	}
	if (node.kind === 'network') {
		return { width: 190, height: 58 };
	}
	return { width: 200, height: 58 };
}

export function sizeOf(node: Node): { width: number; height: number } {
	const measured = node.measured;
	if (measured?.width && measured.height) {
		return { width: measured.width, height: measured.height };
	}
	const graphNode = node.data?.graphNode as GraphNode | undefined;
	const fallback = graphNode ? estimateSize(graphNode) : { width: 200, height: 60 };
	return {
		width: measured?.width ?? fallback.width,
		height: measured?.height ?? fallback.height,
	};
}

/** Runs dagre and returns the top-left position for every node. */
export function layoutNodes(
	nodes: Node[],
	edges: Edge[],
	direction: LayoutDirection,
): Map<string, { x: number; y: number }> {
	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({
		rankdir: direction,
		nodesep: NODE_SEPARATION,
		ranksep: RANK_SEPARATION,
		edgesep: EDGE_SEPARATION,
		marginx: 40,
		marginy: 40,
	});

	for (const node of nodes) {
		const { width, height } = sizeOf(node);
		graph.setNode(node.id, { width, height });
	}

	const ids = new Set(nodes.map((node) => node.id));
	for (const edge of edges) {
		if (ids.has(edge.source) && ids.has(edge.target)) {
			graph.setEdge(edge.source, edge.target);
		}
	}

	dagre.layout(graph);

	const positions = new Map<string, { x: number; y: number }>();
	for (const node of nodes) {
		const laid = graph.node(node.id);
		if (!laid) {
			continue;
		}
		const { width, height } = sizeOf(node);
		// Dagre positions nodes by their centre; React Flow uses the top-left.
		positions.set(node.id, { x: laid.x - width / 2, y: laid.y - height / 2 });
	}
	return positions;
}

/** Handle placement so edges leave and enter along the layout direction. */
export function handlePositions(direction: LayoutDirection): {
	source: Position;
	target: Position;
} {
	switch (direction) {
		case 'LR':
			return { source: Position.Right, target: Position.Left };
		case 'RL':
			return { source: Position.Left, target: Position.Right };
		case 'BT':
			return { source: Position.Top, target: Position.Bottom };
		case 'TB':
		default:
			return { source: Position.Bottom, target: Position.Top };
	}
}
