import { useEffect, useRef, useState } from "react";
import { quadFromBox, type Quad } from "../lib/quad";
import type { UploadedPhoto } from "../lib/uploadedPhoto";

// Real uploads run 2000-4000px+ on a side, so a small preview compresses
// many real pixels into each preview pixel — a misalignment too small to
// see or drag-correct here can still show up as a visible sliver of
// background once the crop is applied at full resolution. Sized generously
// (the .crop-stage CSS max-width/max-height still cap it on small viewports).
const MAX_STAGE_WIDTH = 1100;
const MAX_STAGE_HEIGHT = 760;
const HANDLE_RADIUS_PX = 7;
const CORNER_KEYS = [0, 1, 2, 3] as const;

type DragMode = "move" | 0 | 1 | 2 | 3;

interface DragState {
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  startQuad: Quad;
}

interface CropReviewProps {
  photo: UploadedPhoto;
  index: number;
  total: number;
  error?: string | null;
  onConfirm: (quad: Quad) => Promise<void>;
  onSkip: () => void;
  onDiscard: () => void;
}

export function CropReview({ photo, index, total, error, onConfirm, onSkip, onDiscard }: CropReviewProps) {
  const initial =
    photo.suggestedCrop != null
      ? quadFromBox(photo.suggestedCrop)
      : quadFromBox({ x: 0, y: 0, width: photo.naturalWidth, height: photo.naturalHeight });
  const [quad, setQuad] = useState<Quad>(initial);
  const [submitting, setSubmitting] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // Mirrors the .crop-stage CSS max-width/max-height (calc(100vw - 72px)
  // and 72vh) so the *intended* size below never exceeds what CSS would
  // actually allow. Without this, e.g. a wide photo on a narrow window
  // gets its width clamped by CSS but not its height (or vice versa on a
  // short window), breaking the box's aspect ratio — and since the <img>
  // fills that box exactly, the photo itself renders visibly stretched or
  // squashed, not just misaligned. Computing from real viewport size keeps
  // the box's aspect ratio correct in the first place; the ResizeObserver
  // below is the remaining safety net for edge cases (scrollbars, etc.)
  // rather than the primary defense.
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    function onResize() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const availableWidth = Math.max(200, viewport.width - 72);
  const availableHeight = Math.max(200, viewport.height * 0.72);

  // The size we'd *like* the stage to render at — capped by both the
  // fixed maximums and the real available viewport space above.
  const intendedScale = Math.min(
    MAX_STAGE_WIDTH / photo.naturalWidth,
    MAX_STAGE_HEIGHT / photo.naturalHeight,
    availableWidth / photo.naturalWidth,
    availableHeight / photo.naturalHeight,
    1,
  );
  const intendedWidth = photo.naturalWidth * intendedScale;
  const intendedHeight = photo.naturalHeight * intendedScale;

  // The container's *actual* rendered size, measured after layout. CSS
  // max-width/max-height clamp width and height independently, which can
  // shrink one dimension more than the other on a short or narrow
  // viewport — if drag math assumed a single uniform scale instead of the
  // real per-axis one, the coordinates the user aligns onscreen would
  // silently disagree with what actually gets warped, showing up as
  // background bleeding in at whichever edge the mismatch is worst.
  // Tracking width and height separately (rather than one "scale") keeps
  // the SVG overlay, the <img>, and this drag math all agreeing even when
  // the container ends up non-uniformly squished.
  const [actualStageSize, setActualStageSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const scaleX = (actualStageSize?.width ?? intendedWidth) / photo.naturalWidth;
  const scaleY = (actualStageSize?.height ?? intendedHeight) / photo.naturalHeight;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setActualStageSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function handleConfirmClick() {
    setSubmitting(true);
    await onConfirm(quad);
    // On success this instance unmounts (the review queue shifts) and this
    // is a no-op; a failure leaves it mounted needing the button
    // re-enabled. React 18 doesn't warn on updating an unmounted
    // component, so no mounted-ref guard is needed here.
    setSubmitting(false);
  }

  function beginDrag(mode: DragMode) {
    return (e: React.PointerEvent<Element>) => {
      e.stopPropagation();
      dragRef.current = { mode, startClientX: e.clientX, startClientY: e.clientY, startQuad: quad };
      // Best-effort: keeps the drag tracked if the pointer slides off a
      // small handle, but must not stop the drag state above from being
      // set if the browser rejects capture (see the same fix in Gallery).
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore — move/up still fire on this element without capture as
        // long as the pointer stays roughly over it
      }
    };
  }

  function onDragMove(e: React.PointerEvent<Element>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startClientX) / scaleX;
    const dy = (e.clientY - drag.startClientY) / scaleY;
    setQuad(applyDrag(drag.mode, drag.startQuad, dx, dy, photo.naturalWidth, photo.naturalHeight));
  }

  function endDrag(e: React.PointerEvent<Element>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore — nothing to release if capture was never acquired
    }
    dragRef.current = null;
  }

  // The SVG's viewBox is the photo's own natural pixel space, so every
  // shape below is plotted in the *same* coordinates warpPhoto will
  // actually use — no separate "display scale" to keep in sync with the
  // image, and the browser's own viewBox scaling keeps it aligned with
  // the <img> beneath no matter what size the container actually renders
  // at (including CSS-clamped sizes that don't match the intended one).
  const polygonPoints = quad.map((p) => `${p.x},${p.y}`).join(" ");
  const dimPath = `M0,0 H${photo.naturalWidth} V${photo.naturalHeight} H0 Z M${polygonPoints
    .split(" ")
    .join(" L")} Z`;
  // Only cosmetic (the handle renders as a slight ellipse instead of a
  // perfect circle in the rare non-uniformly-squished case) — hit target
  // size, not drag correctness, so a single representative scale is fine.
  const handleRadius = HANDLE_RADIUS_PX / scaleX;

  return (
    <div className="crop-overlay">
      <div className="crop-panel">
        <div className="crop-panel__header">
          <span className="crop-panel__title">Crop photo</span>
          {total > 1 && (
            <span className="crop-panel__counter">
              {index} of {total}
            </span>
          )}
        </div>
        <p className="crop-panel__hint">
          Drag the corners to match the print's edges — handles keystone distortion, not just a
          rectangle.
        </p>

        <div
          ref={stageRef}
          className="crop-stage"
          style={{ width: intendedWidth, height: intendedHeight }}
        >
          <img className="crop-stage__img" src={photo.url} alt="" draggable={false} />
          <svg
            className="crop-svg"
            viewBox={`0 0 ${photo.naturalWidth} ${photo.naturalHeight}`}
            preserveAspectRatio="none"
          >
            <path className="crop-dim" d={dimPath} fillRule="evenodd" />
            <polygon
              className="crop-outline"
              points={polygonPoints}
              vectorEffect="non-scaling-stroke"
              onPointerDown={beginDrag("move")}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
            />
            {CORNER_KEYS.map((i) => (
              <circle
                key={i}
                className="crop-handle"
                cx={quad[i].x}
                cy={quad[i].y}
                r={handleRadius}
                vectorEffect="non-scaling-stroke"
                onPointerDown={beginDrag(i)}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
              />
            ))}
          </svg>
        </div>

        {error && (
          <p className="crop-panel__error">
            Couldn't crop this photo: {error}. You can try again, or use the full photo instead.
          </p>
        )}

        <div className="crop-actions">
          <button
            type="button"
            className="crop-btn crop-btn--ghost"
            onClick={onDiscard}
            disabled={submitting}
          >
            Remove
          </button>
          <button
            type="button"
            className="crop-btn crop-btn--ghost"
            onClick={onSkip}
            disabled={submitting}
          >
            Use full photo
          </button>
          <button
            type="button"
            className="crop-btn crop-btn--primary"
            onClick={handleConfirmClick}
            disabled={submitting}
          >
            {submitting ? "Cropping…" : "Crop"}
          </button>
        </div>
      </div>
    </div>
  );
}

function applyDrag(
  mode: DragMode,
  start: Quad,
  dx: number,
  dy: number,
  naturalWidth: number,
  naturalHeight: number,
): Quad {
  if (mode === "move") {
    // Shift every corner together, but clamp by how far the *tightest*
    // corner can move so the whole shape stays in bounds without warping.
    const clampedDx = clampShift(
      dx,
      start.map((p) => p.x),
      naturalWidth,
    );
    const clampedDy = clampShift(
      dy,
      start.map((p) => p.y),
      naturalHeight,
    );
    return start.map((p) => ({ x: p.x + clampedDx, y: p.y + clampedDy })) as Quad;
  }
  const next = start.map((p) => ({ ...p })) as Quad;
  const corner = next[mode];
  corner.x = clampPoint(start[mode].x + dx, naturalWidth);
  corner.y = clampPoint(start[mode].y + dy, naturalHeight);
  return next;
}

function clampPoint(v: number, max: number): number {
  return Math.min(Math.max(v, 0), max);
}

function clampShift(delta: number, values: number[], max: number): number {
  const min = Math.min(...values);
  const maxV = Math.max(...values);
  const lo = -min;
  const hi = max - maxV;
  return Math.min(Math.max(delta, lo), hi);
}
