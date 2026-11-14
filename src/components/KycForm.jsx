import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { COUNTRIES, ID_TYPES, idTypeInfo, validateIdNumber, parseMrz } from '../../shared/idRules.js'
import { checkFile, uploadPrivate, screenKyc } from '../lib/kyc'

const label = { fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }

/**
 * Identity verification form shared by /kyc and the setup wizard.
 * Uploads to the private bucket, saves the row, then runs automated screening.
 */
export default function KycForm({ userType = 'job_seeker', onDone }) {
  const { user, profile, refreshProfile } = useAuth()
  const [existing, setExisting] = useState(null)
  const [country, setCountry] = useState('NG')
  const [idType, setIdType] = useState('nin')
  const [idNumber, setIdNumber] = useState('')
  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [dob, setDob] = useState('')
  const [expiry, setExpiry] = useState('')
  const [mrz, setMrz] = useState('')
  const [idFile, setIdFile] = useState(null)
  const [certFile, setCertFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!user) return
    supabase.from('kyc_verifications').select('*').eq('user_id', user.id)
      .order('id', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setExisting(data)
        if (data.country) setCountry(data.country)
        if (data.id_type) setIdType(data.id_type)
        if (data.full_name_on_id) setFullName(data.full_name_on_id)
      })
  }, [user])

  const types = ID_TYPES[country] || ID_TYPES.OTHER
  useEffect(() => { if (!types.some(t => t.value === idType)) setIdType(types[0].value) }, [country]) // eslint-disable-line react-hooks/exhaustive-deps
  const info = idTypeInfo(country, idType)

  // Instant feedback using the same rules the server enforces
  const numberCheck = useMemo(() => (idNumber.trim().length >= 4 ? validateIdNumber(country, idType, idNumber) : null), [country, idType, idNumber])
  const mrzCheck = useMemo(() => (mrz.trim().length > 20 ? parseMrz(mrz) : null), [mrz])
  const isBusiness = userType === 'business'

  async function submit(e) {
    e.preventDefault()
    setError('')
    setResult(null)
    if (!fullName.trim()) return setError('Enter your full name exactly as printed on the ID.')
    if (numberCheck && !numberCheck.valid && numberCheck.strict) return setError(numberCheck.reason)
    if (!idNumber.trim()) return setError('Enter your ID number.')
    if (mrzCheck && !mrzCheck.valid) return setError(`MRZ check failed: ${mrzCheck.errors[0]}`)
    const fileErr = idFile ? checkFile(idFile, { imagesOnly: false }) : (!existing?.id_document_url || /^https?:/i.test(existing.id_document_url) ? 'Upload a photo of your ID.' : null)
    if (fileErr) return setError(fileErr)
    if (isBusiness && !certFile && !existing?.certificate_url) return setError('Upload your business registration certificate (e.g. CAC certificate).')
    if (certFile) { const c = checkFile(certFile); if (c) return setError(c) }

    setBusy(true)
    try {
      await supabase.from('profiles').update({ user_type: userType }).eq('id', user.id)
      let idPath = existing?.id_document_url
      if (idFile) idPath = await uploadPrivate(idFile, 'kyc', user.id, 'id')
      let certPath = existing?.certificate_url || null
      if (isBusiness && certFile) certPath = await uploadPrivate(certFile, 'kyc', user.id, 'cert')

      const payload = { user_id: user.id, type: userType, id_document_url: idPath, certificate_url: isBusiness ? certPath : null, status: 'pending', country, id_type: idType }
      let kycId = existing?.id
      if (existing) {
        const { error: upErr } = await supabase.from('kyc_verifications').update(payload).eq('id', existing.id)
        if (upErr) throw upErr
      } else {
        const { data, error: insErr } = await supabase.from('kyc_verifications').insert(payload).select('id').single()
        if (insErr) throw insErr
        kycId = data.id
      }

      try {
        const r = await screenKyc({ kycId, country, idType, idNumber, fullName, dob: dob || undefined, expiry: expiry || undefined, mrz: mrz || undefined })
        setResult(r)
        setExisting(prev => ({ ...(prev || {}), id: kycId, id_document_url: idPath, certificate_url: certPath }))
        refreshProfile()
        if (r.decision !== 'rejected') setTimeout(() => onDone?.(r), 2200)
      } catch (screenErr) {
        // Documents are saved; screening will be re-run by the team.
        setResult({ decision: 'pending', messages: [screenErr.message] })
        refreshProfile()
        setTimeout(() => onDone?.({ decision: 'pending' }), 2500)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const ok = result.decision !== 'rejected'
    return (
      <div className={`kyc-result ${ok ? 'ok' : 'bad'}`}>
        <div className="kyc-result-icon"><i className={ok ? 'fas fa-check-circle' : 'fas fa-times-circle'}></i></div>
        <h3>{ok ? 'Documents submitted' : 'We could not accept this document'}</h3>
        {ok ? (
          <p>{result.decision === 'pending'
            ? 'Your documents are saved. Automatic checks will run shortly and our team will review them.'
            : 'Your ID passed our automatic checks and is now with our verification team. You will be notified once it is approved.'}</p>
        ) : (
          <>
            <ul>{(result.messages || []).map((m, i) => <li key={i}>{m}</li>)}</ul>
            <button type="button" className="btn btn-primary" onClick={() => { setResult(null); setIdFile(null) }}>Fix and resubmit</button>
          </>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="kyc-form" noValidate>
      {existing?.status === 'rejected' && (
        <div className="notice notice-warn"><i className="fas fa-exclamation-circle"></i> Your previous submission was declined. Please upload a clear photo of your original ID.</div>
      )}
      <div className="kyc-grid">
        <div>
          <label style={label} htmlFor="kyc-country">Issuing country</label>
          <select id="kyc-country" className="input" value={country} onChange={e => setCountry(e.target.value)}>
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="kyc-type">{isBusiness ? "Representative's ID type" : 'ID type'}</label>
          <select id="kyc-type" className="input" value={idType} onChange={e => setIdType(e.target.value)}>
            {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label style={label} htmlFor="kyc-name">Full name (exactly as on the ID)</label>
        <input id="kyc-name" className="input" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
      </div>

      <div>
        <label style={label} htmlFor="kyc-number">ID number</label>
        <input id="kyc-number" className="input" value={idNumber} onChange={e => setIdNumber(e.target.value)} autoComplete="off" spellCheck={false} />
        {numberCheck && (
          <div className={`field-hint ${numberCheck.valid ? 'ok' : numberCheck.strict ? 'bad' : 'warn'}`}>
            {numberCheck.valid ? <><i className="fas fa-check"></i> Format looks valid{numberCheck.dob ? ` · date of birth ${numberCheck.dob}` : ''}</> : numberCheck.reason}
          </div>
        )}
      </div>

      <div className="kyc-grid">
        <div>
          <label style={label} htmlFor="kyc-dob">Date of birth</label>
          <input id="kyc-dob" type="date" className="input" value={dob} onChange={e => setDob(e.target.value)} />
        </div>
        <div>
          <label style={label} htmlFor="kyc-exp">Expiry date {idType === 'nin' ? '(if any)' : ''}</label>
          <input id="kyc-exp" type="date" className="input" value={expiry} onChange={e => setExpiry(e.target.value)} />
        </div>
      </div>

      {info?.mrz && (
        <div>
          <label style={label} htmlFor="kyc-mrz">Machine-readable zone (MRZ) — the lines of &lt;&lt;&lt; text at the bottom {idType === 'passport' ? 'of the photo page' : 'on the back'}</label>
          <textarea id="kyc-mrz" className="input mono" rows={3} value={mrz} onChange={e => setMrz(e.target.value.toUpperCase())}
            placeholder={'P<NGAOKAFOR<<CHIOMA<ADA<<<<<<<<<<<<<<<<<<<<<\nA123456780NGA9001015F3001014<<<<<<<<<<<<<<04'} spellCheck={false} />
          {mrzCheck && (
            <div className={`field-hint ${mrzCheck.valid ? 'ok' : 'bad'}`}>
              {mrzCheck.valid ? <><i className="fas fa-check"></i> Check digits verified · {mrzCheck.givenNames} {mrzCheck.surname} · expires {mrzCheck.expiry}</> : mrzCheck.errors[0]}
            </div>
          )}
        </div>
      )}

      <div>
        <label style={label} htmlFor="kyc-file">
          Photo of your ID {existing?.id_document_url && !/^https?:/i.test(existing.id_document_url) && <span className="ok-text">· already uploaded</span>}
        </label>
        <input id="kyc-file" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="input" onChange={e => setIdFile(e.target.files[0] || null)} style={{ padding: 8 }} />
        <div className="field-hint">Take a clear, well-lit photo of the original card — all four corners visible, no screenshots, no edits.</div>
      </div>

      {isBusiness && (
        <div>
          <label style={label} htmlFor="kyc-cert">
            Business registration certificate (CAC, CIPC, Registrar of Companies…) {existing?.certificate_url && <span className="ok-text">· already uploaded</span>}
          </label>
          <input id="kyc-cert" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="input" onChange={e => setCertFile(e.target.files[0] || null)} style={{ padding: 8 }} />
        </div>
      )}

      {error && <div className="notice notice-error"><i className="fas fa-exclamation-circle"></i> {error}</div>}

      <div className="kyc-steps">
        <i className="fas fa-shield-alt"></i>
        <div><strong>How we verify:</strong> your ID number, dates and MRZ are checked automatically, the image is screened for edits, duplicates and copies of official specimen documents, then our team approves or declines. Your ID number is never stored in full.</div>
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy} style={{ padding: 14 }}>
        {busy ? <span className="btn-busy"><span className="spinner" /> Verifying…</span> : 'Submit for verification'}
      </button>
    </form>
  )
}
