import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addSpecimen, deleteSpecimen, checkFile } from '../../lib/kyc'
import { COUNTRIES, ID_TYPES } from '../../../shared/idRules.js'

/**
 * Official specimen images (from government websites / the EU PRADO register,
 * downloaded by the team). Each is fingerprinted; any KYC upload that is a copy
 * of a specimen is rejected automatically.
 */
export default function SpecimenLibrary() {
  const [rows, setRows] = useState([])
  const [missing, setMissing] = useState(false)
  const [form, setForm] = useState({ label: '', country: 'NG', docType: 'nin', sourceUrl: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const { data, error } = await supabase.from('kyc_specimens').select('*').order('created_at', { ascending: false })
    if (error) { setMissing(true); return }
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault()
    setMsg('')
    const err = checkFile(file, { imagesOnly: true })
    if (err) return setMsg(err)
    if (!/^https?:\/\//.test(form.sourceUrl)) return setMsg('Paste the official page the specimen came from.')
    setBusy(true)
    try {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]
      const path = `specimens/${form.country}_${form.docType}_${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('kyc').upload(path, file, { contentType: file.type })
      if (error) throw error
      await addSpecimen({ path, label: form.label || `${form.country} ${form.docType}`, country: form.country, docType: form.docType, sourceUrl: form.sourceUrl })
      setForm(f => ({ ...f, label: '', sourceUrl: '' }))
      setFile(null)
      e.target.reset?.()
      setMsg('Specimen added — copies of it will now be rejected automatically.')
      load()
    } catch (er) { setMsg(er.message) } finally { setBusy(false) }
  }

  async function remove(id) {
    try { await deleteSpecimen(id); load() } catch (e) { setMsg(e.message) }
  }

  const types = ID_TYPES[form.country] || ID_TYPES.OTHER
  return (
    <div className="card">
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Official ID specimen library ({rows.length})</h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Upload official specimen images published by issuing governments (e.g. NIMC, the EU <a href="https://www.consilium.europa.eu/prado/en/search-by-document-country.html" target="_blank" rel="noopener noreferrer">PRADO register</a>).
        Fraudsters often submit edited copies of these — matching uploads are auto-rejected.
      </p>
      {missing ? <div className="notice notice-warn" style={{ fontSize: 12 }}>Run <code>supabase-kyc-business-migration.sql</code> first.</div> : (
        <form onSubmit={add} className="form-grid" style={{ marginBottom: 12 }}>
          <select className="input" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value, docType: (ID_TYPES[e.target.value] || ID_TYPES.OTHER)[0].value }))} aria-label="Country">
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <select className="input" value={form.docType} onChange={e => setForm(f => ({ ...f, docType: e.target.value }))} aria-label="Document type">
            {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input className="input" placeholder="Label, e.g. NIN slip specimen 2023" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <input className="input" placeholder="Official source URL" value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} />
          <input type="file" accept=".jpg,.jpeg,.png,.webp" className="input" onChange={e => setFile(e.target.files[0] || null)} style={{ padding: 6 }} />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add specimen'}</button>
        </form>
      )}
      {msg && <div className="notice notice-info" style={{ fontSize: 12 }}>{msg}</div>}
      {rows.length > 0 && (
        <table className="sync-table"><thead><tr><th>Specimen</th><th>Country</th><th>Source</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td>{r.label}</td><td>{r.country}</td>
              <td>{r.source_url && <a href={r.source_url} target="_blank" rel="noopener noreferrer">{new URL(r.source_url).hostname}</a>}</td>
              <td><button className="linkish" onClick={() => remove(r.id)}>Remove</button></td>
            </tr>))}
          </tbody></table>
      )}
    </div>
  )
}
