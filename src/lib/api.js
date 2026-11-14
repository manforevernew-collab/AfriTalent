// Base URL for the serverless API. Empty = same site (Vercel). When the static site is
// hosted elsewhere (e.g. cPanel via FTP), set VITE_API_BASE=https://<project>.vercel.app
// at build time so /api calls go to Vercel.
const BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
export const apiUrl = path => `${BASE}${path}`
