const path = require('path');
const fs = require('fs');

const SVG_INPUT = path.join(__dirname, '..', 'icons', 'sixteencloud_logo_light.svg');
const SVG_DARK = path.join(__dirname, '..', 'icons', 'sixteencloud_logo_dark.svg');
const ICONS_DIR = path.join(__dirname, '..', 'assets', 'icons');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function requiredFiles() {
  const iconFiles = SIZES.map(size => path.join(ICONS_DIR, `icon-${size}.png`));
  return [
    ...iconFiles,
    path.join(ICONS_DIR, 'icon.png'),
    path.join(ICONS_DIR, 'icon.ico'),
    path.join(ASSETS_DIR, 'installer-header.bmp'),
  ];
}

function hasPrebuiltIcons() {
  return requiredFiles().every(file => fs.existsSync(file));
}

async function main() {
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    if (hasPrebuiltIcons()) {
      console.warn('[generate-icons] sharp is unavailable on this runtime. Using existing prebuilt icons.');
      return;
    }
    throw new Error(`sharp is unavailable and required icon assets are missing: ${err.message}`);
  }

  const svgBuffer = fs.readFileSync(SVG_INPUT);

  // Generate PNGs
  for (const size of SIZES) {
    const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
    console.log(`Generated ${outPath}`);
  }

  // Copy 256px as icon.png (used at runtime)
  fs.copyFileSync(
    path.join(ICONS_DIR, 'icon-256.png'),
    path.join(ICONS_DIR, 'icon.png')
  );
  console.log('Copied icon.png');

  // Generate NSIS installer header BMP (150x57) from dark logo
  try {
    const darkSvg = fs.readFileSync(SVG_DARK);
    const headerPath = path.join(ASSETS_DIR, 'installer-header.bmp');
    const W = 150, H = 57;
    const { data } = await sharp(darkSvg)
      .resize(W, H, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Build BMP file manually (24-bit, bottom-up)
    const rowSize = Math.ceil(W * 3 / 4) * 4; // rows padded to 4-byte boundary
    const pixelDataSize = rowSize * H;
    const fileSize = 54 + pixelDataSize;
    const bmp = Buffer.alloc(fileSize);

    // BMP Header (14 bytes)
    bmp.write('BM', 0);
    bmp.writeUInt32LE(fileSize, 2);
    bmp.writeUInt32LE(54, 10); // pixel data offset

    // DIB Header (40 bytes)
    bmp.writeUInt32LE(40, 14); // header size
    bmp.writeInt32LE(W, 18);
    bmp.writeInt32LE(H, 22);
    bmp.writeUInt16LE(1, 26); // planes
    bmp.writeUInt16LE(24, 28); // bits per pixel
    bmp.writeUInt32LE(pixelDataSize, 34);

    // Pixel data (bottom-up, BGR)
    for (let y = 0; y < H; y++) {
      const srcRow = (H - 1 - y) * W * 3; // flip vertically
      const dstRow = 54 + y * rowSize;
      for (let x = 0; x < W; x++) {
        const si = srcRow + x * 3;
        const di = dstRow + x * 3;
        bmp[di] = data[si + 2];     // B
        bmp[di + 1] = data[si + 1]; // G
        bmp[di + 2] = data[si];     // R
      }
    }

    fs.writeFileSync(headerPath, bmp);
    console.log(`Generated ${headerPath}`);
  } catch (err) {
    console.error('Failed to generate installer header BMP:', err.message);
  }

  // Generate ICO from multiple sizes using png-to-ico
  try {
    const pngToIco = require('png-to-ico');
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const pngBuffers = icoSizes.map(s =>
      fs.readFileSync(path.join(ICONS_DIR, `icon-${s}.png`))
    );
    const icoBuffer = await pngToIco(pngBuffers);
    const icoPath = path.join(ICONS_DIR, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`Generated ${icoPath}`);
  } catch (err) {
    console.error('Failed to generate ICO:', err.message);
    console.log('Install png-to-ico: npm install --save-dev png-to-ico');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
