import * as path from 'path';
import * as vscode from 'vscode';
import {
	COMPOSE_GLOB,
	compareComposeCandidates,
	isComposeFile,
} from '../parser/composeDetector';
import { ComposeGraphPanel } from '../webview/webviewProvider';
import { logger } from '../util/logger';

/**
 * `DockerSee: Visualize Compose`.
 *
 * Accepts a URI from the explorer / editor context menu, otherwise falls back to
 * the active editor and finally to a quick pick over the workspace (spec §6).
 */
export async function visualizeCompose(
	context: vscode.ExtensionContext,
	resource?: vscode.Uri,
): Promise<void> {
	const uri = await resolveComposeUri(resource);
	if (!uri) {
		return;
	}
	logger.info(`Visualizing ${uri.fsPath}`);
	ComposeGraphPanel.createOrShow(context, uri);
}

/** `DockerSee: Select Compose File...` — always shows the picker. */
export async function selectComposeFile(context: vscode.ExtensionContext): Promise<void> {
	const uri = await pickComposeFile();
	if (!uri) {
		return;
	}
	ComposeGraphPanel.createOrShow(context, uri);
}

async function resolveComposeUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
	if (resource && resource.scheme === 'file') {
		if (!isComposeFile(resource.fsPath)) {
			const proceed = await vscode.window.showWarningMessage(
				`${path.basename(resource.fsPath)} does not look like a Compose file. Visualize it anyway?`,
				{ modal: true },
				'Visualize',
			);
			if (proceed !== 'Visualize') {
				return undefined;
			}
		}
		return resource;
	}

	const active = vscode.window.activeTextEditor?.document;
	if (active && active.uri.scheme === 'file' && isComposeFile(active.uri.fsPath)) {
		return active.uri;
	}

	return pickComposeFile();
}

/** Quick pick listing every Compose file in the workspace, plus a browse entry. */
export async function pickComposeFile(): Promise<vscode.Uri | undefined> {
	const browseItem: vscode.QuickPickItem = {
		label: '$(folder-opened) Browse...',
		detail: 'Choose a Compose file from disk',
		alwaysShow: true,
	};

	const found = await vscode.workspace.findFiles(COMPOSE_GLOB, '**/node_modules/**', 200);
	const candidates = found
		.filter((uri) => isComposeFile(uri.fsPath))
		.sort((a, b) =>
			compareComposeCandidates(
				vscode.workspace.asRelativePath(a, true),
				vscode.workspace.asRelativePath(b, true),
			),
		);

	if (candidates.length === 0) {
		const choice = await vscode.window.showInformationMessage(
			'DockerSee could not find a Compose file in this workspace.',
			'Browse...',
		);
		return choice === 'Browse...' ? browseForComposeFile() : undefined;
	}

	interface ComposeQuickPickItem extends vscode.QuickPickItem {
		uri?: vscode.Uri;
	}

	const items: ComposeQuickPickItem[] = candidates.map((uri) => ({
		label: `$(file) ${path.basename(uri.fsPath)}`,
		description: vscode.workspace.asRelativePath(uri, true),
		uri,
	}));
	items.push({ ...browseItem });

	const picked = await vscode.window.showQuickPick(items, {
		title: 'DockerSee — Select a Compose file',
		placeHolder: 'Select the Docker Compose file to visualize',
		matchOnDescription: true,
	});

	if (!picked) {
		return undefined;
	}
	return picked.uri ?? browseForComposeFile();
}

async function browseForComposeFile(): Promise<vscode.Uri | undefined> {
	const picked = await vscode.window.showOpenDialog({
		title: 'Select a Docker Compose file',
		canSelectMany: false,
		filters: { 'Compose files': ['yml', 'yaml'], 'All files': ['*'] },
	});
	return picked?.[0];
}
