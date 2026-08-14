import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	CANONICAL_COMPOSE_FILENAMES,
	compareComposeCandidates,
	isCanonicalComposeFileName,
	isComposeFile,
} from '../src/parser/composeDetector';

describe('isComposeFile', () => {
	it('accepts the four canonical file names required by the spec', () => {
		for (const name of CANONICAL_COMPOSE_FILENAMES) {
			assert.equal(isComposeFile(name), true, name);
			assert.equal(isCanonicalComposeFileName(name), true, name);
		}
	});

	it('accepts full paths on both path styles', () => {
		assert.equal(isComposeFile('/home/dev/project/docker-compose.yml'), true);
		assert.equal(isComposeFile('C:\\work\\project\\compose.yaml'), true);
	});

	it('accepts the usual override and environment variants', () => {
		assert.equal(isComposeFile('docker-compose.override.yml'), true);
		assert.equal(isComposeFile('compose.prod.yaml'), true);
		assert.equal(isComposeFile('docker-compose-test.yml'), true);
		assert.equal(isCanonicalComposeFileName('docker-compose.override.yml'), false);
	});

	it('rejects unrelated YAML files', () => {
		assert.equal(isComposeFile('deployment.yaml'), false);
		assert.equal(isComposeFile('compose.json'), false);
		assert.equal(isComposeFile('my-compose.yml'), false);
		assert.equal(isComposeFile('README.md'), false);
	});

	it('sorts canonical, shallow paths first', () => {
		const sorted = [
			'services/api/docker-compose.override.yml',
			'compose.yaml',
			'docker-compose.yml',
		].sort(compareComposeCandidates);
		assert.deepEqual(sorted, [
			'compose.yaml',
			'docker-compose.yml',
			'services/api/docker-compose.override.yml',
		]);
	});
});
