import { useEffect, useRef } from 'react'

const PIECES = [
  { s: 1, e: 5, ms: 1, me: 4, i: 0, x: '-220px', y: '-90px', r: '-14deg', t: 'Files' },
  { s: 3, e: 7, ms: 2, me: 5, i: 1, x: '160px', y: '-130px', r: '9deg', t: 'Notes' },
  { s: 5, e: 9, ms: 3, me: 6, i: 2, x: '-140px', y: '-40px', r: '12deg', t: 'Convo' },
  { s: 7, e: 12, ms: 4, me: 7, i: 3, x: '210px', y: '-110px', r: '-8deg', t: 'To-do' },
  { s: 10, e: 15, ms: 5, me: 8, i: 4, x: '-60px', y: '-150px', r: '6deg', t: 'Review' }
]

export default function FinalCta() {
  const fzRef = useRef(null)

  /* Scatter pieces snap back in again on click (original script #14) */
  useEffect(() => {
    const fz = fzRef.current
    if (!fz) return
    const ps = [].slice.call(fz.querySelectorAll('.fz-p'))
    const onClick = function () {
      ps.forEach(p => { p.style.animation = 'none' })
      void fz.offsetWidth
      ps.forEach(p => { p.style.animation = '' })
    }
    fz.addEventListener('click', onClick)
    return () => fz.removeEventListener('click', onClick)
  }, [])

  return (
    <div className="final rv">
      <h2>Ready to get <span className="un">organized?</span></h2>
      <p>Start a 14 day free trial today. No credit card required.</p>
      <a className="cta" href="/login">Get Started
        <svg viewBox="0 0 18 15" fill="none" aria-hidden="true"><path d="M1 7.5h16m0 0L10.6 1.1M17 7.5l-6.4 6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </a>
      <div className="fz" aria-hidden="true" title="Click to replay" ref={fzRef}>
        <em className="fz-lb">Your first 14 days</em>
        <div className="fz-days">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(n => n === 1 ? <span className="d1" key={n}>1</span> : <span key={n}>{n}</span>)}
        </div>
        {PIECES.map(p => (
          <span className="fz-p" key={p.i} style={{ '--s': p.s, '--e': p.e, '--ms': p.ms, '--me': p.me, '--i': p.i, '--x': p.x, '--y': p.y, '--r': p.r }}>{p.t}</span>
        ))}
      </div>
    </div>
  )
}
