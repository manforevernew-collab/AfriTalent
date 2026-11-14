import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { safeHref } from '../lib/jobs'

/** Shows one approved, running ad for the placement (labelled "Sponsored"). */
export default function AdSlot({ placement }) {
  const [ad, setAd] = useState(null)
  const counted = useRef(false)

  useEffect(() => {
    let alive = true
    supabase.from('ad_campaigns').select('id,title,body,image_url,target_url').eq('placement', placement)
      .eq('status', 'active').gt('ends_at', new Date().toISOString()).limit(20)
      .then(({ data }) => {
        if (!alive || !data?.length) return
        setAd(data[Math.floor(Math.random() * data.length)])
      })
    return () => { alive = false }
  }, [placement])

  useEffect(() => {
    if (ad && !counted.current) {
      counted.current = true
      supabase.rpc('record_ad_event', { p_id: ad.id, p_click: false }).then(() => {})
    }
  }, [ad])

  const href = ad && safeHref(ad.target_url)
  if (!ad || !href) return null
  const img = safeHref(ad.image_url)
  return (
    <a className="ad-slot" href={href} target="_blank" rel="noopener noreferrer sponsored"
      onClick={() => supabase.rpc('record_ad_event', { p_id: ad.id, p_click: true })}>
      {img && <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <div style={{ minWidth: 0 }}>
        <span className="ad-label">Sponsored</span>
        <strong>{ad.title}</strong>
        <p>{ad.body}</p>
      </div>
      <i className="fas fa-external-link-alt"></i>
    </a>
  )
}
