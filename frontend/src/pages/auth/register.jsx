import React, { useRef, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './auth.css'
import { useBoxEnhance, AuthStage } from './shared.jsx'
import { auth } from '../../lib/auth.js'
import { api } from '../../lib/api.js'

function RegisterApp() {
  const boxRef = useRef(null)
  const fRef = useRef(null), errRef = useRef(null), emRef = useRef(null), alRef = useRef(null), doneRef = useRef(null), rsRef = useRef(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState('')

  useBoxEnhance(boxRef)

  // Handle email verification token if present in query string
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      setVerifying(true)
      auth.verifyEmail(token)
        .then(() => {
          setVerified(true)
        })
        .catch((err) => {
          const e = errRef.current
          if (e) {
            e.textContent = err.details?.message || err.message || 'Verification link is invalid or has expired.'
            e.hidden = false
          }
        })
        .finally(() => {
          setVerifying(false)
        })
    }
  }, [])

  const onSubmit = async function (ev) {
    ev.preventDefault()
    const e = errRef.current
    const nameEl = fRef.current.querySelector('#n')
    const emailEl = fRef.current.querySelector('#e')
    const pEl = fRef.current.querySelector('#p')
    const cEl = fRef.current.querySelector('#c')

    if (pEl.value !== cEl.value) {
      e.textContent = 'Passwords don’t match.'
      e.hidden = false
      return
    }

    e.hidden = true
    setSubmitting(true)
    const btn = fRef.current.querySelector('button[type="submit"]')
    const origText = btn.textContent
    btn.disabled = true
    btn.textContent = 'Creating account…'

    try {
      await auth.register(nameEl.value.trim(), emailEl.value.trim(), pEl.value)
      setRegisteredEmail(emailEl.value.trim())
      emRef.current.textContent = emailEl.value.trim()
      fRef.current.hidden = true
      alRef.current.hidden = true
      doneRef.current.hidden = false
    } catch (err) {
      e.textContent = err.details?.message || err.message || 'Cannot register right now. Try again.'
      e.hidden = false
      btn.disabled = false
      btn.textContent = origText
    } finally {
      setSubmitting(false)
    }
  }

  const onResend = async function () {
    if (!registeredEmail) return
    rsRef.current.disabled = true
    rsRef.current.textContent = 'Sending…'
    try {
      await api.post('/identity/resend', { email: registeredEmail })
      rsRef.current.textContent = 'Email sent again'
    } catch (err) {
      rsRef.current.textContent = 'Failed to resend. Try again.'
      rsRef.current.disabled = false
    }
  }

  return (
    <main className="split">
      <AuthStage msg={<><h2>Start planning on <mark className="hm">one timeline.</mark></h2></>} />
      <section className="formside"><div className="box" id="box" ref={boxRef}>
        <h1>Create account</h1><p>An account alone doesn’t open any workspace. You’ll create or join one next.</p>
        <div className="msg err" role="alert" hidden id="err" ref={errRef} />

        {verified ? (
          <div id="verified-banner">
            <div className="msg" role="status">Email verified successfully! You can now sign in to your account.</div>
            <a className="btn lime" style={{ width: '100%', height: 54, marginTop: 16 }} href="/login">Continue to Sign in</a>
          </div>
        ) : (
          <>
            <form id="f" ref={fRef} onSubmit={onSubmit}>
              <div className="fld"><label htmlFor="n">Name</label><input id="n" type="text" autoComplete="name" required /></div>
              <div className="fld"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="email" required /></div>
              <div className="two"><div className="fld"><label htmlFor="p">Password</label><input id="p" type="password" autoComplete="new-password" required minLength={8} /></div><div className="fld"><label htmlFor="c">Confirm password</label><input id="c" type="password" autoComplete="new-password" required /></div></div>
              <button className="btn lime" type="submit" disabled={submitting || verifying}>Create account</button>
            </form>
            <div id="done" hidden ref={doneRef}><div className="msg" role="status">Check your inbox. We sent a confirmation link to <b id="em" ref={emRef} />. If that email is already in use, you’ll get a message explaining what to do.</div>
              <p className="alt">Didn’t get it? <button className="link" id="rs" ref={rsRef} onClick={onResend}>Resend email</button></p>
              <p className="alt" style={{ marginTop: 12 }}>Already confirmed? <a href="/login">Sign in to your account</a></p>
            </div>
            <p className="alt" id="al" ref={alRef}>Already have an account? <a href="/login">Sign in</a></p>
          </>
        )}
      </div></section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<RegisterApp />)
