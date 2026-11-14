// Ported from AfriTalent HomePage.tsx — Tailwind translated to inline styles,
// lucide icons mapped to Font Awesome, CTAs wired to this app's routes.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AdSlot from '../components/AdSlot'
import HeroSlideshow from '../components/HeroSlideshow'
import JobCard from '../components/JobCard'
import { fetchJobs, fetchLastSync, timeAgo, EMPTY_FILTERS } from '../lib/jobs'

const features = [
  { icon: 'fas fa-search', title: 'Smart Job Matching', desc: 'AI-powered recommendations that match your skills and aspirations with the perfect opportunities.' },
  { icon: 'fas fa-sync-alt', title: 'Roles Updated Hourly', desc: 'We import fresh openings every hour from leading job boards, so you see roles the moment they go live.' },
  { icon: 'fas fa-passport', title: 'Visa & Remote Filters', desc: 'Filter by remote, hybrid or on-site, visa sponsorship and relocation support to find roles that fit your life.' },
  { icon: 'fas fa-award', title: 'Verified Profiles', desc: 'Stand out with skill-verified profiles and professional credentials that employers trust.' },
  { icon: 'fas fa-globe-africa', title: 'Pan-African Network', desc: 'Access opportunities across Nigeria, Kenya, Ghana, South Africa, and 40+ African countries.' },
  { icon: 'fas fa-star', title: 'Honest Reviews', desc: 'Read verified employee reviews and salary insights before you apply. Make informed decisions.' },
]

const stats = [
  { value: '2M+', label: 'Active Users', icon: 'fas fa-users' },
  { value: '50K+', label: 'Job Listings', icon: 'fas fa-briefcase' },
  { value: '12K+', label: 'Companies', icon: 'fas fa-building' },
  { value: '24×', label: 'Daily Job Imports', icon: 'fas fa-sync-alt' },
]

const SOURCE_NAMES = ['LinkedIn', 'Indeed', 'Glassdoor', 'We Work Remotely', 'Remotive', 'RemoteOK', 'Himalayas', 'Jobicy', 'Arbeitnow', 'The Muse', 'Adzuna', 'Upwork']

const AVATARS = ['a1', 'a2', 'a3', 'a4', 'a5']

const QUICK_LINKS = [
  { label: 'Remote', to: '/jobs?modes=Remote', icon: 'fas fa-globe' },
  { label: 'Hybrid', to: '/jobs?modes=Hybrid', icon: 'fas fa-random' },
  { label: 'Visa sponsorship', to: '/jobs?visa=1', icon: 'fas fa-passport' },
  { label: 'Graduate roles', to: '/jobs?levels=Entry', icon: 'fas fa-user-graduate' },
]

