import { useEffect, useRef } from 'react'

const CHIPS = [
  { t: 'Calendar', x: '-150px', y: '-110px', r: '-8deg', i: 0 },
  { t: 'Tasks', x: '140px', y: '-120px', r: '6deg', i: 1 },
  { t: 'Files', x: '-165px', y: '10px', r: '5deg', i: 2 },
  { t: 'Chat', x: '150px', y: '20px', r: '-6deg', i: 3 },
  { t: 'Docs', x: '-20px', y: '125px', r: '-4deg', i: 4 }
]

export default function Quote() {
  const vizRef = useRef(null)

  /* Merge animation plays on scroll into view and can be replayed by click (original script #13) */
  useEffect(() => {
    const v = vizRef.current
    if (!v) return
    function play() { v.classList.remove('go'); void v.offsetWidth; v.classList.add('go') }
    let io = null
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { play(); io.disconnect(); io = null } })
      }, { threshold: .4 })
      io.observe(v)
    } else play()
    const onClick = play
    v.addEventListener('click', onClick)
    return () => {
      if (io) io.disconnect()
      v.removeEventListener('click', onClick)
    }
  }, [])

  return (
    <div className="quote rv">
      <div className="q-txt">
        <blockquote>“Devworkspace has saved me <span className="qh">hours and hours of time</span> and eliminated the need to use <span className="qx">multiple platforms.</span>”</blockquote>
        <cite><i className="q-av" aria-hidden="true">N</i><span><b>Nicole D’Anna Long</b>, Director of Creative Services</span></cite>
      </div>
      <div className="q-viz" aria-hidden="true" title="Click to replay" ref={vizRef}>
        {CHIPS.map(c => <span className="qc" key={c.i} style={{ '--x': c.x, '--y': c.y, '--r': c.r, '--i': c.i }}>{c.t}</span>)}
        <span className="qd"><svg viewBox="0 0 24 18" aria-hidden="true"><rect x="0" y="0" width="14" height="4" rx="2"/><rect x="4" y="7" width="18" height="4" rx="2"/><rect x="2" y="14" width="10" height="4" rx="2"/></svg>Devworkspace</span>
        <em className="q-cap">One place</em>
      </div>
    </div>
  )
}
