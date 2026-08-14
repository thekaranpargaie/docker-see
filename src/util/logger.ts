import * as vscode from 'vscode';

/** Single output channel shared by the whole extension. */
class Logger {
	private channel: vscode.OutputChannel | undefined;

	private get output(): vscode.OutputChannel {
		if (!this.channel) {
			this.channel = vscode.window.createOutputChannel('DockerSee');
		}
		return this.channel;
	}

	info(message: string): void {
		this.write('INFO', message);
	}

	warn(message: string): void {
		this.write('WARN', message);
	}

	error(message: string, error?: unknown): void {
		this.write('ERROR', message);
		if (error instanceof Error) {
			this.output.appendLine(error.stack ?? error.message);
		} else if (error !== undefined) {
			this.output.appendLine(String(error));
		}
	}

	show(): void {
		this.output.show(true);
	}

	dispose(): void {
		this.channel?.dispose();
		this.channel = undefined;
	}

	private write(level: string, message: string): void {
		const timestamp = new Date().toISOString().slice(11, 23);
		this.output.appendLine(`[${timestamp}] ${level} ${message}`);
	}
}

export const logger = new Logger();
