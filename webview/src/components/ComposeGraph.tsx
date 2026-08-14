import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Background,
	BackgroundVariant,
	Controls,
	MarkerType,
	MiniMap,
	Panel,
	ReactFlow,
	ReactFlowProvider,
	getNodesBounds,
	getViewportForBounds,
	useEdgesState,
	useNodesInitialized,
	useNodesState,
	useReactFlow,
	type Edge,
	type Node,
	type NodeChange,
	type NodeMouseHandler,
	type NodeTypes,
} from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import type { GraphEdge, GraphModel, GraphNode } from '../../../src/graph/graphTypes';
import type { SourceLocation } from '../../../src/parser/composeTypes';
import type { ViewSettings } from '../../../src/webview/messages';
import { computeHighlight, matchesSearch, type FilteredGraph } from '../filters';
import { layoutNodes, sizeOf } from '../layout';
import { useThemeColors, type ThemeColors } from '../theme';
import { post } from '../vscodeApi';
import { NetworkGroupNode } from './NetworkGroupNode';
import { NetworkNode } from './NetworkNode';
import { ServiceNode } from './ServiceNode';
import { VolumeNode } from './VolumeNode';
import type { GroupData, NodeData } from './nodeData';

import '@xyflow/react/dist/style.css';

const nodeTypes = {
	service: ServiceNode,
	network: NetworkNode,
	volume: VolumeNode,
	networkGroup: NetworkGroupNode,
} as unknown as NodeTypes;

export interface GraphCommand {
	name: 'resetLayout' | 'fitView' | 'export';
	format?: 'png' | 'svg';
	token: number;
}

interface ComposeGraphProps {
	graph: GraphModel;
	filtered: FilteredGraph;
	settings: ViewSettings;
	selectedId?: string;
	search: string;
	command?: GraphCommand;
	onSelect: (id: string | undefined) => void;
	onReveal: (location: SourceLocation) => void;
}

export function ComposeGraph(props: ComposeGraphProps): JSX.Element {
	return (
		<ReactFlowProvider>
			<GraphCanvas {...props} />
		</ReactFlowProvider>
	);
}

