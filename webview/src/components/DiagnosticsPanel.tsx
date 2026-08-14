import type { ComposeDiagnostic, SourceLocation } from '../../../src/parser/composeTypes';

interface DiagnosticsPanelProps {
	diagnostics: ComposeDiagnostic[];
	onReveal: (location: SourceLocation) => void;
	onClose: () => void;
}

const ICONS: Record<ComposeDiagnostic['severity'], string> = {
	error: '⛔',
	warning: '⚠',
	info: 'ℹ',
};

/** Bottom drawer listing everything the parser reported (spec §16). */
export function DiagnosticsPanel({
	diagnostics,
	onReveal,
	onClose,
}: DiagnosticsPanelProps): JSX.Element {
	const order = { error: 0, warning: 1, info: 2 } as const;
	const sorted = [...diagnostics].sort((a, b) => order[a.severity] - order[b.severity]);

	return (
		<section className="ds-diagnostics">
			<header className="ds-diagnostics__header">
				<h2>Problems ({diagnostics.length})</h2>
				<button type="button" className="ds-icon-button" onClick={onClose} title="Hide problems">
					✕
				</button>
			</header>

			{sorted.length === 0 ? (
				<p className="ds-diagnostics__empty">No problems found in this Compose file.</p>
			) : (
				<ul className="ds-diagnostics__list">
					{sorted.map((diagnostic, index) => (
						<li
							key={`${diagnostic.code}-${index}`}
							className={`ds-diagnostic is-${diagnostic.severity}`}
						>
							<span className="ds-diagnostic__icon" aria-hidden="true">
								{ICONS[diagnostic.severity]}
							</span>
							<div className="ds-diagnostic__body">
								<p className="ds-diagnostic__message">{diagnostic.message}</p>
								{diagnostic.hint && <p className="ds-diagnostic__hint">{diagnostic.hint}</p>}
								<p className="ds-diagnostic__meta">
									{diagnostic.location ? (
										<button
											type="button"
											className="ds-link"
											onClick={() => onReveal(diagnostic.location as SourceLocation)}
										>
											Line {diagnostic.location.line}, Column {diagnostic.location.column}
										</button>
									) : (
										<span className="ds-muted">No position</span>
									)}
									{diagnostic.path && <span className="ds-muted"> · {diagnostic.path}</span>}
									<span className="ds-muted"> · {diagnostic.code}</span>
								</p>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
