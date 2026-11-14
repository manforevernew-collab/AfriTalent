import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { WORK_MODES, JOB_TYPES, LEVELS, CATEGORIES } from '../lib/jobs'

const SKILL_OPTIONS = [
  'React', 'Node.js', 'Python', 'Figma', 'User Research', 'Prototyping',
  'Digital Marketing', 'SEO', 'Brand Strategy', 'AutoCAD', 'Project Management',
  'Machine Learning', 'TensorFlow', 'PostgreSQL', 'Product Strategy', 'Agile',
  'Payments', 'Data Analysis', 'Content Writing', 'Sales', 'JavaScript',
  'TypeScript', 'CSS', 'HTML', 'UI Design', 'UX Research', 'DevOps', 'AWS',
  'Docker', 'Kubernetes', 'Next.js', 'Vue.js', 'Angular', 'MongoDB', 'Redis',
  'GraphQL', 'REST API', 'Flutter', 'React Native', 'iOS Development',
  'Android Development', 'Swift', 'Kotlin', 'Java', 'C++', 'C#', 'Go', 'Rust',
  'Ruby', 'PHP', 'Laravel', 'Django', 'Flask', 'FastAPI', 'Spring Boot',
  'Express.js', 'Prisma', 'Sequelize', 'Firebase', 'Supabase', 'Tailwind CSS',
  'Bootstrap', 'Sass', 'Webpack', 'Vite', 'Jest', 'Cypress', 'Git', 'GitHub',
  'GitLab', 'CI/CD', 'Jenkins', 'Terraform', 'Ansible', 'Nginx', 'Linux',
  'Tableau', 'Power BI', 'Looker', 'Pandas', 'NumPy', 'Scikit-learn', 'Keras',
  'PyTorch', 'OpenCV', 'NLP', 'Computer Vision', 'Big Data', 'Hadoop', 'Spark',
  'Elasticsearch', 'Kafka', 'RabbitMQ', 'Memcached', 'SQLite', 'Oracle',
  'MySQL', 'SQL', 'NoSQL', 'Data Science', 'Data Engineering', 'Business Intelligence',
  'Financial Analysis', 'Accounting', 'QuickBooks', 'Excel', 'Google Sheets',
  'SAP', 'ERP', 'CRM', 'Salesforce', 'HubSpot', 'Marketo', 'Mailchimp',
  'Social Media Marketing', 'Email Marketing', 'Content Strategy', 'Copywriting',
  'Market Research', 'B2B Sales', 'B2C Marketing', 'Lead Generation',
  'Stakeholder Management', 'OKRs', 'KPIs', 'Roadmapping', 'User Stories',
  'Wireframing', 'Design Systems', 'Accessibility', 'WCAG', 'Adobe XD',
  'Photoshop', 'Illustrator', 'Sketch', 'InVision', 'Canva', 'WordPress',
  'Shopify', 'WooCommerce', 'Magento', 'Drupal', 'Joomla', 'Webflow',
  'Stripe', 'PayPal', 'Square', 'Payment Gateways', 'Cybersecurity',
  'Penetration Testing', 'Ethical Hacking', 'OWASP', 'SSL/TLS', 'OAuth',
  'JWT', 'Identity Management', 'Encryption', 'Network Security'
]