function GraphCanvas({
	graph,
	filtered,
	settings,
	selectedId,
	search,
	command,
	onSelect,
	onReveal,
}: ComposeGraphProps): JSX.Element {
	const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
	const [edges, setEdges] = useEdgesState<Edge>([]);
	const [needsLayout, setNeedsLayout] = useState(true);
	const positions = useRef(new Map<string, { x: number; y: number }>());
	const wrapper = useRef<HTMLDivElement>(null);
	const handledCommand = useRef<number>(-1);

	const initialized = useNodesInitialized();
	const { fitView, getNodes } = useReactFlow();
	const colors = useThemeColors();

	const highlight = useMemo(
		() => (settings.highlightDependencies ? computeHighlight(selectedId, filtered.edges) : undefined),
		[settings.highlightDependencies, selectedId, filtered.edges],
	);

	const searchActive = search.trim().length > 0;
	const matches = useMemo(() => {
		if (!searchActive) {
			return new Set<string>();
		}
		return new Set(
			filtered.nodes.filter((node) => matchesSearch(node, search)).map((node) => node.id),
		);
	}, [filtered.nodes, search, searchActive]);

	// Networks a service belongs to, for the "badges" display mode.
	const networkBadges = useMemo(() => {
		const map = new Map<string, string[]>();
		if (settings.networkDisplay !== 'badges') {
			return map;
		}
		for (const node of graph.nodes) {
			if (node.kind !== 'service' || !node.service) {
				continue;
			}
			const names = node.service.networks
				.map((network) => network.name)
				.filter((name) => settings.showDefaultNetwork || name !== 'default');
			if (names.length > 0) {
				map.set(node.id, names);
			}
		}
		return map;
	}, [graph.nodes, settings.networkDisplay, settings.showDefaultNetwork]);

	// A change of view options or an explicit reset invalidates every position.
	useEffect(() => {
		positions.current.clear();
		setNeedsLayout(true);
	}, [
		settings.layoutDirection,
		settings.networkDisplay,
		settings.showVolumes,
		settings.showBindMounts,
		settings.showDefaultNetwork,
	]);

	useEffect(() => {
		const dimActive = Boolean(highlight) || searchActive;

		const nextNodes: Node[] = filtered.nodes.map((graphNode) => {
			const related = highlight?.nodes.has(graphNode.id) ?? false;
			const isMatch = matches.has(graphNode.id);
			const dimmed =
				dimActive && !related && !(searchActive && isMatch) && graphNode.id !== selectedId;

			const data: NodeData = {
				graphNode,
				direction: settings.layoutDirection,
				dimmed,
				related: related && graphNode.id !== selectedId,
				relation: relationFor(graphNode.id, selectedId, highlight),
				match: isMatch,
				networkBadges: networkBadges.get(graphNode.id),
			};

			return {
				id: graphNode.id,
				type: graphNode.kind === 'service' ? 'service' : graphNode.kind,
				position: positions.current.get(graphNode.id) ?? { x: 0, y: 0 },
				data: data as unknown as Record<string, unknown>,
				selected: graphNode.id === selectedId,
				connectable: false,
				deletable: false,
			};
		});

		setNodes(nextNodes);
		setEdges(filtered.edges.map((edge) => toReactFlowEdge(edge, highlight, dimActive, colors)));

		if (filtered.nodes.some((node) => !positions.current.has(node.id))) {
			setNeedsLayout(true);
		}
	}, [
		filtered,
		highlight,
		matches,
		searchActive,
		selectedId,
		settings.layoutDirection,
		networkBadges,
		colors,
		setNodes,
		setEdges,
	]);

	// Layout runs once React Flow has measured the real node sizes.
	useEffect(() => {
		if (!needsLayout || !initialized || nodes.length === 0) {
			return;
		}
		const laid = layoutNodes(nodes, edges, settings.layoutDirection);
		positions.current = laid;
		setNodes((previous) =>
			previous.map((node) => ({ ...node, position: laid.get(node.id) ?? node.position })),
		);
		setNeedsLayout(false);
		window.requestAnimationFrame(() => {
			void fitView({ padding: 0.18, duration: 350, maxZoom: 1.2 });
		});
	}, [needsLayout, initialized, nodes, edges, settings.layoutDirection, setNodes, fitView]);

	// Commands pushed from the extension host (command palette / menus).
	useEffect(() => {
		if (!command || handledCommand.current === command.token) {
			return;
		}
		handledCommand.current = command.token;

		if (command.name === 'fitView') {
			void fitView({ padding: 0.18, duration: 350 });
		} else if (command.name === 'resetLayout') {
			positions.current.clear();
			setNeedsLayout(true);
		} else if (command.name === 'export' && command.format) {
			void exportDiagram(command.format, getNodes(), colors.background);
		}
	}, [command, fitView, getNodes, colors.background]);

	const handleNodesChange = useCallback(
		(changes: NodeChange<Node>[]) => {
			for (const change of changes) {
				if (change.type === 'position' && change.position) {
					positions.current.set(change.id, change.position);
				}
			}
			onNodesChange(changes);
		},
		[onNodesChange],
	);

	const handleNodeClick = useCallback<NodeMouseHandler>(
		(_event, node) => onSelect(node.id),
		[onSelect],
	);

	const handleNodeDoubleClick = useCallback<NodeMouseHandler>(
		(_event, node) => {
			const graphNode = filtered.nodes.find((candidate) => candidate.id === node.id);
			const location =
				graphNode?.service?.location ?? graphNode?.network?.location ?? graphNode?.volume?.location;
			if (location) {
				onReveal(location);
			}
		},
		[filtered.nodes, onReveal],
	);

	const groups = useMemo(() => {
		if (settings.networkDisplay !== 'groups') {
			return [] as Node[];
		}
		return buildGroupNodes(nodes, filtered.networks, selectedId, highlight);
	}, [settings.networkDisplay, nodes, filtered.networks, selectedId, highlight]);

	const displayNodes = useMemo(() => [...groups, ...nodes], [groups, nodes]);

	return (
		<div className="ds-graph" ref={wrapper}>
			<ReactFlow
				nodes={displayNodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodesChange={handleNodesChange}
				onNodeClick={handleNodeClick}
				onNodeDoubleClick={handleNodeDoubleClick}
				onPaneClick={() => onSelect(undefined)}
				nodesConnectable={false}
				edgesFocusable={false}
				elevateNodesOnSelect
				proOptions={{ hideAttribution: true }}
				minZoom={0.1}
				maxZoom={2.5}
				fitView
			>
				<Background variant={BackgroundVariant.Dots} gap={18} size={1} className="ds-background" />
				<Controls showInteractive={false} position="bottom-left" />
				{settings.showMinimap && (
					<MiniMap
						pannable
						zoomable
						position="bottom-right"
						nodeStrokeWidth={2}
						nodeColor={(node) => miniMapColor(node, colors)}
						maskColor="rgba(0, 0, 0, 0.35)"
						className="ds-minimap"
					/>
				)}
				{filtered.nodes.length === 0 && (
					<Panel position="top-center">
						<div className="ds-empty-panel">Nothing to display with the current view options.</div>
					</Panel>
				)}
			</ReactFlow>
		</div>
	);
}

function relationFor(
	id: string,
	selectedId: string | undefined,
	highlight: ReturnType<typeof computeHighlight>,
): NodeData['relation'] {
	if (!selectedId) {
		return undefined;
	}
	if (id === selectedId) {
		return 'selected';
	}
	if (highlight?.dependencies.has(id)) {
		return 'dependency';
	}
	if (highlight?.dependents.has(id)) {
		return 'dependent';
	}
	if (highlight?.nodes.has(id)) {
		return 'attached';
	}
	return undefined;
}

function toReactFlowEdge(
	edge: GraphEdge,
	highlight: ReturnType<typeof computeHighlight>,
	dimActive: boolean,
	colors: ThemeColors,
): Edge {
	const highlighted = highlight?.edges.has(edge.id) ?? false;
	const dimmed = dimActive && !highlighted;
	const color = edge.dangling ? colors.danger : colors[edgeColorKey(edge.kind)];

	return {
		id: edge.id,
		source: edge.source,
		target: edge.target,
		type: 'smoothstep',
		label: edge.label,
		animated: highlighted && (edge.kind === 'depends_on' || edge.kind === 'link'),
		className: [
			'ds-edge',
			`ds-edge--${edge.kind}`,
			highlighted && 'is-highlighted',
			dimmed && 'is-dimmed',
			edge.dangling && 'is-dangling',
		]
			.filter(Boolean)
			.join(' '),
		style: {
			stroke: color,
			strokeWidth: highlighted ? 2.4 : 1.4,
			opacity: dimmed ? 0.18 : 1,
		},
		labelBgPadding: [6, 3],
		labelBgBorderRadius: 4,
		markerEnd:
			edge.kind === 'depends_on' || edge.kind === 'link'
				? { type: MarkerType.ArrowClosed, width: 16, height: 16, color }
				: { type: MarkerType.Arrow, width: 14, height: 14, color },
	};
}

function edgeColorKey(kind: GraphEdge['kind']): keyof ThemeColors {
	switch (kind) {
		case 'network':
			return 'network';
		case 'volume':
			return 'volume';
		case 'link':
			return 'link';
		default:
			return 'dependency';
	}
}

function miniMapColor(node: Node, colors: ThemeColors): string {
	const graphNode = (node.data as unknown as NodeData | undefined)?.graphNode;
	if (!graphNode) {
		return 'transparent';
	}
	if (graphNode.kind === 'network') {
		return colors.network;
	}
	if (graphNode.kind === 'volume') {
		return colors.volume;
	}
	return colors.dependency;
}

/** Bounding boxes drawn behind the services attached to each network. */
function buildGroupNodes(
	nodes: Node[],
	networks: GraphNode[],
	selectedId: string | undefined,
	highlight: ReturnType<typeof computeHighlight>,
): Node[] {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const groups: Node[] = [];

	networks.forEach((network, index) => {
		const members = (network.network?.services ?? [])
			.map((name) => byId.get(`service:${name}`))
			.filter((node): node is Node => Boolean(node));

		if (members.length === 0) {
			return;
		}

		const padding = 26 + index * 9;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		for (const member of members) {
			const { width, height } = sizeOf(member);
			minX = Math.min(minX, member.position.x);
			minY = Math.min(minY, member.position.y);
			maxX = Math.max(maxX, member.position.x + width);
			maxY = Math.max(maxY, member.position.y + height);
		}

		const dimmed = Boolean(selectedId) && !members.some((member) => highlight?.nodes.has(member.id));

		const data: GroupData = { label: network.label, colorIndex: index, dimmed };

		groups.push({
			id: `group:${network.id}`,
			type: 'networkGroup',
			position: { x: minX - padding, y: minY - padding - 18 },
			data: data as unknown as Record<string, unknown>,
			style: {
				width: maxX - minX + padding * 2,
				height: maxY - minY + padding * 2 + 18,
				zIndex: -1 - index,
				pointerEvents: 'none',
			},
			draggable: false,
			selectable: false,
			focusable: false,
			deletable: false,
			connectable: false,
		});
	});

	return groups;
}

/** Renders the current viewport to an image and hands it to the extension. */
async function exportDiagram(
	format: 'png' | 'svg',
	nodes: Node[],
	background: string,
): Promise<void> {
	const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
	if (!viewport || nodes.length === 0) {
		post({
			type: 'exportFailed',
			payload: { format, message: 'There is nothing to export yet.' },
		});
		return;
	}

	try {
		const bounds = getNodesBounds(nodes);
		const width = Math.min(Math.max(Math.round(bounds.width) + 160, 640), 6000);
		const height = Math.min(Math.max(Math.round(bounds.height) + 160, 480), 6000);
		const transform = getViewportForBounds(bounds, width, height, 0.2, 2, 0.08);

		const options = {
			backgroundColor: background,
			width,
			height,
			pixelRatio: format === 'png' ? 2 : 1,
			cacheBust: true,
			style: {
				width: `${width}px`,
				height: `${height}px`,
				transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
			},
			filter: (element: HTMLElement) => {
				const className = typeof element.className === 'string' ? element.className : '';
				return !(
					className.includes('react-flow__minimap') ||
					className.includes('react-flow__controls') ||
					className.includes('react-flow__attribution') ||
					className.includes('react-flow__background')
				);
			},
		};

		const dataUrl = format === 'png' ? await toPng(viewport, options) : await toSvg(viewport, options);
		post({ type: 'exportResult', payload: { format, dataUrl } });
	} catch (error) {
		post({
			type: 'exportFailed',
			payload: { format, message: error instanceof Error ? error.message : String(error) },
		});
	}
}
