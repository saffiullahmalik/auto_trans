// Image helpers for replacing a solution-step image with a translated version:
// copy the original to the clipboard (for an AI image tool), paste or upload a
// new one, and keep replacements in drafts.

/** Clipboard image writes only accept PNG, so convert other formats first. */
export async function toPngBlob(blob) {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the image'))), 'image/png'));
}

export async function copyImageToClipboard(blob) {
  const png = await toPngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** The first image on the clipboard as a File, or null. */
export async function readImageFromClipboard(baseName = 'translated') {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) {
      const blob = await item.getType(type);
      return new File([blob], `${baseName}.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type });
    }
  }
  return null;
}

export function isImageFile(file) {
  return !!file && /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(file.type);
}

/** Name for an uploaded replacement: keeps the original's base name so it is easy to recognise. */
export function replacementName(originalPath, file) {
  const base = String(originalPath ?? 'image').split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  return `${base}-urdu.${ext}`;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function dataUrlToFile(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type });
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
