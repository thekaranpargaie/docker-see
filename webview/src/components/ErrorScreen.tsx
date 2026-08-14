import type { ParseFailurePayload } from '../../../src/webview/messages';
import type { SourceLocation } from '../../../src/parser/composeTypes';

interface ErrorScreenProps {
	failure: ParseFailurePayload;
	onRetry: () => void;
	onReveal: (location: SourceLocation) => void;
}

/**
 * Full-screen fallback shown when the file cannot be parsed at all (spec §16).
 * The extension never crashes — it always ends up here instead.
 */
export function ErrorScreen({ failure, onRetry, onReveal }: ErrorScreenProps): JSX.Element {
	const first = failure.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
	const location = first?.location;

	return (
		<div className="ds-error-screen">
			<div className="ds-error-card">
				<h1 className="ds-error-card__brand">DockerSee</h1>
				<p className="ds-error-card__headline">Unable to parse Compose file.</p>
				<p className="ds-error-card__file">{failure.fileName}</p>

				{location && (
					<dl className="ds-error-card__position">
						<div>
							<dt>Line</dt>
							<dd>{location.line}</dd>
						</div>
						<div>
							<dt>Column</dt>
							<dd>{location.column}</dd>
						</div>
					</dl>
				)}

				<p className="ds-error-card__message">{first?.message ?? failure.message}</p>
				{first?.hint && <p className="ds-error-card__hint">{first.hint}</p>}

				<div className="ds-error-card__actions">
					{location && (
						<button type="button" className="ds-button" onClick={() => onReveal(location)}>
							Go to problem
						</button>
					)}
					<button type="button" className="ds-button ds-button--primary" onClick={onRetry}>
						Try again
					</button>
				</div>

				{failure.diagnostics.length > 1 && (
					<ul className="ds-error-card__list">
						{failure.diagnostics.slice(1).map((diagnostic, index) => (
							<li key={index}>
								{diagnostic.message}
								{diagnostic.location && (
									<span className="ds-muted">
										{' '}
										(line {diagnostic.location.line}, column {diagnostic.location.column})
									</span>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
