import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// React-style clean URLs: /workspace/dashboard, /login, /pricing, ...
// Extension-less paths are resolved to the existing <path>.html file,
// keeping the original markup, links and behavior untouched.
function cleanUrls() {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const resolve = (path) => {
    if (path === '/') return '/index.html'
    if (path.startsWith('/@') || path.startsWith('/src/') || path.startsWith('/node_modules/')) return null
    const last = path.slice(path.lastIndexOf('/') + 1)
    if (last.includes('.')) return null                    // real asset (css/js/img)
    if (path.endsWith('/')) path = path.slice(0, -1)
    return fs.existsSync(root + path.slice(1) + '.html') ? path + '.html' : null
  }
  const handler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    const qi = req.url.indexOf('?')
    let path = qi === -1 ? req.url : req.url.slice(0, qi)
    try { path = decodeURIComponent(path) } catch { /* keep raw */ }
    const target = resolve(path)
    req.url = (target || path) + (qi === -1 ? '' : req.url.slice(qi))
    return next()
  }
  // After the whole chain: only a request that matched NOTHING gets the
  // designed /404.html page (original 404 status kept). Valid pages fall
  // through to Vite's own html middleware, which runs after us.
  const htmlExists = (path) => {
    if (path.startsWith('/@') || path.startsWith('/src/') || path.startsWith('/node_modules/')) return true
    try { return fs.existsSync(root + path.replace(/^\//, '')) } catch { return true }
  }
  const gate404 = (loadHtml) => (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (res.writableEnded || res.writableFinished) return next()
    if (!(req.headers.accept || '').includes('text/html')) return next()
    const qi = req.url.indexOf('?')
    let path = qi === -1 ? req.url : req.url.slice(0, qi)
    try { path = decodeURIComponent(path) } catch { /* keep raw */ }
    if (htmlExists(path)) return next()
    try { loadHtml(req.url).then((h) => { res.statusCode = 404; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(h) }).catch(() => next()) } catch { next() }
  }
  return {
    name: 'clean-urls',
    configureServer(s) {
      s.middlewares.use(handler)
      // returned hook = runs after fs fallbacks, before Vite's html middleware
      return () => { s.middlewares.use(gate404((url) => s.transformIndexHtml(url, fs.readFileSync(root + '404.html', 'utf8')))) }
    },
    configurePreviewServer(s) {
      s.middlewares.use(handler)
      return () => { s.middlewares.use(gate404(async () => fs.readFileSync(root + 'dist/404.html', 'utf8'))) }
    }
  }
}

export default defineConfig({
  appType: 'mpa',
  plugins: [react(), cleanUrls()],
  build: {
    rollupOptions: {
      input: {
        'main': fileURLToPath(new URL('./index.html', import.meta.url)),
        'pricing': fileURLToPath(new URL('./pricing.html', import.meta.url)),
        'login': fileURLToPath(new URL('./login.html', import.meta.url)),
        'register': fileURLToPath(new URL('./register.html', import.meta.url)),
        'forgot-password': fileURLToPath(new URL('./forgot-password.html', import.meta.url)),
        'reset-password': fileURLToPath(new URL('./reset-password.html', import.meta.url)),
        'onboarding': fileURLToPath(new URL('./onboarding.html', import.meta.url)),
        'invitation': fileURLToPath(new URL('./invitation.html', import.meta.url)),
        '404': fileURLToPath(new URL('./404.html', import.meta.url)),
        'loading': fileURLToPath(new URL('./loading.html', import.meta.url)),
        'portal-portal-account': fileURLToPath(new URL('./portal/portal-account.html', import.meta.url)),
        'portal-portal-deliverables': fileURLToPath(new URL('./portal/portal-deliverables.html', import.meta.url)),
        'portal-portal-notifications': fileURLToPath(new URL('./portal/portal-notifications.html', import.meta.url)),
        'portal-portal-project': fileURLToPath(new URL('./portal/portal-project.html', import.meta.url)),
        'portal-portal-projects': fileURLToPath(new URL('./portal/portal-projects.html', import.meta.url)),
        'portal-portal-review': fileURLToPath(new URL('./portal/portal-review.html', import.meta.url)),
        'portal-portal-updates': fileURLToPath(new URL('./portal/portal-updates.html', import.meta.url)),
        'project-project-access': fileURLToPath(new URL('./project/project-access.html', import.meta.url)),
        'project-project-activity': fileURLToPath(new URL('./project/project-activity.html', import.meta.url)),
        'project-project-deliverables': fileURLToPath(new URL('./project/project-deliverables.html', import.meta.url)),
        'project-project-discussions': fileURLToPath(new URL('./project/project-discussions.html', import.meta.url)),
        'project-project-files': fileURLToPath(new URL('./project/project-files.html', import.meta.url)),
        'project-project-milestones': fileURLToPath(new URL('./project/project-milestones.html', import.meta.url)),
        'project-project-review': fileURLToPath(new URL('./project/project-review.html', import.meta.url)),
        'project-project-task': fileURLToPath(new URL('./project/project-task.html', import.meta.url)),
        'project-project-tasks': fileURLToPath(new URL('./project/project-tasks.html', import.meta.url)),
        'project-project': fileURLToPath(new URL('./project/project.html', import.meta.url)),
        'workspace-account': fileURLToPath(new URL('./workspace/account.html', import.meta.url)),
        'workspace-audit': fileURLToPath(new URL('./workspace/audit.html', import.meta.url)),
        'workspace-client': fileURLToPath(new URL('./workspace/client.html', import.meta.url)),
        'workspace-clients': fileURLToPath(new URL('./workspace/clients.html', import.meta.url)),
        'workspace-dashboard': fileURLToPath(new URL('./workspace/dashboard.html', import.meta.url)),
        'workspace-document': fileURLToPath(new URL('./workspace/document.html', import.meta.url)),
        'workspace-documents': fileURLToPath(new URL('./workspace/documents.html', import.meta.url)),
        'workspace-my-tasks': fileURLToPath(new URL('./workspace/my-tasks.html', import.meta.url)),
        'workspace-notifications': fileURLToPath(new URL('./workspace/notifications.html', import.meta.url)),
        'workspace-projects': fileURLToPath(new URL('./workspace/projects.html', import.meta.url)),
        'workspace-reports': fileURLToPath(new URL('./workspace/reports.html', import.meta.url)),
        'workspace-reviews': fileURLToPath(new URL('./workspace/reviews.html', import.meta.url)),
        'workspace-settings': fileURLToPath(new URL('./workspace/settings.html', import.meta.url)),
        'workspace-team': fileURLToPath(new URL('./workspace/team.html', import.meta.url))
      }
    }
  },
  preview: {
    port: 5200,
    strictPort: true
  },
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // DEV ONLY: The Vite dev server runs on http://localhost:5199,
            // but the backend strictly validates `origin === 'https://localhost:8443'`
            // on all state-changing requests (packages/server/src/product.ts:184)
            // and APP_ORIGIN is a fixed literal 'https://localhost:8443' (packages/server/src/index.ts:4).
            // In production, the frontend and API are served behind the same Caddy reverse proxy
            // on https://localhost:8443 (same-origin), so no proxy or header rewrite is used.
            proxyReq.setHeader('origin', 'https://localhost:8443');
          });
        }
      },
      '/dw-staging': {
        target: 'http://127.0.0.1:9000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // DEV ONLY: Storage capability signatures in dev are calculated by the backend
            // with signed header `host: localhost:8443` (packages/server/src/storage.ts:56).
            // When proxying to local MinIO in dev, the Host header must match what was signed.
            proxyReq.setHeader('host', 'localhost:8443');
          });
        }
      }
    }
  }
})
