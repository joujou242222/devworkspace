import { useEffect, useRef, useState } from 'react'

const L = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* Footer: markup verbatim + generated mini timeline (original script #6) */
export default function PricingFooter() {
  const ftRef = useRef(null)
  const daysRef = useRef(null)
  const [state] = useState(() => {
    const t = new Date()
    const days = []
    for (let i = 0; i < 14; i++) {
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i - 3)
      days.push({ label: L[d.getDay()], num: d.getDate(), now: i === 3 })
    }
    return { days, year: t.getFullYear() }
  })

  useEffect(() => {
    const ft = ftRef.current
    if (!ft) return
    const up = document.getElementById('ft-up')
    const onUp = up ? function () { scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' }) } : null
    if (up) up.addEventListener('click', onUp)
    let io = null
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting })) { ft.classList.add('in'); io.disconnect(); io = null } }, { threshold: .25 })
      io.observe(ft)
    } else ft.classList.add('in')
    return () => { if (onUp) up.removeEventListener('click', onUp); if (io) io.disconnect() }
  }, [])

  return (
    <footer>
      <div className="ft" ref={ftRef}>
        <div className="ft-top">
          <p className="ft-h">Organize your projects <em>in time.</em></p>
          <a className="ft-go" href="/pricing#plans">Start free<svg viewBox="0 0 18 15" fill="none" aria-hidden="true"><path d="M1 7.5h16m0 0L10.6 1.1M17 7.5l-6.4 6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></a>
        </div>
        <nav className="ft-tl" aria-label="Footer">
          <div className="ft-days" aria-hidden="true" ref={daysRef}>
            {state.days.map((d, i) => <span className={d.now ? 'now' : undefined} key={i}>{d.label}<b>{d.num}</b></span>)}
          </div>
          <div className="ft-row"><a className="ft-bar b1" href="/" style={{ '--i': 0, '--s': 1, '--e': 7, '--ms': 1, '--me': 6 }}>Product</a></div>
          <div className="ft-row"><a className="ft-bar b2" href="/pricing" aria-current="page" style={{ '--i': 1, '--s': 5, '--e': 12, '--ms': 3, '--me': 8 }}>Pricing</a></div>
          <div className="ft-row"><a className="ft-bar b3" href="/pricing#plans" style={{ '--i': 2, '--s': 9, '--e': 15, '--ms': 2, '--me': 7 }}>Start your trial</a></div>
          <i className="ft-now" aria-hidden="true" />
        </nav>
        <div className="ft-bot"><span>© <span id="ft-y">{state.year}</span> Devworkspace</span><button type="button" className="ft-up" id="ft-up" aria-label="Back to top">↑</button></div>
      </div>
      <div className="mark" aria-hidden="true">Devworkspace</div>
    </footer>
  )
}
