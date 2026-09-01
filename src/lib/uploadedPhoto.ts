import { detectCropBox, type CropBox } from "./autoCrop";

export interface UploadedPhoto {
  id: string;
  url: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Best-effort guess at the print's boundary, for pre-filling the crop
   * tool. Undefined once a photo has actually been cropped (see cropPhoto)
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
 * Renders the given crop of a photo to a new image and returns it as a
 * fresh UploadedPhoto. Does not revoke the source photo's URL — the caller
 * decides when the original is no longer needed.
 */
export function cropPhoto(photo: UploadedPhoto, box: CropBox): Promise<UploadedPhoto> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D is not supported"));
        return;
      }
      ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not crop image"));
          return;
        }
        resolve({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: URL.createObjectURL(blob),
          naturalWidth: width,
          naturalHeight: height,
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
