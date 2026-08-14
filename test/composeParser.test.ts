import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCompose, parsePort, parseVolumeMount, splitMountString } from '../src/parser/composeParser';
import type { ComposeService } from '../src/parser/composeTypes';

const SPEC_EXAMPLE = `
services:
  api:
    image: my-api:latest
    ports:
      - "8080:8080"
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16

  redis:
    image: redis:7
`;

function serviceNamed(services: ComposeService[], name: string): ComposeService {
	const found = services.find((service) => service.name === name);
	assert.ok(found, `expected a service named ${name}`);
	return found;
}

describe('ComposeParser', () => {
	it('parses the example from the specification', () => {
		const result = parseCompose(SPEC_EXAMPLE, { filePath: '/tmp/docker-compose.yml' });

		assert.equal(result.ok, true);
		assert.ok(result.project);
		assert.deepEqual(
			result.project.services.map((service) => service.name),
			['api', 'postgres', 'redis'],
		);

		const api = serviceNamed(result.project.services, 'api');
		assert.equal(api.image, 'my-api:latest');
		assert.deepEqual(
			api.dependsOn.map((dependency) => dependency.service),
			['postgres', 'redis'],
		);
		assert.equal(api.ports[0].hostPort, '8080');
		assert.equal(api.ports[0].containerPort, '8080');
		assert.equal(api.ports[0].display, '8080 → 8080');
	});

	it('attaches services without an explicit network to the implicit default one', () => {
		const result = parseCompose(SPEC_EXAMPLE);
		const defaultNetwork = result.project?.networks.find((network) => network.name === 'default');
		assert.ok(defaultNetwork);
		assert.equal(defaultNetwork.implicit, true);
		assert.deepEqual(defaultNetwork.services, ['api', 'postgres', 'redis']);
	});

	it('reports invalid YAML with a line and a column', () => {
		const result = parseCompose('services:\n  api:\n   image: "unterminated\n');
		assert.equal(result.ok, false);
		assert.equal(result.project, undefined);
		const error = result.diagnostics.find((diagnostic) => diagnostic.code === 'yaml-syntax');
		assert.ok(error);
		assert.ok(error.location);
		assert.ok(error.location.line >= 1);
		assert.ok(error.location.column >= 1);
	});

	it('reports a missing services section instead of throwing', () => {
		const result = parseCompose('networks:\n  backend:\n');
		assert.equal(result.ok, false);
		assert.ok(result.project);
		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'missing-services'));
	});

	it('reports depends_on entries that point at unknown services', () => {
		const result = parseCompose(`
services:
  api:
    image: api
    depends_on:
      - ghost
`);
		const diagnostic = result.diagnostics.find(
			(candidate) => candidate.code === 'unknown-dependency',
		);
		assert.ok(diagnostic);
		assert.equal(diagnostic.severity, 'error');
		assert.ok(diagnostic.location, 'the diagnostic should carry a position');
		assert.equal(result.project?.services[0].dependsOn[0].dangling, true);
	});

	it('reports undeclared networks and volumes but still models them', () => {
		const result = parseCompose(`
services:
  db:
    image: postgres:16
    networks: [backend]
    volumes:
      - db-data:/var/lib/postgresql/data
`);

		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'undeclared-network'));
		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'undeclared-volume'));
		assert.equal(result.project?.networks.find((network) => network.name === 'backend')?.implicit, true);
		assert.equal(result.project?.volumes.find((volume) => volume.name === 'db-data')?.implicit, true);
	});

	it('understands the long depends_on syntax and its conditions', () => {
		const result = parseCompose(`
services:
  api:
    image: api
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: nonsense
  db:
    image: postgres
  cache:
    image: redis
`);

		const api = serviceNamed(result.project!.services, 'api');
		assert.equal(api.dependsOn[0].condition, 'service_healthy');
		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-condition'));
	});

	it('detects circular dependencies', () => {
		const result = parseCompose(`
services:
  a:
    image: a
    depends_on: [b]
  b:
    image: b
    depends_on: [a]
`);
		const cycle = result.diagnostics.find((diagnostic) =>
			diagnostic.message.startsWith('Circular dependency'),
		);
		assert.ok(cycle);
	});

	it('flags duplicate container names and services with no image or build', () => {
		const result = parseCompose(`
services:
  a:
    image: a
    container_name: same
  b:
    container_name: same
`);
		assert.ok(result.diagnostics.some((d) => d.code === 'duplicate-container-name'));
		assert.ok(result.diagnostics.some((d) => d.code === 'service-without-image-or-build'));
	});

	it('normalizes environment, labels and build in every allowed shape', () => {
		const result = parseCompose(`
services:
  a:
    build: ./a
    environment:
      - FOO=bar
      - BARE
    labels:
      team: platform
  b:
    build:
      context: ./b
      dockerfile: Dockerfile.dev
      target: dev
      args:
        VERSION: "1.2"
    environment:
      FOO: bar
`);
		const a = serviceNamed(result.project!.services, 'a');
		assert.deepEqual(a.environment, [
			{ key: 'FOO', value: 'bar' },
			{ key: 'BARE', value: null },
		]);
		assert.deepEqual(a.labels, [{ key: 'team', value: 'platform' }]);
		assert.equal(a.build?.context, './a');

		const b = serviceNamed(result.project!.services, 'b');
		assert.equal(b.build?.dockerfile, 'Dockerfile.dev');
		assert.equal(b.build?.target, 'dev');
		assert.deepEqual(b.build?.args, [{ key: 'VERSION', value: '1.2' }]);
		assert.deepEqual(b.environment, [{ key: 'FOO', value: 'bar' }]);
	});

	it('parses healthchecks in both shapes', () => {
		const result = parseCompose(`
services:
  a:
    image: a
    healthcheck:
      test: curl -f http://localhost/
      interval: 10s
      retries: 3
  b:
    image: b
    healthcheck:
      disable: true
`);
		const a = serviceNamed(result.project!.services, 'a');
		assert.deepEqual(a.healthcheck?.test, ['CMD-SHELL', 'curl -f http://localhost/']);
		assert.equal(a.healthcheck?.retries, 3);
		assert.equal(serviceNamed(result.project!.services, 'b').healthcheck?.disabled, true);
	});

	it('interpolates variables using the supplied map', () => {
		const result = parseCompose(
			`
services:
  db:
    image: postgres:\${PG_TAG:-16}
    environment:
      PASSWORD: \${PG_PASSWORD}
`,
			{ variables: { PG_PASSWORD: 's3cret' } },
		);

		const db = serviceNamed(result.project!.services, 'db');
		assert.equal(db.image, 'postgres:16');
		assert.deepEqual(db.environment, [{ key: 'PASSWORD', value: 's3cret' }]);
	});

	it('marks the obsolete version key without failing', () => {
		const result = parseCompose('version: "3.8"\nservices:\n  a:\n    image: a\n');
		assert.equal(result.ok, true);
		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'obsolete-version'));
	});

	it('never throws on structurally hostile input', () => {
		for (const input of ['[]', '- 1\n- 2', 'services: 5', 'services:\n  api: 5', '"just a string"']) {
			const result = parseCompose(input);
			assert.equal(typeof result.ok, 'boolean');
		}
	});
});

