/**
 * Generates `media/icon.png`, the 128×128 marketplace icon.
 *
 * The icon is drawn programmatically (three nodes joined by edges) so the repo
 * does not need to carry a binary asset that nobody can review in a diff.
 *
 * Run with: node scripts/generateIcon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const BACKGROUND = [13, 71, 122, 255];
const NODE = [235, 245, 255, 255];
const EDGE = [125, 190, 240, 255];

const pixels = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, color) {
	if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
		return;
	}
	const offset = (y * SIZE + x) * 4;
	pixels[offset] = color[0];
	pixels[offset + 1] = color[1];
	pixels[offset + 2] = color[2];
	pixels[offset + 3] = color[3];
}

function fillRoundedRect(x, y, width, height, radius, color) {
	for (let row = 0; row < height; row += 1) {
		for (let column = 0; column < width; column += 1) {
			const dx = Math.min(column, width - 1 - column);
			const dy = Math.min(row, height - 1 - row);
			if (dx < radius && dy < radius) {
				const distance = Math.hypot(radius - dx, radius - dy);
				if (distance > radius) {
					continue;
				}
			}
			setPixel(x + column, y + row, color);
		}
	}
}

function drawLine(x1, y1, x2, y2, thickness, color) {
	const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2;
	for (let step = 0; step <= steps; step += 1) {
		const t = steps === 0 ? 0 : step / steps;
		const x = Math.round(x1 + (x2 - x1) * t);
		const y = Math.round(y1 + (y2 - y1) * t);
		const half = Math.floor(thickness / 2);
		for (let dy = -half; dy <= half; dy += 1) {
			for (let dx = -half; dx <= half; dx += 1) {
				setPixel(x + dx, y + dy, color);
			}
		}
	}
}

// Background.
fillRoundedRect(0, 0, SIZE, SIZE, 24, BACKGROUND);

// Edges first so the nodes sit on top of them.
drawLine(64, 44, 64, 68, 5, EDGE);
drawLine(32, 68, 96, 68, 5, EDGE);
drawLine(32, 68, 32, 84, 5, EDGE);
drawLine(96, 68, 96, 84, 5, EDGE);

// Nodes: one parent service and two dependencies.
fillRoundedRect(42, 20, 44, 24, 6, NODE);
fillRoundedRect(12, 84, 40, 24, 6, NODE);
fillRoundedRect(76, 84, 40, 24, 6, NODE);

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);
	return Buffer.concat([length, typeAndData, crc]);
}

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c;
	}
	return table;
})();

function crc32(buffer) {
	let crc = -1;
	for (const byte of buffer) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return crc ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
	raw[y * (SIZE * 4 + 1)] = 0; // no filter
	pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk('IHDR', ihdr),
	chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
	chunk('IEND', Buffer.alloc(0)),
]);

const target = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(target, png);
console.log(`Wrote ${target} (${png.length} bytes)`);
