import React, { useRef, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './auth.css'
import { useBoxEnhance, AuthStage } from './shared.jsx'
import { auth } from '../../lib/auth.js'

function InvitationApp() {
  const boxRef = useRef(null)
  const errRef = useRef(null), accRef = useRef(null), alRef = useRef(null), doneRef = useRef(null), authRef = useRef(null)
  const [token, setToken] = useState('')
  const [invData, setInvData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useBoxEnhance(boxRef)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token') || location.hash.slice(1)
    setToken(t)

    if (!t) {
      setErrorMessage('Missing invitation token.')
      setLoading(false)
      return
    }

    // Check if user is authenticated
    auth.init().then((session) => {
      setAuthenticated(session.authenticated)
      if (session.authenticated) {
        // Inspect invitation
        return auth.inspectInvitation(t).then((data) => {
          setInvData(data)
        })
      }
    }).catch((err) => {
      setErrorMessage(err.details?.message || err.message || 'Invitation is invalid or has expired.')
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleSignInAndAccept = async (e) => {
    e.preventDefault()
    setErrorMessage('')
    const form = e.currentTarget
    const email = form.querySelector('#e').value.trim()
    const password = form.querySelector('#p').value
    const btn = form.querySelector('button')
    const origText = btn.textContent

    btn.disabled = true
    btn.textContent = 'Signing in…'

    try {
      await auth.login(email, password)
      setAuthenticated(true)
      const data = await auth.inspectInvitation(token)
      setInvData(data)
      await auth.acceptInvitation(token)
      // Silent re-login with local variable to establish fresh session post-membership trigger
      await auth.login(email, password)
      ok()
    } catch (err) {
      btn.disabled = false
      btn.textContent = origText
      setErrorMessage(err.details?.message || err.message || 'Sign in failed or invitation invalid.')
    }
  }

  const handleAccept = async () => {
    setErrorMessage('')
    const btn = accRef.current
    const origText = btn.textContent
    btn.disabled = true
    btn.textContent = 'Accepting…'

    try {
      await auth.acceptInvitation(token)
      ok()
    } catch (err) {
      btn.disabled = false
      btn.textContent = origText
      setErrorMessage(err.details?.message || err.message || 'Failed to accept invitation.')
    }
  }

  function ok() {
    if (accRef.current) accRef.current.hidden = true
    if (authRef.current) authRef.current.hidden = true
    if (alRef.current) alRef.current.hidden = true
    if (doneRef.current) doneRef.current.hidden = false
  }

  return (
    <main className="split">
      <AuthStage msg={<><h2>Your team is <mark className="hm">waiting</mark> on the timeline.</h2></>} />
      <section className="formside"><div className="box" id="box" ref={boxRef}>
        <h1>You’re invited</h1><p>Check the details, then accept to join.</p>
        <div className="msg err" role="alert" hidden={!errorMessage} id="err" ref={errRef}>
          {errorMessage}
        </div>

        <div className="inv">
          <div><span>Organization</span><b>{invData?.organization?.name || 'Studio Nour'}</b></div>
          <div><span>Invitation type</span><b>{invData?.capacity || 'Client contact'}</b></div>
          <div><span>Suggested role</span><b>{invData?.role || 'Reviewer'}</b></div>
          <div><span>Projects you’ll see</span><b>{invData?.project?.name || 'Assigned projects'}</b></div>
        </div>
        <p className="alt" style={{ textAlign: 'left', margin: '-8px 0 18px' }}>The role is set by the organization. You can’t change it here.</p>

        {!authenticated && (
          <div id="auth" ref={authRef}>
            <p className="alt" style={{ textAlign: 'left', marginBottom: 12 }}>Sign in to accept this invitation.</p>
            <form id="f" onSubmit={handleSignInAndAccept}>
              <div className="fld"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="email" required /></div>
              <div className="fld"><label htmlFor="p">Password</label><input id="p" type="password" autoComplete="current-password" required /></div>
              <button className="btn lime" id="b" type="submit">Sign in and accept</button>
            </form>
          </div>
        )}

        {authenticated && (
          <button className="btn lime" id="acc" type="button" ref={accRef} onClick={handleAccept} disabled={loading || Boolean(errorMessage)}>
            Accept invitation
          </button>
        )}

        <div id="done" hidden ref={doneRef}>
          <div className="msg" role="status">Invitation accepted. You now have access.</div>
          <a className="btn lime" style={{ width: '100%', height: 54 }} href="/workspace/dashboard">Open workspace</a>
        </div>
        <p className="alt" id="al" ref={alRef}>No account yet? <a href="/register">Create one</a></p>
      </div></section>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<InvitationApp />)