describe('parsePort', () => {
	it('handles every short-syntax shape', () => {
		assert.deepEqual(parsePort('3000')?.containerPort, '3000');
		assert.deepEqual(parsePort(3000)?.containerPort, '3000');
		assert.deepEqual(parsePort('8080:80')?.hostPort, '8080');
		assert.deepEqual(parsePort('127.0.0.1:8001:8001')?.hostIp, '127.0.0.1');
		assert.deepEqual(parsePort('6060:6060/udp')?.protocol, 'udp');
		assert.deepEqual(parsePort('8000-9000:80')?.hostPort, '8000-9000');
		assert.equal(parsePort('127.0.0.1::5000')?.hostPort, undefined);
	});

	it('handles the long syntax', () => {
		const port = parsePort({ target: 80, published: '8080', protocol: 'tcp', mode: 'host' });
		assert.equal(port?.containerPort, '80');
		assert.equal(port?.hostPort, '8080');
		assert.equal(port?.mode, 'host');
	});

	it('rejects nonsense', () => {
		assert.equal(parsePort('not-a-port:8080'), undefined);
		assert.equal(parsePort(''), undefined);
		assert.equal(parsePort({ published: 8080 }), undefined);
	});
});

describe('parseVolumeMount', () => {
	it('separates named volumes from bind mounts', () => {
		const named = parseVolumeMount('db-data:/var/lib/postgresql/data');
		assert.equal(named?.isNamedVolume, true);
		assert.equal(named?.type, 'volume');

		const bind = parseVolumeMount('./api:/app');
		assert.equal(bind?.isNamedVolume, false);
		assert.equal(bind?.type, 'bind');
	});

	it('handles read-only flags and anonymous volumes', () => {
		assert.equal(parseVolumeMount('./nginx.conf:/etc/nginx/nginx.conf:ro')?.readOnly, true);
		const anonymous = parseVolumeMount('/var/lib/mysql');
		assert.equal(anonymous?.source, undefined);
		assert.equal(anonymous?.target, '/var/lib/mysql');
	});

	it('keeps Windows drive letters intact', () => {
		assert.deepEqual(splitMountString('C:\\data:/app:ro'), ['C:\\data', '/app', 'ro']);
		assert.equal(parseVolumeMount('C:\\data:/app')?.source, 'C:\\data');
	});

	it('handles the long syntax', () => {
		const mount = parseVolumeMount({
			type: 'volume',
			source: 'db-data',
			target: '/data',
			read_only: true,
		});
		assert.equal(mount?.isNamedVolume, true);
		assert.equal(mount?.readOnly, true);
	});

	it('rejects entries without an absolute target', () => {
		assert.equal(parseVolumeMount('just-a-name'), undefined);
		assert.equal(parseVolumeMount(42), undefined);
	});
});
