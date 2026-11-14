import { supabase } from './supabase'
import { apiUrl } from './api'
import { safeHref } from './jobs'

const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
export const MAX_UPLOAD = 10 * 1024 * 1024

export function checkFile(file, { imagesOnly = false } = {}) {
  if (!file) return 'Choose a file.'
  if (!ALLOWED[file.type] || (imagesOnly && file.type === 'application/pdf')) {
    return imagesOnly ? 'Upload a JPG, PNG or WebP photo.' : 'Upload a JPG, PNG, WebP or PDF file.'
  }
  if (file.size > MAX_UPLOAD) return 'File is larger than 10 MB.'
  return null
}

/** Upload into the private `kyc` bucket under <folder>/<uid>/ and return the storage path. */
export async function uploadPrivate(file, folder, userId, prefix = 'doc') {
  const ext = ALLOWED[file.type] || 'bin'
  const path = `${folder}/${userId}/${prefix}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('kyc').upload(path, file, { contentType: file.type, upsert: false })
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error('Document storage is not set up yet. Please contact support.')
    if (/row-level security|unauthorized|403/i.test(error.message)) throw new Error('Upload not permitted — please sign out and in again. If it persists, the storage policies migration has not been run.')
    throw error
  }
  return path
}

/**
 * Resolve a stored document reference for viewing: new rows hold a private
 * storage path (signed for 5 minutes); legacy rows hold a full URL.
 */
export async function documentLink(ref) {
  if (!ref) return null
  if (/^https?:/i.test(ref)) return safeHref(ref)
  const { data, error } = await supabase.storage.from('kyc').createSignedUrl(ref, 300)
  return error ? null : data.signedUrl
}

async function authedPost(url, body, method = 'POST') {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(apiUrl(url), {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body),
  })
  let json = {}
  try { json = await res.json() } catch { /* empty */ }
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), { status: res.status, body: json })
  return json
}

export const screenKyc = body => authedPost('/api/kyc-check', body)
export const addSpecimen = body => authedPost('/api/kyc-specimen', body)
export const deleteSpecimen = id => authedPost('/api/kyc-specimen', { id }, 'DELETE')
export const triggerBusinessSync = () => authedPost('/api/sync-businesses', {})

export const RISK_STYLE = {
  passed: { label: 'Checks passed', bg: '#dcfce7', color: '#166534', icon: 'fas fa-shield-alt' },
  review: { label: 'Needs careful review', bg: '#fef3c7', color: '#92400e', icon: 'fas fa-exclamation-triangle' },
  rejected: { label: 'Auto-rejected', bg: '#fee2e2', color: '#991b1b', icon: 'fas fa-ban' },
  pending: { label: 'Not screened yet', bg: '#e2e8f0', color: '#334155', icon: 'fas fa-hourglass-half' },
}
