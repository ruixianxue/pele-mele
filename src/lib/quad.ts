import type { CropBox } from "./autoCrop";

export interface Point {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export function quadFromBox(box: CropBox): Quad {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

/**
 * Maps a point on the unit square (u,v ∈ [0,1]) to the corresponding point
 * inside an arbitrary quadrilateral — the standard "unit square to quad"
 * projective mapping (Heckbert, "Fundamentals of Texture Mapping and Image
 * Warping", 1989). This is exactly the inverse map a resampling warp needs:
 * for a given normalized position in the straightened output, it gives the
 * pixel to sample from the (possibly keystone-distorted) source photo.
 */
export function mapUnitSquareToQuad(u: number, v: number, quad: Quad): Point {
  const [p0, p1, p2, p3] = quad;

  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;

  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // Parallelogram: no perspective term needed, plain affine map.
    a = p1.x - p0.x;
    b = p2.x - p1.x;
    c = p0.x;
    d = p1.y - p0.y;
    e = p2.y - p1.y;
    f = p0.y;
    g = 0;
    h = 0;
  } else {
    const denom = dx1 * dy2 - dx2 * dy1;
    g = denom !== 0 ? (dx3 * dy2 - dx2 * dy3) / denom : 0;
    h = denom !== 0 ? (dx1 * dy3 - dx3 * dy1) / denom : 0;
    a = p1.x - p0.x + g * p1.x;
    b = p3.x - p0.x + h * p3.x;
    c = p0.x;
    d = p1.y - p0.y + g * p1.y;
    e = p3.y - p0.y + h * p3.y;
    f = p0.y;
  }

  const w = g * u + h * v + 1;
  return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
}

/** How big the straightened output should be: the average of each pair of
 * opposite edge lengths, so a keystoned quad still produces a sensibly
 * sized rectangle instead of arbitrarily picking one edge. */
export function outputSizeForQuad(quad: Quad): { width: number; height: number } {
  const [p0, p1, p2, p3] = quad;
  const width = (dist(p0, p1) + dist(p3, p2)) / 2;
  const height = (dist(p0, p3) + dist(p1, p2)) / 2;
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
