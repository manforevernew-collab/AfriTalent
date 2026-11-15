#!/usr/bin/env node
// Configure Supabase Auth for AfriTalent through the Management API:
//   • Site URL + redirect allow-list (so confirmation / OAuth links return to the live site)
//   • Google sign-in (client ID + secret)
//   • Branded AfriTalent email templates + subjects
//   • Custom SMTP (sender name "AfriTalent") — required for emails to reach real users
//
// Auth settings live outside the database, so this needs a Supabase personal access token
// (https://supabase.com/dashboard/account/tokens). Put these in .env (never committed):
//
//   SUPABASE_ACCESS_TOKEN=sbp_...                     required
//   GOOGLE_CLIENT_ID=....apps.googleusercontent.com   optional — enables Google sign-in
//   GOOGLE_CLIENT_SECRET=GOCSPX-...
//   SMTP_HOST=  SMTP_PORT=465  SMTP_USER=  SMTP_PASS=  SMTP_ADMIN_EMAIL=noreply@yourdomain
//   SMTP_SENDER_NAME=AfriTalent                       optional — custom email sender
//   PUBLIC_SITE_URL=https://afritalent.anaefunasoftwares.com
//
//   node scripts/supabase-auth-setup.mjs              apply
//   node scripts/supabase-auth-setup.mjs --dry-run    show what would change (no secrets printed)
//   node scripts/supabase-auth-setup.mjs --write-templates   write supabase/templates/*.html for pasting by hand

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
const env = process.env
const SITE = (env.PUBLIC_SITE_URL || 'https://afritalent.anaefunasoftwares.com').replace(/\/$/, '')
const LOGO = `${SITE}/email-logo.png`
const BRAND = 'AfriTalent'
const GOLD = '#F5B000', NAVY = '#2E374A', MUTED = '#6F7B8A'

