import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './auth.css'
import { useBoxEnhance, AuthStage, busy } from './shared.jsx'
import { auth } from '../../lib/auth.js'

function ForgotApp() {
  const boxRef = useRef(null)
  const fRef = useRef(null), bRef = useRef(null), doneRef = useRef(null), errRef = useRef(null)
  const [errorMessage, setErrorMessage] = useState('We couldn’t send the email. Try again in a moment.')
  const [showError, setShowError] = useState(false)

  useBoxEnhance(boxRef)

  const onSubmit = async function (ev) {
    ev.preventDefault()
    setShowError(false)
    const emailEl = fRef.current.querySelector('#e')
    const btn = bRef.current
    const origText = btn.textContent

    btn.disabled = true
    btn.textContent = 'Sending…'

    try {
      await auth.requestPasswordReset(emailEl.value.trim())
      fRef.current.hidden = true
      doneRef.current.hidden = false
    } catch (err) {
      btn.disabled = false
      btn.textContent = origText
      setErrorMessage(err.details?.message || err.message || 'We couldn’t send the email. Try again in a moment.')
      setShowError(true)
    }
  }

  return (
    <main className="split">
      <AuthStage msg={<><h2><mark className="hm">Locked out?</mark> It happens.</h2></>} />
      <section className="formside"><div className="box" id="box" ref={boxRef}>
        <h1>Forgot password?</h1><p>Enter your email and we’ll send you a link to set a new one.</p>
        <div className="msg err" role="alert" hidden={!showError} id="err" ref={errRef}>
          {errorMessage}
        </div>
        <form id="f" ref={fRef} onSubmit={onSubmit}>
          <div className="fld"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="email" required /></div>
          <button className="btn lime" id="b" type="submit" ref={bRef}>Send reset link</button>
        </form>
        <div id="done" hidden ref={doneRef}><div className="msg" role="status">If an account exists for that email, a reset link is on its way. It may take a minute.</div></div>
        <p className="alt"><a href="/login">Back to sign in</a></p>
      </div></section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<ForgotApp />)
