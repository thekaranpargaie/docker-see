import { Handle, type NodeProps } from '@xyflow/react';
import { handlePositions } from '../layout';
import { classNames, type NodeData } from './nodeData';

/**
 * A single Compose service (spec §8): glyph, name, image and port mappings.
 * Everything else lives in the details panel.
 */
export function ServiceNode({ data, selected }: NodeProps): JSX.Element {
	const { graphNode, direction, dimmed, related, relation, match, networkBadges } =
		data as unknown as NodeData;
	const positions = handlePositions(direction);

	return (
		<div
			className={classNames(
				'ds-node',
				'ds-node--service',
				selected && 'is-selected',
				dimmed && 'is-dimmed',
				related && 'is-related',
				match && 'is-match',
				relation && `is-${relation}`,
				graphNode.implicit && 'is-missing',
			)}
			title={graphNode.subtitle ? `${graphNode.label} — ${graphNode.subtitle}` : graphNode.label}
		>
			<Handle type="target" position={positions.target} className="ds-handle" />

			<div className="ds-node__header">
				<span className="ds-node__icon" aria-hidden="true">
					{graphNode.icon}
				</span>
				<span className="ds-node__title">{graphNode.label}</span>
			</div>

			<div className="ds-node__body">
				{graphNode.subtitle && <div className="ds-node__subtitle">{graphNode.subtitle}</div>}

				{graphNode.ports.length > 0 && (
					<ul className="ds-node__ports">
						{graphNode.ports.map((port) => (
							<li key={port} className="ds-node__port">
								<span className="ds-node__port-icon" aria-hidden="true">
									⇄
								</span>
								{port}
							</li>
						))}
					</ul>
				)}

				{(graphNode.badges.length > 0 || (networkBadges && networkBadges.length > 0)) && (
					<div className="ds-node__badges">
						{graphNode.badges.map((badge) => (
							<span key={badge} className="ds-badge">
								{badge}
							</span>
						))}
						{networkBadges?.map((badge) => (
							<span key={`net-${badge}`} className="ds-badge ds-badge--network">
								🕸️ {badge}
							</span>
						))}
					</div>
				)}
			</div>

			<Handle type="source" position={positions.source} className="ds-handle" />
		</div>
	);
}
