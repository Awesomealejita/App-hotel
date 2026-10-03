/**
 * Reduce las fotos del móvil (3-8 MB) a ~150-300 KB antes de subirlas,
 * para que el 1 GB de almacenamiento del plan gratuito dure años.
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.75): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // formato no soportado por el navegador (p. ej. HEIC en algunos Android): se sube tal cual
  }
}
