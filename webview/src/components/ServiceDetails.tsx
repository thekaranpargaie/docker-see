import type { ReactNode } from 'react';
import type { GraphModel, GraphNode } from '../../../src/graph/graphTypes';
import type {
	ComposeKeyValue,
	ComposeService,
	SourceLocation,
} from '../../../src/parser/composeTypes';
import { nodeIdFor } from '../ids';

interface ServiceDetailsProps {
	node: GraphNode | undefined;
	graph: GraphModel;
	onSelect: (id: string) => void;
	onReveal: (location: SourceLocation) => void;
	onClose: () => void;
}

/**
 * Details panel (spec §9). Shows everything DockerSee knows about the selected
 * node; the graph node itself only carries the headline information.
 */
export function ServiceDetails({
	node,
	graph,
	onSelect,
	onReveal,
	onClose,
}: ServiceDetailsProps): JSX.Element {
	if (!node) {
		return (
			<aside className="ds-details ds-details--empty">
				<p className="ds-details__hint">
					Select a service, network or volume in the diagram to inspect it.
				</p>
			</aside>
		);
	}

	return (
		<aside className="ds-details">
			<header className="ds-details__header">
				<span className="ds-details__icon" aria-hidden="true">
					{node.icon}
				</span>
				<div className="ds-details__heading">
					<h2 className="ds-details__title">{node.label}</h2>
					<p className="ds-details__kind">{describeKind(node)}</p>
				</div>
				<div className="ds-details__actions">
					{node.service?.location || node.network?.location || node.volume?.location ? (
						<button
							type="button"
							className="ds-icon-button"
							title="Reveal in the Compose file"
							onClick={() => {
								const location =
									node.service?.location ?? node.network?.location ?? node.volume?.location;
								if (location) {
									onReveal(location);
								}
							}}
						>
							↗
						</button>
					) : null}
					<button type="button" className="ds-icon-button" title="Close panel" onClick={onClose}>
						✕
					</button>
				</div>
			</header>

			<div className="ds-details__scroll">
				{node.kind === 'service' && node.service && (
					<ServiceSections service={node.service} graph={graph} onSelect={onSelect} />
				)}
				{node.kind === 'service' && !node.service && (
					<Section title="Status">
						<p className="ds-details__warning">
							This service is referenced by <code>depends_on</code> but is not defined in the
							Compose file.
						</p>
					</Section>
				)}
				{node.kind === 'network' && node.network && (
					<NetworkSections node={node} onSelect={onSelect} />
				)}
				{node.kind === 'volume' && node.volume && <VolumeSections node={node} onSelect={onSelect} />}
			</div>
		</aside>
	);
}

