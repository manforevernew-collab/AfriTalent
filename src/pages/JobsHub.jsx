import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Jobs from './Jobs'
import Gigs from './Gigs'

// "Jobs" now holds both full-time/contract roles and escrow-protected gigs.
export default function JobsHub() {
  const [params, setParams] = useSearchParams()
  const { user, isBusiness } = useAuth()
  const tab = params.get('tab') === 'gigs' ? 'gigs' : 'jobs'

  return (
    <>
      <div className="hub-tabs-bar">
        <div className="container hub-tabs">
          <button type="button" className={tab === 'jobs' ? 'on' : ''} onClick={() => setParams({}, { replace: true })}><i className="fas fa-briefcase"></i> Jobs</button>
          <button type="button" className={tab === 'gigs' ? 'on' : ''} onClick={() => setParams({ tab: 'gigs' }, { replace: true })}><i className="fas fa-bolt"></i> Gigs <span className="muted" style={{ fontSize: 12 }}>· escrow-protected</span></button>
          {user && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {isBusiness && <Link to="/post-job" className="btn btn-outline btn-sm"><i className="fas fa-plus"></i> Post a job</Link>}
              <Link to="/gigs/new" className="btn btn-primary btn-sm"><i className="fas fa-plus"></i> Post a gig</Link>
            </span>
          )}
        </div>
      </div>
      {tab === 'gigs' ? <Gigs /> : <Jobs />}
    </>
  )
}
