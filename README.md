# AfriTalent

Africa's premier platform connecting top talent with leading companies.

## Quick Start

```bash
npm install
npm run dev
```

## Logo Design
- Africa continent shape with network nodes (blue circles connected by lines)
- Text: "Afri" (navy #1E1B4B) + "Talent" (amber #F59E0B)
- Outer ring in amber
- No overlap, fully responsive

## Fix Applied
- Removed `<BrowserRouter>` from `main.tsx` (was conflicting with `createBrowserRouter`)
- Logo uses `flex-shrink-0` to prevent navbar overlap
- All branding updated to AfriTalent
