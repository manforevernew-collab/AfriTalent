// Automated KYC pre-screening. Runs on the server with the service-role key.
// Result goes to kyc_verifications.auto_* columns:
//   rejected -> obvious fake / invalid; never reaches the review team
//   review   -> plausible but risky; team sees the flags first
//   passed   -> clean; team gives the final approve/decline

import { createHmac } from 'node:crypto'
import {
  validateIdNumber, normalizeIdNumber, parseMrz, idTypeInfo, nameSimilarity, ageOn,
} from '../../shared/idRules.js'
import { screenFile, bestDistance, hamming } from './screenFile.js'

export const MAX_ATTEMPTS = 10
const WEIGHT = { reject: 100, high: 30, medium: 12, info: 0 }
// Messages users may see verbatim; forensic reasons stay internal so fraudsters
// can't tune their forgeries against them.
const PUBLIC_CODES = new Set(['id_number_invalid', 'id_number_format', 'expired', 'dob_mismatch', 'mrz_invalid',
  'mrz_number_mismatch', 'mrz_dob_mismatch', 'bad_type', 'low_res', 'tiny_file', 'corrupt', 'underage', 'mrz_missing',
  'missing_document', 'missing_certificate'])

const today = () => new Date().toISOString().slice(0, 10)

export function idNumberHash(country, idType, idNumber) {
  const secret = process.env.KYC_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-only-secret'
  return createHmac('sha256', secret).update(`${country}:${idType}:${normalizeIdNumber(idNumber)}`).digest('hex')
}

