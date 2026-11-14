// ID document rules shared by the browser (instant feedback) and the server
// (authoritative screening). Pure functions, no dependencies.
//
// "strict" rules are deterministic (checksums / encoded dates / ICAO 9303 check
// digits): a failure means the number cannot have been issued, so the
// submission is rejected. "pattern" rules only check the published format; a
// mismatch is flagged for the review team instead of auto-rejecting.

export const COUNTRIES = [
  { code: 'NG', name: 'Nigeria' }, { code: 'GH', name: 'Ghana' }, { code: 'KE', name: 'Kenya' },
  { code: 'ZA', name: 'South Africa' }, { code: 'EG', name: 'Egypt' }, { code: 'UG', name: 'Uganda' },
  { code: 'RW', name: 'Rwanda' }, { code: 'TZ', name: 'Tanzania' }, { code: 'OTHER', name: 'Other country' },
]

// id_type values per country. `mrz` = document carries a machine-readable zone.
export const ID_TYPES = {
  NG: [
    { value: 'nin', label: 'National ID (NIN slip / card)' },
    { value: 'passport', label: 'International passport', mrz: true },
    { value: 'drivers_licence', label: "Driver's licence" },
    { value: 'voters_card', label: "Voter's card (PVC)" },
  ],
  GH: [
    { value: 'ghana_card', label: 'Ghana Card', mrz: true },
    { value: 'passport', label: 'Passport', mrz: true },
    { value: 'drivers_licence', label: "Driver's licence" },
  ],
  KE: [
    { value: 'national_id', label: 'National ID / Maisha Namba' },
    { value: 'passport', label: 'Passport', mrz: true },
    { value: 'drivers_licence', label: "Driver's licence" },
  ],
  ZA: [
    { value: 'sa_id', label: 'Smart ID card / green ID book' },
    { value: 'passport', label: 'Passport', mrz: true },
    { value: 'drivers_licence', label: "Driver's licence" },
  ],
  EG: [
    { value: 'eg_national_id', label: 'National ID card' },
    { value: 'passport', label: 'Passport', mrz: true },
  ],
  UG: [
    { value: 'ug_nin', label: 'National ID (NIN)', mrz: true },
    { value: 'passport', label: 'Passport', mrz: true },
  ],
  RW: [
    { value: 'rw_national_id', label: 'National ID' },
    { value: 'passport', label: 'Passport', mrz: true },
  ],
  TZ: [
    { value: 'tz_nida', label: 'NIDA national ID' },
    { value: 'passport', label: 'Passport', mrz: true },
  ],
  OTHER: [
    { value: 'passport', label: 'Passport', mrz: true },
    { value: 'national_id', label: 'National ID card' },
    { value: 'drivers_licence', label: "Driver's licence" },
  ],
}

export function idTypeInfo(country, idType) {
  return (ID_TYPES[country] || ID_TYPES.OTHER).find(t => t.value === idType) || null
}

export const normalizeIdNumber = s => String(s || '').toUpperCase().replace(/[\s\-./]/g, '')

// ---------- helpers ----------------------------------------------------------
function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export function luhnValid(digits) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return sum % 10 === 0
}

// ---------- country specific -------------------------------------------------
/** South African ID: YYMMDD SSSS C A Z (Luhn). */
export function parseSaId(raw) {
  const id = normalizeIdNumber(raw)
  if (!/^\d{13}$/.test(id)) return { valid: false, reason: 'A South African ID number has exactly 13 digits.' }
  const yy = +id.slice(0, 2), mm = +id.slice(2, 4), dd = +id.slice(4, 6)
  const nowYY = new Date().getUTCFullYear() % 100
  const year = yy > nowYY ? 1900 + yy : 2000 + yy
  if (!validDate(year, mm, dd)) return { valid: false, reason: 'The first six digits are not a real date of birth.' }
  if (!['0', '1', '2'].includes(id[10])) return { valid: false, reason: 'Invalid citizenship digit.' }
  if (!luhnValid(id)) return { valid: false, reason: 'The check digit is wrong — this number was not issued.' }
  return { valid: true, dob: iso(year, mm, dd), sex: +id.slice(6, 10) >= 5000 ? 'M' : 'F' }
}

const EG_GOVERNORATES = new Set(['01', '02', '03', '04', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '31', '32', '33', '34', '35', '88'])

/** Egyptian national ID: C YYMMDD GG SSSS K (14 digits). */
export function parseEgId(raw) {
  const id = normalizeIdNumber(raw)
  if (!/^\d{14}$/.test(id)) return { valid: false, reason: 'An Egyptian national ID has exactly 14 digits.' }
  const century = { 2: 1900, 3: 2000 }[id[0]]
  if (!century) return { valid: false, reason: 'Invalid century digit.' }
  const year = century + +id.slice(1, 3), mm = +id.slice(3, 5), dd = +id.slice(5, 7)
  if (!validDate(year, mm, dd)) return { valid: false, reason: 'The encoded date of birth is not a real date.' }
  if (!EG_GOVERNORATES.has(id.slice(7, 9))) return { valid: false, reason: 'Unknown governorate code.' }
  return { valid: true, dob: iso(year, mm, dd), sex: +id[12] % 2 ? 'M' : 'F' }
}

