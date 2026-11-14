import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MODE_STYLE, timeAgo, workModeOf, safeHref, isDirectSource } from '../lib/jobs'

export function CompanyLogo({ job, size = 48 }) {
  const [broken, setBroken] = useState(false)
  const initial = (job.company || '?').trim().charAt(0).toUpperCase()
  const logo = safeHref(job.company_logo)
  if (logo && !broken) {
    return (
      <img src={logo} alt="" loading="lazy" onError={() => setBroken(true)}
        className="company-logo" style={{ width: size, height: size }} referrerPolicy="no-referrer" />
    )
  }
  return <div className="company-logo company-logo-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initial}</div>
}

export function JobBadges({ job }) {
  const mode = workModeOf(job)
  const ms = MODE_STYLE[mode] || MODE_STYLE['On-site']
  return (
    <div className="job-badges">
      <span className="pill" style={{ background: ms.bg, color: ms.color }}><i className={ms.icon}></i> {mode}</span>
      {isDirectSource(job.source) && <span className="pill pill-direct" title="Imported from the employer's own careers page"><i className="fas fa-building"></i> Direct from employer</span>}
      {job.visa_sponsorship && <span className="pill pill-visa"><i className="fas fa-passport"></i> Visa sponsorship</span>}
      {job.relocation && <span className="pill pill-reloc"><i className="fas fa-plane-departure"></i> Relocation</span>}
      {job.type && <span className="pill pill-muted">{job.type}</span>}
      {job.experience_level && <span className="pill pill-muted">{job.experience_level === 'Entry' ? 'Graduate / Entry' : job.experience_level}</span>}
      {job.salary && job.salary !== 'Not disclosed' && <span className="pill pill-salary"><i className="fas fa-money-bill-wave"></i> {job.salary}</span>}
    </div>
  )
}

export default function JobCard({ job, onOpen, featured }) {
  const applyHref = safeHref(job.apply_url)
  const external = job.is_external && applyHref
  const snippet = String(job.description || '').replace(/\s+/g, ' ').slice(0, 220)

  return (
    <article className={`job-card ${featured ? 'featured' : ''}`} onClick={onOpen} role="link" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onOpen() }}>
      <div className="job-card-main">
        <CompanyLogo job={job} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Link to={`/jobs/${job.id}`} className="job-title" onClick={e => e.stopPropagation()}>{job.title}</Link>
          <div className="job-meta">
            <span><i className="fas fa-building"></i> {job.company}</span>
            <span><i className="fas fa-map-marker-alt"></i> {job.location}</span>
          </div>
          <JobBadges job={job} />
          {snippet && <p className="job-snippet">{snippet}{job.description?.length > 220 ? '…' : ''}</p>}
        </div>
      </div>
      <div className="job-card-foot">
        <span className="job-source">
          {job.source && job.source !== 'AfriTalent'
            ? <>via <strong>{job.source}</strong></>
            : <><i className="fas fa-check-circle" style={{ color: 'var(--color-success)' }}></i> Posted on AfriTalent</>}
          <span className="dot-sep">•</span>{timeAgo(job.posted_at)}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/jobs/${job.id}`} className="btn btn-outline btn-sm" onClick={e => e.stopPropagation()}>Details</Link>
          {external ? (
            <a href={applyHref} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary btn-sm"
              onClick={e => e.stopPropagation()}>
              Apply <i className="fas fa-external-link-alt" style={{ fontSize: 11 }}></i>
            </a>
          ) : (
            <Link to={`/jobs/${job.id}`} className="btn btn-primary btn-sm" onClick={e => e.stopPropagation()}>Apply</Link>
          )}
        </div>
      </div>
    </article>
  )
}