// ---------- email templates (table layout + inline styles for every mail client) ----------
const layout = ({ heading, intro, button, url = '{{ .ConfirmationURL }}', note, code }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${BRAND}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:${NAVY};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e8e8f0;">
    <tr><td style="height:5px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td align="center" style="padding:28px 32px 8px;">
      <a href="${SITE}" style="text-decoration:none;"><img src="${LOGO}" width="220" alt="${BRAND} — Professional Network" style="display:block;width:220px;max-width:100%;height:auto;border:0;"></a>
    </td></tr>
    <tr><td style="padding:16px 32px 4px;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${NAVY};">${heading}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a4a68;">${intro}</p>
    </td></tr>
    ${code ? `<tr><td align="center" style="padding:4px 32px 20px;">
      <div style="display:inline-block;padding:14px 28px;font-size:28px;letter-spacing:8px;font-weight:700;color:${NAVY};background:#fff8e6;border:1px dashed ${GOLD};border-radius:10px;">{{ .Token }}</div>
    </td></tr>` : ''}
    ${button ? `<tr><td align="center" style="padding:4px 32px 24px;">
      <a href="${url}" style="display:inline-block;padding:14px 32px;background:${GOLD};color:${NAVY};font-size:15px;font-weight:700;text-decoration:none;border-radius:999px;">${button}</a>
    </td></tr>
    <tr><td style="padding:0 32px 20px;">
      <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">Button not working? Copy and paste this link into your browser:<br><a href="${url}" style="color:#b45309;word-break:break-all;">${url}</a></p>
    </td></tr>` : ''}
    <tr><td style="padding:0 32px 28px;">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">${note}</p>
    </td></tr>
    <tr><td style="padding:18px 32px;background:#f8f9fa;border-top:1px solid #e8e8f0;">
      <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;">
        <strong style="color:${NAVY};">${BRAND}</strong> · Africa's professional network for talent and companies<br>
        <a href="${SITE}" style="color:#b45309;text-decoration:none;">${SITE.replace(/^https?:\/\//, '')}</a>
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`

const IGNORE = `If you didn't request this, you can safely ignore this email.`
export const TEMPLATES = {
  confirmation: {
    subject: `Confirm your ${BRAND} account`,
    html: layout({ heading: `Welcome to ${BRAND}! 👋`, intro: `Thanks for signing up with <strong>{{ .Email }}</strong>. Please confirm your email address to activate your account and start connecting with Africa's top talent and companies.`, button: 'Confirm my email', note: `This link expires in 24 hours. If you didn't create an ${BRAND} account, you can ignore this email.` }),
  },
  recovery: {
    subject: `Reset your ${BRAND} password`,
    html: layout({ heading: 'Reset your password', intro: `We received a request to reset the password for your ${BRAND} account (<strong>{{ .Email }}</strong>). Click below to choose a new one.`, button: 'Reset password', note: `This link expires soon and can only be used once. ${IGNORE} Your password won't change.` }),
  },
  magic_link: {
    subject: `Your ${BRAND} sign-in link`,
    html: layout({ heading: `Sign in to ${BRAND}`, intro: 'Use the button below to sign in. No password needed.', button: `Sign in to ${BRAND}`, note: `This link can only be used once. ${IGNORE}` }),
  },
  invite: {
    subject: `You've been invited to join ${BRAND}`,
    html: layout({ heading: `You're invited to ${BRAND}`, intro: `You've been invited to create an account on ${BRAND}, Africa's professional network for talent and companies.`, button: 'Accept invitation', note: `If you weren't expecting this invitation, you can ignore this email.` }),
  },
  email_change: {
    subject: `Confirm your new ${BRAND} email`,
    html: layout({ heading: 'Confirm your new email', intro: `Please confirm that you want to change your ${BRAND} email from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>.`, button: 'Confirm email change', note: `If you didn't ask for this change, please secure your account by resetting your password.` }),
  },
  reauthentication: {
    subject: `Your ${BRAND} verification code`,
    html: layout({ heading: 'Confirm it\'s you', intro: `Enter this code in ${BRAND} to continue:`, code: true, note: `The code expires in a few minutes. ${IGNORE}` }),
  },
}

if (process.argv.includes('--write-templates')) {
  mkdirSync('supabase/templates', { recursive: true })
  for (const [k, t] of Object.entries(TEMPLATES)) writeFileSync(`supabase/templates/${k}.html`, t.html)
  writeFileSync('supabase/templates/subjects.txt', Object.entries(TEMPLATES).map(([k, t]) => `${k}: ${t.subject}`).join('\n') + '\n')
  console.log('Wrote supabase/templates/*.html and subjects.txt')
  if (!env.SUPABASE_ACCESS_TOKEN) process.exit(0)
}

// ---------- apply via the Management API ----------
const ref = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!ref) { console.error('VITE_SUPABASE_URL is missing from .env'); process.exit(1) }
if (!env.SUPABASE_ACCESS_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN — create one at https://supabase.com/dashboard/account/tokens and add it to .env')
  process.exit(1)
}
const api = async (method, body) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method, headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} config/auth → ${r.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

const current = await api('GET')
const allow = new Set(String(current.uri_allow_list || '').split(',').map(s => s.trim()).filter(Boolean))
for (const u of [SITE, `${SITE}/**`, 'http://localhost:5173/**', 'http://localhost:4173/**']) allow.add(u)

const patch = { site_url: SITE, uri_allow_list: [...allow].join(','), external_email_enabled: true, mailer_autoconfirm: false }
for (const [k, t] of Object.entries(TEMPLATES)) {
  patch[`mailer_subjects_${k}`] = t.subject
  patch[`mailer_templates_${k}_content`] = t.html
}
if (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) { console.error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'); process.exit(1) }
  if (!/\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID)) { console.error('GOOGLE_CLIENT_ID should end in .apps.googleusercontent.com'); process.exit(1) }
  Object.assign(patch, { external_google_enabled: true, external_google_client_id: env.GOOGLE_CLIENT_ID, external_google_secret: env.GOOGLE_CLIENT_SECRET })
}
const smtpKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_ADMIN_EMAIL']
if (smtpKeys.some(k => env[k])) {
  const miss = smtpKeys.filter(k => !env[k])
  if (miss.length) { console.error(`Custom SMTP needs: ${miss.join(', ')}`); process.exit(1) }
  Object.assign(patch, {
    smtp_host: env.SMTP_HOST, smtp_port: String(env.SMTP_PORT || 465), smtp_user: env.SMTP_USER, smtp_pass: env.SMTP_PASS,
    smtp_admin_email: env.SMTP_ADMIN_EMAIL, smtp_sender_name: env.SMTP_SENDER_NAME || BRAND,
  })
}

const SECRET = /secret|pass|content/
const summary = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, SECRET.test(k) ? (k.endsWith('content') ? `<${v.length} chars of HTML>` : '<hidden>') : v]))
console.log(`Project ${ref} — changes:`); console.log(summary)
if (process.argv.includes('--dry-run')) process.exit(0)

const after = await api('PATCH', patch)
console.log('\n✅ Supabase Auth updated')
console.log(`   Site URL:        ${after.site_url}`)
console.log(`   Google sign-in:  ${after.external_google_enabled ? 'ON' : 'off (add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET)'}`)
console.log(`   Custom SMTP:     ${after.smtp_host ? `${after.smtp_host} as "${after.smtp_sender_name}" <${after.smtp_admin_email}>` : 'not set — Supabase only emails your team members until you add it'}`)
if (after.external_google_enabled) console.log(`\n   Google Cloud → OAuth client → Authorized redirect URI must include:\n   https://${ref}.supabase.co/auth/v1/callback`)
