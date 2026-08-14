import * as path from 'path';
import * as vscode from 'vscode';
import { getRefreshDelay } from '../util/settings';

export type ComposeChangeReason = 'edit' | 'save' | 'external' | 'env' | 'deleted';

/**
 * Watches a single Compose file (spec §14 / Phase 7).
 *
 * Three sources are observed so the diagram stays current in every situation:
 *  - `onDidChangeTextDocument` — live updates while the developer types;
 *  - a `FileSystemWatcher` — changes made outside VS Code (git checkout, CLI);
 *  - the project's `.env` file — it feeds `${VAR}` interpolation.
 */
export class ComposeWatcher implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private timer: NodeJS.Timeout | undefined;
	private disposed = false;

	constructor(
		private readonly uri: vscode.Uri,
		private readonly onChange: (reason: ComposeChangeReason) => void,
	) {
		const directory = path.dirname(uri.fsPath);
		const fileName = path.basename(uri.fsPath);

		const fileWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.file(directory), `{${fileName},.env}`),
		);
		this.disposables.push(fileWatcher);
		this.disposables.push(
			fileWatcher.onDidChange((changed) => this.schedule(this.reasonFor(changed, 'external'))),
			fileWatcher.onDidCreate((changed) => this.schedule(this.reasonFor(changed, 'external'))),
			fileWatcher.onDidDelete((deleted) => {
				if (this.isTarget(deleted)) {
					this.flush('deleted');
				} else {
					this.schedule('env');
				}
			}),
		);

		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (this.isTarget(event.document.uri) && event.contentChanges.length > 0) {
					this.schedule('edit');
				}
			}),
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (this.isTarget(document.uri)) {
					this.schedule('save');
				}
			}),
		);
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
	}

	private reasonFor(changed: vscode.Uri, fallback: ComposeChangeReason): ComposeChangeReason {
		return this.isTarget(changed) ? fallback : 'env';
	}

	private isTarget(candidate: vscode.Uri): boolean {
		return candidate.fsPath === this.uri.fsPath;
	}

	/** Debounces bursts of keystrokes into a single rebuild. */
	private schedule(reason: ComposeChangeReason): void {
		if (this.disposed) {
			return;
		}
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.onChange(reason);
		}, getRefreshDelay(this.uri));
	}

	private flush(reason: ComposeChangeReason): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		if (!this.disposed) {
			this.onChange(reason);
		}
	}
}
