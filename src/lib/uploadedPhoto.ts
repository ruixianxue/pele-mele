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
 * Reads a file into an object URL, measures it, and runs a quick auto-crop
 * guess. The object URL is kept for the card's <img src> — callers own it
 * and must revoke it (see revokePhoto) once the photo is no longer shown.
 */
export function loadImageFile(file: File): Promise<UploadedPhoto> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        suggestedCrop: detectCropBox(img),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read image: ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * Straightens the region of a photo inside `quad` into a new axis-aligned
 * image and returns it as a fresh UploadedPhoto. A quad that happens to be
 * an axis-aligned rectangle degrades to a plain crop; an arbitrary
 * (keystoned) quad gets perspective-corrected — see perspectiveWarp.ts.
 * Does not revoke the source photo's URL — the caller decides when the
 * original is no longer needed.
 */
export function warpPhoto(photo: UploadedPhoto, quad: Quad): Promise<UploadedPhoto> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let canvas: HTMLCanvasElement;
      try {
        canvas = warpQuadToCanvas(img, quad);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Could not crop image"));
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not crop image"));
          return;
        }
        resolve({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: URL.createObjectURL(blob),
          naturalWidth: canvas.width,
          naturalHeight: canvas.height,
        });
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Could not read image for cropping"));
    img.src = photo.url;
  });
}

export function revokePhoto(photo: UploadedPhoto) {
  URL.revokeObjectURL(photo.url);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
