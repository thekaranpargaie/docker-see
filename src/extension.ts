import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { logger } from './util/logger';
import {
	COMPOSE_GRAPH_VIEW_TYPE,
	ComposeGraphPanel,
	ComposeGraphSerializer,
} from './webview/webviewProvider';

export function activate(context: vscode.ExtensionContext): void {
	logger.info('DockerSee activated');

	registerCommands(context);

	context.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(
			COMPOSE_GRAPH_VIEW_TYPE,
			new ComposeGraphSerializer(context),
		),
		{ dispose: () => ComposeGraphPanel.disposeAll() },
		logger,
	);
}

export function deactivate(): void {
	ComposeGraphPanel.disposeAll();
}
