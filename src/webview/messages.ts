/**
 * Message protocol between the extension host and the webview.
 *
 * Both sides import these types (the webview via a type-only import, so nothing
 * from this file ends up in the browser bundle).
 */

import type { ComposeDiagnostic, ComposeProject } from '../parser/composeTypes';
import type { GraphModel } from '../graph/graphTypes';

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export type NetworkDisplay = 'nodes' | 'groups' | 'badges' | 'hidden';

/** View options mirrored from the `dockersee.*` settings. */
export interface ViewSettings {
	layoutDirection: LayoutDirection;
	networkDisplay: NetworkDisplay;
	showVolumes: boolean;
	showBindMounts: boolean;
	showDefaultNetwork: boolean;
	highlightDependencies: boolean;
	showMinimap: boolean;
	autoRefresh: boolean;
}

export interface GraphPayload {
	graph: GraphModel;
	project: ComposeProject;
	diagnostics: ComposeDiagnostic[];
	/** False when at least one `error` diagnostic was produced. */
	ok: boolean;
	/** Increments on every rebuild; used to animate the "updated" indicator. */
	revision: number;
	/** Locale-independent ISO timestamp of the rebuild. */
	generatedAt: string;
}

export interface ParseFailurePayload {
	filePath: string;
	fileName: string;
	message: string;
	diagnostics: ComposeDiagnostic[];
	revision: number;
}

export type ExtensionToWebviewMessage =
	| { type: 'init'; settings: ViewSettings; filePath: string; fileName: string }
	| { type: 'graph'; payload: GraphPayload }
	| { type: 'parseFailure'; payload: ParseFailurePayload }
	| { type: 'settings'; payload: ViewSettings }
	| {
			type: 'command';
			payload: { name: 'resetLayout' | 'fitView' | 'focusSearch' | 'export'; format?: 'png' | 'svg' };
	  }
	| { type: 'busy'; payload: { busy: boolean } };

export type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'refresh' }
	| { type: 'selection'; payload: { id?: string; label?: string } }
	| { type: 'reveal'; payload: { line: number; column: number } }
	| { type: 'updateSettings'; payload: Partial<ViewSettings> }
	| { type: 'exportResult'; payload: { format: 'png' | 'svg'; dataUrl: string } }
	| { type: 'exportFailed'; payload: { format: 'png' | 'svg'; message: string } }
	| { type: 'notify'; payload: { level: 'info' | 'warning' | 'error'; text: string } }
	| { type: 'runtimeError'; payload: { message: string; stack?: string } };
