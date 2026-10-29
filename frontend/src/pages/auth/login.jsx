import React, { useRef, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './login.css'
import { useBoxEnhance, AuthStage, busy } from './shared.jsx'
import { auth } from '../../lib/auth.js'

function LoginApp() {
  const boxRef = useRef(null)
  const errRef = useRef(null)
  const btnRef = useRef(null)
  const [errorMessage, setErrorMessage] = useState('Email or password is incorrect.')
  const [showError, setShowError] = useState(false)
  const [noticeMessage, setNoticeMessage] = useState('')

  useBoxEnhance(boxRef)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('notice') === 'org_created') {
      setNoticeMessage('Your organization is ready. Sign in again to continue.')
      try {
        const stored = sessionStorage.getItem('__dw_prefill_email')
        if (stored) {
          const emailInput = document.getElementById('e')
          if (emailInput) emailInput.value = stored
          sessionStorage.removeItem('__dw_prefill_email')
        }
      } catch (_) {}
    } else if (params.get('notice') === 'session_ended' || params.get('reason') === 'session_updated' || params.get('reason') === 'expired') {
      setNoticeMessage('Your session ended. Please sign in again.')
    }

    if (params.get('autofill') === '1' || params.get('demo') === '1') {
      const emailInput = document.getElementById('e')
      const passwordInput = document.getElementById('p')
      if (emailInput) emailInput.value = 'demo@agency.com'
      if (passwordInput) passwordInput.value = 'Password123!'
    }

    // If already authenticated, redirect to workspace or onboarding
    let active = true
    auth.init().then((session) => {
      if (!active || !session.authenticated) return
      const returnTo = params.get('returnTo')
      if (session.principals && session.principals.length > 0) {
        window.location.href = returnTo || '/workspace/dashboard'
      } else if (session.clientPrincipals && session.clientPrincipals.length > 0) {
        window.location.href = returnTo || '/portal/portal-projects'
      } else {
        window.location.href = '/onboarding'
      }
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setShowError(false)

    const form = e.currentTarget
    const email = form.querySelector('#e').value.trim()
    const rawPassword = form.querySelector('#p').value
    const password = rawPassword.trim()
    const btn = btnRef.current
    const origText = btn.textContent
    btn.disabled = true
    btn.textContent = 'Signing in…'

    try {
      let authRes = null
      try {
        authRes = await auth.login(email, password)
      } catch (loginErr) {
        if (rawPassword !== password) {
          authRes = await auth.login(email, rawPassword)
        } else {
          throw loginErr
        }
      }
      const { principals, clientPrincipals } = authRes
      const params = new URLSearchParams(window.location.search)
      const returnTo = params.get('returnTo')

      if ((!principals || principals.length === 0) && (!clientPrincipals || clientPrincipals.length === 0)) {
        window.location.href = '/onboarding'
      } else if (!principals || principals.length === 0) {
        window.location.href = returnTo || '/portal/portal-projects'
      } else {
        window.location.href = returnTo || '/workspace/dashboard'
      }
    } catch (err) {
      btn.disabled = false
      btn.textContent = origText
      setErrorMessage(err.details?.message || err.message || 'Email or password is incorrect.')
      setShowError(true)
    }
  }

  return (
    <main className="split">
      <AuthStage ariaHiddenFalse msg={<><h2>Pick up where the <mark className="hm">timeline</mark> left off.</h2><p>Your projects, reviews and clients are exactly as you left them.</p></>} />
      <section className="formside"><div className="box" ref={boxRef}>
        <h1>Sign in</h1><p>Use the email you registered with.</p>
        {noticeMessage && (
          <div className="msg" role="status" style={{ marginBottom: 16 }}>
            {noticeMessage}
          </div>
        )}
        <div className="msg err" role="alert" hidden={!showError} id="err" ref={errRef}>
          {errorMessage}
        </div>
        <div style={{
          marginBottom: '16px',
          padding: '10px 14px',
          background: 'rgba(190, 242, 100, 0.14)',
          border: '1px solid rgba(163, 230, 53, 0.4)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px'
        }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a2e05' }}>Quick Demo Account</div>
            <div style={{ fontSize: '12px', color: '#4d7c0f' }}>demo@agency.com</div>
          </div>
          <button
            id="demo-autofill-btn"
            type="button"
            className="btn sm lime"
            style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
            onClick={() => {
              const eInp = document.getElementById('e')
              const pInp = document.getElementById('p')
              if (eInp) eInp.value = 'demo@agency.com'
              if (pInp) pInp.value = 'Password123!'
              setShowError(false)
            }}
          >
            Auto-fill
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="fld"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="email" required /></div>
          <div className="fld"><label htmlFor="p">Password</label><input id="p" type="password" autoComplete="current-password" required /></div>
          <div className="row"><span /><a href="/forgot-password">Forgot your password?</a></div>
          <button className="btn lime" type="submit" ref={btnRef}>Sign in</button>
        </form>
        <p className="alt">New here? <a href="/register">Create an account</a></p>
      </div></section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<LoginApp />)
