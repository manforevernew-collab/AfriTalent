// Social + marketplace data layer (posts, feed, profiles, follows, likes, comments, orders).
import { supabase } from './supabase'
import { squareAvatar } from './avatar'

export const POST_KINDS = [
  { id: 'update', label: 'Update', icon: 'fas fa-pen', hint: 'Share news, wins or ideas' },
  { id: 'portfolio', label: 'Portfolio', icon: 'fas fa-images', hint: 'Show your work — designs, builds, interiors' },
  { id: 'service', label: 'Service', icon: 'fas fa-concierge-bell', hint: 'Offer a service people can book and pay for' },
  { id: 'product', label: 'Product', icon: 'fas fa-box-open', hint: 'Sell goods — paid into escrow until delivered' },
  { id: 'job', label: 'Job', icon: 'fas fa-briefcase', hint: 'Hiring? Describe the role' },
]
export const KIND = Object.fromEntries(POST_KINDS.map(k => [k.id, k]))

export const ORDER_STATUS = {
  paid: { label: 'Paid · in escrow', color: '#1d4ed8', bg: '#dbeafe' },
  shipped: { label: 'Shipped / delivered by seller', color: '#6d28d9', bg: '#ede9fe' },
  delivered: { label: 'Delivered', color: '#6d28d9', bg: '#ede9fe' },
  completed: { label: 'Completed · seller paid', color: '#166534', bg: '#dcfce7' },
  cancelled: { label: 'Cancelled · refunded', color: '#334155', bg: '#e2e8f0' },
  refunded: { label: 'Refunded', color: '#334155', bg: '#e2e8f0' },
  disputed: { label: 'In dispute', color: '#991b1b', bg: '#fee2e2' },
}

// True when the database migration for this feature hasn't been applied yet
export function isSetupPending(error) {
  const code = error?.code || ''
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(code) || /could not find the (function|table)/i.test(error?.message || '')
}

function unwrap({ data, error }) {
  if (error) throw Object.assign(new Error(friendlyError(error)), { code: error.code, original: error })
  return data
}

export function friendlyError(error) {
  const m = error?.message || String(error)
  if (isSetupPending(error)) return 'This feature is being set up — please try again shortly.'
  if (/row-level security|permission denied/i.test(m)) return 'You can\'t do that yet — your account may still be awaiting approval.'
  if (/Insufficient wallet balance/i.test(m)) return 'Not enough money in your wallet. Top up from Dashboard → Wallet.'
  return m.replace(/^.*?ERROR:\s*/, '')
}

// ---------- media ----------
export const MAX_IMAGES = 8
export const MAX_VIDEO_MB = 50

async function shrinkImage(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bitmap || Math.max(bitmap.width, bitmap.height) <= max) return file
  const scale = max / Math.max(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise(res => canvas.toBlob(b => res(b || file), 'image/jpeg', 0.86))
}

export async function uploadMedia(file, userId) {
  const isVideo = file.type.startsWith('video/')
  if (!isVideo && !file.type.startsWith('image/')) throw new Error(`${file.name}: only images and videos can be posted`)
  if (isVideo && file.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`${file.name}: videos must be under ${MAX_VIDEO_MB} MB`)
  const body = isVideo ? file : await shrinkImage(file)
  const ext = isVideo ? (file.name.split('.').pop() || 'mp4').toLowerCase() : 'jpg'
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('posts').upload(path, body, { contentType: isVideo ? file.type : 'image/jpeg', cacheControl: '31536000' })
  if (error) throw new Error(friendlyError(error))
  return { url: supabase.storage.from('posts').getPublicUrl(path).data.publicUrl, type: isVideo ? 'video' : 'image' }
}

