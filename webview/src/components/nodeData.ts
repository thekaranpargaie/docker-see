import type { GraphNode } from '../../../src/graph/graphTypes';
import type { LayoutDirection } from '../../../src/webview/messages';

/** Payload attached to every React Flow node. */
export interface NodeData extends Record<string, unknown> {
	graphNode: GraphNode;
	direction: LayoutDirection;
	/** True when a selection or search is active and this node is not part of it. */
	dimmed: boolean;
	/** True when the node is a direct dependency/dependent of the selection. */
	related: boolean;
	/** How the node relates to the current selection. */
	relation?: 'selected' | 'dependency' | 'dependent' | 'attached';
	/** True when the node matches the current search query. */
	match: boolean;
	/** Networks shown as badges (only in `badges` network display mode). */
	networkBadges?: string[];
}

/** Payload for the translucent network group boxes. */
export interface GroupData extends Record<string, unknown> {
	label: string;
	colorIndex: number;
	dimmed: boolean;
}

export function classNames(...values: (string | false | undefined)[]): string {
	return values.filter(Boolean).join(' ');
}
