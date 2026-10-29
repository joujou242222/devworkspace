import React, { useRef, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './auth.css'
import { useBoxEnhance, AuthStage, busy } from './shared.jsx'
import { auth } from '../../lib/auth.js'

function OnboardingApp() {
  const boxRef = useRef(null)
  const fRef = useRef(null), errRef = useRef(null), bRef = useRef(null)
  const [errorMessage, setErrorMessage] = useState('Finish your details first.')
  const [showError, setShowError] = useState(false)

  useBoxEnhance(boxRef)

  useEffect(() => {
    let active = true
    auth.init().then((session) => {
      if (!active) return
      if (!session.authenticated) {
        window.location.href = '/login?returnTo=/onboarding'
        return
      }
      // If user already has an organization, go to dashboard
      if (session.principals && session.principals.length > 0) {
        window.location.href = '/workspace/dashboard'
      }
    }).catch(() => {
      window.location.href = '/login?returnTo=/onboarding'
    })
    return () => { active = false }
  }, [])

  const onSubmit = async function (ev) {
    ev.preventDefault()
    setShowError(false)
    const n = fRef.current.querySelector('#n')
    const d = fRef.current.querySelector('#d')
    const btn = bRef.current

    if (!n.value.trim()) {
      setErrorMessage('Company name is required.')
      setShowError(true)
      return
    }

    const origText = btn.textContent
    btn.disabled = true
    btn.textContent = 'Saving…'

    try {
      const email = auth.user?.email || ''
      await auth.createOrganization({
        name: n.value.trim(),
        description: d ? d.value.trim() : ''
      })
      if (email) {
        try {
          sessionStorage.setItem('__dw_prefill_email', email)
        } catch (_) {}
      }
      window.location.href = '/login?notice=org_created'
    } catch (err) {
      btn.disabled = false
      btn.textContent = origText
      setErrorMessage(err.details?.message || err.message || 'Cannot create organization right now. Try again.')
      setShowError(true)
    }
  }

  return (
    <main className="split">
      <AuthStage msg={<><h2>Name it. Then <mark className="hm">plan it.</mark></h2></>} />
      <section className="formside"><div className="box" id="box" ref={boxRef}>
        <h1>Create organization</h1><p>One short step, then you’re in.</p>
        <div className="msg err" role="alert" hidden={!showError} id="err" ref={errRef}>
          {errorMessage}
        </div>
        <form id="f" ref={fRef} onSubmit={onSubmit}>
          <div className="fld"><label htmlFor="n">Company name</label><input id="n" type="text" autoComplete="organization" required /></div>
          <div className="fld"><label htmlFor="d">Description</label><textarea id="d" placeholder="What does your team make?" /></div>
          <button className="btn lime" id="b" type="submit" ref={bRef}>Create organization</button>
        </form>
      </div></section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<OnboardingApp />)
