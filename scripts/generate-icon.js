// Generate AntonTron app icon as PNG files for electron-builder
// Uses raw pixel manipulation — no external image libs needed.
// We'll create an SVG and convert via sips (macOS)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const assetsDir = path.join(__dirname, '..', 'assets');

// Create a slick SVG icon: stylized "A" with cyan/purple gradient on dark bg
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a1a"/>
      <stop offset="100%" stop-color="#12122a"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#00e5ff"/>
      <stop offset="100%" stop-color="#b388ff"/>
    </linearGradient>
    <linearGradient id="glow2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#b388ff" stop-opacity="0.6"/>
    </linearGradient>
    <filter id="outerGlow">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    <filter id="softGlow">
      <feGaussianBlur stdDeviation="25" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Background with rounded corners -->
  <rect width="1024" height="1024" rx="220" ry="220" fill="url(#bg)"/>

  <!-- Subtle border -->
  <rect width="1024" height="1024" rx="220" ry="220" fill="none" stroke="#2a2a5a" stroke-width="3"/>

  <!-- Background glow circle -->
  <circle cx="512" cy="480" r="280" fill="#00e5ff" opacity="0.04" filter="url(#softGlow)"/>

  <!-- The "A" letterform — bold, geometric, futuristic -->
  <g filter="url(#outerGlow)">
    <!-- Left leg -->
    <polygon points="320,760 440,760 540,340 460,340" fill="url(#glow)"/>
    <!-- Right leg -->
    <polygon points="704,760 584,760 484,340 564,340" fill="url(#glow)"/>
    <!-- Crossbar -->
    <rect x="380" y="560" width="264" height="64" rx="8" fill="url(#glow)"/>
    <!-- Top peak accent -->
    <polygon points="512,260 540,340 484,340" fill="url(#glow)"/>
  </g>

  <!-- Inner cutout on crossbar for style -->
  <rect x="420" y="576" width="184" height="32" rx="4" fill="#0a0a1a" opacity="0.5"/>

  <!-- Small accent dots -->
  <circle cx="512" cy="850" r="8" fill="#00e5ff" opacity="0.8"/>
  <circle cx="480" cy="850" r="4" fill="#b388ff" opacity="0.6"/>
  <circle cx="544" cy="850" r="4" fill="#b388ff" opacity="0.6"/>
</svg>`;

// Write SVG
const svgPath = path.join(assetsDir, 'icon.svg');
fs.writeFileSync(svgPath, svg);
console.log('Created icon.svg');

// Convert SVG to PNG using sips (macOS) — we need to go through a temp HTML render
// Actually sips doesn't handle SVG. Let's use the qlmanage trick or a simple approach.
// We'll write a quick HTML file and use a headless approach, OR we can use
// Electron itself to render it. Simplest: just ship the SVG and use a node canvas approach.

// Alternative: use the `sips` tool with a pre-rendered PNG.
// Let's generate the PNG from SVG using a tiny inline Electron script.
const electronPath = require('electron');
const renderScript = `
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    webPreferences: { offscreen: true },
    frame: false,
    transparent: true,
  });

  const svgData = fs.readFileSync('${svgPath.replace(/'/g, "\\'")}', 'utf8');
  const html = \`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;}body{background:transparent;}</style></head><body>\${svgData}</body></html>\`;

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // Wait for render
  await new Promise(r => setTimeout(r, 500));

  const image = await win.webContents.capturePage();
  const pngBuffer = image.toPNG();

  const sizes = [1024, 512, 256, 128, 64, 32, 16];

  // Save full size
  const pngPath = path.join('${assetsDir.replace(/'/g, "\\'")}', 'icon.png');
  fs.writeFileSync(pngPath, pngBuffer);
  console.log('Created icon.png (1024x1024)');

  app.quit();
});
`;

const renderScriptPath = path.join(assetsDir, '_render.js');
fs.writeFileSync(renderScriptPath, renderScript);

try {
  execSync(`"${electronPath}" "${renderScriptPath}"`, {
    stdio: 'inherit',
    timeout: 10000,
  });
} catch (e) {
  console.error('Electron render failed, trying alternative...');
}

// Clean up render script
try { fs.unlinkSync(renderScriptPath); } catch {}

// Now create .icns from the PNG using iconutil (macOS)
const pngPath = path.join(assetsDir, 'icon.png');
if (fs.existsSync(pngPath)) {
  const iconsetDir = path.join(assetsDir, 'icon.iconset');
  if (!fs.existsSync(iconsetDir)) fs.mkdirSync(iconsetDir);

  const sizes = [16, 32, 64, 128, 256, 512];
  for (const size of sizes) {
    execSync(`sips -z ${size} ${size} "${pngPath}" --out "${path.join(iconsetDir, `icon_${size}x${size}.png`)}"`, { stdio: 'pipe' });
    // @2x variants
    if (size <= 512) {
      const size2x = size * 2;
      execSync(`sips -z ${size2x} ${size2x} "${pngPath}" --out "${path.join(iconsetDir, `icon_${size}x${size}@2x.png`)}"`, { stdio: 'pipe' });
    }
  }

  // Create .icns
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(assetsDir, 'icon.icns')}"`, { stdio: 'pipe' });
    console.log('Created icon.icns');
  } catch (e) {
    console.error('iconutil failed:', e.message);
  }

  // Clean up iconset
  try { fs.rmSync(iconsetDir, { recursive: true }); } catch {}

  // For Windows .ico — electron-builder can auto-generate from PNG,
  // but let's also create a basic one using sips -> bmp approach
  // electron-builder handles this automatically from icon.png, so we're good.
  console.log('icon.png will be auto-converted to .ico by electron-builder for Windows');
}

console.log('Done!');
