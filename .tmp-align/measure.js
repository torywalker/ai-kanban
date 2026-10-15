// Measures, in the same Chromium the app runs on, whether the first icon's top
// edge lands on the top of the title's glyphs — for one-line and two-line
// titles, with every combination of the two badges.
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 320,
    height: 900,
    show: false,
    webPreferences: { offscreen: true },
  });

  await win.loadFile(path.join(__dirname, 'harness.html'));
  await win.webContents.executeJavaScript('document.fonts.ready');

  const result = await win.webContents.executeJavaScript(`(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    function firstLineTop(el) {
      const textNode = el.querySelector('span').firstChild;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      return range.getClientRects()[0].top;
    }

    // Where the top of a capital glyph sits inside its line box:
    // baseline = halfLeading + fontAscent, then back off the cap ascent.
    function capOffset(el) {
      const cs = getComputedStyle(el);
      ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const m = ctx.measureText('T');
      const lineHeight = parseFloat(cs.lineHeight);
      const fontHeight = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
      const baseline = (lineHeight - fontHeight) / 2 + m.fontBoundingBoxAscent;
      return baseline - m.actualBoundingBoxAscent;
    }

    return [...document.querySelectorAll('[data-case]')].map((cardEl) => {
      const label = cardEl.dataset.case;
      const titleEl = cardEl.querySelector('[role=button]');
      const icon = cardEl.querySelector('svg[data-icon]');
      const btnIcon = cardEl.querySelector('[data-btn=copy] svg');

      const lineTop = firstLineTop(titleEl);
      const glyphTop = lineTop + capOffset(titleEl);
      const lineRect = titleEl.querySelector('span').firstChild;
      const r = document.createRange();
      r.selectNodeContents(lineRect);
      const line = r.getClientRects()[0];
      const b = btnIcon.getBoundingClientRect();

      return {
        case: label,
        lines: r.getClientRects().length,
        iconTop: icon ? +icon.getBoundingClientRect().top.toFixed(2) : null,
        titleGlyphTop: +glyphTop.toFixed(2),
        iconVsGlyph: icon
          ? +(icon.getBoundingClientRect().top - glyphTop).toFixed(2)
          : null,
        firstLineCenter: +(line.top + line.height / 2).toFixed(2),
        btnIconCenter: +(b.top + b.height / 2).toFixed(2),
        rowHeight: +cardEl.querySelector('div').getBoundingClientRect().height.toFixed(2),
      };
    });
  })()`);

  console.table(result);
  app.exit(0);
});
