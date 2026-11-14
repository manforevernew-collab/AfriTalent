import { useState } from 'react'
import { documentLink } from '../../lib/kyc'

/** Opens a private document through a short-lived signed URL (generated on click). */
export default function DocLink({ refPath, children }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!refPath) return null
  async function open(e) {
    e.preventDefault()
    setBusy(true)
    // open the tab synchronously (popup blockers), then point it at the signed URL
    // ('noopener' would make window.open return null, so detach the opener manually)
    const win = window.open('about:blank', '_blank')
    if (win) win.opener = null
    const url = await documentLink(refPath)
    setBusy(false)
    if (!url) { setFailed(true); win?.close(); return }
    if (win) win.location.href = url
    else window.location.assign(url)
  }
  if (failed) return <span className="muted">{children} (unavailable)</span>
  return <a href="#" onClick={open} className="doc-link">{busy ? 'Opening…' : children}</a>
}
