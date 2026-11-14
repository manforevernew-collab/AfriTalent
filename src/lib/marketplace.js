// Wallet, gigs, escrow, boosts and ads — thin wrappers over the database functions.
// All money is in minor units (kobo/cents) in the database.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const SYMBOL = { NGN: '₦', GHS: 'GH₵', KES: 'KSh ', ZAR: 'R', USD: '$', EUR: '€', GBP: '£' }

export function formatMoney(minor, currency = 'NGN', { decimals } = {}) {
  const n = Number(minor || 0) / 100
  const d = decimals ?? (Math.abs(n) % 1 ? 2 : 0)
  return `${n < 0 ? '−' : ''}${SYMBOL[currency] ?? `${currency} `}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: 2 })}`
}
export const toMinor = major => Math.round(Number(String(major).replace(/[^\d.]/g, '')) * 100)

let settingsCache = null
export function useSettings() {
  const [s, setS] = useState(settingsCache)
  useEffect(() => {
    if (settingsCache) return
    supabase.from('app_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => {
      settingsCache = data || { currency: 'NGN', platform_fee_percent: 10, boost_price_per_day: 100000, ad_price_per_day: { home: 500000, jobs: 300000, businesses: 300000, gigs: 300000 }, min_withdrawal: 500000, min_topup: 100000, missing: true }
      setS(settingsCache)
    })
  }, [])
  return s
}
export const clearSettingsCache = () => { settingsCache = null }

/** Turn a Postgres exception into a readable message. */
export function friendly(error) {
  const m = error?.message || String(error || '')
  if (/insufficient wallet balance/i.test(m)) return 'Not enough funds in your wallet. Top up first.'
  if (/row-level security/i.test(m)) return 'You are not allowed to do that (your account may be pending approval or restricted).'
  if (/could not find the function|does not exist/i.test(m)) return 'This feature needs the latest database update (supabase-admin-escrow-migration.sql).'
  return m
}

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(friendly(error))
  return data
}

export const hireProposal = id => rpc('hire_proposal', { p_proposal: id })
export const declineProposal = id => rpc('decline_proposal', { p_proposal: id })
export const fundContract = id => rpc('fund_contract', { p_contract: id })
export const submitWork = (id, note) => rpc('submit_work', { p_contract: id, p_note: note })
export const requestRevision = (id, note) => rpc('request_revision', { p_contract: id, p_note: note })
export const releaseContract = (id, rating, review) => rpc('release_contract', { p_contract: id, p_rating: rating || null, p_review: review || null })
export const cancelContract = (id, reason) => rpc('cancel_contract', { p_contract: id, p_reason: reason || null })
export const openDispute = (id, reason, details) => rpc('open_dispute', { p_contract: id, p_reason: reason, p_details: details || null })
export const requestWithdrawal = (amount, bank, number, name) => rpc('request_withdrawal', { p_amount: amount, p_bank_name: bank, p_account_number: number, p_account_name: name })
export const purchaseBoost = (type, id, days) => rpc('purchase_boost', { p_target_type: type, p_target_id: String(id), p_days: days })
export const createAd = ({ title, body, targetUrl, placement, days, imageUrl }) =>
  rpc('create_ad_campaign', { p_title: title, p_body: body, p_target_url: targetUrl, p_placement: placement, p_days: days, p_image_url: imageUrl || null })
// admin
export const adminStats = () => rpc('admin_stats')
export const adminListUsers = (search, status, limit = 50, offset = 0) => rpc('admin_list_users', { p_search: search || null, p_status: status || null, p_limit: limit, p_offset: offset })
export const adminSetStatus = (user, status, reason, until) => rpc('admin_set_account_status', { p_user: user, p_status: status, p_reason: reason || null, p_until: until || null })
export const adminAdjustWallet = (user, amount, reason) => rpc('admin_adjust_wallet', { p_user: user, p_amount: amount, p_reason: reason })
export const adminResolveDispute = (id, resolution, freelancerAmount, note) => rpc('admin_resolve_dispute', { p_dispute: id, p_resolution: resolution, p_freelancer_amount: freelancerAmount ?? null, p_note: note || null })
export const adminProcessWithdrawal = (id, paid, reference, note) => rpc('admin_process_withdrawal', { p_id: id, p_paid: paid, p_reference: reference || null, p_note: note || null })
export const adminReviewAd = (id, approve, note) => rpc('admin_review_ad', { p_id: id, p_approve: approve, p_note: note || null })

export async function fetchWallet(userId) {
  const { data } = await supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle()
  return data || { balance: 0, held: 0, pending_withdrawal: 0 }
}

async function authedPost(url, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(apiUrl(url), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}
export const startTopup = amountMajor => authedPost('/api/wallet-topup', { amount: amountMajor })
export const verifyTopup = reference => authedPost('/api/wallet-verify', { reference })

export const CONTRACT_STATUS = {
  awaiting_funding: { label: 'Awaiting escrow funding', color: '#92400e', bg: '#fef3c7' },
  funded: { label: 'In progress · funds in escrow', color: '#1d4ed8', bg: '#dbeafe' },
  submitted: { label: 'Work submitted · awaiting approval', color: '#6d28d9', bg: '#ede9fe' },
  revision_requested: { label: 'Changes requested', color: '#b45309', bg: '#ffedd5' },
  completed: { label: 'Completed · paid', color: '#166534', bg: '#dcfce7' },
  disputed: { label: 'In dispute', color: '#991b1b', bg: '#fee2e2' },
  refunded: { label: 'Refunded', color: '#334155', bg: '#e2e8f0' },
  settled: { label: 'Settled by AfriTalent', color: '#334155', bg: '#e2e8f0' },
  cancelled: { label: 'Cancelled', color: '#334155', bg: '#e2e8f0' },
}

export const TX_LABEL = {
  topup: 'Top-up', escrow_hold: 'Escrow funded', escrow_release: 'Escrow released', escrow_refund: 'Escrow refund',
  earning: 'Earning', dispute_settlement: 'Dispute settlement', withdrawal: 'Withdrawal requested', withdrawal_paid: 'Withdrawal paid',
  withdrawal_reversal: 'Withdrawal returned', boost: 'Post boost', ad: 'Ad campaign', ad_refund: 'Ad refund', adjustment: 'Adjustment',
}

export const GIG_CATEGORIES = ['Design', 'Development', 'Writing & Translation', 'Marketing', 'Video & Animation', 'Data', 'Admin & Support', 'Finance', 'Legal', 'Other']
