# AfriTalent

Africa's premier verified professional network. KYC-verified talent, AI-matched opportunities, built for Africa.

## 🚀 Quick Start (Local)

```bash
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173)

## 🌐 Deploy to Vercel

### Option 1: Vercel CLI (Recommended)

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy from project root
vercel

# 4. Set environment variables
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY

# 5. Redeploy with env vars
vercel --prod
```

### Option 2: Vercel Dashboard (GitHub)

1. Push this project to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and click "Add New Project"
3. Import your GitHub repo
4. Set Framework Preset to **Vite**
5. Add Environment Variables:
   - `VITE_SUPABASE_URL` = `https://hmzdufreadfglgsiryeb.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
6. Click **Deploy**

### Option 3: Vercel Dashboard (Manual Upload)

1. Run `npm run build` locally
2. Go to [vercel.com](https://vercel.com) → "Add New Project"
3. Select "Import Git Repository" or upload the `dist/` folder
4. Add the environment variables above
5. Deploy

## ⚙️ Environment Variables

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://hmzdufreadfglgsiryeb.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

## 📁 Project Structure

```
afritalent-v2/
├── src/
│   ├── components/     # Navbar, Footer, ProtectedRoute, KYCGuard
│   ├── context/        # AuthContext
│   ├── lib/            # Supabase client
│   ├── pages/          # All route pages
│   ├── App.jsx         # Router setup
│   ├── main.jsx        # Entry point
│   └── index.css       # Global styles
├── index.html
├── vite.config.js
├── vercel.json         # SPA routing config
├── package.json
├── .env
└── .env.example
```

## ✨ Features

- **Professional Directory** — Browse KYC-verified African professionals
- **Job Board** — Search and filter jobs by category, location, type
- **Business Job Posting** — Recruiters post jobs with required skills
- **AI Matching** — Resume skills matched against job requirements (% score)
- **KYC Verification** — Govt ID upload for job seekers, business cert for recruiters
- **Address Verification** — GPS capture + utility bill upload
- **Admin Dashboard** — Approve/reject KYC and address submissions
- **Social Auth** — Google, LinkedIn, X, Apple
- **Demo Accounts** — One-click login for testing

## 🔄 Automatic Job Import (hourly)

Roles are pulled from job boards every hour, normalised (work mode, visa sponsorship,
relocation, level, category) and upserted into `jobs` with their **direct application links**.
Listings that disappear from the source are retired after 72h (`is_active = false`, never deleted).

| Source | How | Needs a key? |
|--------|-----|--------------|
| **Employer career pages** — Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee | Official public job-board APIs. Built-in: Moniepoint, Jumia, LemFi, Sabi, Kuda, FairMoney, GitLab, Canonical, Elastic, Turing, Toptal, Supabase, PostHog. Admins add more in **Admin → Job import** by pasting a careers URL. Global employers keep only remote/Africa roles. Closed roles disappear on the next run. | No |
| MyJobMag (Nigeria; Ghana/Kenya/SA optional) | Search-index style: title, employer, excerpt + link back to the role page. robots.txt checked per URL, rate-limited | No |
| We Work Remotely, Remotive, RemoteOK, Jobicy, Himalayas, Arbeitnow | Public feeds | No |
| **LinkedIn, Indeed, Glassdoor, ZipRecruiter, Wellfound** (and Jobberman/MyJobMag listings Google indexes) | JSearch = Google for Jobs index; prefers the employer's direct apply link | `JSEARCH_API_KEY` |
| Adzuna, X, Upwork, The Muse | Official APIs | their keys |

**Not imported, and why:** Jobberman (robots.txt blocks job pages and its API), HeadHunter.ng (terms forbid automated
collection), HotNigerianJobs (blocks automated page requests), Wellfound and FlexJobs (no public API; FlexJobs is
members-only), LinkedIn/Indeed/Glassdoor/ZipRecruiter direct (scraping prohibited — use JSearch). Partnerships or
official feeds from these boards can be added as connectors in `server/sources.js`.

Every employer hiring in Africa (and every career-board company) is added to the **business directory**
automatically, with an "Open roles" list on its profile, ready for the owner to claim.

### Setup
1. Run `supabase-job-aggregator-migration.sql` in the Supabase SQL editor.
2. Add env vars on Vercel: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, plus any optional keys (see `.env.example`).
   Run `supabase-career-boards-migration.sql` to let admins add employer career pages.
3. Pick an hourly scheduler (any one is enough):
   - **Vercel Pro**: the cron in `vercel.json` calls `/api/sync-jobs` every hour automatically.
   - **GitHub Actions (free)**: push to GitHub and add repo secrets `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` —
     `.github/workflows/sync-jobs.yml` runs hourly.
   - **Supabase pg_cron**: uncomment the block at the end of the migration.
   (Vercel Hobby crons only run once a day, so use GitHub Actions or pg_cron there.)
4. Admins can trigger an import any time from **Admin → Automatic job import → Sync now**.

```bash
npm run sync:jobs:dry   # fetch + normalise, print a report (no database needed)
npm run sync:jobs       # import into Supabase
npm test                # normaliser unit tests
```

## 🏢 Business Directory (daily import + owner claims)

Businesses are imported from **OpenStreetMap** (name, category, street address, phone, email,
website, opening hours, services and Facebook/Instagram/X/LinkedIn/WhatsApp links) for 28 African
cities. A daily run refreshes a few cities, so every city is refreshed weekly. Listings removed from
OSM are hidden; **claimed profiles are never overwritten**.

- Owners press **Claim this business**, sign in/up, and upload proof (registration certificate,
  utility bill…). Claims from a sign-in email on the business's own domain are flagged automatically.
  An admin approves → the owner can edit address, services, hours, contacts and socials.
- Not listed? **Add your business** (shown as unverified until the team checks it).
- Each profile links to **Google Maps** for directions/reviews. Google Maps, Google Places and social
  networks are *not* scraped: their terms forbid copying listings into another database. OSM data is
  ODbL-licensed and attributed on every page.

```bash
npm run sync:businesses:dry -- --only=Lagos   # preview, no database needed
npm run sync:businesses                       # today's cities
npm run sync:businesses -- --all              # every city (~1 min per city)
```
Scheduled by `/api/sync-businesses` (Vercel cron, daily) or `.github/workflows/sync-businesses.yml`.

## 🛡️ Automated KYC screening

Every KYC upload is screened on the server (`/api/kyc-check`) before the team sees it:

| Check | Result if it fails |
|-------|--------------------|
| ID number rules — South African ID (Luhn + birth date), Egyptian ID (date + governorate), Rwanda & Tanzania IDs (encoded dates), Nigeria NIN, Ghana Card, Uganda NIN formats | Rejected |
| Passport / ID-card **MRZ check digits** (ICAO 9303), MRZ vs typed number and birth date | Rejected |
| Expired document, impossible birth date | Rejected |
| Same ID number or same image already used by another account | Rejected |
| File is not a real JPG/PNG/WebP/PDF, too low resolution, corrupt | Rejected |
| Exported from Photoshop, GIMP, Canva, Photopea, Illustrator… | Rejected |
| Copy of an **official specimen** in the specimen library (perceptual hash, rotation-proof) | Rejected |
| Photo-app edits, screenshots, name mismatch, unusual number format | Sent to the team as *Needs careful review* |

Rejected users see what to fix (forensic reasons stay internal). The team only receives submissions
that passed, sorted by risk, and makes the final decision. ID numbers are never stored in full
(last 4 digits + keyed hash), and documents live in a **private** bucket viewed through 5-minute links.

**Specimen library:** Admin → *Official ID specimen library*. Download official specimen images
from issuing authorities or the EU PRADO register and upload them with the source URL.

**Limits:** these checks catch invalid numbers, tampered MRZs, edits, duplicates and specimen copies,
but no image analysis can prove a high-quality physical forgery is fake. For that, connect a
government-database verification provider (e.g. Smile ID, Dojah, Prembly, Youverify: NIN/BVN,
Ghana Card, SA Home Affairs lookups) — `server/kyc/runCheck.js` is where its result would be added.

## 🛠️ Admin console (`/admin`)

Admins sign in at `/admin` (own login screen). Sections: **Overview** (live numbers, items needing
attention, automation health, activity feed), **Sign-up approvals** (toggle "new sign-ups need approval"),
**Users** (search, approve, suspend for N days, block, reactivate, wallet adjustments, message user),
**KYC & address** (risk-sorted queue, specimen library), **Disputes** (contract chat + release / refund /
split), **Support chat** (realtime inbox), **Payments & escrow** (withdrawal payouts, funds in escrow,
ledger), **Ads** (approve / reject-and-refund), **Businesses**, **Job import**, **Settings** (fees, prices,
currency). Every admin action is written to `admin_actions`.

Pending, suspended and blocked users can browse, verify and talk to support, but the database refuses
their posts, applications, proposals and payments (restrictive RLS policies).

## 💼 Gigs, escrow & wallets

1. A business or user posts a **gig** (`/gigs/new`); ID-verified job seekers send **proposals**.
2. The client **hires** → a contract is created → the client **funds escrow** from their wallet.
3. The freelancer **submits work**; the client **approves & releases** (minus the platform fee, default 10%)
   or requests changes. Either side can open a **dispute**; an admin releases, refunds or splits.
4. Freelancers see an **Earnings** tab (available, pending in escrow, lifetime, monthly chart, withdrawals);
   businesses get a **Wallet** tab (top-up via Paystack, escrow, transactions) and **Ads & boosts**.

All money moves through locked Postgres functions with an immutable ledger
(`wallet_transactions`); browsers can't write balances. Top-ups are credited only after Paystack
confirms them (signed webhook or server-side verify). Withdrawals are paid by an admin, who records the
transfer reference. `npm run test:sql` runs the full escrow scenario suite on an in-memory Postgres.

Setup: run `supabase-admin-escrow-migration.sql`, then add `PAYSTACK_SECRET_KEY` (test key first) and
set the Paystack webhook to `https://YOUR-SITE/api/paystack-webhook`. Until Paystack is configured,
admins can fund wallets from **Users → Adjust wallet** (logged).

> Holding customer funds in escrow is a regulated activity in many countries. Before going live, confirm
> the licensing position with your payment provider (Paystack offers split payments and
> escrow-style "subaccounts"), and keep the payout process documented.

## 🔐 Demo Accounts

Demo and test accounts exist in Supabase (Authentication → Users). Their passwords are
deliberately **not** stored in this repository — ask the project owner, and change any shared
password before going live (especially for accounts with the Admin role).

## 🗄️ Supabase Setup

1. In the Supabase SQL Editor, paste and run (in this order):
   `supabase-companies-reviews-migration.sql` → `supabase-job-aggregator-migration.sql` → `supabase-kyc-business-migration.sql`
2. The last file creates the storage buckets (`kyc` private, `resumes` public) and their access rules
3. Enable Auth providers: Google, LinkedIn (OIDC), Twitter/X
4. Server env vars (Vercel + `.env`): `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `KYC_HASH_SECRET`

## 📝 Notes

- The `.env` file contains your Supabase credentials. **Do not commit this to Git.**
- `vercel.json` handles React Router SPA routing on Vercel.
- To make a user an admin, update their `role` in the `profiles` table to `'admin'`.

---

Built with ❤️ for Africa.
