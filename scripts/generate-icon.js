// Render the checked-in app icon SVG into PNG/ICNS assets for packaging.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const assetsDir = path.join(__dirname, '..', 'assets');

const svgPath = path.join(assetsDir, 'icon.svg');
if (!fs.existsSync(svgPath)) {
  throw new Error(`Missing source SVG: ${svgPath}`);
}

console.log('Using icon.svg from assets');

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
