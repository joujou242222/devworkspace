import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { api, esc } from '../lib/api.js'
import { auth } from '../lib/auth.js'
import * as helpers from '../lib/helpers.js'
import { i18n } from '../lib/i18n.js'
import '../styles/design-system.css'

// Expose shared API, Auth and sanitization helpers globally
// so all classic page scripts (page.js.txt) can consume them directly
if (typeof window !== 'undefined') {
  window.__API__ = api
  window.__AUTH__ = auth
  window.api = api
  window.auth = auth
  window.esc = esc
  window.__DW_HELPERS__ = helpers
  window.helpers = helpers
  window.__DW_I18N__ = i18n
  window.i18n = i18n
}

/**
 * Renders the page's original static markup verbatim, then executes its
 * original <script> blocks as classic scripts inside the host node —
 * same order and global semantics as the source page's end-of-body code.
 *
 * Strict Route Guard resolves BEFORE any markup or scripts are injected,
 * preventing any flash of protected content.
 */
export default function Doc({ body, scripts = [] }) {
  const [authorized, setAuthorized] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    let active = true

    async function checkGuard() {
      const path = window.location.pathname
      const isWorkspace = path.startsWith('/workspace') || path.startsWith('/project')
      const isPortal = path.startsWith('/portal')

      // Public / static / error pages don't require workspace auth
      if (!isWorkspace && !isPortal) {
        if (active) setAuthorized(true)
        return
      }

      try {
        const session = await auth.init()
        if (!active) return

        if (!session.authenticated) {
          const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
          window.location.href = `/login?returnTo=${returnTo}&notice=session_ended`
          return
        }

        if (isWorkspace && (!session.principals || session.principals.length === 0)) {
          window.location.href = '/onboarding'
          return
        }

        if (isPortal && (!session.clientPrincipals || session.clientPrincipals.length === 0)) {
          // If the user has workspace access but no client access, redirect to workspace
          if (session.principals && session.principals.length > 0) {
            window.location.href = '/workspace/dashboard'
            return
          }
        }

        if (active) setAuthorized(true)
      } catch (err) {
        if (active) {
          const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
          window.location.href = `/login?returnTo=${returnTo}&notice=session_ended`
        }
      }
    }

    checkGuard()
    return () => { active = false }
  }, [])

  useLayoutEffect(() => {
    if (!authorized) return
    const host = ref.current
    if (!host) return

    host.innerHTML = body

    // Inject runtime logout button into .util (workspace/project) or .ph > .pr (portal)
    const util = host.querySelector('.util')
    const portalHeader = host.querySelector('.ph > .pr')
    const target = util || portalHeader
    if (target && !target.querySelector('#logout-btn')) {
      const logoutBtn = document.createElement('button')
      logoutBtn.id = 'logout-btn'
      logoutBtn.type = 'button'
      logoutBtn.className = 'ib'
      logoutBtn.textContent = 'Log out'
      logoutBtn.onclick = () => {
        auth.logout()
      }
      const dr = target.querySelector('#dr')
      if (dr) {
        target.insertBefore(logoutBtn, dr)
      } else {
        target.appendChild(logoutBtn)
      }
    }

    // Mount language switcher button into toolbar
    i18n.mountToolbarButton()
    if (i18n.isRTL()) {
      i18n.translateTree(host)
    }

    // Role-based navigation visibility: hide admin-only items (Team, Audit) for MEMBER
    const activePrincipal = auth.getActivePrincipal()
    if (activePrincipal && activePrincipal.role === 'MEMBER') {
      const teamNav = host.querySelector('nav a[href="/workspace/team"]')
      if (teamNav) {
        teamNav.hidden = true
        teamNav.style.display = 'none'
      }
      const auditNav = host.querySelector('nav a[href="/workspace/audit"]')
      if (auditNav) {
        auditNav.hidden = true
        auditNav.style.display = 'none'
      }
    }

    // In project pages, validate and propagate ?id=<uuid>
    const isProjectPage = window.location.pathname.startsWith('/project/')
    if (isProjectPage) {
      const params = new URLSearchParams(window.location.search)
      const projectId = params.get('id')
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

      if (!projectId || !uuidRegex.test(projectId)) {
        helpers.renderNotAvailableState(host, 'This project is not available.')
        return
      }

      window.__DW_PROJECT_ID__ = projectId

      // Propagate ?id=<uuid> across all project navigation and links at runtime
      const projectLinks = host.querySelectorAll('a[href^="/project/"]')
      projectLinks.forEach(a => {
        try {
          const rawHref = a.getAttribute('href')
          if (!rawHref) return
          const url = new URL(rawHref, window.location.origin)
          if (!url.searchParams.has('id')) {
            url.searchParams.set('id', projectId)
            a.setAttribute('href', url.pathname + url.search + url.hash)
          }
        } catch (_) {}
      })
    }

    for (const code of scripts.flat()) {
      const el = document.createElement('script')
      el.textContent = code
      host.appendChild(el)
    }

    /* Native fragment scroll ran before React committed; the original
       pages had static markup, so re-run it here for parity. */
    if (location.hash.length > 1) {
      const t = document.getElementById(decodeURIComponent(location.hash.slice(1)))
      if (t) t.scrollIntoView()
    }
  }, [authorized, body, scripts])

  if (!authorized) {
    return <div style={{ minHeight: '100vh', background: 'var(--ink, #141414)' }} />
  }

  return <div ref={ref} />
}
