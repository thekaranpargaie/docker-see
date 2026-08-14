/** Mirrors the id scheme used by the extension's GraphBuilder. */
export const nodeIdFor = {
	service: (name: string) => `service:${name}`,
	network: (name: string) => `network:${name}`,
	volume: (name: string) => `volume:${name}`,
	bind: (source: string) => `bind:${source}`,
};
