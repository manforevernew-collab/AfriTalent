import { useState } from 'react'

// Fixed-size circular avatar that never stretches or squashes (works for any photo shape).
export default function UserAvatar({ src, name, email, size = 36, style }) {
  const [broken, setBroken] = useState(false)
  const initials = (name || email || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const box = {
    width: size, height: size, minWidth: size, flex: `0 0 ${size}px`, borderRadius: '50%', overflow: 'hidden',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style,
  }
  if (src && !broken) {
    return (
      <span style={{ ...box, background: 'var(--color-bg-raised)', border: '2px solid var(--color-border)' }}>
        <img src={src} alt={name ? `${name}'s photo` : 'Profile photo'} onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%', display: 'block' }} />
      </span>
    )
  }
  return <span className="avatar" style={{ ...box, fontSize: Math.round(size * 0.36) }}>{initials}</span>
}
