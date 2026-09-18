const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets', 'ui', 'extracted');
fs.mkdirSync(OUT, { recursive: true });

// Sprite sheet crops: [input, name, left, top, width, height]
const CROPS = [
  // From carved-buttons.png (1849x1837) — panel backgrounds and bar sizes
  ['assets/ui/carved-buttons.png', 'btn-panel-skull.png',     0,   0, 920, 680],
  ['assets/ui/carved-buttons.png', 'btn-panel-castle.png',    0, 1157, 920, 680],
  ['assets/ui/carved-buttons.png', 'btn-check.png',          320,  680, 280, 200],
  ['assets/ui/carved-buttons.png', 'btn-x.png',              640,  680, 280, 200],
  ['assets/ui/carved-buttons.png', 'btn-bar-wide.png',       940,    0, 900, 180],
  ['assets/ui/carved-buttons.png', 'btn-bar-md.png',         940,  230, 900, 150],
  ['assets/ui/carved-buttons.png', 'btn-bar-sm.png',         940,  450, 900, 120],

  // From existing PNGs — icon set
  ['assets/ui/sword.png',          'icon-sword.png',          0, 0, 64, 64],
  ['assets/ui/castle.png',         'icon-castle.png',         0, 0, 64, 64],
  ['assets/ui/exit cross.png',     'icon-exit.png',           0, 0, 64, 64],
  ['assets/ui/right tick.png',     'icon-check.png',          0, 0, 64, 64],
  ['assets/ui/shield.png',         'icon-shield.png',         0, 0, 64, 64],
];

async function extract() {
  const base = path.join(__dirname, '..');
  for (const [file, name, left, top, w, h] of CROPS) {
    const src = path.join(base, file);
    const dst = path.join(base, 'assets', 'ui', 'extracted', name);
    try {
      const meta = await sharp(src).metadata();
      const safeLeft = Math.min(left, meta.width - 1);
      const safeTop = Math.min(top, meta.height - 1);
      const safeW = Math.min(w, meta.width - safeLeft);
      const safeH = Math.min(h, meta.height - safeTop);
      await sharp(src)
        .extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH })
        .png()
        .toFile(dst);
      console.log(`✅ ${name} (${safeW}x${safeH})`);
    } catch (e) {
      console.warn(`⚠️ ${name}: ${e.message}`);
    }
  }
  console.log('\nDone.');
}

extract();
