// Forensic checks on an uploaded ID document (server side only).
//
// What this can detect reliably: wrong/disguised file types, images too small
// to verify, files exported from design / photo-editing software, screenshots,
// PDFs stamped SPECIMEN/SAMPLE, and copies of the official specimen images in
// the specimen library (perceptual hash). It cannot prove a physical card is
// genuine — that needs a government-database check (see README).

import { createHash } from 'node:crypto'
import sharp from 'sharp'

// Untrusted input: refuse decompression bombs and keep libvips single-threaded.
sharp.concurrency(1)
const SHARP_OPTS = { limitInputPixels: 50_000_000, failOn: 'error' }

export function sniffType(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf'
  return null
}

// Software that composes/forges documents -> reject. Photo apps -> flag.
const DESIGN_TOOLS = /(Adobe Photoshop|Photoshop|GIMP|Canva|Photopea|Adobe Illustrator|CorelDRAW|Inkscape|Affinity (Photo|Designer)|Pixelmator|Paint\.NET|Krita|Figma)/i
const PHOTO_APPS = /(Snapseed|PicsArt|Lightroom|Fotor|Remini|FaceApp|Meitu|VSCO|PhotoDirector|Picsart)/i

function metadataText(buf) {
  // EXIF/XMP/PDF info dictionaries live near the start (images) or end (PDF trailer)
  const head = buf.subarray(0, Math.min(buf.length, 256 * 1024)).toString('latin1')
  const tail = buf.length > 256 * 1024 ? buf.subarray(buf.length - 64 * 1024).toString('latin1') : ''
  return head + tail
}

/** 64-bit difference hash as 16 hex chars. */
export async function dHash(input, rotate = 0) {
  const { data } = await sharp(input, SHARP_OPTS).rotate(rotate || undefined).greyscale()
    .resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  let bits = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n)
    }
  }
  return bits.toString(16).padStart(16, '0')
}

export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let n = 0
  while (x) { n += Number(x & 1n); x >>= 1n }
  return n
}

const SCREEN_SIZES = new Set(['1080x1920', '1170x2532', '1179x2556', '1284x2778', '1290x2796', '750x1334', '828x1792',
  '1125x2436', '1242x2688', '720x1600', '1080x2400', '1080x2340', '1440x3200', '1920x1080', '1366x768', '1536x864',
  '1440x900', '2560x1440', '1280x720', '1600x900'])

/**
 * Screen one file. Returns:
 * { mime, sha256, width, height, hashes: [dhash rot0, rot90, rot180, rot270], flags: [{code, severity, message}] }
 * severity: 'reject' | 'high' | 'medium' | 'info'
 */
export async function screenFile(buf, { declaredName = '' } = {}) {
  const flags = []
  const add = (code, severity, message) => flags.push({ code, severity, message })
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const mime = sniffType(buf)
  const out = { mime, sha256, size: buf.length, width: null, height: null, hashes: [], flags }

  if (!mime) { add('bad_type', 'reject', 'The file is not a real JPG, PNG, WebP or PDF.'); return out }
  const ext = (declaredName.split('.').pop() || '').toLowerCase()
  const extMime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[ext]
  if (extMime && extMime !== mime) add('ext_mismatch', 'high', `File is named .${ext} but is actually ${mime}.`)
  if (buf.length < 25 * 1024) add('tiny_file', 'high', 'File is very small — too little detail to verify a real document.')

  const meta = metadataText(buf)
  const design = meta.match(DESIGN_TOOLS)
  if (design) add('edited_design_tool', 'reject', `The file was produced or edited with ${design[1]}.`)
  const photo = !design && meta.match(PHOTO_APPS)
  if (photo) add('edited_photo_app', 'high', `The image was processed with ${photo[1]}.`)

  if (mime === 'application/pdf') {
    if (/\b(SPECIMEN|SAMPLE ONLY|NOT VALID|VOID)\b/.test(meta)) add('specimen_text', 'reject', 'The PDF contains SPECIMEN/SAMPLE wording.')
    const producer = meta.match(/\/(Producer|Creator)\s*\(([^)]{1,80})\)/)
    if (producer && /(Word|PowerPoint|Excel|LibreOffice|Google Docs|Pages|Keynote)/i.test(producer[2])) {
      add('pdf_office_app', 'high', `PDF was created in ${producer[2]} rather than scanned.`)
    }
    add('pdf_manual', 'info', 'PDF — visual checks need a person; an image (photo of the card) can be screened automatically.')
    return out
  }

  // Images
  let md
  try {
    md = await sharp(buf, SHARP_OPTS).metadata()
  } catch {
    add('corrupt', 'reject', 'The image is corrupt or could not be decoded.')
    return out
  }
  const w = md.autoOrient?.width ?? md.width
  const h = md.autoOrient?.height ?? md.height
  out.width = w
  out.height = h
  const short = Math.min(w, h)
  if (short < 400) add('low_res', 'reject', `Image is ${w}×${h}px — too low resolution to verify.`)
  else if (short < 700) add('lowish_res', 'medium', `Image is only ${w}×${h}px.`)

  const exif = md.exif ? md.exif.toString('latin1') : ''
  const hasCamera = /(Apple|samsung|SAMSUNG|HUAWEI|Xiaomi|OPPO|vivo|Google|TECNO|Infinix|itel|Canon|NIKON|SONY|motorola|OnePlus|Nokia|realme|HONOR|LGE|HMD)/.test(exif)
  if (mime === 'image/png' && !hasCamera && (SCREEN_SIZES.has(`${w}x${h}`) || SCREEN_SIZES.has(`${h}x${w}`))) {
    add('screenshot', 'high', 'Looks like a screenshot rather than a photo or scan of the card.')
  }
  if (!hasCamera && mime === 'image/jpeg' && !design && !photo) {
    add('no_camera_exif', 'info', 'No camera information (common for images sent via WhatsApp).')
  }

  try {
    const base = await sharp(buf, SHARP_OPTS).rotate().toBuffer() // apply EXIF orientation
    out.hashes = await Promise.all([0, 90, 180, 270].map(r => dHash(base, r)))
  } catch {
    add('hash_failed', 'medium', 'Could not fingerprint the image.')
  }
  return out
}

/** Smallest hamming distance between any rotation of `hashes` and `target`. */
export function bestDistance(hashes, target) {
  if (!hashes?.length || !target) return 64
  return Math.min(...hashes.map(h => hamming(h, target)))
}
