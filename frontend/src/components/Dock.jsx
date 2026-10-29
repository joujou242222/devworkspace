import { useEffect, useRef } from 'react'

const LINKS = [
  ['#plan', '01', 'Plan'],
  ['#files', '02', 'Proof'],
  ['#reviews', '03', 'Present'],
  ['#teams', '04', 'Clients']
]

export default function Dock() {
  const dockRef = useRef(null)
  const linkRefs = useRef([])

  /* Bottom nav tracks scroll: per-link progress, active section, show/hide (original script #9) */
  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return
    const links = linkRefs.current.filter(Boolean)
    const secs = links.map(a => document.querySelector(a.getAttribute('href')))
    const ft = document.querySelector('.ft')
    let tick = false, raf = 0
    function clamp(v) { return Math.max(0, Math.min(1, v)) }
    function update() {
      tick = false
      const vh = innerHeight, mid = vh * .45
      let act = -1
      secs.forEach(function (el, i) {
        if (!el || !el.isConnected) return
        const r = el.getBoundingClientRect(), p = clamp((mid - r.top) / r.height)
        links[i].style.setProperty('--p', p.toFixed(3))
        if (r.top <= mid && r.bottom > mid) act = i
      })
      links.forEach(function (a, i) { a.classList.toggle('act', i === act) })
      const first = secs[0]
      const started = first && first.isConnected && first.getBoundingClientRect().top < vh * .8
      const atEnd = ft && ft.isConnected && ft.getBoundingClientRect().top < vh - 60
      dock.classList.toggle('show', !!started && !atEnd)
    }
    function req() {
      if (tick) return
      tick = true
      raf = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', req, { passive: true })
    window.addEventListener('resize', req)
    update()
    return () => {
      window.removeEventListener('scroll', req)
      window.removeEventListener('resize', req)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <nav className="dock" id="dock" aria-label="Page sections" ref={dockRef}>
      {LINKS.map((a, i) => (
        <a href={a[0]} key={i} ref={el => { linkRefs.current[i] = el }}><b>{a[1]}</b><span className="dk-lb">{a[2]}</span></a>
      ))}
    </nav>
  )
}
