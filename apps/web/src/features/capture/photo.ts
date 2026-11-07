/** Longest side of a stored field photo. Enough to read a tag or a meter, small enough for a weak signal. */
export const PHOTO_MAX_SIDE = 1280;
export const PHOTO_JPEG_QUALITY = 0.7;

/** Size that fits within `max` on the longest side, keeping the shape. Never enlarges. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality = PHOTO_JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be made.'))), 'image/jpeg', quality);
  });
}

function draw(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const size = fitWithin(width, height);
  if (size.width === 0) return Promise.reject(new Error('The camera gave an empty picture.'));
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('This phone cannot make the photo.'));
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvasToJpeg(canvas);
}

/** The current camera frame as a compressed JPEG. */
export const captureVideoFrame = (video: HTMLVideoElement): Promise<Blob> =>
  draw(video, video.videoWidth, video.videoHeight);

/** A picked or native-camera file as a compressed JPEG, turned the right way up. */
export async function compressImageFile(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      return await draw(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await draw(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}
