// "Already submitted" card used by the KYC page, address page and setup wizard.
export default function VerificationStatusCard({ kind = 'identity', status, submittedAt, onUpdate, children }) {
  const approved = status === 'approved'
  return (
    <div className="card" style={{ padding: 28, textAlign: 'center' }}>
      <div style={{ fontSize: 44, marginBottom: 10 }}>{approved ? '✅' : '⏳'}</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
        {approved ? `Your ${kind} is verified` : `Your ${kind} documents are under review`}
      </h2>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
        {approved
          ? 'Nothing else to do here.'
          : `We received your submission${submittedAt ? ` on ${new Date(submittedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}. Reviews usually take under 24 hours and you'll get a notification when it's done. No further action is needed.`}
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {children}
        {!approved && onUpdate && (
          <button type="button" className="btn btn-outline" onClick={onUpdate}>Update my documents</button>
        )}
      </div>
    </div>
  )
}
