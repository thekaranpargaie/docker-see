interface LegendProps {
	showNetworks: boolean;
	showVolumes: boolean;
}

/** Small key explaining the edge and node colours. */
export function Legend({ showNetworks, showVolumes }: LegendProps): JSX.Element {
	return (
		<div className="ds-legend">
			<span className="ds-legend__item">
				<i className="ds-legend__swatch ds-legend__swatch--dependency" /> depends_on
			</span>
			{showNetworks && (
				<span className="ds-legend__item">
					<i className="ds-legend__swatch ds-legend__swatch--network" /> network
				</span>
			)}
			{showVolumes && (
				<span className="ds-legend__item">
					<i className="ds-legend__swatch ds-legend__swatch--volume" /> volume
				</span>
			)}
		</div>
	);
}
