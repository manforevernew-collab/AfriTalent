import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev only: serve the Vercel functions in /api from the Vite dev server so
 * KYC screening, "Sync now" etc. work on localhost exactly like production.
 */
function localApi() {
  return {
    name: 'local-vercel-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\/+|\/+$/g, '')
        if (!/^[a-z0-9-]+$/.test(name)) return next()
        let mod
        try { mod = await server.ssrLoadModule(`/api/${name}.js`) } catch { return next() }
        let raw = ''
        for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) break }
        req.rawBody = raw // webhooks verify signatures over the exact bytes
        try { req.body = raw ? JSON.parse(raw) : {} } catch { req.body = {} }
        req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams)
        res.status = code => { res.statusCode = code; return res }
        res.json = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
        try {
          await mod.default(req, res)
        } catch (e) {
          server.config.logger.error(e.stack || String(e))
          if (!res.headersSent) res.status(500).json({ error: 'Local API error' })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Make server-only variables (SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET…) visible to /api in dev.
  // They are NOT exposed to the browser bundle (only VITE_* are).
  const env = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v

  return {
    plugins: [react(), localApi()],
    // Absolute base so assets load on deep links like /jobs/123 (SPA rewrite on Vercel).
    base: '/',
    server: {
      port: 5173,
      // Only listen on this machine. Use `npm run dev:lan` to test from a phone on your network.
      host: 'localhost',
    },
  }
})