function ServiceSections({
	service,
	graph,
	onSelect,
}: {
	service: ComposeService;
	graph: GraphModel;
	onSelect: (id: string) => void;
}): JSX.Element {
	const dependents = graph.edges
		.filter(
			(edge) =>
				(edge.kind === 'depends_on' || edge.kind === 'link') &&
				edge.target === nodeIdFor.service(service.name),
		)
		.map((edge) => edge.source.replace(/^service:/, ''));

	return (
		<>
			{service.image && (
				<Section title="Image">
					<code className="ds-code">{service.image}</code>
				</Section>
			)}

			{service.build && (
				<Section title="Build">
					<Field label="Context" value={service.build.context} mono />
					{service.build.dockerfile && (
						<Field label="Dockerfile" value={service.build.dockerfile} mono />
					)}
					{service.build.target && <Field label="Target" value={service.build.target} mono />}
					{service.build.args.length > 0 && (
						<KeyValueList title="Args" entries={service.build.args} />
					)}
					{service.build.cacheFrom.length > 0 && (
						<Field label="Cache from" value={service.build.cacheFrom.join(', ')} mono />
					)}
				</Section>
			)}

			{service.containerName && (
				<Section title="Container name">
					<code className="ds-code">{service.containerName}</code>
				</Section>
			)}

			{service.ports.length > 0 && (
				<Section title="Ports">
					<table className="ds-table">
						<thead>
							<tr>
								<th>Host</th>
								<th aria-label="direction" />
								<th>Container</th>
								<th>Protocol</th>
							</tr>
						</thead>
						<tbody>
							{service.ports.map((port) => (
								<tr key={port.raw + port.containerPort}>
									<td className="ds-mono">
										{port.hostIp ? `${port.hostIp}:` : ''}
										{port.hostPort ?? '(random)'}
									</td>
									<td aria-hidden="true">→</td>
									<td className="ds-mono">{port.containerPort}</td>
									<td>{port.protocol}</td>
								</tr>
							))}
						</tbody>
					</table>
				</Section>
			)}

			{service.expose.length > 0 && (
				<Section title="Exposed (internal only)">
					<div className="ds-chips">
						{service.expose.map((port) => (
							<span key={port} className="ds-chip ds-mono">
								{port}
							</span>
						))}
					</div>
				</Section>
			)}

			{service.dependsOn.length > 0 && (
				<Section title="Depends on">
					<ul className="ds-list">
						{service.dependsOn.map((dependency) => (
							<li key={`${dependency.origin}:${dependency.service}`}>
								<button
									type="button"
									className="ds-link"
									onClick={() => onSelect(nodeIdFor.service(dependency.service))}
								>
									{dependency.service}
								</button>
								{dependency.condition !== 'service_started' && (
									<span className="ds-muted"> · {dependency.condition}</span>
								)}
								{dependency.origin === 'links' && <span className="ds-muted"> · via links</span>}
								{dependency.dangling && <span className="ds-error"> · not defined</span>}
							</li>
						))}
					</ul>
				</Section>
			)}

			{dependents.length > 0 && (
				<Section title="Required by">
					<ul className="ds-list">
						{dependents.map((name) => (
							<li key={name}>
								<button
									type="button"
									className="ds-link"
									onClick={() => onSelect(nodeIdFor.service(name))}
								>
									{name}
								</button>
							</li>
						))}
					</ul>
				</Section>
			)}

			{service.networks.length > 0 && (
				<Section title="Networks">
					<ul className="ds-list">
						{service.networks.map((network) => (
							<li key={network.name}>
								<button
									type="button"
									className="ds-link"
									onClick={() => onSelect(nodeIdFor.network(network.name))}
								>
									{network.name}
								</button>
								{network.aliases.length > 0 && (
									<span className="ds-muted"> · aliases: {network.aliases.join(', ')}</span>
								)}
								{network.ipv4Address && (
									<span className="ds-muted"> · {network.ipv4Address}</span>
								)}
								{network.undeclared && <span className="ds-error"> · not declared</span>}
							</li>
						))}
					</ul>
				</Section>
			)}

			{service.volumes.length > 0 && (
				<Section title="Volumes">
					<ul className="ds-list">
						{service.volumes.map((mount) => (
							<li key={mount.raw + mount.target}>
								{mount.source ? (
									<button
										type="button"
										className="ds-link"
										onClick={() =>
											onSelect(
												mount.isNamedVolume
													? nodeIdFor.volume(mount.source as string)
													: nodeIdFor.bind(mount.source as string),
											)
										}
									>
										{mount.source}
									</button>
								) : (
									<span className="ds-muted">(anonymous)</span>
								)}
								<span className="ds-muted"> → </span>
								<code className="ds-code">{mount.target}</code>
								{mount.readOnly && <span className="ds-muted"> · read-only</span>}
								<span className="ds-muted"> · {mount.type}</span>
							</li>
						))}
					</ul>
				</Section>
			)}

			{service.environment.length > 0 && (
				<Section title="Environment variables">
					<KeyValueList entries={service.environment} />
				</Section>
			)}

			{service.envFiles.length > 0 && (
				<Section title="Env files">
					<div className="ds-chips">
						{service.envFiles.map((file) => (
							<span key={file} className="ds-chip ds-mono">
								{file}
							</span>
						))}
					</div>
				</Section>
			)}

			{service.healthcheck && (
				<Section title="Health check">
					{service.healthcheck.disabled ? (
						<p className="ds-muted">Disabled.</p>
					) : (
						<>
							{service.healthcheck.test && (
								<Field label="Test" value={service.healthcheck.test.join(' ')} mono />
							)}
							{service.healthcheck.interval && (
								<Field label="Interval" value={service.healthcheck.interval} />
							)}
							{service.healthcheck.timeout && (
								<Field label="Timeout" value={service.healthcheck.timeout} />
							)}
							{service.healthcheck.retries !== undefined && (
								<Field label="Retries" value={String(service.healthcheck.retries)} />
							)}
							{service.healthcheck.startPeriod && (
								<Field label="Start period" value={service.healthcheck.startPeriod} />
							)}
						</>
					)}
				</Section>
			)}

			{(service.command || service.entrypoint || service.user || service.workingDir) && (
				<Section title="Runtime">
					{service.entrypoint && <Field label="Entrypoint" value={service.entrypoint} mono />}
					{service.command && <Field label="Command" value={service.command} mono />}
					{service.user && <Field label="User" value={service.user} mono />}
					{service.workingDir && <Field label="Working dir" value={service.workingDir} mono />}
					{service.restart && <Field label="Restart" value={service.restart} />}
				</Section>
			)}

			{service.deploy && (
				<Section title="Deploy">
					{service.deploy.replicas !== undefined && (
						<Field label="Replicas" value={String(service.deploy.replicas)} />
					)}
					{service.deploy.mode && <Field label="Mode" value={service.deploy.mode} />}
					{service.deploy.cpuLimit && <Field label="CPU limit" value={service.deploy.cpuLimit} />}
					{service.deploy.memoryLimit && (
						<Field label="Memory limit" value={service.deploy.memoryLimit} />
					)}
					{service.deploy.cpuReservation && (
						<Field label="CPU reservation" value={service.deploy.cpuReservation} />
					)}
					{service.deploy.memoryReservation && (
						<Field label="Memory reservation" value={service.deploy.memoryReservation} />
					)}
				</Section>
			)}

			{service.profiles.length > 0 && (
				<Section title="Profiles">
					<div className="ds-chips">
						{service.profiles.map((profile) => (
							<span key={profile} className="ds-chip">
								{profile}
							</span>
						))}
					</div>
				</Section>
			)}

			{service.labels.length > 0 && (
				<Section title="Labels">
					<KeyValueList entries={service.labels} />
				</Section>
			)}

			{service.extends && (
				<Section title="Extends">
					<Field label="Service" value={service.extends.service} mono />
					{service.extends.file && <Field label="File" value={service.extends.file} mono />}
					<p className="ds-muted">DockerSee does not resolve inherited configuration.</p>
				</Section>
			)}

			{service.volumesFrom.length > 0 && (
				<Section title="Volumes from">
					<div className="ds-chips">
						{service.volumesFrom.map((entry) => (
							<span key={entry} className="ds-chip ds-mono">
								{entry}
							</span>
						))}
					</div>
				</Section>
			)}

			{service.unsupportedKeys.length > 0 && (
				<Section title="Not visualized">
					<div className="ds-chips">
						{service.unsupportedKeys.map((key) => (
							<span key={key} className="ds-chip ds-chip--muted ds-mono">
								{key}
							</span>
						))}
					</div>
					<p className="ds-muted">
						These keys are valid Compose configuration but do not affect the diagram.
					</p>
				</Section>
			)}
		</>
	);
}

