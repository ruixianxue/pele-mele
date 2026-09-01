import { memo, useEffect, useRef } from "react";
import { sizeForAspect } from "../lib/formats";
import type { UploadedPhoto } from "../lib/uploadedPhoto";
import type { PileSimulation } from "../lib/physics";

interface PhotoCardProps {
  photo: UploadedPhoto;
  count: number;
  sim: PileSimulation;
  isTop: boolean;
  focused: boolean;
}

// The card *is* the uploaded print — whatever border the user's photo
// already carries (see PRD §3.3: real edges, not a UI-drawn frame). This
// component just sizes and shadows it; it never adds a synthetic border.
//
// Gesture handling lives on the canvas container, not here: a card must
// stay transparent to pointerdown/move/up so a sweep that starts or passes
// over it still reaches the container's tap-vs-drag logic. It's found by
// the container afterwards via the data-photo-id attribute.
function PhotoCardImpl({ photo, count, sim, isTop, focused }: PhotoCardProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const size = sizeForAspect(photo.naturalWidth, photo.naturalHeight, count);

  useEffect(() => {
    sim.register(photo.id, elRef.current, size);
    return () => sim.unregister(photo.id);
    // Mount/unmount only — must not re-run when `size` changes (see
    // updateSize below) or every existing card would get unregistered and
    // re-registered as "new" each time the pile's total count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, photo.id]);

  useEffect(() => {
    sim.updateSize(photo.id, size);
  }, [sim, photo.id, size.width, size.height]);

  return (
    <div
      ref={elRef}
      data-photo-id={photo.id}
      className={`photo-card${focused ? " is-focused" : ""}${isTop ? " is-top" : ""}`}
      style={{ width: size.width, height: size.height }}
    >
      <img className="photo-card__img" src={photo.url} alt="" draggable={false} />
    </div>
  );
}

export const PhotoCard = memo(PhotoCardImpl);
