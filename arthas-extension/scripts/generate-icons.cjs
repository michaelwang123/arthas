/**
 * Generate minimal valid PNG icon files for the Chrome extension.
 * Creates solid purple (#7C3AED) square icons at 16x16, 48x48, and 128x128.
 * 
 * PNG format: signature + IHDR + IDAT (zlib-compressed raw scanlines) + IEND
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width, height, bit depth (8), color type (2 = RGB)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);  // width
  ihdrData.writeUInt32BE(size, 4);  // height
  ihdrData.writeUInt8(8, 8);        // bit depth
  ihdrData.writeUInt8(2, 9);        // color type: RGB
  ihdrData.writeUInt8(0, 10);       // compression method
  ihdrData.writeUInt8(0, 11);       // filter method
  ihdrData.writeUInt8(0, 12);       // interlace method
  const ihdr = makeChunk('IHDR', ihdrData);

  // Raw image data: each row starts with filter byte (0 = None), then RGB pixels
  const rowSize = 1 + size * 3; // filter byte + RGB per pixel
  const rawData = Buffer.alloc(rowSize * size);
  
  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const pixelOffset = rowOffset + 1 + x * 3;
      // Create a simple shield-like shape: darker border, lighter center
      const margin = Math.floor(size * 0.15);
      const isEdge = x < margin || x >= size - margin || y < margin || y >= size - margin;
      const isShieldTop = y < size * 0.6;
      const isShieldPoint = y >= size * 0.6 && 
        x >= (size / 2 - (size - y) * 0.6) && 
        x <= (size / 2 + (size - y) * 0.6);
      
      if (isEdge && (isShieldTop || isShieldPoint)) {
        // Border: darker purple
        rawData[pixelOffset] = 91;     // R
        rawData[pixelOffset + 1] = 33; // G
        rawData[pixelOffset + 2] = 182; // B
      } else if (isShieldTop || isShieldPoint) {
        // Fill: brand purple (#7C3AED)
        rawData[pixelOffset] = r;
        rawData[pixelOffset + 1] = g;
        rawData[pixelOffset + 2] = b;
      } else {
        // Transparent area (rendered as dark gray to match extension theme)
        rawData[pixelOffset] = 17;     // R (gray-900 approx)
        rawData[pixelOffset + 1] = 24; // G
        rawData[pixelOffset + 2] = 39; // B
      }
    }
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);

  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcInput);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  // CRC-32 lookup table
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      if (c & 1) {
        c = 0xEDB88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[i] = c;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate icons
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const sizes = [16, 48, 128];
// Arthas brand purple: #7C3AED
const purple = { r: 124, g: 58, b: 237 };

for (const size of sizes) {
  const png = createPNG(size, purple.r, purple.g, purple.b);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Created ${filePath} (${png.length} bytes)`);
}

console.log('Done! All icons generated.');