function NetworkSections({
	node,
	onSelect,
}: {
	node: GraphNode;
	onSelect: (id: string) => void;
}): JSX.Element {
	const network = node.network!;
	return (
		<>
			<Section title="Definition">
				{network.dockerName && <Field label="Docker name" value={network.dockerName} mono />}
				<Field label="Driver" value={network.driver ?? 'bridge (default)'} />
				<Field label="External" value={network.external ? 'yes' : 'no'} />
				<Field label="Internal" value={network.internal ? 'yes' : 'no'} />
				{network.attachable && <Field label="Attachable" value="yes" />}
				{network.implicit && (
					<p className="ds-muted">
						{network.isDefault
							? 'Implicit `default` network created by Docker Compose.'
							: 'Referenced by a service but not declared in the top-level `networks` section.'}
					</p>
				)}
			</Section>

			{network.subnets.length > 0 && (
				<Section title="Subnets">
					<div className="ds-chips">
						{network.subnets.map((subnet) => (
							<span key={subnet} className="ds-chip ds-mono">
								{subnet}
							</span>
						))}
					</div>
				</Section>
			)}

			<Section title={`Attached services (${network.services.length})`}>
				{network.services.length === 0 ? (
					<p className="ds-muted">No service is attached to this network.</p>
				) : (
					<ul className="ds-list">
						{network.services.map((name) => (
							<li key={name}>
								<button
									type="button"
									className="ds-link"
									onClick={() => onSelect(nodeIdFor.service(name))}
								>
									{name}
								</button>
							</li>
						))}
					</ul>
				)}
			</Section>

			{network.driverOpts.length > 0 && (
				<Section title="Driver options">
					<KeyValueList entries={network.driverOpts} />
				</Section>
			)}

			{network.labels.length > 0 && (
				<Section title="Labels">
					<KeyValueList entries={network.labels} />
				</Section>
			)}
		</>
	);
}

