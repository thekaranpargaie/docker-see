import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SourceLocation } from '../../src/parser/composeTypes';
import type {
	ExtensionToWebviewMessage,
	GraphPayload,
	ParseFailurePayload,
	ViewSettings,
} from '../../src/webview/messages';
import { ComposeGraph, type GraphCommand } from './components/ComposeGraph';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { ErrorScreen } from './components/ErrorScreen';
import { Legend } from './components/Legend';
import { ServiceDetails } from './components/ServiceDetails';
import { Toolbar } from './components/Toolbar';
import { filterGraph, matchesSearch } from './filters';
import { post, rememberFilePath } from './vscodeApi';

const DEFAULT_SETTINGS: ViewSettings = {
	layoutDirection: 'TB',
	networkDisplay: 'nodes',
	showVolumes: true,
	showBindMounts: false,
	showDefaultNetwork: false,
	highlightDependencies: true,
	showMinimap: true,
	autoRefresh: true,
};

export function App(): JSX.Element {
	const [settings, setSettings] = useState<ViewSettings>(DEFAULT_SETTINGS);
	const [payload, setPayload] = useState<GraphPayload | undefined>();
	const [failure, setFailure] = useState<ParseFailurePayload | undefined>();
	const [fileName, setFileName] = useState('');
	const [busy, setBusy] = useState(true);
	const [selectedId, setSelectedId] = useState<string | undefined>();
	const [search, setSearch] = useState('');
	const [command, setCommand] = useState<GraphCommand | undefined>();
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

	const searchRef = useRef<HTMLInputElement>(null);
	const commandToken = useRef(0);

	const issueCommand = useCallback((name: GraphCommand['name'], format?: 'png' | 'svg') => {
		commandToken.current += 1;
		setCommand({ name, format, token: commandToken.current });
	}, []);

	// ------------------------------------------------------------- messaging

	useEffect(() => {
		const handler = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
			const message = event.data;
			switch (message.type) {
				case 'init':
					setSettings(message.settings);
					setFileName(message.fileName);
					rememberFilePath(message.filePath);
					break;
				case 'graph':
					setPayload(message.payload);
					setFailure(undefined);
					break;
				case 'parseFailure':
					setFailure(message.payload);
					break;
				case 'settings':
					setSettings(message.payload);
					break;
				case 'busy':
					setBusy(message.payload.busy);
					break;
				case 'command':
					if (message.payload.name === 'focusSearch') {
						searchRef.current?.focus();
						searchRef.current?.select();
					} else {
						issueCommand(message.payload.name, message.payload.format);
					}
					break;
				default:
					break;
			}
		};

		window.addEventListener('message', handler);
		post({ type: 'ready' });
		return () => window.removeEventListener('message', handler);
	}, [issueCommand]);

	// Surface unexpected UI failures in the extension log instead of a blank panel.
	useEffect(() => {
		const onError = (event: ErrorEvent): void => {
			post({
				type: 'runtimeError',
				payload: { message: event.message, stack: event.error?.stack },
			});
		};
		window.addEventListener('error', onError);
		return () => window.removeEventListener('error', onError);
	}, []);

	// ------------------------------------------------------------- shortcuts

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			const target = event.target as HTMLElement | null;
			const typing =
				target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
				event.preventDefault();
				searchRef.current?.focus();
				searchRef.current?.select();
				return;
			}
			if (!typing && event.key === '/') {
				event.preventDefault();
				searchRef.current?.focus();
				return;
			}
			if (event.key === 'Escape') {
				setSelectedId(undefined);
				setSearch('');
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	useEffect(() => {
		post({ type: 'selection', payload: { id: selectedId } });
	}, [selectedId]);

	// --------------------------------------------------------------- actions

	const changeSetting = useCallback(
		<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => {
			setSettings((previous) => ({ ...previous, [key]: value }));
			post({ type: 'updateSettings', payload: { [key]: value } as Partial<ViewSettings> });
		},
		[],
	);

	const reveal = useCallback((location: SourceLocation) => {
		post({ type: 'reveal', payload: { line: location.line, column: location.column } });
	}, []);

	const refresh = useCallback(() => post({ type: 'refresh' }), []);

	// --------------------------------------------------------------- derived

	const filtered = useMemo(
		() => (payload ? filterGraph(payload.graph, settings) : undefined),
		[payload, settings],
	);

	const matchCount = useMemo(() => {
		if (!filtered || search.trim().length === 0) {
			return 0;
		}
		return filtered.nodes.filter((node) => matchesSearch(node, search)).length;
	}, [filtered, search]);

	const selectedNode = useMemo(
		() => payload?.graph.nodes.find((node) => node.id === selectedId),
		[payload, selectedId],
	);

	const diagnostics = payload?.diagnostics ?? failure?.diagnostics ?? [];
	const errorCount = diagnostics.filter((item) => item.severity === 'error').length;
	const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;

	// ---------------------------------------------------------------- render

	if (!payload) {
		if (failure) {
			return <ErrorScreen failure={failure} onRetry={refresh} onReveal={reveal} />;
		}
		return (
			<div className="ds-loading">
				<span className="ds-spinner" />
				<p>Reading {fileName || 'Compose file'}…</p>
			</div>
		);
	}

	return (
		<div className="ds-app">
			<Toolbar
				title={payload.graph.projectName ?? 'DockerSee'}
				subtitle={payload.graph.fileName}
				stats={payload.graph.stats}
				settings={settings}
				onChangeSetting={changeSetting}
				search={search}
				onSearch={setSearch}
				searchRef={searchRef}
				matchCount={matchCount}
				busy={busy}
				errorCount={errorCount}
				warningCount={warningCount}
				diagnosticsOpen={diagnosticsOpen}
				onToggleDiagnostics={() => setDiagnosticsOpen((open) => !open)}
				onRefresh={refresh}
				onFit={() => issueCommand('fitView')}
				onResetLayout={() => issueCommand('resetLayout')}
				onExport={(format) => issueCommand('export', format)}
			/>

			{failure && (
				<div className="ds-banner ds-banner--error" role="alert">
					<span aria-hidden="true">⛔</span>
					<span>
						{failure.message} The diagram below still shows the last version that parsed
						successfully.
					</span>
					<button type="button" className="ds-button" onClick={refresh}>
						Retry
					</button>
				</div>
			)}

			{!failure && !payload.ok && (
				<div className="ds-banner ds-banner--warning" role="status">
					<span aria-hidden="true">⚠</span>
					<span>
						This Compose file has {errorCount} problem{errorCount === 1 ? '' : 's'} that Docker
						Compose would reject.
					</span>
					<button type="button" className="ds-button" onClick={() => setDiagnosticsOpen(true)}>
						Show problems
					</button>
				</div>
			)}

			<main className="ds-main">
				<div className="ds-canvas">
					{filtered && (
						<ComposeGraph
							graph={payload.graph}
							filtered={filtered}
							settings={settings}
							selectedId={selectedId}
							search={search}
							command={command}
							onSelect={setSelectedId}
							onReveal={reveal}
						/>
					)}
					<Legend
						showNetworks={settings.networkDisplay === 'nodes'}
						showVolumes={settings.showVolumes}
					/>
				</div>

				<ServiceDetails
					node={selectedNode}
					graph={payload.graph}
					onSelect={setSelectedId}
					onReveal={reveal}
					onClose={() => setSelectedId(undefined)}
				/>
			</main>

			{diagnosticsOpen && (
				<DiagnosticsPanel
					diagnostics={diagnostics}
					onReveal={reveal}
					onClose={() => setDiagnosticsOpen(false)}
				/>
			)}
		</div>
	);
}
