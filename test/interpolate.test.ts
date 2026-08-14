import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	interpolateString,
	interpolateTree,
	parseEnvFile,
	type InterpolationIssue,
} from '../src/parser/interpolate';

describe('interpolateString', () => {
	const variables = { NAME: 'api', EMPTY: '', TAG: 'latest' };

	it('substitutes both syntaxes', () => {
		assert.equal(interpolateString('$NAME:${TAG}', variables), 'api:latest');
	});

	it('honours $$ as an escaped dollar sign', () => {
		assert.equal(interpolateString('cost: $$5', variables), 'cost: $5');
	});

	it('applies :- and - defaults with the right empty-string semantics', () => {
		assert.equal(interpolateString('${EMPTY:-fallback}', variables), 'fallback');
		assert.equal(interpolateString('${EMPTY-fallback}', variables), '');
		assert.equal(interpolateString('${MISSING-fallback}', variables), 'fallback');
	});

	it('supports alternate values and nesting', () => {
		assert.equal(interpolateString('${NAME:+set}', variables), 'set');
		assert.equal(interpolateString('${MISSING:-${TAG}}', variables), 'latest');
	});

	it('reports required variables that are not set', () => {
		const issues: InterpolationIssue[] = [];
		assert.equal(interpolateString('${SECRET:?must be provided}', variables, issues), '');
		assert.equal(issues.length, 1);
		assert.equal(issues[0].severity, 'error');
		assert.match(issues[0].message, /must be provided/);
	});

	it('walks nested objects and arrays', () => {
		const result = interpolateTree(
			{ image: 'redis:${TAG}', ports: ['${PORT:-6379}:6379'] },
			variables,
		);
		assert.deepEqual(result, { image: 'redis:latest', ports: ['6379:6379'] });
	});
});

describe('parseEnvFile', () => {
	it('reads KEY=VALUE lines, comments, quotes and export prefixes', () => {
		const env = parseEnvFile(
			[
				'# a comment',
				'',
				'PLAIN=value',
				'export EXPORTED=other',
				'QUOTED="with spaces"',
				"SINGLE='raw $VALUE'",
				'INLINE=value # trailing comment',
				'NOT_A_PAIR',
			].join('\n'),
		);

		assert.deepEqual(env, {
			PLAIN: 'value',
			EXPORTED: 'other',
			QUOTED: 'with spaces',
			SINGLE: 'raw $VALUE',
			INLINE: 'value',
		});
	});
});
