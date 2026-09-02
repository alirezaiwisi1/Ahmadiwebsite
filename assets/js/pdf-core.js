/* pdf-core.js — pure geometry/detection helpers for the PDF reader.
 *
 * Adapted from Veil by Simone Amico (https://github.com/simoneamico-ux-dev/veil),
 * MIT License. The two-layer dark-mode technique lives here: image regions are
 * extracted from the PDF operator list, the base canvas is softly inverted with
 * CSS, and the overlay canvas repaints the original image pixels on top so
 * photos, charts and diagrams keep their true colors.
 */

export const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

/* BT.601 luminance below which a rendered page counts as "already dark"
   (slides, dark-themed PDFs) and inversion is skipped. */
export const DARK_LUMINANCE_THRESHOLD = 0.4;

/* --- Matrix utilities --------------------------------------------------- */

export function multiplyMatrices(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function transformPoint(matrix, x, y) {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

/* Every raster image starts as a 1x1 square stretched by the CTM. Transform
   all four corners and take the bounding box — correct for rotated/skewed
   images that a naive (x,y,w,h) approach would miss. */
export function computeImageBounds(ctm, viewportTransform) {
  const final = multiplyMatrices(viewportTransform, ctm);

  const c0 = transformPoint(final, 0, 0);
  const c1 = transformPoint(final, 1, 0);
  const c2 = transformPoint(final, 1, 1);
  const c3 = transformPoint(final, 0, 1);

  const xs = [c0[0], c1[0], c2[0], c3[0]];
  const ys = [c0[1], c1[1], c2[1], c3[1]];

  const minX = Math.floor(Math.min(...xs));
  const minY = Math.floor(Math.min(...ys));

  return {
    x: minX,
    y: minY,
    width: Math.ceil(Math.max(...xs)) - minX,
    height: Math.ceil(Math.max(...ys)) - minY,
  };
}

/* Walk the PDF.js operator list keeping a CTM stack (save/restore/transform)
   to find every paintImageXObject-ish op and record its on-canvas bounds.
   `ops` maps logical names to numeric op codes so this stays independent of
   the pdf.js version's enum values. */
export function extractImageRegions(opList, viewportTransform, ops) {
  const regions = [];
  const ctmStack = [];
  let ctm = [...IDENTITY_MATRIX];

  const { fnArray, argsArray } = opList;

  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i];
    const args = argsArray[i];

    if (op === ops.save) {
      if (ctmStack.length > 1000) continue;
      ctmStack.push([...ctm]);
    } else if (op === ops.restore) {
      ctm = ctmStack.pop() || [...IDENTITY_MATRIX];
    } else if (op === ops.transform) {
      ctm = multiplyMatrices(ctm, args);
    } else if (op === ops.paintFormXObjectBegin) {
      ctmStack.push([...ctm]);
      if (args[0]) ctm = multiplyMatrices(ctm, args[0]);
    } else if (op === ops.paintFormXObjectEnd) {
      ctm = ctmStack.pop() || [...IDENTITY_MATRIX];
    } else if (op === ops.paintImageXObject || op === ops.paintInlineImageXObject) {
      regions.push(computeImageBounds(ctm, viewportTransform));
    } else if (op === ops.paintImageXObjectRepeat) {
      if (args.length > 3) {
        for (let j = 3; j < args.length; j += 2) {
          const repeatCtm = multiplyMatrices(ctm, [1, 0, 0, 1, args[j], args[j + 1]]);
          regions.push(computeImageBounds(repeatCtm, viewportTransform));
        }
      } else {
        regions.push(computeImageBounds(ctm, viewportTransform));
      }
    }
  }

  return regions;
}

/* After the base canvas is CSS-inverted, the overlay canvas repaints the
   original (non-inverted) pixels of each image region. The overlay sits
   above the base canvas with no CSS filter, so images show true colors. */
export function compositeImageRegions(ctx, sourceCanvas, regions, canvasW, canvasH) {
  for (const r of regions) {
    const sx = Math.max(0, r.x);
    const sy = Math.max(0, r.y);
    const sx2 = Math.min(canvasW, r.x + r.width);
    const sy2 = Math.min(canvasH, r.y + r.height);
    const sw = sx2 - sx;
    const sh = sy2 - sy;

    if (sw <= 0 || sh <= 0) continue;
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
  }
}

/* Sample luminance at page edges/corners (where the background is exposed)
   and decide whether the page is natively dark. Single getImageData read,
   BT.601 weights. */
export function detectAlreadyDark(pixelData, width, height) {
  if (width <= 0 || height <= 0 || pixelData.length === 0) return false;
  const samplePoints = [];
  const margin = Math.max(5, Math.floor(Math.min(width, height) * 0.02));
  const step = Math.max(1, Math.floor(Math.min(width, height) * 0.05));

  samplePoints.push(
    [margin, margin], [width - margin, margin],
    [margin, height - margin], [width - margin, height - margin],
  );

  for (let x = margin; x < width - margin; x += step) {
    samplePoints.push([x, margin], [x, height - margin]);
  }
  for (let y = margin; y < height - margin; y += step) {
    samplePoints.push([margin, y], [width - margin, y]);
  }

  let totalLuminance = 0;
  let count = 0;

  for (const [sx, sy] of samplePoints) {
    const idx = (sy * width + sx) * 4;
    if (idx + 2 >= pixelData.length) continue;
    const luminance = (0.299 * pixelData[idx] + 0.587 * pixelData[idx + 1] + 0.114 * pixelData[idx + 2]) / 255;
    totalLuminance += luminance;
    count++;
  }

  const avgLuminance = count > 0 ? totalLuminance / count : 1;
  return avgLuminance < DARK_LUMINANCE_THRESHOLD;
}

/* Per-page dark mode resolution with user override:
   override 'dark' -> force dark, 'light' -> force light,
   otherwise dark unless the page is already dark. */
export function shouldApplyDark(pageNum, pageDarkOverride, pageAlreadyDark) {
  const override = pageDarkOverride.get(pageNum);
  if (override === 'dark') return true;
  if (override === 'light') return false;
  if (pageAlreadyDark.get(pageNum)) return false;
  return true;
}

/* Decompose typographic ligatures (fi -> f i, ...) so copied text and
   search behave like plain characters. */
export function normalizeLigatures(str) {
  if (!str) return str;
  return str.normalize('NFKD');
}

/* Persian/Arabic tolerant normalization for search: unify Arabic yeh/kaf
   with Persian forms, strip tashkeel, drop soft separators, fold digits. */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeForSearch(str) {
  if (!str) return '';
  let s = String(str).normalize('NFKD');
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    // strip Arabic tashkeel / Quranic annotation marks
    if ((code >= 0x064b && code <= 0x065f) || (code >= 0x06d6 && code <= 0x06ed)) continue;
    if (ch === '\u200c' || ch === '\u200d' || ch === '\u200f' || ch === '\u200e') continue;
    if (ch === 'ي') { out += 'ی'; continue; }
    if (ch === 'ك') { out += 'ک'; continue; }
    if (ch === 'أ' || ch === 'إ' || ch === 'آ') { out += 'ا'; continue; }
    if (ch === 'ة') { out += 'ه'; continue; }
    const pd = PERSIAN_DIGITS.indexOf(ch);
    if (pd >= 0) { out += String(pd); continue; }
    const ad = ARABIC_DIGITS.indexOf(ch);
    if (ad >= 0) { out += String(ad); continue; }
    out += ch;
  }
  return out.toLowerCase();
}
