export interface CardSize {
  width: number;
  height: number;
  diag: number;
}

// A representative "long edge" length, in the same abstract unit the old
// mm-based format table used (real instant-film prints run ~85-99mm on
// their long edge). Keeps on-screen scale consistent with earlier tuning
// even though photos are now sized from their own real aspect ratio
// instead of a fixed mini/square/wide preset.
const REFERENCE_LONG_EDGE = 92;

/**
 * px-per-unit shrinks as the pile grows, so a couple of photos fill the
 * frame and forty photos still read as a coherent scatter rather than a
 * jumble.
 */
export function scaleForCount(count: number): number {
  const base = 5.4;
  const min = 1.9;
  const value = base - 0.52 * Math.sqrt(Math.max(0, count - 1));
  return Math.min(base, Math.max(min, value));
}

/**
 * Size a card from the photo's own width/height so real uploads keep their
 * true proportions (no forcing into an instax preset) while still scaling
 * down as more photos join the pile.
 */
export function sizeForAspect(naturalWidth: number, naturalHeight: number, count: number): CardSize {
  const aspect = naturalWidth / naturalHeight || 1;
  const longEdge = REFERENCE_LONG_EDGE * scaleForCount(count);
  const width = aspect >= 1 ? longEdge : longEdge * aspect;
  const height = aspect >= 1 ? longEdge / aspect : longEdge;
  return { width, height, diag: Math.hypot(width, height) };
}
