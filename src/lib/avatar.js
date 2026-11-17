// Turn any uploaded photo into a centred square JPEG (512×512) so avatars always render as clean
// circles — no stretched/tall images, and phone photos shrink from several MB to ~50 KB.
export async function squareAvatar(file, size = 512) {
  if (!file?.type?.startsWith('image/')) throw new Error('Please choose an image file (JPG or PNG).')
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is too large (max 15 MB).')
  const bitmap = await loadImage(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  // Bias portrait photos slightly upwards so faces stay in frame
  const sy = bitmap.height > bitmap.width ? Math.max(0, (bitmap.height - side) * 0.3) : (bitmap.height - side) / 2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/jpeg', 0.88))
}

async function loadImage(file) {
  // createImageBitmap honours EXIF orientation (rotated phone photos)
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* fall back */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read that image.'))
    img.src = URL.createObjectURL(file)
  })
}
