import * as vscode from 'vscode';
import type { LayoutDirection, NetworkDisplay, ViewSettings } from '../webview/messages';

export const CONFIG_SECTION = 'dockersee';

/** Reads the `dockersee.*` settings, scoped to the Compose file when possible. */
export function getViewSettings(resource?: vscode.Uri): ViewSettings {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource ?? null);
	return {
		layoutDirection: config.get<LayoutDirection>('layoutDirection', 'TB'),
		networkDisplay: config.get<NetworkDisplay>('networkDisplay', 'nodes'),
		showVolumes: config.get<boolean>('showVolumes', true),
		showBindMounts: config.get<boolean>('showBindMounts', false),
		showDefaultNetwork: config.get<boolean>('showDefaultNetwork', false),
		highlightDependencies: config.get<boolean>('highlightDependencies', true),
		showMinimap: config.get<boolean>('showMinimap', true),
		autoRefresh: config.get<boolean>('autoRefresh', true),
	};
}

export function getRefreshDelay(resource?: vscode.Uri): number {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource ?? null);
	return Math.max(0, config.get<number>('refreshDelay', 300));
}

export function getInterpolationOptions(resource?: vscode.Uri): { enabled: boolean; envFile: string } {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource ?? null);
	return {
		enabled: config.get<boolean>('interpolateVariables', true),
		envFile: config.get<string>('envFile', '.env'),
	};
}

/** Persists a view option changed from the webview toolbar. */
export async function updateViewSetting<K extends keyof ViewSettings>(
	key: K,
	value: ViewSettings[K],
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const target = vscode.workspace.workspaceFolders?.length
		? vscode.ConfigurationTarget.Workspace
		: vscode.ConfigurationTarget.Global;
	await config.update(key, value, target);
}
