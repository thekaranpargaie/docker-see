/**
 * Compose file detection (spec §5 / Phase 2).
 *
 * Pure string helpers — no `vscode` and no filesystem access — so they can be
 * unit tested directly.
 */

/** The four file names the Compose CLI picks up automatically. */
export const CANONICAL_COMPOSE_FILENAMES = [
	'docker-compose.yml',
	'docker-compose.yaml',
	'compose.yml',
	'compose.yaml',
] as const;

/**
 * Also matches the conventional variants developers keep next to the canonical
 * files, e.g. `docker-compose.override.yml` or `compose.prod.yaml`.
 */
export const COMPOSE_FILENAME_PATTERN = /^(docker-)?compose([.-][A-Za-z0-9_.-]+)?\.ya?ml$/i;

/** Glob used for workspace scanning and file watching. */
export const COMPOSE_GLOB = '**/{docker-compose,compose}*.{yml,yaml}';

/** Extracts the final path segment of a POSIX or Windows path. */
export function basename(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	const index = normalized.lastIndexOf('/');
	return index === -1 ? normalized : normalized.slice(index + 1);
}

/** True for exactly the four names Compose loads by default. */
export function isCanonicalComposeFileName(fileName: string): boolean {
	const lower = basename(fileName).toLowerCase();
	return (CANONICAL_COMPOSE_FILENAMES as readonly string[]).includes(lower);
}

/** True for canonical names and the usual override/environment variants. */
export function isComposeFileName(fileName: string): boolean {
	return COMPOSE_FILENAME_PATTERN.test(basename(fileName));
}

/**
 * True when the given path looks like a Docker Compose file.
 *
 * The public entry point named in the spec (`isComposeFile()`); accepts a full
 * path, a relative path, or a bare file name.
 */
export function isComposeFile(filePath: string): boolean {
	return isComposeFileName(filePath);
}

/**
 * Ranks candidate Compose files so the canonical ones are offered first, then
 * the shallowest paths, then alphabetically.
 */
export function compareComposeCandidates(a: string, b: string): number {
	const aCanonical = isCanonicalComposeFileName(a) ? 0 : 1;
	const bCanonical = isCanonicalComposeFileName(b) ? 0 : 1;
	if (aCanonical !== bCanonical) {
		return aCanonical - bCanonical;
	}
	const aDepth = a.replace(/\\/g, '/').split('/').length;
	const bDepth = b.replace(/\\/g, '/').split('/').length;
	if (aDepth !== bDepth) {
		return aDepth - bDepth;
	}
	return a.localeCompare(b);
}