/** Rwanda national ID: 1 YYYY G NNNNNNN F CC (16 digits). */
export function parseRwId(raw) {
  const id = normalizeIdNumber(raw)
  if (!/^\d{16}$/.test(id)) return { valid: false, reason: 'A Rwandan national ID has exactly 16 digits.' }
  if (!['1', '2', '3'].includes(id[0])) return { valid: false, reason: 'Invalid nationality digit.' }
  const year = +id.slice(1, 5)
  if (year < 1900 || year > new Date().getUTCFullYear()) return { valid: false, reason: 'Invalid birth year.' }
  if (!['7', '8'].includes(id[5])) return { valid: false, reason: 'Invalid gender digit.' }
  return { valid: true, birthYear: year, sex: id[5] === '8' ? 'M' : 'F' }
}

/** Tanzania NIDA: 20 digits, starting with the date of birth YYYYMMDD. */
export function parseTzNida(raw) {
  const id = normalizeIdNumber(raw)
  if (!/^\d{20}$/.test(id)) return { valid: false, reason: 'A NIDA number has exactly 20 digits.' }
  const y = +id.slice(0, 4), m = +id.slice(4, 6), d = +id.slice(6, 8)
  if (!validDate(y, m, d) || y < 1900) return { valid: false, reason: 'The first eight digits are not a real date of birth.' }
  return { valid: true, dob: iso(y, m, d) }
}

const RULES = {
  sa_id: { strict: true, parse: parseSaId },
  eg_national_id: { strict: true, parse: parseEgId },
  rw_national_id: { strict: true, parse: parseRwId },
  tz_nida: { strict: true, parse: parseTzNida },
  nin: { strict: true, re: /^\d{11}$/, hint: 'An NIN has exactly 11 digits.' },
  ghana_card: { strict: true, re: /^GHA\d{10}$/, hint: 'A Ghana Card number looks like GHA-123456789-0.' },
  ug_nin: { strict: true, re: /^C[MF][A-Z0-9]{12}$/, hint: 'A Ugandan NIN has 14 characters and starts with CM or CF.' },
  national_id: { re: /^[A-Z0-9]{6,12}$/, hint: 'Expected 6–12 letters or digits.' },
  passport: { re: /^[A-Z0-9]{6,9}$/, hint: 'Passport numbers have 6–9 letters or digits.' },
  drivers_licence: { re: /^[A-Z0-9]{6,16}$/, hint: "Expected 6–16 letters or digits." },
  voters_card: { re: /^[A-Z0-9]{19}$/, hint: "A PVC VIN has 19 characters." },
}
// Country-specific passport shapes (pattern only)
const PASSPORT_RE = { NG: /^[A-Z]\d{8}$/, GH: /^[A-Z]\d{7}$/, KE: /^[A-Z]{1,2}\d{6,7}$/, ZA: /^[A-Z]\d{8}$/ }
const DL_RE = { NG: /^[A-Z]{3}\d{5}[A-Z]{2}\d{2}$/ }

/**
 * Validate an ID number. Returns { valid, strict, reason?, dob?, birthYear?, sex? }.
 * valid=false && strict=true  -> the number cannot exist (auto-reject)
 * valid=false && strict=false -> unusual format (flag for review)
 */
export function validateIdNumber(country, idType, raw) {
  const id = normalizeIdNumber(raw)
  if (!id) return { valid: false, strict: true, reason: 'Enter the number printed on your ID.' }
  const rule = RULES[idType]
  if (!rule) return { valid: /^[A-Z0-9]{4,20}$/.test(id), strict: false, reason: 'Unrecognised format.' }
  if (rule.parse) return { strict: true, ...rule.parse(id) }
  let re = rule.re
  let strict = !!rule.strict
  if (idType === 'passport' && PASSPORT_RE[country]) re = PASSPORT_RE[country]
  if (idType === 'drivers_licence' && DL_RE[country]) re = DL_RE[country]
  const valid = re.test(id)
  return valid ? { valid: true, strict } : { valid: false, strict, reason: rule.hint }
}

// ---------- ICAO 9303 machine-readable zone ----------------------------------
const MRZ_W = [7, 3, 1]
function mrzValue(c) {
  if (c === '<') return 0
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55
  return NaN
}
export function mrzCheckDigit(str) {
  let sum = 0
  for (let i = 0; i < str.length; i++) {
    const v = mrzValue(str[i])
    if (Number.isNaN(v)) return -1
    sum += v * MRZ_W[i % 3]
  }
  return sum % 10
}
const ck = (field, digit) => digit !== '<' && mrzCheckDigit(field) === Number(digit)

