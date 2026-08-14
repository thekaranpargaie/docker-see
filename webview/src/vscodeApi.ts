import type { WebviewToExtensionMessage } from '../../src/webview/messages';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState<T>(): T | undefined;
	setState<T>(state: T): T;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** `acquireVsCodeApi` may only be called once per webview. */
export const vscode: VsCodeApi = acquireVsCodeApi();

export function post(message: WebviewToExtensionMessage): void {
	vscode.postMessage(message);
}

/** Persisted so the panel can be revived after a window reload. */
export interface PersistedState {
	filePath?: string;
}

export function rememberFilePath(filePath: string): void {
	vscode.setState<PersistedState>({ filePath });
}
