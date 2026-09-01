import { useRef, useState } from "react";
import type { CropBox } from "../lib/autoCrop";
import type { UploadedPhoto } from "../lib/uploadedPhoto";

const MAX_STAGE_WIDTH = 560;
const MAX_STAGE_HEIGHT = 420;
const MIN_BOX_SIZE = 24;

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

interface DragState {
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  startBox: CropBox;
}

interface CropReviewProps {
  photo: UploadedPhoto;
  index: number;
  total: number;
  onConfirm: (box: CropBox) => void;
  onSkip: () => void;
  onDiscard: () => void;
}

export function CropReview({ photo, index, total, onConfirm, onSkip, onDiscard }: CropReviewProps) {
  const initial = photo.suggestedCrop ?? {
    x: 0,
    y: 0,
    width: photo.naturalWidth,
    height: photo.naturalHeight,
  };
  const [box, setBox] = useState<CropBox>(initial);
  const dragRef = useRef<DragState | null>(null);

  const scale = Math.min(
    MAX_STAGE_WIDTH / photo.naturalWidth,
    MAX_STAGE_HEIGHT / photo.naturalHeight,
    1,
  );
  const stageWidth = photo.naturalWidth * scale;
  const stageHeight = photo.naturalHeight * scale;

  function beginDrag(mode: DragMode) {
    return (e: React.PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { mode, startClientX: e.clientX, startClientY: e.clientY, startBox: box };
    };
  }

  function onDragMove(e: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startClientX) / scale;
    const dy = (e.clientY - drag.startClientY) / scale;
    setBox(clampBox(applyDrag(drag.mode, drag.startBox, dx, dy), photo.naturalWidth, photo.naturalHeight));
  }

  function endDrag(e: React.PointerEvent<HTMLElement>) {
    if (dragRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }

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

        <div className="crop-stage" style={{ width: stageWidth, height: stageHeight }}>
          <img className="crop-stage__img" src={photo.url} alt="" draggable={false} />
          <div
            className="crop-box"
            style={{
              left: box.x * scale,
              top: box.y * scale,
              width: box.width * scale,
              height: box.height * scale,
            }}
            onPointerDown={beginDrag("move")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
          >
            {(["nw", "ne", "sw", "se"] as const).map((corner) => (
              <span
                key={corner}
                className={`crop-handle crop-handle--${corner}`}
                onPointerDown={beginDrag(corner)}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
              />
            ))}
          </div>
        </div>

        <div className="crop-actions">
          <button type="button" className="crop-btn crop-btn--ghost" onClick={onDiscard}>
            Remove
          </button>
          <button type="button" className="crop-btn crop-btn--ghost" onClick={onSkip}>
            Use full photo
          </button>
          <button type="button" className="crop-btn crop-btn--primary" onClick={() => onConfirm(box)}>
            Crop
          </button>
        </div>
      </div>
    </div>
  );
}

function applyDrag(mode: DragMode, start: CropBox, dx: number, dy: number): CropBox {
  if (mode === "move") {
    return { ...start, x: start.x + dx, y: start.y + dy };
  }
  const x2 = start.x + start.width;
  const y2 = start.y + start.height;
  let nx = start.x;
  let ny = start.y;
  let nx2 = x2;
  let ny2 = y2;
  if (mode === "nw") {
    nx = start.x + dx;
    ny = start.y + dy;
  } else if (mode === "ne") {
    nx2 = x2 + dx;
    ny = start.y + dy;
  } else if (mode === "sw") {
    nx = start.x + dx;
    ny2 = y2 + dy;
  } else if (mode === "se") {
    nx2 = x2 + dx;
    ny2 = y2 + dy;
  }
  return { x: Math.min(nx, nx2), y: Math.min(ny, ny2), width: Math.abs(nx2 - nx), height: Math.abs(ny2 - ny) };
}

function clampBox(box: CropBox, naturalWidth: number, naturalHeight: number): CropBox {
  let width = Math.max(MIN_BOX_SIZE, Math.min(box.width, naturalWidth));
  let height = Math.max(MIN_BOX_SIZE, Math.min(box.height, naturalHeight));
  let x = Math.max(0, Math.min(box.x, naturalWidth - width));
  let y = Math.max(0, Math.min(box.y, naturalHeight - height));
  // Re-clamp size in case the position clamp above pushed it out of range
  // on a very small source image.
  width = Math.min(width, naturalWidth - x);
  height = Math.min(height, naturalHeight - y);
  return { x, y, width, height };
}
