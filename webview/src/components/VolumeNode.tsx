import { Handle, type NodeProps } from '@xyflow/react';
import { handlePositions } from '../layout';
import { classNames, type NodeData } from './nodeData';

/** A named volume or bind mount (spec §12). */
export function VolumeNode({ data, selected }: NodeProps): JSX.Element {
	const { graphNode, direction, dimmed, related, match } = data as unknown as NodeData;
	const positions = handlePositions(direction);
	const mounts = graphNode.volume?.mounts.length ?? 0;

	return (
		<div
			className={classNames(
				'ds-node',
				'ds-node--volume',
				graphNode.volumeKind === 'bind' && 'ds-node--bind',
				selected && 'is-selected',
				dimmed && 'is-dimmed',
				related && 'is-related',
				match && 'is-match',
			)}
			title={`Volume ${graphNode.label}`}
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
					{mounts > 0 && ` · ${mounts} mount${mounts === 1 ? '' : 's'}`}
				</div>
			</div>

			<Handle type="source" position={positions.source} className="ds-handle" />
		</div>
	);
}
