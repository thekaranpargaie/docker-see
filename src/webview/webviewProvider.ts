import * as path from 'path';
import * as vscode from 'vscode';
import { buildGraph } from '../graph/graphBuilder';
import { ComposeParser } from '../parser/composeParser';
import { defaultProjectName, loadVariables, readComposeText } from '../services/composeLoader';
import { logger } from '../util/logger';
import { CONFIG_SECTION, getViewSettings, updateViewSetting } from '../util/settings';
import { ComposeWatcher, type ComposeChangeReason } from '../watcher/composeWatcher';
import type {
	ExtensionToWebviewMessage,
	ViewSettings,
	WebviewToExtensionMessage,
} from './messages';

const VIEW_TYPE = 'dockersee.graph';
const PANEL_ACTIVE_CONTEXT = 'dockersee.panelActive';

interface PanelState {
	filePath: string;
}

/**
 * Owns one webview panel per Compose file: builds the diagram, keeps it in sync
 * with the file, and bridges commands between VS Code and the React app.
 */
export class ComposeGraphPanel {
	private static readonly panels = new Map<string, ComposeGraphPanel>();
	private static activePanel: ComposeGraphPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private readonly parser = new ComposeParser();
	private watcher: ComposeWatcher | undefined;
	private ready = false;
	private pending: ExtensionToWebviewMessage[] = [];
	private revision = 0;
	private rendering = false;
	private renderQueued = false;

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly context: vscode.ExtensionContext,
		private uri: vscode.Uri,
	) {
		this.panel.webview.html = this.render();
		this.panel.iconPath = {
			light: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon-light.svg'),
			dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon-dark.svg'),
		};

		this.disposables.push(
			this.panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) =>
				this.handleMessage(message),
			),
			this.panel.onDidChangeViewState(() => this.syncActiveState()),
			this.panel.onDidDispose(() => this.dispose()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(CONFIG_SECTION)) {
					this.post({ type: 'settings', payload: this.settings() });
				}
			}),
		);

		this.startWatching();
		this.syncActiveState();
	}

	// --------------------------------------------------------------- lifecycle

	static createOrShow(context: vscode.ExtensionContext, uri: vscode.Uri): ComposeGraphPanel {
		const key = uri.toString();
		const existing = ComposeGraphPanel.panels.get(key);
		if (existing) {
			existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Beside);
			void existing.refresh();
			return existing;
		}

		const panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			`DockerSee — ${path.basename(uri.fsPath)}`,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
			{ ...ComposeGraphPanel.webviewOptions(context), retainContextWhenHidden: true },
		);

		const instance = new ComposeGraphPanel(panel, context, uri);
		ComposeGraphPanel.panels.set(key, instance);
		return instance;
	}

	/** Restores a panel after a window reload. */
	static revive(
		panel: vscode.WebviewPanel,
		context: vscode.ExtensionContext,
		state: PanelState | undefined,
	): void {
		if (!state?.filePath) {
			panel.dispose();
			return;
		}
		const uri = vscode.Uri.file(state.filePath);
		panel.webview.options = ComposeGraphPanel.webviewOptions(context);
		const instance = new ComposeGraphPanel(panel, context, uri);
		ComposeGraphPanel.panels.set(uri.toString(), instance);
	}

	static get active(): ComposeGraphPanel | undefined {
		return ComposeGraphPanel.activePanel;
	}

	static disposeAll(): void {
		for (const panel of [...ComposeGraphPanel.panels.values()]) {
			panel.dispose();
		}
	}

	private static webviewOptions(context: vscode.ExtensionContext): vscode.WebviewOptions {
		return {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
				vscode.Uri.joinPath(context.extensionUri, 'media'),
			],
		};
	}

	dispose(): void {
		ComposeGraphPanel.panels.delete(this.uri.toString());
		if (ComposeGraphPanel.activePanel === this) {
			ComposeGraphPanel.activePanel = undefined;
			void vscode.commands.executeCommand('setContext', PANEL_ACTIVE_CONTEXT, false);
		}
		this.watcher?.dispose();
		this.watcher = undefined;
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
		this.panel.dispose();
	}

	private syncActiveState(): void {
		if (this.panel.active) {
			ComposeGraphPanel.activePanel = this;
		} else if (ComposeGraphPanel.activePanel === this) {
			ComposeGraphPanel.activePanel = undefined;
		}
		void vscode.commands.executeCommand(
			'setContext',
			PANEL_ACTIVE_CONTEXT,
			ComposeGraphPanel.activePanel !== undefined,
		);
	}

	private startWatching(): void {
		this.watcher?.dispose();
		this.watcher = new ComposeWatcher(this.uri, (reason) => this.onFileChanged(reason));
	}

	private onFileChanged(reason: ComposeChangeReason): void {
		if (reason !== 'deleted' && !this.settings().autoRefresh) {
			return;
		}
		logger.info(`Rebuilding diagram (${reason}) for ${this.uri.fsPath}`);
		void this.refresh();
	}

	// ------------------------------------------------------------ public verbs

	/** Re-reads, re-parses and re-renders the Compose file. */
	async refresh(): Promise<void> {
		if (this.rendering) {
			this.renderQueued = true;
			return;
		}
		this.rendering = true;
		try {
			do {
				this.renderQueued = false;
				await this.rebuild();
			} while (this.renderQueued);
		} finally {
			this.rendering = false;
		}
	}

	resetLayout(): void {
		this.post({ type: 'command', payload: { name: 'resetLayout' } });
	}

	fitView(): void {
		this.post({ type: 'command', payload: { name: 'fitView' } });
	}

	focusSearch(): void {
		this.post({ type: 'command', payload: { name: 'focusSearch' } });
	}

	exportDiagram(format: 'png' | 'svg'): void {
		this.post({ type: 'command', payload: { name: 'export', format } });
	}

	get composeUri(): vscode.Uri {
		return this.uri;
	}

	// ---------------------------------------------------------------- internals

	private async rebuild(): Promise<void> {
		this.revision += 1;
		this.post({ type: 'busy', payload: { busy: true } });

		const fileName = path.basename(this.uri.fsPath);

		try {
			await vscode.workspace.fs.stat(this.uri);
		} catch {
			this.post({
				type: 'parseFailure',
				payload: {
					filePath: this.uri.fsPath,
					fileName,
					message: `${fileName} no longer exists on disk.`,
					diagnostics: [],
					revision: this.revision,
				},
			});
			this.post({ type: 'busy', payload: { busy: false } });
			return;
		}

		try {
			const text = await readComposeText(this.uri);
			const variables = await loadVariables(this.uri);
			const result = this.parser.parse(text, {
				filePath: this.uri.fsPath,
				variables,
				projectName: defaultProjectName(this.uri),
			});

			if (!result.project) {
				const first = result.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
				this.post({
					type: 'parseFailure',
					payload: {
						filePath: this.uri.fsPath,
						fileName,
						message: first?.message ?? 'Unable to parse Compose file.',
						diagnostics: result.diagnostics,
						revision: this.revision,
					},
				});
				return;
			}

			const graph = buildGraph(result.project);
			this.post({
				type: 'graph',
				payload: {
					graph,
					project: result.project,
					diagnostics: result.diagnostics,
					ok: result.ok,
					revision: this.revision,
					generatedAt: new Date().toISOString(),
				},
			});
		} catch (error) {
			logger.error(`Failed to rebuild ${this.uri.fsPath}`, error);
			this.post({
				type: 'parseFailure',
				payload: {
					filePath: this.uri.fsPath,
					fileName,
					message: error instanceof Error ? error.message : String(error),
					diagnostics: [],
					revision: this.revision,
				},
			});
		} finally {
			this.post({ type: 'busy', payload: { busy: false } });
		}
	}

	private settings(): ViewSettings {
		return getViewSettings(this.uri);
	}

	private post(message: ExtensionToWebviewMessage): void {
		if (!this.ready) {
			this.pending.push(message);
			return;
		}
		void this.panel.webview.postMessage(message);
	}

	private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
		switch (message.type) {
			case 'ready': {
				this.ready = true;
				this.post({
					type: 'init',
					settings: this.settings(),
					filePath: this.uri.fsPath,
					fileName: path.basename(this.uri.fsPath),
				});
				const queued = this.pending;
				this.pending = [];
				for (const pending of queued) {
					void this.panel.webview.postMessage(pending);
				}
				await this.refresh();
				break;
			}
			case 'refresh':
				await this.refresh();
				break;
			case 'reveal':
				await this.revealInEditor(message.payload.line, message.payload.column);
				break;
			case 'updateSettings':
				for (const [key, value] of Object.entries(message.payload)) {
					await updateViewSetting(key as keyof ViewSettings, value as never);
				}
				break;
			case 'exportResult':
				await this.saveExport(message.payload.format, message.payload.dataUrl);
				break;
			case 'exportFailed':
				void vscode.window.showErrorMessage(
					`DockerSee could not export the diagram as ${message.payload.format.toUpperCase()}: ${message.payload.message}`,
				);
				break;
			case 'notify':
				this.notify(message.payload.level, message.payload.text);
				break;
			case 'runtimeError':
				logger.error(`Webview error: ${message.payload.message}`, message.payload.stack);
				break;
			case 'selection':
				// Selection is purely visual; logged to help diagnose user reports.
				logger.info(`Selected ${message.payload.id ?? 'nothing'}`);
				break;
			default:
				break;
		}
	}

	private notify(level: 'info' | 'warning' | 'error', text: string): void {
		if (level === 'error') {
			void vscode.window.showErrorMessage(text);
		} else if (level === 'warning') {
			void vscode.window.showWarningMessage(text);
		} else {
			void vscode.window.showInformationMessage(text);
		}
	}

	private async revealInEditor(line: number, column: number): Promise<void> {
		try {
			const document = await vscode.workspace.openTextDocument(this.uri);
			const editor = await vscode.window.showTextDocument(document, {
				viewColumn: vscode.ViewColumn.One,
				preserveFocus: false,
			});
			const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1));
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(
				new vscode.Range(position, position),
				vscode.TextEditorRevealType.InCenterIfOutsideViewport,
			);
		} catch (error) {
			logger.error('Unable to reveal position in the Compose file', error);
		}
	}

	private async saveExport(format: 'png' | 'svg', dataUrl: string): Promise<void> {
		const projectName = path.basename(path.dirname(this.uri.fsPath)) || 'dockersee';
		const target = await vscode.window.showSaveDialog({
			title: `Export diagram as ${format.toUpperCase()}`,
			defaultUri: vscode.Uri.file(
				path.join(path.dirname(this.uri.fsPath), `${projectName}-architecture.${format}`),
			),
			filters: format === 'png' ? { Images: ['png'] } : { Images: ['svg'] },
		});
		if (!target) {
			return;
		}

		try {
			await vscode.workspace.fs.writeFile(target, dataUrlToBytes(dataUrl));
			const open = await vscode.window.showInformationMessage(
				`Diagram exported to ${path.basename(target.fsPath)}.`,
				'Open',
			);
			if (open === 'Open') {
				await vscode.commands.executeCommand('vscode.open', target);
			}
		} catch (error) {
			logger.error('Export failed', error);
			void vscode.window.showErrorMessage(
				`DockerSee could not write the exported diagram: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private render(): string {
		const webview = this.panel.webview;
		const base = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));
		const nonce = createNonce();

		return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta
			http-equiv="Content-Security-Policy"
			content="default-src 'none';
				img-src ${webview.cspSource} data: blob:;
				style-src ${webview.cspSource} 'unsafe-inline';
				font-src ${webview.cspSource} data:;
				connect-src ${webview.cspSource} data: blob:;
				script-src 'nonce-${nonce}';" />
		<link href="${styleUri}" rel="stylesheet" />
		<title>DockerSee</title>
	</head>
	<body>
		<div id="root"></div>
		<script nonce="${nonce}" src="${scriptUri}"></script>
	</body>
</html>`;
	}
}

/** Serializer so open diagrams survive a window reload. */
export class ComposeGraphSerializer implements vscode.WebviewPanelSerializer<PanelState> {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async deserializeWebviewPanel(
		panel: vscode.WebviewPanel,
		state: PanelState | undefined,
	): Promise<void> {
		ComposeGraphPanel.revive(panel, this.context, state);
	}
}

export const COMPOSE_GRAPH_VIEW_TYPE = VIEW_TYPE;

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i += 1) {
		nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}
	return nonce;
}

/** Decodes both base64 and URI-encoded data URLs (PNG and SVG respectively). */
function dataUrlToBytes(dataUrl: string): Uint8Array {
	const match = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/.exec(dataUrl);
	if (!match) {
		throw new Error('The webview returned an unsupported image payload.');
	}
	const parameters = match[2];
	const payload = match[3];
	if (parameters.includes(';base64')) {
		return new Uint8Array(Buffer.from(payload, 'base64'));
	}
	return new Uint8Array(Buffer.from(decodeURIComponent(payload), 'utf8'));
}
