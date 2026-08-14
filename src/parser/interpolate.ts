/**
 * Compose variable interpolation (`${VARIABLE}` and friends).
 *
 * Supports the full shell-style syntax the Compose specification defines:
 *
 *   $VAR  ${VAR}  ${VAR:-default}  ${VAR-default}
 *   ${VAR:?error}  ${VAR?error}    ${VAR:+alt}  ${VAR+alt}
 *   $$    (escaped literal dollar sign)
 *
 * Defaults may themselves contain variables, so the scanner is recursive.
 */

export interface InterpolationIssue {
	severity: 'error' | 'warning';
	variable: string;
	message: string;
}

export type VariableMap = Record<string, string | undefined>;

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

/** Substitutes variables in a single string. */
export function interpolateString(
	input: string,
	variables: VariableMap,
	issues: InterpolationIssue[] = [],
): string {
	let out = '';
	let i = 0;

	while (i < input.length) {
		const char = input[i];

		if (char !== '$') {
			out += char;
			i += 1;
			continue;
		}

		const next = input[i + 1];

		// `$$` escapes a literal dollar sign.
		if (next === '$') {
			out += '$';
			i += 2;
			continue;
		}

		if (next === '{') {
			const end = findClosingBrace(input, i + 2);
			if (end === -1) {
				// Unbalanced braces: emit the rest verbatim rather than throwing.
				out += input.slice(i);
				break;
			}
			out += resolveExpression(input.slice(i + 2, end), variables, issues);
			i = end + 1;
			continue;
		}

		if (next && NAME_START.test(next)) {
			let j = i + 1;
			while (j < input.length && NAME_CHAR.test(input[j])) {
				j += 1;
			}
			const name = input.slice(i + 1, j);
			out += variables[name] ?? '';
			if (variables[name] === undefined) {
				issues.push({
					severity: 'warning',
					variable: name,
					message: `Variable "${name}" is not set; it resolves to an empty string.`,
				});
			}
			i = j;
			continue;
		}

		// A lone `$` that starts nothing meaningful.
		out += char;
		i += 1;
	}

	return out;
}

/** Finds the `}` matching a `${` that opened at `start - 2`, honouring nesting. */
function findClosingBrace(input: string, start: number): number {
	let depth = 1;
	for (let i = start; i < input.length; i += 1) {
		if (input[i] === '$' && input[i + 1] === '{') {
			depth += 1;
			i += 1;
		} else if (input[i] === '}') {
			depth -= 1;
			if (depth === 0) {
				return i;
			}
		}
	}
	return -1;
}

/** Resolves the inside of a `${...}` expression. */
function resolveExpression(
	expression: string,
	variables: VariableMap,
	issues: InterpolationIssue[],
): string {
	let i = 0;
	while (i < expression.length && NAME_CHAR.test(expression[i])) {
		i += 1;
	}

	const name = expression.slice(0, i);
	const rest = expression.slice(i);

	if (!name) {
		issues.push({
			severity: 'warning',
			variable: expression,
			message: `"\${${expression}}" is not a valid variable reference.`,
		});
		return '';
	}

	const value = variables[name];
	const isSet = value !== undefined;
	const isNonEmpty = isSet && value !== '';

	if (rest === '') {
		if (!isSet) {
			issues.push({
				severity: 'warning',
				variable: name,
				message: `Variable "${name}" is not set; it resolves to an empty string.`,
			});
		}
		return value ?? '';
	}

	const colon = rest.startsWith(':');
	const operator = colon ? rest[1] : rest[0];
	const argument = rest.slice(colon ? 2 : 1);
	const satisfied = colon ? isNonEmpty : isSet;

	switch (operator) {
		case '-':
			return satisfied ? (value as string) : interpolateString(argument, variables, issues);
		case '+':
			return satisfied ? interpolateString(argument, variables, issues) : '';
		case '?': {
			if (satisfied) {
				return value as string;
			}
			const detail = interpolateString(argument, variables, issues);
			issues.push({
				severity: 'error',
				variable: name,
				message: detail
					? `Required variable "${name}" is not set: ${detail}`
					: `Required variable "${name}" is not set.`,
			});
			return '';
		}
		default:
			issues.push({
				severity: 'warning',
				variable: name,
				message: `Unsupported substitution syntax "\${${expression}}".`,
			});
			return value ?? '';
	}
}

/** Recursively substitutes variables in every string of a parsed YAML tree. */
export function interpolateTree<T>(
	value: T,
	variables: VariableMap,
	issues: InterpolationIssue[] = [],
): T {
	if (typeof value === 'string') {
		return interpolateString(value, variables, issues) as unknown as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => interpolateTree(item, variables, issues)) as unknown as T;
	}
	if (value && typeof value === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			result[interpolateString(key, variables, issues)] = interpolateTree(item, variables, issues);
		}
		return result as unknown as T;
	}
	return value;
}

/**
 * Parses a `.env` file the way Compose does: `KEY=VALUE` lines, `#` comments,
 * optional `export` prefix and optional single/double quotes around the value.
 */
export function parseEnvFile(content: string): Record<string, string> {
	const result: Record<string, string> = {};

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
		const separator = withoutExport.indexOf('=');
		if (separator === -1) {
			continue;
		}

		const key = withoutExport.slice(0, separator).trim();
		if (!key) {
			continue;
		}

		let value = withoutExport.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
			(value.startsWith("'") && value.endsWith("'") && value.length > 1)
		) {
			const quote = value[0];
			value = value.slice(1, -1);
			if (quote === '"') {
				value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
			}
		} else {
			// Strip trailing inline comments from unquoted values.
			const comment = value.indexOf(' #');
			if (comment !== -1) {
				value = value.slice(0, comment).trim();
			}
		}

		result[key] = value;
	}

	return result;
}
