import * as vscode from 'vscode';
import { logger } from '../util/logger';
import { ComposeGraphPanel } from '../webview/webviewProvider';
import { selectComposeFile, visualizeCompose } from './visualizeCompose';

/** Registers every `dockersee.*` command (spec §Phase 1). */
export function registerCommands(context: vscode.ExtensionContext): void {
	const requirePanel = (): ComposeGraphPanel | undefined => {
		const panel = ComposeGraphPanel.active;
		if (!panel) {
			void vscode.window.showInformationMessage(
				'Open a diagram first with "DockerSee: Visualize Compose".',
			);
			return undefined;
		}
		return panel;
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('dockersee.visualizeCompose', (resource?: vscode.Uri) =>
			visualizeCompose(context, resource),
		),
		vscode.commands.registerCommand('dockersee.selectComposeFile', () => selectComposeFile(context)),
		vscode.commands.registerCommand('dockersee.refresh', () => requirePanel()?.refresh()),
		vscode.commands.registerCommand('dockersee.resetLayout', () => requirePanel()?.resetLayout()),
		vscode.commands.registerCommand('dockersee.fitView', () => requirePanel()?.fitView()),
		vscode.commands.registerCommand('dockersee.search', () => requirePanel()?.focusSearch()),
		vscode.commands.registerCommand('dockersee.exportPng', () =>
			requirePanel()?.exportDiagram('png'),
		),
		vscode.commands.registerCommand('dockersee.exportSvg', () =>
			requirePanel()?.exportDiagram('svg'),
		),
		vscode.commands.registerCommand('dockersee.showLog', () => logger.show()),
	);
}
