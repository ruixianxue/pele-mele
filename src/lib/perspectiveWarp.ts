import { mapUnitSquareToQuad, outputSizeForQuad, type Quad } from "./quad";

/**
 * Straightens the region of `img` inside `quad` into an axis-aligned
 * rectangle, undoing the keystone distortion from photographing a print at
 * an angle. Canvas 2D only offers affine transforms, so this resamples
 * pixel-by-pixel via the inverse projective mapping instead of a single
 * drawImage call.
 */
export function warpQuadToCanvas(img: HTMLImageElement, quad: Quad): HTMLCanvasElement {
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = img.naturalWidth;
  srcCanvas.height = img.naturalHeight;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) throw new Error("Canvas 2D is not supported");
  srcCtx.drawImage(img, 0, 0);
  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;
  const src = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const { width: outWidth, height: outHeight } = outputSizeForQuad(quad);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Canvas 2D is not supported");
  const outImage = outCtx.createImageData(outWidth, outHeight);
  const out = outImage.data;

  for (let oy = 0; oy < outHeight; oy++) {
    const v = (oy + 0.5) / outHeight;
    for (let ox = 0; ox < outWidth; ox++) {
      const u = (ox + 0.5) / outWidth;
      const { x, y } = mapUnitSquareToQuad(u, v, quad);
      const di = (oy * outWidth + ox) * 4;
      sampleBilinear(src, srcW, srcH, x, y, out, di);
    }
  }

  outCtx.putImageData(outImage, 0, 0);
  return outCanvas;
}

function sampleBilinear(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  outIndex: number,
) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = clampInt(x0, 0, w - 1);
  const cx1 = clampInt(x0 + 1, 0, w - 1);
  const cy0 = clampInt(y0, 0, h - 1);
  const cy1 = clampInt(y0 + 1, 0, h - 1);

  const i00 = (cy0 * w + cx0) * 4;
  const i10 = (cy0 * w + cx1) * 4;
  const i01 = (cy1 * w + cx0) * 4;
  const i11 = (cy1 * w + cx1) * 4;

  for (let c = 0; c < 4; c++) {
    const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
    const bottom = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
    out[outIndex + c] = top * (1 - fy) + bottom * fy;
  }
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