export async function uploadCover(file, userId) {
  const img = await shrinkImage(file, 1800)
  const path = `${userId}/cover-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('posts').upload(path, img, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(friendlyError(error))
  return supabase.storage.from('posts').getPublicUrl(path).data.publicUrl
}

export async function uploadAvatar(file, userId) {
  const image = await squareAvatar(file)
  const path = `avatars/${userId}.jpg`
  const { error } = await supabase.storage.from('avatars').upload(path, image, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw new Error(friendlyError(error))
  return `${supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`
}

// ---------- posts & feed ----------
export const getFeed = ({ scope = 'for_you', before = null, limit = 15, author = null, kinds = null, search = null } = {}) =>
  supabase.rpc('get_feed', { p_scope: scope, p_before: before, p_limit: limit, p_author: author, p_kinds: kinds, p_search: search || null }).then(unwrap)

export async function getPost(id, userId) {
  const post = unwrap(await supabase.from('posts').select('*').eq('id', id).maybeSingle())
  if (!post) return null
  const [people, like] = await Promise.all([
    publicPeople([post.author_id]),
    userId ? supabase.from('post_likes').select('post_id').eq('post_id', id).eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const a = people?.[0]
  return { ...post, author_name: a?.full_name, author_username: a?.username, author_avatar: a?.avatar_url, author_headline: a?.headline, author_verified: a?.verified, liked: Boolean(like?.data) }
}

export const createPost = post => supabase.from('posts').insert(post).select().single().then(unwrap)
export const updatePost = (id, patch) => supabase.from('posts').update(patch).eq('id', id).select().single().then(unwrap)
export const deletePost = id => supabase.from('posts').delete().eq('id', id).then(unwrap)

export async function toggleLike(post, userId) {
  if (post.liked) return supabase.from('post_likes').delete().eq('post_id', post.id).eq('user_id', userId).then(unwrap)
  return supabase.from('post_likes').insert({ post_id: post.id }).then(unwrap)
}
export const getComments = postId => supabase.rpc('get_post_comments', { p_post: postId }).then(unwrap)
export const addComment = (postId, body) => supabase.from('post_comments').insert({ post_id: postId, body }).select().single().then(unwrap)
export const deleteComment = id => supabase.from('post_comments').delete().eq('id', id).then(unwrap)

// ---------- people ----------
export const getPublicProfile = handle => supabase.rpc('get_public_profile', { p_handle: handle }).then(unwrap)
export const publicPeople = ids => (ids?.length ? supabase.rpc('public_people', { p_ids: ids }).then(unwrap) : Promise.resolve([]))
export const follow = userId => supabase.from('follows').insert({ following_id: userId }).then(unwrap)
export const unfollow = (me, userId) => supabase.from('follows').delete().eq('follower_id', me).eq('following_id', userId).then(unwrap)
export const profileUrl = username => `${window.location.origin}/u/${username}`

// ---------- orders ----------
export const placeOrder = (postId, quantity, address, note) =>
  supabase.rpc('place_order', { p_post: postId, p_quantity: quantity, p_address: address || null, p_note: note || null }).then(unwrap)
export const markShipped = (id, { carrier, tracking, receiptUrl, note }) =>
  supabase.rpc('mark_order_shipped', { p_order: id, p_carrier: carrier || null, p_tracking: tracking || null, p_receipt_url: receiptUrl || null, p_note: note || null }).then(unwrap)
export const confirmDelivery = (id, rating, review) => supabase.rpc('confirm_order_delivery', { p_order: id, p_rating: rating || null, p_review: review || null }).then(unwrap)
export const cancelOrder = (id, reason) => supabase.rpc('cancel_order', { p_order: id, p_reason: reason || null }).then(unwrap)
export const disputeOrder = (id, reason) => supabase.rpc('dispute_order', { p_order: id, p_reason: reason }).then(unwrap)
export const adminResolveOrder = (id, refund, note) => supabase.rpc('admin_resolve_order', { p_order: id, p_refund: refund, p_note: note || null }).then(unwrap)
export const myOrders = userId => supabase.from('orders').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).order('created_at', { ascending: false }).limit(100).then(unwrap)
export const getOrder = id => supabase.from('orders').select('*').eq('id', id).maybeSingle().then(unwrap)

export const dashboardSummary = () => supabase.rpc('dashboard_summary').then(unwrap)

export function shareLinks(url, text) {
  const u = encodeURIComponent(url); const t = encodeURIComponent(text)
  return {
    whatsapp: `https://wa.me/?text=${t}%20${u}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
  }
}

// ---------- member reviews (max 3 per reviewer per person, enforced in the database) ----------
export const MAX_REVIEWS_PER_PERSON = 3
export const REVIEW_RELATIONSHIPS = [
  { id: 'customer', label: 'I bought from them' },
  { id: 'client', label: 'I hired them' },
  { id: 'employer', label: 'They hired me' },
  { id: 'colleague', label: 'We worked together' },
  { id: 'other', label: 'Other' },
]
export const addReview = ({ revieweeId, rating, title, body, relationship }) =>
  supabase.from('user_reviews').insert({ reviewee_id: revieweeId, rating, title: title || null, body, relationship }).select().single().then(unwrap)
export const deleteReview = id => supabase.from('user_reviews').delete().eq('id', id).then(unwrap)
