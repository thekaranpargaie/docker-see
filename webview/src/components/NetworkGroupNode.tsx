import type { NodeProps } from '@xyflow/react';
import { classNames, type GroupData } from './nodeData';

/**
 * Translucent box drawn behind every service attached to a network
 * (spec §11, "visual containers/groups" option).
 */
export function NetworkGroupNode({ data }: NodeProps): JSX.Element {
	const { label, colorIndex, dimmed } = data as unknown as GroupData;

	return (
		<div
			className={classNames('ds-group', dimmed && 'is-dimmed')}
			data-color={colorIndex % 6}
			aria-hidden="true"
		>
			<span className="ds-group__label">🕸️ {label}</span>
		</div>
	);
}
