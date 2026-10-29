import { useLayoutEffect } from 'react'
import { i18n } from '../../lib/i18n.js'

/* Original shared script (identical on all auth pages), ported with useLayoutEffect
   so the --k stagger and the .pw/.meter DOM transforms land before the first paint,
   exactly like the original end-of-body script did. */
export function useBoxEnhance(boxRef) {
  useLayoutEffect(() => {
    i18n.init()
    if (i18n.isRTL()) {
      i18n.translateTree(document.body)
    }

    const box = boxRef.current
    if (!box) return

    /* stagger the form pieces */
    let k = 0
    ;[].forEach.call(box.querySelectorAll(':scope > *'), function (el) { el.style.setProperty('--k', k++) })

    /* show/hide password (one toggle controls a password + its confirm field) */
    const pws = [].slice.call(document.querySelectorAll('input[type=password]'))
    const done = []
    pws.forEach(function (inp) {
      if (done.indexOf(inp) > -1) return
      const grp = [inp], two = inp.closest('.two')
      if (two) pws.forEach(function (o) { if (o !== inp && two.contains(o)) grp.push(o) })
      grp.forEach(function (g) { done.push(g) })
      const w = document.createElement('div'); w.className = 'pw'; inp.parentNode.insertBefore(w, inp); w.appendChild(inp)
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pwt'; b.textContent = 'Show'; b.setAttribute('aria-label', 'Show password'); b.setAttribute('aria-pressed', 'false')
      b.addEventListener('click', function () {
        const s = inp.type === 'password'
        grp.forEach(function (g) { g.type = s ? 'text' : 'password' })
        b.textContent = s ? 'Hide' : 'Show'
        b.setAttribute('aria-pressed', s)
        b.setAttribute('aria-label', s ? 'Hide password' : 'Show password')
      })
      w.appendChild(b)
    })

    /* strength meter: four bars that fill like a timeline */
    const p = document.getElementById('p')
    if (p && p.getAttribute('autocomplete') === 'new-password') {
      const m = document.createElement('div'); m.className = 'meter'; m.setAttribute('aria-hidden', 'true')
      m.innerHTML = '<i></i><i></i><i></i><i></i><em></em>'
      const host = p.closest('.two') || p.closest('.fld')
      host.parentNode.insertBefore(m, host.nextSibling)
      const bars = m.querySelectorAll('i'), lab = m.querySelector('em'), names = ['', 'Weak', 'Okay', 'Good', 'Strong']
      const onInput = function () {
        const v = p.value
        let sc = 0; if (v.length >= 8) sc++; if (v.length >= 12) sc++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) sc++; if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) sc++
        if (!v) sc = 0
        ;[].forEach.call(bars, function (b, i) { b.classList.toggle('on', i < sc) }); lab.textContent = names[sc]
      }
      p.addEventListener('input', onInput)
    }
  }, [])
}

/* Left stage — identical markup on every auth page */
export function AuthStage({ ariaHiddenFalse, msg }) {
  return (
    <section className="stage dk" aria-hidden={ariaHiddenFalse ? false : undefined}>
      <header className="top">
        <a className="brand" href="/" aria-label="Devworkspace home"><span className="lgm" aria-hidden="true"><i /><i /><i /></span><span className="lgw"><span className="d">Dev</span><span className="w">workspace</span></span></a><i className="rule" aria-hidden="true" />
      </header>
      <div>
        <div className="gantt" aria-hidden="true"><b>Scriptwriting</b><b>Boards</b><b>Shoot planning</b><b>Review</b></div>
        {msg}
      </div>
    </section>
  )
}

/* busy() helper from the original scripts */
export function busy(b, t) { b.disabled = true; b.textContent = t }
