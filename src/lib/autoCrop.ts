export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Downsample target for the analysis pass — this only needs to find roughly
// where the print's edges are, not read pixel-perfect detail.
const WORK_SIZE = 240;
// A candidate edge must search within the outer/inner thirds of each axis:
// assume the print roughly fills the frame rather than a sliver of it.
const SEARCH_MARGIN = 0.4;
// The strongest edge in the search zone must beat the zone's average
// gradient by this much, or we treat the frame as low-confidence and back
// off to "no crop" rather than guess.
const PEAK_CONFIDENCE = 1.8;
const MIN_SPAN_FRACTION = 0.3;

/**
 * Best-effort guess at where an instant-film print sits inside an uploaded
 * photo, for pre-filling the crop tool — not a final answer. Finds the
 * strongest roughly-straight edge on each side via gradient projection
 * (sum absolute gradient per row/column; a real border shows up as a sharp
 * peak). Falls back to the full frame when nothing looks confident, so a
 * bad guess never applies a bad crop — the user still adjusts by hand.
 */
export function detectCropBox(img: ImageBitmap): CropBox {
  const nw = img.width;
  const nh = img.height;
  const full: CropBox = { x: 0, y: 0, width: nw, height: nh };
  if (!nw || !nh) return full;

  const scale = Math.min(1, WORK_SIZE / Math.max(nw, nh));
  const w = Math.max(2, Math.round(nw * scale));
  const h = Math.max(2, Math.round(nh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return full;
  ctx.drawImage(img, 0, 0, w, h);

  let gray: Float32Array;
  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
  } catch {
    // canvas is tainted (e.g. cross-origin source) — can't read pixels
    return full;
  }

  const colProfile = new Float32Array(w);
  for (let x = 1; x < w - 1; x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      sum += Math.abs(gray[y * w + x + 1] - gray[y * w + x - 1]);
    }
    colProfile[x] = sum;
  }

  const rowProfile = new Float32Array(h);
  for (let y = 1; y < h - 1; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += Math.abs(gray[(y + 1) * w + x] - gray[(y - 1) * w + x]);
    }
    rowProfile[y] = sum;
  }

  const left = findEdgePeak(colProfile, 0, Math.floor(w * SEARCH_MARGIN));
  const right = findEdgePeak(colProfile, Math.ceil(w * (1 - SEARCH_MARGIN)), w - 1);
  const top = findEdgePeak(rowProfile, 0, Math.floor(h * SEARCH_MARGIN));
  const bottom = findEdgePeak(rowProfile, Math.ceil(h * (1 - SEARCH_MARGIN)), h - 1);

  if (left == null || right == null || top == null || bottom == null) return full;
  if (right - left < w * MIN_SPAN_FRACTION || bottom - top < h * MIN_SPAN_FRACTION) return full;

  const sx = nw / w;
  const sy = nh / h;
  return {
    x: Math.round(left * sx),
    y: Math.round(top * sy),
    width: Math.round((right - left) * sx),
    height: Math.round((bottom - top) * sy),
  };
}

function findEdgePeak(profile: Float32Array, from: number, to: number): number | null {
  let bestIndex = -1;
  let bestValue = -Infinity;
  let sum = 0;
  let count = 0;
  for (let i = from; i <= to; i++) {
    const v = profile[i];
    sum += v;
    count++;
    if (v > bestValue) {
      bestValue = v;
      bestIndex = i;
    }
  }
  if (bestIndex < 0 || count === 0) return null;
  const mean = sum / count;
  if (mean <= 0 || bestValue < mean * PEAK_CONFIDENCE) return null;
  return bestIndex;
}
