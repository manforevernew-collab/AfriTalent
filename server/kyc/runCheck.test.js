import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { evaluate, decide, publicMessages } from './runCheck.js'
import { screenFile, bestDistance, sniffType } from './screenFile.js'

// A synthetic "ID card": noise texture so the perceptual hash has structure
async function fakeCard({ width = 1200, height = 760, seed = 1, format = 'jpeg', xmp } = {}) {
  const px = Buffer.alloc(width * height * 3)
  let s = seed
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      const band = ((x >> 6) + (y >> 5)) % 2 ? 180 : 60
      const v = (band + (s % 50)) & 255
      const i = (y * width + x) * 3
      px[i] = v; px[i + 1] = (v + x) & 255; px[i + 2] = (v + y) & 255
    }
  }
  let img = sharp(px, { raw: { width, height, channels: 3 } })
  if (xmp) img = img.withXmp(xmp)
  return format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 92 }).toBuffer()
}

test('decision logic', () => {
  assert.equal(decide([]).decision, 'passed')
  assert.equal(decide([{ severity: 'high' }, { severity: 'medium' }]).decision, 'review')
  assert.equal(decide([{ severity: 'reject' }]).decision, 'rejected')
})

test('evaluate: valid NIN passes, bad checksum / expiry / DOB mismatch reject', () => {
  const ok = evaluate({ country: 'NG', idType: 'nin', idNumber: '12345678901', fullName: 'Chioma Okafor', dob: '1995-03-02', profileName: 'Chioma Okafor' })
  assert.equal(decide(ok.flags).decision, 'passed')

  const sa = evaluate({ country: 'ZA', idType: 'sa_id', idNumber: '8001015009088', fullName: 'A B' })
  assert.equal(decide(sa.flags).decision, 'rejected')

  const dob = evaluate({ country: 'ZA', idType: 'sa_id', idNumber: '8001015009087', dob: '1981-01-01', fullName: 'A B' })
  assert.ok(dob.flags.some(f => f.code === 'dob_mismatch'))

  const expired = evaluate({ country: 'NG', idType: 'drivers_licence', idNumber: 'ABC12345AB12', expiry: '2020-01-01', fullName: 'A B' })
  assert.ok(expired.flags.some(f => f.code === 'expired'))
  assert.deepEqual(publicMessages(expired.flags), ['This document has expired.'])
})

test('evaluate: forged MRZ rejected, MRZ/number mismatch rejected', () => {
  const td3 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10'
  const forged = evaluate({ country: 'OTHER', idType: 'passport', idNumber: 'L898902C3', mrz: td3.replace('7408122', '7508122'), fullName: 'Anna Maria Eriksson' })
  assert.ok(forged.flags.some(f => f.code === 'mrz_invalid'))
  const mismatch = evaluate({ country: 'OTHER', idType: 'passport', idNumber: 'X1234567', mrz: td3, fullName: 'Anna Maria Eriksson' })
  assert.ok(mismatch.flags.some(f => f.code === 'mrz_number_mismatch'))
})

test('screenFile: clean photo passes and is fingerprinted', async () => {
  const buf = await fakeCard()
  assert.equal(sniffType(buf), 'image/jpeg')
  const r = await screenFile(buf, { declaredName: 'id.jpg' })
  assert.equal(r.flags.filter(f => f.severity === 'reject').length, 0)
  assert.equal(r.hashes.length, 4)
  assert.equal(r.width, 1200)
})

test('screenFile: edited in Photoshop -> reject', async () => {
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Adobe Photoshop 25.0 (Windows)"/></rdf:RDF></x:xmpmeta>'
  const r = await screenFile(await fakeCard({ xmp }), { declaredName: 'id.jpg' })
  assert.ok(r.flags.some(f => f.code === 'edited_design_tool' && f.severity === 'reject'))
})

test('screenFile: low resolution, disguised type and screenshots', async () => {
  const small = await screenFile(await fakeCard({ width: 380, height: 240 }), { declaredName: 'id.jpg' })
  assert.ok(small.flags.some(f => f.code === 'low_res'))
  const disguised = await screenFile(Buffer.from('MZ\x90\x00 this is an exe not a photo, padding padding'), { declaredName: 'id.jpg' })
  assert.ok(disguised.flags.some(f => f.code === 'bad_type'))
  const shot = await screenFile(await fakeCard({ width: 1080, height: 1920, format: 'png' }), { declaredName: 'id.png' })
  assert.ok(shot.flags.some(f => f.code === 'screenshot'))
})

test('specimen matching survives re-encoding and rotation, but not a different card', async () => {
  const specimen = await screenFile(await fakeCard({ seed: 7 }), { declaredName: 's.jpg' })
  const copy = await sharp(await fakeCard({ seed: 7 })).rotate(90).resize(900).jpeg({ quality: 70 }).toBuffer()
  const submitted = await screenFile(copy, { declaredName: 'id.jpg' })
  assert.ok(bestDistance(submitted.hashes, specimen.hashes[0]) <= 10, 'copy of specimen should match')
  const other = await screenFile(await fakeCard({ seed: 99, width: 1000, height: 1300 }), { declaredName: 'id.jpg' })
  assert.ok(bestDistance(other.hashes, specimen.hashes[0]) > 10, 'different document should not match')
})
