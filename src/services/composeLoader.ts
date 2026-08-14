import * as path from 'path';
import * as vscode from 'vscode';
import { parseEnvFile, type VariableMap } from '../parser/interpolate';
import { getInterpolationOptions } from '../util/settings';
import { logger } from '../util/logger';

/**
 * Reads the Compose file. When the file is open in an editor the in-memory text
 * is used, so the diagram follows unsaved edits.
 */
export async function readComposeText(uri: vscode.Uri): Promise<string> {
	const open = vscode.workspace.textDocuments.find(
		(document) => document.uri.toString() === uri.toString(),
	);
	if (open) {
		return open.getText();
	}
	const bytes = await vscode.workspace.fs.readFile(uri);
	return Buffer.from(bytes).toString('utf8');
}

/**
 * Builds the variable map used for `${VAR}` interpolation: the extension host
 * environment plus the project's env file (which takes precedence, as it does
 * for the Compose CLI's `--env-file`).
 */
export async function loadVariables(uri: vscode.Uri): Promise<VariableMap> {
	const { enabled, envFile } = getInterpolationOptions(uri);
	if (!enabled) {
		return {};
	}

	const variables: VariableMap = { ...process.env };

	// `COMPOSE_PROJECT_NAME` defaults to the directory holding the file.
	const directory = path.dirname(uri.fsPath);
	variables.COMPOSE_PROJECT_NAME =
		variables.COMPOSE_PROJECT_NAME ?? path.basename(directory).toLowerCase().replace(/[^a-z0-9_-]/g, '');

	if (envFile) {
		const envUri = vscode.Uri.joinPath(vscode.Uri.file(directory), envFile);
		try {
			const bytes = await vscode.workspace.fs.readFile(envUri);
			Object.assign(variables, parseEnvFile(Buffer.from(bytes).toString('utf8')));
		} catch {
			// A missing env file is completely normal — nothing to report.
			logger.info(`No env file at ${envUri.fsPath}`);
		}
	}

	return variables;
}

/** Project name fallback: the folder containing the Compose file. */
export function defaultProjectName(uri: vscode.Uri): string {
	return path.basename(path.dirname(uri.fsPath));
}
