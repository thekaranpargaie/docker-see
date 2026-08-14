import { Handle, type NodeProps } from '@xyflow/react';
import { handlePositions } from '../layout';
import { classNames, type NodeData } from './nodeData';

/** A Compose network rendered as its own node (spec §11, "graph nodes" option). */
export function NetworkNode({ data, selected }: NodeProps): JSX.Element {
	const { graphNode, direction, dimmed, related, match } = data as unknown as NodeData;
	const positions = handlePositions(direction);
	const attached = graphNode.network?.services.length ?? 0;

	return (
		<div
			className={classNames(
				'ds-node',
				'ds-node--network',
				selected && 'is-selected',
				dimmed && 'is-dimmed',
				related && 'is-related',
				match && 'is-match',
			)}
			title={`Network ${graphNode.label}`}
		>
			<Handle type="target" position={positions.target} className="ds-handle" />

			<div className="ds-node__header">
				<span className="ds-node__icon" aria-hidden="true">
					{graphNode.icon}
				</span>
				<span className="ds-node__title">{graphNode.label}</span>
			</div>

			<div className="ds-node__body">
				<div className="ds-node__subtitle">
					{graphNode.subtitle}
					{attached > 0 && ` · ${attached} service${attached === 1 ? '' : 's'}`}
				</div>
				{graphNode.badges.length > 0 && (
					<div className="ds-node__badges">
						{graphNode.badges.map((badge) => (
							<span key={badge} className="ds-badge">
								{badge}
							</span>
						))}
					</div>
				)}
			</div>

			<Handle type="source" position={positions.source} className="ds-handle" />
		</div>
	);
}
