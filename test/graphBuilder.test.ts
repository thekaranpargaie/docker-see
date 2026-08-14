import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGraph } from '../src/graph/graphBuilder';
import { parseCompose } from '../src/parser/composeParser';
import { pickServiceIcon } from '../src/graph/serviceIcons';

function graphFor(yaml: string) {
	const result = parseCompose(yaml, { filePath: '/tmp/docker-compose.yml' });
	assert.ok(result.project);
	return buildGraph(result.project);
}

describe('GraphBuilder', () => {
	const graph = graphFor(`
services:
  api:
    image: my-api:latest
    ports:
      - "8080:8080"
    depends_on:
      - postgres
      - redis
    networks: [backend]
    volumes:
      - ./api:/app

  postgres:
    image: postgres:16
    networks: [backend]
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7
    networks: [backend]

networks:
  backend:

volumes:
  postgres-data:
`);

	it('creates one node per service', () => {
		const services = graph.nodes.filter((node) => node.kind === 'service');
		assert.deepEqual(
			services.map((node) => node.label).sort(),
			['api', 'postgres', 'redis'],
		);
		assert.equal(graph.stats.services, 3);
	});

	it('creates dependency edges from depends_on', () => {
		const dependencies = graph.edges.filter((edge) => edge.kind === 'depends_on');
		assert.deepEqual(
			dependencies.map((edge) => `${edge.source}->${edge.target}`).sort(),
			['service:api->service:postgres', 'service:api->service:redis'],
		);
	});

	it('creates network and volume nodes with their edges', () => {
		assert.ok(graph.nodes.some((node) => node.id === 'network:backend'));
		assert.ok(graph.nodes.some((node) => node.id === 'volume:postgres-data'));
		assert.ok(graph.nodes.some((node) => node.id === 'bind:./api'));

		assert.equal(graph.edges.filter((edge) => edge.kind === 'network').length, 3);
		assert.deepEqual(
			graph.edges
				.filter((edge) => edge.kind === 'volume')
				.map((edge) => edge.target)
				.sort(),
			['bind:./api', 'volume:postgres-data'],
		);
	});

	it('shows headline information on the service node', () => {
		const api = graph.nodes.find((node) => node.id === 'service:api');
		assert.equal(api?.subtitle, 'my-api:latest');
		assert.deepEqual(api?.ports, ['8080 → 8080']);
		assert.equal(graph.stats.ports, 1);
	});

	it('renders services referenced by depends_on but never defined', () => {
		const broken = graphFor(`
services:
  api:
    image: api
    depends_on: [ghost]
`);
		const ghost = broken.nodes.find((node) => node.id === 'service:ghost');
		assert.ok(ghost);
		assert.equal(ghost.implicit, true);
		assert.equal(broken.edges[0].dangling, true);
	});

	it('does not duplicate an edge declared through both depends_on and links', () => {
		const graphWithLinks = graphFor(`
services:
  api:
    image: api
    depends_on: [db]
    links: [db]
  db:
    image: postgres
`);
		assert.equal(graphWithLinks.edges.filter((edge) => edge.target === 'service:db' && edge.kind !== 'network').length, 1);
	});
});

describe('pickServiceIcon', () => {
	it('picks an icon from the image, then the service name', () => {
		assert.equal(pickServiceIcon('db', 'postgres:16'), '🐘');
		assert.equal(pickServiceIcon('cache', 'redis:7'), '🧠');
		assert.equal(pickServiceIcon('api', undefined), '⚙️');
		assert.equal(pickServiceIcon('anything', 'some/unknown-image'), '🐳');
	});
});