async function download(db, path) {
  const { data, error } = await db.storage.from('kyc').download(path)
  if (error) throw new Error(`Could not read ${path}: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

/**
 * Pure decision logic over the collected facts (unit-testable, no I/O).
 */
export function evaluate({ country, idType, idNumber, fullName, dob, expiry, mrz, profileName }) {
  const flags = []
  const add = (code, severity, message) => flags.push({ code, severity, message })
  const info = idTypeInfo(country, idType)
  if (!info) add('id_type_unknown', 'high', 'Unknown ID type for the selected country.')

  const num = validateIdNumber(country, idType, idNumber)
  if (!num.valid) add(num.strict ? 'id_number_invalid' : 'id_number_format', num.strict ? 'reject' : 'high', num.reason || 'ID number format not recognised.')
  if (num.valid && num.dob && dob && num.dob !== dob) add('dob_mismatch', 'reject', 'The date of birth does not match the one encoded in the ID number.')
  if (num.valid && num.birthYear && dob && Number(dob.slice(0, 4)) !== num.birthYear) add('dob_mismatch', 'reject', 'The birth year does not match the ID number.')

  let effectiveExpiry = expiry || null
  let effectiveDob = dob || num.dob || null
  if (mrz && String(mrz).trim()) {
    const m = parseMrz(mrz)
    if (!m.valid) add('mrz_invalid', 'reject', `Machine-readable zone failed verification: ${m.errors.join(' ')}`)
    else {
      if (normalizeIdNumber(m.documentNumber) !== normalizeIdNumber(idNumber) &&
          !normalizeIdNumber(idNumber).includes(normalizeIdNumber(m.documentNumber))) {
        add('mrz_number_mismatch', 'reject', 'The document number in the MRZ does not match the number you entered.')
      }
      if (dob && m.dob && m.dob !== dob) add('mrz_dob_mismatch', 'reject', 'The date of birth in the MRZ does not match the one you entered.')
      if (expiry && m.expiry && m.expiry !== expiry) add('mrz_expiry_mismatch', 'high', 'The expiry date in the MRZ does not match the one you entered.')
      if (fullName && nameSimilarity(fullName, `${m.givenNames} ${m.surname}`) < 0.5) add('mrz_name_mismatch', 'high', 'The name in the MRZ does not match the name entered.')
      effectiveExpiry = m.expiry || effectiveExpiry
      effectiveDob = m.dob || effectiveDob
    }
  } else if (info?.mrz && idType === 'passport') {
    add('mrz_missing', 'medium', 'Passport MRZ (the two lines of <<< text) was not provided.')
  }

  if (effectiveExpiry && effectiveExpiry < today()) add('expired', 'reject', 'This document has expired.')
  if (effectiveDob) {
    const age = ageOn(effectiveDob)
    if (age === null || age < 0 || age > 110) add('dob_invalid', 'reject', 'The date of birth is not plausible.')
    else if (age < 16) add('underage', 'high', 'The holder appears to be under 16.')
  }
  if (fullName && profileName && nameSimilarity(fullName, profileName) < 0.5) {
    add('name_mismatch_profile', 'medium', `Name on ID ("${fullName}") differs from the account name ("${profileName}").`)
  }
  return { flags, effectiveDob, effectiveExpiry }
}

export function decide(flags) {
  if (flags.some(f => f.severity === 'reject')) return { decision: 'rejected', riskScore: 100 }
  const riskScore = Math.min(99, flags.reduce((s, f) => s + (WEIGHT[f.severity] || 0), 0))
  return { decision: riskScore >= 40 ? 'review' : 'passed', riskScore }
}

export const publicMessages = flags => {
  const pub = flags.filter(f => PUBLIC_CODES.has(f.code) && f.severity !== 'info').map(f => f.message)
  if (flags.some(f => f.severity === 'reject' && !PUBLIC_CODES.has(f.code))) pub.push('The document failed our authenticity checks. Please upload a clear photo of your original, unedited ID.')
  return [...new Set(pub)]
}

/**
 * Screen one kyc_verifications row. `fields` are the details typed by the user
 * (sent to the API, never stored in clear).
 */
export async function runKycCheck(db, { kycId, actorId, actorIsAdmin = false, fields = {} }) {
  const { data: row, error } = await db.from('kyc_verifications').select('*').eq('id', kycId).maybeSingle()
  if (error) throw error
  if (!row) return { status: 404, error: 'Verification not found' }
  if (!actorIsAdmin && row.user_id !== actorId) return { status: 403, error: 'Not your verification' }
  if (!actorIsAdmin && (row.screen_attempts || 0) >= MAX_ATTEMPTS) {
    return { status: 429, error: 'Too many attempts. Please contact support.' }
  }
  if (!actorIsAdmin && row.status === 'approved') return { status: 409, error: 'Already approved' }

  const country = fields.country || row.country || 'OTHER'
  const idType = fields.idType || row.id_type || 'national_id'
  const { data: profile } = await db.from('profiles').select('full_name').eq('id', row.user_id).maybeSingle()

  // Admin re-runs have no typed number; keep the previous ID-number verdicts.
  const hasNumber = !!normalizeIdNumber(fields.idNumber)
  const evalRes = hasNumber
    ? evaluate({ country, idType, idNumber: fields.idNumber, fullName: fields.fullName, dob: fields.dob, expiry: fields.expiry, mrz: fields.mrz, profileName: profile?.full_name })
    : { flags: (row.auto_flags || []).filter(f => f.source !== 'file'), effectiveDob: row.date_of_birth, effectiveExpiry: row.expiry_date }
  const flags = [...evalRes.flags]
  const add = (code, severity, message) => flags.push({ code, severity, message, source: 'file' })

  // Duplicate ID number across accounts
  let numberHash = row.id_number_hash
  if (hasNumber) {
    numberHash = idNumberHash(country, idType, fields.idNumber)
    const { data: dup } = await db.from('kyc_verifications').select('id').eq('id_number_hash', numberHash).neq('user_id', row.user_id).limit(1)
    if (dup?.length) flags.push({ code: 'duplicate_id_number', severity: 'reject', message: 'This ID number is already registered to another account.', source: 'number' })
  }

  // Document forensics
  let file = null
  const path = row.id_document_url || ''
  if (!path) add('missing_document', 'reject', 'No ID document uploaded.')
  else if (/^https?:/i.test(path)) add('legacy_url', 'medium', 'Document stored by the old uploader — check it manually.')
  else if (!actorIsAdmin && !path.startsWith(`kyc/${row.user_id}/`)) add('foreign_document', 'reject', 'Document path does not belong to this account.')
  else {
    file = await screenFile(await download(db, path), { declaredName: path })
    file.flags.forEach(f => add(f.code, f.severity, f.message))
    if (file.sha256) {
      const { data: dupFile } = await db.from('kyc_verifications').select('id').eq('doc_sha256', file.sha256).neq('user_id', row.user_id).limit(1)
      if (dupFile?.length) add('duplicate_document', 'reject', 'The same document image was submitted by another account.')
    }
    if (file.hashes.length) {
      const { data: others } = await db.from('kyc_verifications').select('doc_dhash').neq('user_id', row.user_id).not('doc_dhash', 'is', null).limit(5000)
      if ((others || []).some(o => bestDistance(file.hashes, o.doc_dhash) <= 4)) {
        if (!flags.some(f => f.code === 'duplicate_document')) add('duplicate_document', 'reject', 'A near-identical document was submitted by another account.')
      }
      const { data: specimens } = await db.from('kyc_specimens').select('label, dhash')
      let best = { d: 64 }
      for (const s of specimens || []) {
        const d = bestDistance(file.hashes, s.dhash)
        if (d < best.d) best = { d, label: s.label }
      }
      if (best.d <= 10) add('matches_specimen', 'reject', `Matches the official specimen "${best.label}" (distance ${best.d}/64).`)
      else if (best.d <= 14) add('similar_to_specimen', 'high', `Very similar to the official specimen "${best.label}" (distance ${best.d}/64).`)
    }
  }

  // Business accounts: registration certificate
  if (row.type === 'business') {
    const cert = row.certificate_url || ''
    if (!cert) add('missing_certificate', 'high', 'Business registration certificate not uploaded.')
    else if (!/^https?:/i.test(cert) && (actorIsAdmin || cert.startsWith(`kyc/${row.user_id}/`))) {
      const c = await screenFile(await download(db, cert), { declaredName: cert })
      c.flags.filter(f => f.severity !== 'info').forEach(f => add(`cert_${f.code}`, f.severity, `Certificate: ${f.message}`))
    }
  }

  const { decision, riskScore } = decide(flags)
  const update = {
    auto_status: decision,
    risk_score: riskScore,
    auto_flags: flags,
    auto_checked_at: new Date().toISOString(),
    screen_attempts: (row.screen_attempts || 0) + (actorIsAdmin ? 0 : 1),
    country, id_type: idType,
    id_number_hash: numberHash,
    ...(hasNumber ? { id_last4: normalizeIdNumber(fields.idNumber).slice(-4) } : {}),
    ...(fields.fullName ? { full_name_on_id: String(fields.fullName).slice(0, 120) } : {}),
    date_of_birth: evalRes.effectiveDob || null,
    expiry_date: evalRes.effectiveExpiry || null,
    doc_sha256: file?.sha256 || row.doc_sha256 || null,
    doc_dhash: file?.hashes?.[0] || row.doc_dhash || null,
    status: decision === 'rejected' ? 'rejected' : (row.status === 'approved' ? 'approved' : 'pending'),
  }
  const { error: upErr } = await db.from('kyc_verifications').update(update).eq('id', row.id)
  if (upErr) throw upErr
  if (row.status !== 'approved') {
    await db.from('profiles').update({ kyc_status: decision === 'rejected' ? 'rejected' : 'pending' }).eq('id', row.user_id)
  }
  return { status: 200, decision, riskScore, messages: publicMessages(flags), flags: actorIsAdmin ? flags : undefined }
}

export { hamming }
