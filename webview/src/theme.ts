import { useEffect, useState } from 'react';

export interface ThemeColors {
	dependency: string;
	link: string;
	network: string;
	volume: string;
	background: string;
	danger: string;
}

const VARIABLES: Record<keyof ThemeColors, [string, string]> = {
	dependency: ['--ds-edge-dependency', '#4f9cf9'],
	link: ['--ds-edge-link', '#4f9cf9'],
	network: ['--ds-edge-network', '#b180d7'],
	volume: ['--ds-edge-volume', '#d18616'],
	background: ['--ds-canvas-background', '#1e1e1e'],
	danger: ['--ds-danger', '#f14c4c'],
};

function readColors(): ThemeColors {
	const styles = getComputedStyle(document.documentElement);
	const resolve = (name: string, fallback: string): string => {
		const value = styles.getPropertyValue(name).trim();
		return value.length > 0 ? value : fallback;
	};
	return Object.fromEntries(
		Object.entries(VARIABLES).map(([key, [name, fallback]]) => [key, resolve(name, fallback)]),
	) as unknown as ThemeColors;
}

/**
 * React Flow needs concrete colours for SVG markers, so the resolved values are
 * read from CSS and refreshed whenever VS Code switches theme.
 */
export function useThemeColors(): ThemeColors {
	const [colors, setColors] = useState<ThemeColors>(() => readColors());

	useEffect(() => {
		const update = (): void => setColors(readColors());
		const observer = new MutationObserver(update);
		observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
		return () => observer.disconnect();
	}, []);

	return colors;
}
