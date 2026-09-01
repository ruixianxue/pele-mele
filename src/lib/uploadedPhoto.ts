export interface UploadedPhoto {
  id: string;
  url: string;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Reads a file into an object URL and measures it. The object URL is kept
 * for the card's <img src> — callers own it and must revoke it (see
 * revokePhoto) once the photo is no longer shown.
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
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取图片：${file.name}`));
    };
    img.src = url;
  });
}

export function revokePhoto(photo: UploadedPhoto) {
  URL.revokeObjectURL(photo.url);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
