import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { CompanyLogo, JobBadges } from '../components/JobCard'
import { timeAgo, sanitizeJob, isDirectSource } from '../lib/jobs'

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, kycVerified, addressVerified } = useAuth()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => { loadJob() }, [id])

  function flash(type, message) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  async function loadJob() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single()
      if (error) throw error
      setJob(sanitizeJob(data))
      if (user) {
        const { data: appData } = await supabase.from('applications').select('id').eq('job_id', id).eq('user_id', user.id).maybeSingle()
        setApplied(!!appData)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  // Imported roles: send the candidate straight to the original application page.
  // If they're signed in we also keep a record so it shows up in their applications.
  async function trackExternalApply() {
    if (!user || applied) return
    const { error } = await supabase.from('applications').insert({ job_id: Number(id), user_id: user.id })
    if (!error) setApplied(true)
  }

  async function handleApply() {
    if (!user) return flash('error', 'Please log in to apply.')
    if (!kycVerified || !addressVerified) return flash('error', 'Complete verification to apply for jobs.')
    setApplying(true)
    try {
      const { error } = await supabase.from('applications').insert({ job_id: Number(id), user_id: user.id })
      if (error) throw error
      setApplied(true)
      flash('success', `Application submitted for ${job.title}!`)
    } catch (e) { flash('error', e.message) }
    finally { setApplying(false) }
  }

  if (loading) return <div className="container" style={{ padding: '80px 24px', textAlign: 'center' }}><div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 16px' }} /><p style={{ color: 'var(--color-text-muted)' }}>Loading job details...</p></div>
  if (!job) return <div className="container" style={{ padding: '80px 24px', textAlign: 'center' }}><p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>Job not found.</p><button className="btn btn-primary" onClick={() => navigate('/jobs')}>Browse Jobs</button></div>

  const external = job.is_external && job.apply_url
  const closed = job.is_active === false

  return (
    <div className="page-enter">
      {toast && <div className="toast" style={{ background: toast.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)' }}>{toast.message}</div>}
      <div className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 860 }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 16, paddingLeft: 0 }}>← Back to jobs</button>

        <div className="card" style={{ padding: 28, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <CompanyLogo job={job} size={64} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <h1 style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.25, marginBottom: 6 }}>{job.title}</h1>
              <div className="job-meta" style={{ fontSize: 15 }}>
                <span><i className="fas fa-building"></i> {job.company}</span>
                <span><i className="fas fa-map-marker-alt"></i> {job.location}</span>
                <span><i className="far fa-clock"></i> Posted {timeAgo(job.posted_at)}</span>
              </div>
              <JobBadges job={job} />
            </div>
          </div>

          {closed && (
            <div className="notice notice-warn" style={{ marginTop: 20, marginBottom: 0 }}>
              <i className="fas fa-hourglass-end"></i> This listing is no longer on the original job board and may be closed.
            </div>
          )}

          <div className="apply-row">
            {external ? (
              <>
                <a href={job.apply_url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary apply-btn" onClick={trackExternalApply}>
                  {isDirectSource(job.source) ? `Apply on ${job.company}'s careers page` : `Apply on ${job.source}`} <i className="fas fa-external-link-alt" style={{ fontSize: 12 }}></i>
                </a>
                {job.source_url && job.source_url !== job.apply_url && (
                  <a href={job.source_url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-outline apply-btn">
                    View original listing
                  </a>
                )}
              </>
            ) : (
              <button className="btn btn-primary apply-btn" onClick={handleApply} disabled={applying || applied}>
                {applying ? 'Submitting…' : applied ? '✓ Application Submitted' : 'Apply Now'}
              </button>
            )}
          </div>
          {external && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
              <i className="fas fa-shield-alt"></i> {isDirectSource(job.source)
                ? <>This role comes straight from {job.company}'s own careers page — your application goes directly into their recruiting pipeline.</>
                : <>You'll apply through {job.source}. Tip: check that the role is still open on {job.company}'s official website or LinkedIn page, and apply there directly if you can.</>}
              {' '}AfriTalent never charges candidates to apply.
              {applied && <> · <strong style={{ color: 'var(--color-success)' }}>Saved to your applications</strong></>}
            </p>
          )}
        </div>

        <div className="card" style={{ padding: 28 }}>
          <h3 className="section-label">About the role</h3>
          <div className="job-description">{job.description}</div>

          {job.required_skills?.length > 0 && (
            <>
              <h3 className="section-label" style={{ marginTop: 28 }}>Skills & tags</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {job.required_skills.map((skill, i) => <span key={i} className="badge badge-blue" style={{ fontSize: 12 }}>{skill}</span>)}
              </div>
            </>
          )}

          {external && (
            <p style={{ marginTop: 28, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Description may be shortened. Read the full listing on{' '}
              <a href={job.source_url || job.apply_url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: 'var(--color-primary-dark)', fontWeight: 600 }}>{job.source}</a>.
            </p>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Looking for more? <Link to="/jobs" style={{ color: 'var(--color-accent)', fontWeight: 500 }}>Browse all jobs →</Link></p>
        </div>
      </div>
    </div>
  )
}
