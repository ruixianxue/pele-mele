import { useEffect, useMemo, useRef, useState } from "react";
import { PhotoCard } from "./PhotoCard";
import { CropReview } from "./CropReview";
import { PileSimulation } from "../lib/physics";
import type { Quad } from "../lib/quad";
import { warpPhoto, isImageFile, loadImageFile, revokePhoto, type UploadedPhoto } from "../lib/uploadedPhoto";

const TAP_THRESHOLD_PX = 6;
const SWEEP_GAIN = 2.4;
const MAX_SWEEP_IMPULSE = 42;
const MIN_DT_MS = 4;

type Phase = "empty" | "stacked" | "scattered";

interface PointerTrack {
  pointerId: number;
  downX: number;
  downY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  moved: number;
}

export function Gallery() {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [topId, setTopId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);
  const [pendingEntranceIds, setPendingEntranceIds] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<UploadedPhoto[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sim = useMemo(() => new PileSimulation(), []);
  const trackRef = useRef<PointerTrack | null>(null);
  const photosRef = useRef<UploadedPhoto[]>([]);
  photosRef.current = photos;
  const reviewQueueRef = useRef<UploadedPhoto[]>([]);
  reviewQueueRef.current = reviewQueue;

  useEffect(() => {
    return () => {
      sim.dispose();
      photosRef.current.forEach(revokePhoto);
      reviewQueueRef.current.forEach(revokePhoto);
    };
  }, [sim]);

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(isImageFile);
    if (files.length === 0) return;

    let loaded: UploadedPhoto[];
    try {
      loaded = await Promise.all(files.map(loadImageFile));
    } catch (err) {
      console.error(err);
      return;
    }

    // Every upload goes through the crop-review queue first — see
    // commitPhoto for where a reviewed photo actually joins the pile.
    setReviewQueue((prev) => [...prev, ...loaded]);
  }

  function commitPhoto(photo: UploadedPhoto) {
    setPhotos((prev) => [...prev, photo]);
    if (phase === "empty") {
      setTopId(photo.id);
      setPhase("stacked");
    } else if (phase === "scattered") {
      setPendingEntranceIds((prev) => [...prev, photo.id]);
    }
    // phase === "stacked": the photo just joins the still-unexploded pile;
    // the layoutStack effect below re-places everyone automatically.
  }

  async function handleCropConfirm(quad: Quad) {
    const original = reviewQueue[0];
    if (!original) return;
    try {
      const cropped = await warpPhoto(original, quad);
      commitPhoto(cropped);
    } catch (err) {
      console.error(err);
      commitPhoto(original);
    } finally {
      revokePhoto(original);
      setReviewQueue((prev) => prev.slice(1));
    }
  }

  function handleCropSkip() {
    const original = reviewQueue[0];
    if (!original) return;
    commitPhoto(original);
    setReviewQueue((prev) => prev.slice(1));
  }

  function handleCropDiscard() {
    const original = reviewQueue[0];
    if (!original) return;
    revokePhoto(original);
    setReviewQueue((prev) => prev.slice(1));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setBounds({ width, height });
      sim.setBounds(width, height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sim]);

  useEffect(() => {
    if (!bounds || phase !== "stacked" || !topId) return;
    layoutStack(sim, photos, topId, bounds);
  }, [sim, photos, topId, bounds, phase]);

  // Photos dropped in after the pile is already scattered hop in and join
  // the mix, rather than resetting anything already resting on the table.
  useEffect(() => {
    if (pendingEntranceIds.length === 0 || !bounds) return;
    const anchorX = bounds.width / 2;
    const anchorY = bounds.height * 0.58;
    for (const id of pendingEntranceIds) {
      const rot = (Math.random() - 0.5) * 16;
      sim.place(id, anchorX, anchorY, rot);
      const power = Math.min(bounds.width, bounds.height) * (0.03 + Math.random() * 0.015);
      sim.burstOne(id, power);
    }
    setPendingEntranceIds([]);
  }, [pendingEntranceIds, bounds, sim]);

  function explode() {
    if (!bounds) return;
    const power = Math.min(bounds.width, bounds.height) * (0.02 + Math.random() * 0.01);
    sim.scatterAll(power);
    setPhase("scattered");
  }

  function reshuffle() {
    if (!bounds) return;
    const power = Math.min(bounds.width, bounds.height) * (0.022 + Math.random() * 0.012);
    sim.scatterAll(power);
    setFocusedId(null);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    trackRef.current = {
      pointerId: e.pointerId,
      downX: e.clientX,
      downY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      moved: 0,
    };
    // Capture is best-effort: it keeps the drag tracked if the pointer
    // slides off a small card mid-sweep, but a handful of browsers/inputs
    // can reject it (e.g. an already-released pointer id), which must not
    // stop the tap/drag tracking above from taking effect.
    try {
      containerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // ignore — move/up still bubble to the container without capture
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track || track.pointerId !== e.pointerId || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = performance.now();
    const dt = Math.max(MIN_DT_MS, now - track.lastT);
    const dx = e.clientX - track.lastX;
    const dy = e.clientY - track.lastY;
    const dist = Math.hypot(dx, dy);

    track.moved += dist;
    track.lastX = e.clientX;
    track.lastY = e.clientY;
    track.lastT = now;

    if (dist > 0.5 && phase === "scattered") {
      const dirX = dx / dist;
      const dirY = dy / dist;
      const speed = Math.min(MAX_SWEEP_IMPULSE, (dist / dt) * SWEEP_GAIN * 16);
      sim.sweep(x, y, dirX, dirY, speed);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const track = trackRef.current;
    trackRef.current = null;
    if (!track || track.pointerId !== e.pointerId) return;

    if (track.moved < TAP_THRESHOLD_PX) {
      if (phase === "stacked") {
        explode();
      } else if (phase === "scattered") {
        const cardEl = (e.target as HTMLElement).closest<HTMLElement>("[data-photo-id]");
        setFocusedId(cardEl?.dataset.photoId ?? null);
      }
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="visually-hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <header className="app-header">
        <span className="app-header__mark">pêle · mêle</span>
        <div className="app-header__controls">
          {phase !== "empty" && (
            <button type="button" className="upload-btn" onClick={openFilePicker}>
              + Add photos
            </button>
          )}
          {phase === "scattered" && (
            <button type="button" className="shuffle-btn" onClick={reshuffle}>
              Shuffle again
            </button>
          )}
        </div>
      </header>

      <div
        ref={containerRef}
        className={`gallery-canvas${isDragOver ? " is-drag-over" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {phase === "stacked" && (
          <p className="gallery-hint">Tap the table to see what happens</p>
        )}

        {phase === "empty" && (
          <button
            type="button"
            className="dropzone"
            onClick={openFilePicker}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="dropzone__title">Drag your instant photos here</span>
            <span className="dropzone__sub">or click to upload</span>
          </button>
        )}

        {photos.map((photo) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            count={photos.length}
            sim={sim}
            isTop={phase === "stacked" && photo.id === topId}
            focused={focusedId === photo.id}
          />
        ))}
      </div>

      {reviewQueue.length > 0 && (
        <CropReview
          key={reviewQueue[0].id}
          photo={reviewQueue[0]}
          index={1}
          total={reviewQueue.length}
          onConfirm={handleCropConfirm}
          onSkip={handleCropSkip}
          onDiscard={handleCropDiscard}
        />
      )}
    </div>
  );
}

function layoutStack(
  sim: PileSimulation,
  photos: UploadedPhoto[],
  topId: string,
  bounds: { width: number; height: number },
) {
  sim.setRepulsionEnabled(false);
  const anchorX = bounds.width / 2;
  const anchorY = bounds.height * 0.58;

  photos.forEach((photo, i) => {
    const isTop = photo.id === topId;
    const spread = isTop ? 0 : 5 + Math.min(i, 10) * 0.8;
    const dx = isTop ? 0 : (Math.random() - 0.5) * spread * 2;
    const dy = isTop ? 0 : (Math.random() - 0.5) * spread * 1.3;
    const rot = isTop ? (Math.random() - 0.5) * 3 : (Math.random() - 0.5) * 11;

    sim.place(photo.id, anchorX + dx, anchorY + dy, rot);
    sim.setZIndex(photo.id, isTop ? photos.length + 10 : i + 1);
  });
}