export default function PostJob() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [form, setForm] = useState({
    title: '', company: '', location: '', salary: '', type: 'Full-time', category: 'Technology',
    work_mode: 'On-site', experience_level: 'Mid', visa_sponsorship: false, relocation: false,
    description: '', required_skills: []
  })
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const [rlsError, setRlsError] = useState(false)

  function toggleSkill(skill) {
    setForm(prev => ({
      ...prev,
      required_skills: prev.required_skills.includes(skill)
        ? prev.required_skills.filter(s => s !== skill)
        : [...prev.required_skills, skill]
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title || !form.company || !form.description) return
    setLoading(true)
    setRlsError(false)
    try {
      const { work_mode, experience_level, visa_sponsorship, relocation, ...base } = form
      let { error } = await supabase.from('jobs').insert({
        ...base, work_mode, experience_level, visa_sponsorship, relocation,
        source: 'AfriTalent', is_external: false, is_active: true,
        posted_by: user.id
      })
      // Database not migrated yet → post with the original columns only
      if (error && (error.code === '42703' || error.code === 'PGRST204')) {
        ({ error } = await supabase.from('jobs').insert({ ...base, posted_by: user.id }))
      }
      if (error) {
        if (error.message?.includes('row-level security') || error.message?.includes('violates row-level security')) {
          setRlsError(true)
          setToast({ type: 'error', message: 'Permission denied. Ask your admin to run the RLS fix SQL.' })
        } else {
          throw error
        }
      } else {
        setToast({ type: 'success', message: 'Job posted successfully!' })
        setTimeout(() => { setToast(null); navigate('/jobs') }, 2000)
      }
    } catch (e) {
      setToast({ type: 'error', message: e.message })
    } finally {
      setLoading(false)
      setTimeout(() => setToast(null), 5000)
    }
  }

  return (
    <div className="page-enter">
      {toast && (
        <div className="toast" style={{ background: toast.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)' }}>
          {toast.message}
        </div>
      )}

      <div className="container" style={{ maxWidth: 640, paddingTop: 40, paddingBottom: 60 }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 20 }}>← Back</button>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Post a Job</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 28 }}>
          Reach verified talent across Africa. All applicants are KYC-verified.
        </p>

        {rlsError && (
          <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 6 }}>🚫 RLS Policy Blocking Insert</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
              Your Supabase project is missing an INSERT policy for the "jobs" table. 
              Run this SQL in your Supabase SQL Editor:
            </div>
            <code style={{ display: 'block', padding: 10, background: '#1a1a2e', color: '#e8e8f0', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', overflowX: 'auto' }}>
              CREATE POLICY "Authenticated insert jobs" ON jobs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
            </code>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Job Title *</label>
            <input type="text" className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Senior React Developer" required />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Company Name *</label>
            <input type="text" className="input" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="e.g. Flutterwave" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Location</label>
              <input type="text" className="input" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. Lagos / Remote" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Salary Range</label>
              <input type="text" className="input" value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} placeholder="e.g. ₦800k - ₦1.2M" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Job Type</label>
              <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                {JOB_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Category</label>
              <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Work Arrangement</label>
              <select className="input" value={form.work_mode} onChange={e => setForm({ ...form, work_mode: e.target.value })}>
                {WORK_MODES.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Experience Level</label>
              <select className="input" value={form.experience_level} onChange={e => setForm({ ...form, experience_level: e.target.value })}>
                {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <label className="check"><input type="checkbox" checked={form.visa_sponsorship} onChange={e => setForm({ ...form, visa_sponsorship: e.target.checked })} /> <span>Visa sponsorship available</span></label>
            <label className="check"><input type="checkbox" checked={form.relocation} onChange={e => setForm({ ...form, relocation: e.target.checked })} /> <span>Relocation support offered</span></label>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Description *</label>
            <textarea className="input" rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the role, responsibilities, and requirements..." required />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 10 }}>
              Required Skills ({form.required_skills.length} selected)
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 280, overflowY: 'auto', padding: 4 }}>
              {SKILL_OPTIONS.map(skill => (
                <button key={skill} type="button" onClick={() => toggleSkill(skill)} className="badge" style={{
                  cursor: 'pointer',
                  background: form.required_skills.includes(skill) ? 'var(--color-accent)' : 'var(--color-bg-muted)',
                  color: form.required_skills.includes(skill) ? 'white' : 'var(--color-text-secondary)',
                  border: 'none', padding: '6px 12px', fontSize: 12
                }}>{form.required_skills.includes(skill) ? '✓ ' : ''}{skill}</button>
              ))}
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ padding: '14px', marginTop: 8 }}>
            {loading ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><div className="spinner" style={{ width: 16, height: 16, borderColor: 'white', borderTopColor: 'transparent' }} /> Posting...</span> : 'Post Job'}
          </button>
        </form>
      </div>
    </div>
  )
}
