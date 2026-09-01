import { detectCropBox, type CropBox } from "./autoCrop";
import { warpQuadToCanvas } from "./perspectiveWarp";
import type { Quad } from "./quad";

export interface UploadedPhoto {
  id: string;
  url: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Best-effort guess at the print's boundary, for pre-filling the crop
   * tool. Undefined once a photo has actually been cropped (see warpPhoto)
   * — there's nothing left to suggest at that point. */
  suggestedCrop?: CropBox;
}

/**
 * Decodes with EXIF orientation explicitly applied. A phone photo is often
 * stored "sideways" with an orientation tag telling viewers to rotate it —
 * <img> and CSS apply that automatically for display, but a plain
 * `new Image()` fed into a canvas has historically been inconsistent about
 * it across browsers. createImageBitmap with imageOrientation: "from-image"
 * makes it explicit, so the pixels we actually sample always match what
 * the user sees (and drags the crop corners against) in the preview.
 */
function decodeOriented(source: Blob): Promise<ImageBitmap> {
  return createImageBitmap(source, { imageOrientation: "from-image" });
}

/**
 * Reads a file into an object URL, measures it, and runs a quick auto-crop
 * guess. The object URL is kept for the card's <img src> — callers own it
 * and must revoke it (see revokePhoto) once the photo is no longer shown.
 */
export async function loadImageFile(file: File): Promise<UploadedPhoto> {
  const url = URL.createObjectURL(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeOriented(file);
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`Could not read image: ${file.name}`);
  }
  try {
    return {
      id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      naturalWidth: bitmap.width,
      naturalHeight: bitmap.height,
      suggestedCrop: detectCropBox(bitmap),
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Straightens the region of a photo inside `quad` into a new axis-aligned
 * image and returns it as a fresh UploadedPhoto. A quad that happens to be
 * an axis-aligned rectangle degrades to a plain crop; an arbitrary
 * (keystoned) quad gets perspective-corrected — see perspectiveWarp.ts.
 * Does not revoke the source photo's URL — the caller decides when the
 * original is no longer needed.
 */
export async function warpPhoto(photo: UploadedPhoto, quad: Quad): Promise<UploadedPhoto> {
  let sourceBlob: Blob;
  try {
    sourceBlob = await fetch(photo.url).then((r) => r.blob());
  } catch {
    throw new Error("Could not read image for cropping");
  }

  const bitmap = await decodeOriented(sourceBlob);
  let canvas: HTMLCanvasElement;
  try {
    canvas = warpQuadToCanvas(bitmap, quad);
  } finally {
    bitmap.close();
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not crop image");

  return {
    id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: URL.createObjectURL(blob),
    naturalWidth: canvas.width,
    naturalHeight: canvas.height,
  };
}

export function revokePhoto(photo: UploadedPhoto) {
  URL.revokeObjectURL(photo.url);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
