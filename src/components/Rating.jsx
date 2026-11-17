// Star rating shown wherever a member or business appears (search, profiles, cards).
export default function Rating({ value, count, size = 13, showEmpty = true, compact = false }) {
  const v = Number(value) || 0
  if (!count && !v) {
    return showEmpty ? <span className="rating rating-empty" style={{ fontSize: size }}><i className="far fa-star"></i> {compact ? 'New' : 'No reviews yet'}</span> : null
  }
  const full = Math.round(v)
  return (
    <span className="rating" style={{ fontSize: size }} aria-label={`Rated ${v.toFixed(1)} out of 5 from ${count} review${count === 1 ? '' : 's'}`}>
      {compact
        ? <i className="fas fa-star"></i>
        : [1, 2, 3, 4, 5].map(i => <i key={i} className={i <= full ? 'fas fa-star' : 'far fa-star'}></i>)}
      <b>{v.toFixed(1)}</b>
      {count != null && <span className="rating-count">({count})</span>}
    </span>
  )
}