function mrzDate(yymmdd, kind) {
  if (!/^\d{6}$/.test(yymmdd)) return null
  const yy = +yymmdd.slice(0, 2), mm = +yymmdd.slice(2, 4), dd = +yymmdd.slice(4, 6)
  const nowYY = new Date().getUTCFullYear() % 100
  // birth dates are in the past; expiry dates are within the next ~20 years
  const year = kind === 'birth' ? (yy > nowYY ? 1900 + yy : 2000 + yy) : (yy >= 70 ? 1900 + yy : 2000 + yy)
  return validDate(year, mm, dd) ? iso(year, mm, dd) : null
}
const mrzName = s => s.replace(/<+$/, '').split('<<').map(p => p.replace(/</g, ' ').trim()).filter(Boolean)

/**
 * Parse + verify a TD3 (passport, 2x44) or TD1 (ID card, 3x30) MRZ.
 * Returns { valid, format, errors[], documentNumber, nationality, dob, expiry, sex, surname, givenNames }
 */
export function parseMrz(text) {
  const lines = String(text || '').toUpperCase().replace(/[ \t]/g, '').replace(/«/g, '<')
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const errors = []
  if (lines.length === 2 && lines.every(l => l.length === 44)) {
    const [l1, l2] = lines
    const out = { format: 'TD3', documentNumber: l2.slice(0, 9).replace(/</g, ''), nationality: l2.slice(10, 13).replace(/</g, ''),
      dob: mrzDate(l2.slice(13, 19), 'birth'), sex: l2[20], expiry: mrzDate(l2.slice(21, 27), 'expiry'), issuer: l1.slice(2, 5).replace(/</g, '') }
    const [surname, given = ''] = mrzName(l1.slice(5))
    Object.assign(out, { surname, givenNames: given })
    if (l1[0] !== 'P') errors.push('Line 1 of a passport MRZ starts with P.')
    if (!ck(l2.slice(0, 9), l2[9])) errors.push('Document number check digit is wrong.')
    if (!ck(l2.slice(13, 19), l2[19])) errors.push('Date of birth check digit is wrong.')
    if (!ck(l2.slice(21, 27), l2[27])) errors.push('Expiry date check digit is wrong.')
    if (l2[42] !== '<' || /[^<]/.test(l2.slice(28, 42))) { if (!ck(l2.slice(28, 42), l2[42])) errors.push('Personal number check digit is wrong.') }
    if (!ck(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), l2[43])) errors.push('Overall (composite) check digit is wrong.')
    if (!out.dob) errors.push('Date of birth is not a real date.')
    if (!out.expiry) errors.push('Expiry date is not a real date.')
    return { valid: errors.length === 0, errors, ...out }
  }
  if (lines.length === 3 && lines.every(l => l.length === 30)) {
    const [l1, l2, l3] = lines
    const out = { format: 'TD1', documentNumber: l1.slice(5, 14).replace(/</g, ''), issuer: l1.slice(2, 5).replace(/</g, ''),
      dob: mrzDate(l2.slice(0, 6), 'birth'), sex: l2[7], expiry: mrzDate(l2.slice(8, 14), 'expiry'), nationality: l2.slice(15, 18).replace(/</g, '') }
    const [surname, given = ''] = mrzName(l3)
    Object.assign(out, { surname, givenNames: given })
    if (!ck(l1.slice(5, 14), l1[14])) errors.push('Document number check digit is wrong.')
    if (!ck(l2.slice(0, 6), l2[6])) errors.push('Date of birth check digit is wrong.')
    if (!ck(l2.slice(8, 14), l2[14])) errors.push('Expiry date check digit is wrong.')
    if (!ck(l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29), l2[29])) errors.push('Overall (composite) check digit is wrong.')
    if (!out.dob) errors.push('Date of birth is not a real date.')
    if (!out.expiry) errors.push('Expiry date is not a real date.')
    return { valid: errors.length === 0, errors, ...out }
  }
  return { valid: false, format: null, errors: ['The MRZ must be 2 lines of 44 characters (passport) or 3 lines of 30 characters (ID card).'] }
}

// ---------- names & dates ----------------------------------------------------
const nameTokens = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(t => t.length > 1)

/** Share of the shorter name's tokens found in the other (order-insensitive). 0..1 */
export function nameSimilarity(a, b) {
  const A = nameTokens(a), B = new Set(nameTokens(b))
  if (!A.length || !B.size) return 0
  const shorter = A.length <= B.size ? A : [...B]
  const other = A.length <= B.size ? B : new Set(A)
  return shorter.filter(t => other.has(t)).length / shorter.length
}

export function ageOn(dobIso, at = new Date()) {
  const d = new Date(`${dobIso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  let age = at.getUTCFullYear() - d.getUTCFullYear()
  const m = at.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < d.getUTCDate())) age--
  return age
}
