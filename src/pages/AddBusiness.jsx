import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import BusinessForm from '../components/BusinessForm'

export default function AddBusiness() {
  const navigate = useNavigate()

  async function create(payload) {
    const { data, error } = await supabase.from('companies').insert(payload).select('id').single()
    if (error) throw error
    navigate(`/businesses/${data.id}`)
  }

  return (
    <div className="page-enter">
      <div className="container" style={{ maxWidth: 760, paddingTop: 40, paddingBottom: 60 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Add your business</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          List your business on AfriTalent for free. You will manage the profile; our team adds a <strong>Verified</strong> badge once your documents check out.
        </p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24 }}>
          Already listed? <Link to="/businesses" style={{ color: 'var(--color-primary-dark)', fontWeight: 600 }}>Search for it</Link> and press “Claim this business” instead.
        </p>
        <div className="card"><BusinessForm submitLabel="Publish business" onSubmit={create} onCancel={() => navigate(-1)} /></div>
      </div>
    </div>
  )
}