export default function Home() {
  const { user, kycVerified, addressVerified } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [latest, setLatest] = useState([])
  const [total, setTotal] = useState(null)
  const [lastSync, setLastSync] = useState(null)

  const needsKYC = user && (!kycVerified || !addressVerified)

  useEffect(() => {
    fetchJobs(EMPTY_FILTERS, 0).then(r => { setLatest(r.jobs.slice(0, 4)); setTotal(r.count) }).catch(() => {})
    fetchLastSync().then(setLastSync)
  }, [])

  function handleSearch(e) {
    e.preventDefault()
    navigate(query.trim() ? `/jobs?q=${encodeURIComponent(query.trim())}` : '/jobs')
  }

  return (
    <div className="page-enter">
      {needsKYC && (
        <div style={{ background: 'rgba(245, 158, 11, 0.08)', borderBottom: '1px solid rgba(245, 158, 11, 0.2)', padding: '12px 24px' }}>
          <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--color-warning)', fontWeight: 500 }}>
              <i className="fas fa-exclamation-triangle" style={{ marginRight: 6 }}></i>
              Complete your verification to unlock all features
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {!kycVerified && <Link to="/kyc" className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 12 }}>Verify KYC</Link>}
              {kycVerified && !addressVerified && <Link to="/verify-address" className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 12 }}>Verify Address</Link>}
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <section style={{ position: 'relative', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)', color: 'white', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.1, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: 80, left: 40, width: 288, height: 288, background: '#f59e0b', borderRadius: '50%', filter: 'blur(80px)' }}></div>
          <div style={{ position: 'absolute', bottom: 80, right: 40, width: 384, height: 384, background: '#3b82f6', borderRadius: '50%', filter: 'blur(80px)' }}></div>
        </div>

        <div className="hero-grid">
          <div className="hero-copy">
            <span className="hero-eyebrow"><span className="live-dot"></span> {total ? `${total.toLocaleString()} live roles` : 'Live roles'} · updated every hour</span>
            <h1 style={{ fontSize: 'clamp(34px, 4.6vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.12, marginBottom: 22 }}>
              Discover Africa's
              <span style={{ color: '#fbbf24' }}> Top Talent</span>
              <br />& Leading Companies
            </h1>
            <p style={{ fontSize: 'clamp(16px, 1.6vw, 19px)', color: '#cbd5e1', marginBottom: 32, maxWidth: 560, lineHeight: 1.65 }}>
              From fresh graduates to seasoned executives — AfriTalent brings together roles from the world's leading job boards,
              with direct application links, honest reviews and verified profiles.
            </p>

            <form onSubmit={handleSearch} className="hero-search">
              <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                <i className="fas fa-search" style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 16 }}></i>
                <input
                  type="text"
                  placeholder="Job title, company, or keyword"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  aria-label="Search jobs"
                  style={{
                    width: '100%', padding: '16px 16px 16px 48px',
                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 12, color: 'white', fontSize: 15, outline: 'none',
                  }}
                />
              </div>
              <button type="submit" style={{ padding: '16px 32px', background: '#f59e0b', color: 'white', fontWeight: 600, borderRadius: 12, fontSize: 15, border: 'none', cursor: 'pointer' }}>
                Search Jobs
              </button>
            </form>

            <div className="hero-quick">
              {QUICK_LINKS.map(q => (
                <Link key={q.label} to={q.to} className="hero-quick-link"><i className={q.icon}></i> {q.label}</Link>
              ))}
            </div>

            <div className="hero-trust">
              <div className="avatar-stack">
                {AVATARS.map(a => <img key={a} src={`/images/people/${a}.jpg`} alt="" loading="lazy" />)}
              </div>
              <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.4 }}>
                <strong style={{ color: 'white' }}>2M+ professionals</strong> across 40+ countries<br />
                <span style={{ color: '#fbbf24' }}>★★★★★</span> trusted by graduates & executives alike
              </div>
            </div>
          </div>

          <HeroSlideshow />
        </div>
      </section>

      {/* Sources strip */}
      <section className="sources-strip">
        <div className="container">
          <span className="sources-label">Roles imported hourly from</span>
          <div className="sources-list">
            {SOURCE_NAMES.map(s => <span key={s}>{s}</span>)}
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="container"><AdSlot placement="home" /></div>
      <section style={{ padding: '64px 0', background: 'white' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 32 }}>
            {stats.map(stat => (
              <div key={stat.label} style={{ textAlign: 'center' }}>
                <i className={stat.icon} style={{ fontSize: 28, color: '#f59e0b', marginBottom: 12, display: 'block' }}></i>
                <div style={{ fontSize: 30, fontWeight: 700, color: '#0f172a' }}>{stat.value}</div>
                <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Career stages */}
      <section style={{ padding: '80px 0', background: '#f8fafc' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 36px)', fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Built for Every Stage of Your Career</h2>
            <p style={{ fontSize: 18, color: '#475569', maxWidth: 640, margin: '0 auto' }}>
              Whether you just tossed your graduation cap or you're leading teams, the right role is waiting.
            </p>
          </div>
          <div className="stage-grid">
            <StageCard
              img="/images/people/graduates.jpg"
              alt="Smiling graduate holding her diploma"
              eyebrow="Graduates & early careers"
              title="Start strong with your first role"
              points={['Graduate programmes & internships', 'Entry-level roles that welcome fresh talent', 'Remote roles open to candidates across Africa']}
              cta="Browse graduate roles" to="/jobs?levels=Entry,Internship"
            />
            <StageCard
              img="/images/people/team.jpg"
              alt="Smiling team of professionals in a modern office"
              eyebrow="Experienced professionals"
              title="Take the next step up"
              points={['Senior, lead & executive positions', 'Visa sponsorship & relocation packages', 'Hybrid and flexible arrangements']}
              cta="Browse senior roles" to="/jobs?levels=Senior,Executive"
            />
          </div>
        </div>
      </section>

      {/* Live roles */}
      {latest.length > 0 && (
        <section style={{ padding: '80px 0', background: 'white' }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
              <div>
                <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 32px)', fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Just Posted</h2>
                <p style={{ color: '#64748b', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="live-dot"></span>
                  {lastSync ? `Last import ${timeAgo(lastSync.finished_at)} — refreshed every hour` : 'Refreshed every hour'}
                </p>
              </div>
              <Link to="/jobs" className="btn btn-outline">View all {total ? total.toLocaleString() : ''} roles →</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {latest.map(job => <JobCard key={job.id} job={job} onOpen={() => navigate(`/jobs/${job.id}`)} />)}
            </div>
          </div>
        </section>
      )}

      {/* Features */}
      <section style={{ padding: '80px 0', background: '#f8fafc' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 36px)', fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Why Choose AfriTalent?</h2>
            <p style={{ fontSize: 18, color: '#475569', maxWidth: 640, margin: '0 auto' }}>
              The most trusted platform for career growth and talent discovery across Africa.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 32 }}>
            {features.map(feature => (
              <div key={feature.title} className="card" style={{ padding: 32, borderRadius: 16 }}>
                <div style={{ width: 48, height: 48, background: '#fef3c7', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                  <i className={feature.icon} style={{ fontSize: 20, color: '#d97706' }}></i>
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 600, color: '#0f172a', marginBottom: 12 }}>{feature.title}</h3>
                <p style={{ color: '#475569', lineHeight: 1.7, fontSize: 15 }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '80px 0', background: '#f59e0b' }}>
        <div style={{ maxWidth: 896, margin: '0 auto', padding: '0 24px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 36px)', fontWeight: 700, color: 'white', marginBottom: 24 }}>Ready to Accelerate Your Career?</h2>
          <p style={{ fontSize: 18, color: '#fef3c7', marginBottom: 40, maxWidth: 640, margin: '0 auto 40px' }}>
            Join millions of professionals who trust AfriTalent to find their next big opportunity.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/login" style={{ padding: '16px 32px', background: 'white', color: '#b45309', fontWeight: 600, borderRadius: 12, fontSize: 15 }}>
              Create Free Account
            </Link>
            <Link to="/post-job" style={{ padding: '16px 32px', background: '#b45309', color: 'white', fontWeight: 600, borderRadius: 12, fontSize: 15, border: '1px solid #fbbf24' }}>
              Post a Job
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

function StageCard({ img, alt, eyebrow, title, points, cta, to }) {
  return (
    <div className="stage-card">
      <div className="stage-img"><img src={img} alt={alt} loading="lazy" /></div>
      <div className="stage-body">
        <span className="stage-eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <ul>
          {points.map(p => <li key={p}><i className="fas fa-check-circle"></i> {p}</li>)}
        </ul>
        <Link to={to} className="btn btn-primary">{cta} →</Link>
      </div>
    </div>
  )
}
