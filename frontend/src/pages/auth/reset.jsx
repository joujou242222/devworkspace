import React, { useRef, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './auth.css'
import { useBoxEnhance, AuthStage } from './shared.jsx'
import { auth } from '../../lib/auth.js'

function ResetApp() {
  const boxRef = useRef(null)
  const fRef = useRef(null), errRef = useRef(null), bRef = useRef(null), doneRef = useRef(null), badRef = useRef(null), btRef = useRef(null)
  const [token, setToken] = useState('')
  const [invalidMsg, setInvalidMsg] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useBoxEnhance(boxRef)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    if (t) {
      setToken(t)
    } else {
      const q = location.hash.slice(1)
      const badMsg = { expired: 'This link has expired.', used: 'This link was already used.', invalid: 'This link isn’t valid.' }[q]
      setInvalidMsg(badMsg || 'This link isn’t valid. Missing reset token.')
    }
  }, [])

  const onSubmit = async function (ev) {
    ev.preventDefault()
    setErrorMessage('')
    const pEl = fRef.current.querySelector('#p')
    const cEl = fRef.current.querySelector('#c')

    if (pEl.value !== cEl.value) {
      setErrorMessage('Passwords don’t match.')
      return
    }

    if (!token) {
      setInvalidMsg('Reset token is missing or expired.')
      return
    }

    const btn = bRef.current
    const origText = btn.textContent
    btn.disabled = true
    btn.textContent = 'Saving…'

    try {
      await auth.resetPassword(token, pEl.value)
      fRef.current.hidden = true
      doneRef.current.hidden = false
    } catch (err) {
      btn.disabled = false
      btn.textContent = origText
      const msg = err.details?.message || err.message || 'Cannot reset password. The link may have expired.'
      if (err.status === 400 || err.status === 404 || err.code === 'INVALID_TOKEN') {
        setInvalidMsg(msg)
      } else {
        setErrorMessage(msg)
      }
    }
  }

  return (
    <main className="split">
      <AuthStage msg={<><h2>A <mark className="hm">fresh start</mark> for your timeline.</h2></>} />
      <section className="formside"><div className="box" id="box" ref={boxRef}>
        <h1>New password</h1><p>Choose something you haven’t used here before.</p>
        <div className="msg err" role="alert" hidden={!errorMessage} id="err" ref={errRef}>
          {errorMessage}
        </div>
        <form id="f" ref={fRef} hidden={Boolean(invalidMsg)} onSubmit={onSubmit}>
          <div className="fld"><label htmlFor="p">New password</label><input id="p" type="password" autoComplete="new-password" required minLength={8} /></div>
          <div className="fld"><label htmlFor="c">Confirm new password</label><input id="c" type="password" autoComplete="new-password" required /></div>
          <p className="alt" style={{ margin: '-4px 0 18px', textAlign: 'left' }}>You’ll be signed out on all your other devices.</p>
          <button className="btn lime" id="b" type="submit" ref={bRef}>Save password</button>
        </form>
        <div id="done" hidden ref={doneRef}><div className="msg" role="status">Password updated. Sign in with your new password.</div><a className="btn lime" style={{ width: '100%', height: 54 }} href="/login">Back to sign in</a></div>
        <div id="bad" hidden={!invalidMsg} ref={badRef}><div className="msg err" role="alert" id="bt" ref={btRef}>{invalidMsg}</div><a className="btn" style={{ width: '100%', height: 54 }} href="/forgot-password">Request a new link</a></div>
      </div></section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<ResetApp />)
