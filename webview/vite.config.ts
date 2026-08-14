import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The bundle is loaded by the extension as a plain <script nonce="..."> tag, so
// it is emitted as a single self-executing file with stable names.
export default defineConfig({
	plugins: [react()],
	build: {
		outDir: '../dist/webview',
		emptyOutDir: true,
		target: 'es2020',
		cssCodeSplit: false,
		modulePreload: false,
		sourcemap: false,
		reportCompressedSize: false,
		rollupOptions: {
			output: {
				format: 'iife',
				inlineDynamicImports: true,
				entryFileNames: 'main.js',
				assetFileNames: 'main.[ext]',
			},
		},
	},
});
