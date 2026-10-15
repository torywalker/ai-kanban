// Ground truth: render the harness and find the topmost *painted* pixel of the
// icon and of the title's first line. No font-metric assumptions.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 320,
    height: 900,
    show: false,
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });

  await win.loadFile(path.join(__dirname, 'harness.html'));
  await win.webContents.executeJavaScript('document.fonts.ready');

  const boxes = await win.webContents.executeJavaScript(`(() => {
    return [...document.querySelectorAll('[data-case]')].map((cardEl) => {
      const span = cardEl.querySelector('[role=button] span');
      const textNode = span.firstChild;
      const r = document.createRange();
      r.selectNodeContents(textNode);
      const line = r.getClientRects()[0];
      const icon = cardEl.querySelector('svg[data-icon]');
      const ir = icon ? icon.getBoundingClientRect() : null;
      return {
        case: cardEl.dataset.case,
        icon: ir && { x: ir.x, y: ir.y, w: ir.width, h: ir.height },
        // Clip the text probe to the first line only.
        text: { x: line.x, y: line.y, w: line.width, h: line.height },
      };
    });
  })()`);

  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'shot.png'), image.toPNG());
  const size = image.getSize();
  const bitmap = image.getBitmap(); // BGRA, device pixels
  const scale = Math.round(Math.sqrt(bitmap.length / 4 / (size.width * size.height)));
  const dw = size.width * scale;

  // Topmost row in the box holding a pixel meaningfully darker than the card.
  function topPaintedRow(box, pad = 3) {
    const x0 = Math.floor((box.x - pad) * scale);
    const x1 = Math.ceil((box.x + box.w + pad) * scale);
    const y0 = Math.floor((box.y - pad) * scale);
    const y1 = Math.ceil((box.y + box.h + pad) * scale);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * dw + x) * 4;
        const lum = 0.299 * bitmap[i + 2] + 0.587 * bitmap[i + 1] + 0.114 * bitmap[i];
        if (lum < 200) return y / scale;
      }
    }
    return null;
  }

  const rows = boxes.map((b) => {
    const iconTop = b.icon ? topPaintedRow(b.icon) : null;
    const textTop = topPaintedRow(b.text);
    return {
      case: b.case,
      iconPaintedTop: iconTop,
      titlePaintedTop: textTop,
      delta: iconTop === null ? null : +(iconTop - textTop).toFixed(2),
    };
  });

  console.log('scale', scale);
  console.table(rows);
  app.exit(0);
});