function VolumeSections({
	node,
	onSelect,
}: {
	node: GraphNode;
	onSelect: (id: string) => void;
}): JSX.Element {
	const volume = node.volume!;
	return (
		<>
			<Section title="Definition">
				<Field label="Type" value={node.volumeKind === 'bind' ? 'bind mount' : 'named volume'} />
				{volume.dockerName && <Field label="Docker name" value={volume.dockerName} mono />}
				{volume.driver && <Field label="Driver" value={volume.driver} />}
				{node.volumeKind !== 'bind' && (
					<Field label="External" value={volume.external ? 'yes' : 'no'} />
				)}
				{volume.implicit && node.volumeKind !== 'bind' && (
					<p className="ds-muted">
						Referenced by a service but not declared in the top-level `volumes` section.
					</p>
				)}
			</Section>

			<Section title={`Mounted by (${volume.mounts.length})`}>
				<ul className="ds-list">
					{volume.mounts.map((mount) => (
						<li key={`${mount.service}:${mount.target}`}>
							<button
								type="button"
								className="ds-link"
								onClick={() => onSelect(nodeIdFor.service(mount.service))}
							>
								{mount.service}
							</button>
							<span className="ds-muted"> → </span>
							<code className="ds-code">{mount.target}</code>
							{mount.readOnly && <span className="ds-muted"> · read-only</span>}
						</li>
					))}
				</ul>
			</Section>

			{volume.driverOpts.length > 0 && (
				<Section title="Driver options">
					<KeyValueList entries={volume.driverOpts} />
				</Section>
			)}

			{volume.labels.length > 0 && (
				<Section title="Labels">
					<KeyValueList entries={volume.labels} />
				</Section>
			)}
		</>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
	return (
		<section className="ds-section">
			<h3 className="ds-section__title">{title}</h3>
			<div className="ds-section__body">{children}</div>
		</section>
	);
}

function Field({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}): JSX.Element {
	return (
		<div className="ds-field">
			<span className="ds-field__label">{label}</span>
			<span className={mono ? 'ds-field__value ds-mono' : 'ds-field__value'}>{value}</span>
		</div>
	);
}

function KeyValueList({
	entries,
	title,
}: {
	entries: ComposeKeyValue[];
	title?: string;
}): JSX.Element {
	return (
		<>
			{title && <p className="ds-subheading">{title}</p>}
			<table className="ds-table ds-table--kv">
				<tbody>
					{entries.map((entry) => (
						<tr key={entry.key}>
							<td className="ds-mono ds-table__key">{entry.key}</td>
							<td className="ds-mono">
								{entry.value === null ? (
									<span className="ds-muted">(from environment)</span>
								) : (
									entry.value
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
}

function describeKind(node: GraphNode): string {
	if (node.kind === 'service') {
		return node.service ? 'Service' : 'Undefined service';
	}
	if (node.kind === 'network') {
		return node.network?.external ? 'External network' : 'Network';
	}
	return node.volumeKind === 'bind' ? 'Bind mount' : 'Volume';
}
