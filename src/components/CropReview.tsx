import { useRef, useState } from "react";
import { quadFromBox, type Quad } from "../lib/quad";
import type { UploadedPhoto } from "../lib/uploadedPhoto";

const MAX_STAGE_WIDTH = 560;
const MAX_STAGE_HEIGHT = 420;
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
  onConfirm: (quad: Quad) => void;
  onSkip: () => void;
  onDiscard: () => void;
}

export function CropReview({ photo, index, total, onConfirm, onSkip, onDiscard }: CropReviewProps) {
  const initial =
    photo.suggestedCrop != null
      ? quadFromBox(photo.suggestedCrop)
      : quadFromBox({ x: 0, y: 0, width: photo.naturalWidth, height: photo.naturalHeight });
  const [quad, setQuad] = useState<Quad>(initial);
  const dragRef = useRef<DragState | null>(null);

  const scale = Math.min(
    MAX_STAGE_WIDTH / photo.naturalWidth,
    MAX_STAGE_HEIGHT / photo.naturalHeight,
    1,
  );
  const stageWidth = photo.naturalWidth * scale;
  const stageHeight = photo.naturalHeight * scale;

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
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;
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

  const displayQuad = quad.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const polygonPoints = displayQuad.map((p) => `${p.x},${p.y}`).join(" ");
  const dimPath = `M0,0 H${stageWidth} V${stageHeight} H0 Z M${polygonPoints
    .split(" ")
    .join(" L")} Z`;

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

        <div className="crop-stage" style={{ width: stageWidth, height: stageHeight }}>
          <img className="crop-stage__img" src={photo.url} alt="" draggable={false} />
          <svg
            className="crop-svg"
            width={stageWidth}
            height={stageHeight}
            viewBox={`0 0 ${stageWidth} ${stageHeight}`}
          >
            <path className="crop-dim" d={dimPath} fillRule="evenodd" />
            <polygon
              className="crop-outline"
              points={polygonPoints}
              onPointerDown={beginDrag("move")}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
            />
            {CORNER_KEYS.map((i) => (
              <circle
                key={i}
                className="crop-handle"
                cx={displayQuad[i].x}
                cy={displayQuad[i].y}
                r={7}
                onPointerDown={beginDrag(i)}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
              />
            ))}
          </svg>
        </div>

        <div className="crop-actions">
          <button type="button" className="crop-btn crop-btn--ghost" onClick={onDiscard}>
            Remove
          </button>
          <button type="button" className="crop-btn crop-btn--ghost" onClick={onSkip}>
            Use full photo
          </button>
          <button type="button" className="crop-btn crop-btn--primary" onClick={() => onConfirm(quad)}>
            Crop
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
