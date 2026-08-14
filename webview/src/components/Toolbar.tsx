import type { RefObject } from 'react';
import type { GraphStats } from '../../../src/graph/graphTypes';
import type { LayoutDirection, NetworkDisplay, ViewSettings } from '../../../src/webview/messages';

interface ToolbarProps {
	title: string;
	subtitle: string;
	stats: GraphStats;
	settings: ViewSettings;
	onChangeSetting: <K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => void;
	search: string;
	onSearch: (value: string) => void;
	searchRef: RefObject<HTMLInputElement>;
	matchCount: number;
	busy: boolean;
	errorCount: number;
	warningCount: number;
	diagnosticsOpen: boolean;
	onToggleDiagnostics: () => void;
	onRefresh: () => void;
	onFit: () => void;
	onResetLayout: () => void;
	onExport: (format: 'png' | 'svg') => void;
}

const DIRECTIONS: { value: LayoutDirection; label: string }[] = [
	{ value: 'TB', label: 'Top → Bottom' },
	{ value: 'LR', label: 'Left → Right' },
	{ value: 'BT', label: 'Bottom → Top' },
	{ value: 'RL', label: 'Right → Left' },
];

const NETWORK_MODES: { value: NetworkDisplay; label: string }[] = [
	{ value: 'nodes', label: 'Networks: nodes' },
	{ value: 'groups', label: 'Networks: groups' },
	{ value: 'badges', label: 'Networks: badges' },
	{ value: 'hidden', label: 'Networks: hidden' },
];

export function Toolbar({
	title,
	subtitle,
	stats,
	settings,
	onChangeSetting,
	search,
	onSearch,
	searchRef,
	matchCount,
	busy,
	errorCount,
	warningCount,
	diagnosticsOpen,
	onToggleDiagnostics,
	onRefresh,
	onFit,
	onResetLayout,
	onExport,
}: ToolbarProps): JSX.Element {
	return (
		<header className="ds-toolbar">
			<div className="ds-toolbar__identity">
				<span className="ds-toolbar__logo" aria-hidden="true">
					🐳
				</span>
				<div>
					<h1 className="ds-toolbar__title">{title}</h1>
					<p className="ds-toolbar__subtitle" title={subtitle}>
						{subtitle}
					</p>
				</div>
				{busy && <span className="ds-spinner" title="Rebuilding diagram" />}
			</div>

			<div className="ds-toolbar__stats" aria-label="Project statistics">
				<Stat label="services" value={stats.services} />
				<Stat label="dependencies" value={stats.dependencies} />
				<Stat label="networks" value={stats.networks} />
				<Stat label="volumes" value={stats.volumes} />
				<Stat label="ports" value={stats.ports} />
			</div>

			<div className="ds-toolbar__controls">
				<div className="ds-search">
					<span className="ds-search__icon" aria-hidden="true">
						🔎
					</span>
					<input
						ref={searchRef}
						className="ds-search__input"
						type="search"
						value={search}
						placeholder="Search services, images, ports…"
						aria-label="Search services"
						onChange={(event) => onSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Escape') {
								onSearch('');
								event.currentTarget.blur();
							}
						}}
					/>
					{search.trim().length > 0 && (
						<span className="ds-search__count">
							{matchCount} match{matchCount === 1 ? '' : 'es'}
						</span>
					)}
				</div>

				<select
					className="ds-select"
					aria-label="Layout direction"
					value={settings.layoutDirection}
					onChange={(event) =>
						onChangeSetting('layoutDirection', event.target.value as LayoutDirection)
					}
				>
					{DIRECTIONS.map((direction) => (
						<option key={direction.value} value={direction.value}>
							{direction.label}
						</option>
					))}
				</select>

				<select
					className="ds-select"
					aria-label="Network display mode"
					value={settings.networkDisplay}
					onChange={(event) =>
						onChangeSetting('networkDisplay', event.target.value as NetworkDisplay)
					}
				>
					{NETWORK_MODES.map((mode) => (
						<option key={mode.value} value={mode.value}>
							{mode.label}
						</option>
					))}
				</select>

				<Toggle
					label="Volumes"
					checked={settings.showVolumes}
					onChange={(value) => onChangeSetting('showVolumes', value)}
				/>
				<Toggle
					label="Bind mounts"
					checked={settings.showBindMounts}
					disabled={!settings.showVolumes}
					onChange={(value) => onChangeSetting('showBindMounts', value)}
				/>
				<Toggle
					label="default net"
					checked={settings.showDefaultNetwork}
					onChange={(value) => onChangeSetting('showDefaultNetwork', value)}
				/>
				<Toggle
					label="Highlight"
					checked={settings.highlightDependencies}
					onChange={(value) => onChangeSetting('highlightDependencies', value)}
				/>
				<Toggle
					label="Minimap"
					checked={settings.showMinimap}
					onChange={(value) => onChangeSetting('showMinimap', value)}
				/>

				<div className="ds-toolbar__buttons">
					<button type="button" className="ds-button" onClick={onRefresh} title="Refresh diagram">
						⟳ Refresh
					</button>
					<button type="button" className="ds-button" onClick={onFit} title="Fit graph to screen">
						⤢ Fit
					</button>
					<button
						type="button"
						className="ds-button"
						onClick={onResetLayout}
						title="Recompute the automatic layout"
					>
						↺ Reset layout
					</button>
					<button
						type="button"
						className="ds-button"
						onClick={() => onExport('png')}
						title="Export the diagram as a PNG image"
					>
						⤓ PNG
					</button>
					<button
						type="button"
						className="ds-button"
						onClick={() => onExport('svg')}
						title="Export the diagram as an SVG image"
					>
						⤓ SVG
					</button>
					<button
						type="button"
						className={
							errorCount > 0
								? 'ds-button ds-button--danger'
								: warningCount > 0
									? 'ds-button ds-button--warning'
									: 'ds-button'
						}
						onClick={onToggleDiagnostics}
						aria-expanded={diagnosticsOpen}
						title="Show parsing problems"
					>
						{errorCount > 0 ? '⛔' : warningCount > 0 ? '⚠' : '✓'} {errorCount + warningCount}{' '}
						problem{errorCount + warningCount === 1 ? '' : 's'}
					</button>
				</div>
			</div>
		</header>
	);
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
	return (
		<span className="ds-stat">
			<strong>{value}</strong> {label}
		</span>
	);
}

function Toggle({
	label,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	checked: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
}): JSX.Element {
	return (
		<label className={disabled ? 'ds-toggle is-disabled' : 'ds-toggle'}>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span>{label}</span>
		</label>
	);
}
