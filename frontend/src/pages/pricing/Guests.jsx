import { useEffect, useRef } from 'react'

const COLORS = ['#d9a07a', '#9aa6ff', '#8c7cf6', '#f1fd82']
const DOTS = Array.from({ length: 24 }, (_, i) => COLORS[i % 4])

/* Guests section: markup verbatim + crowd loop script (#3) */
export default function Guests() {
  const boxRef = useRef(null)
  const nRef = useRef(null)
  const billRef = useRef(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box || !nRef.current || !billRef.current) return
    const dots = [].slice.call(box.querySelectorAll('.fv-crowd i'))
    const n = nRef.current, bill = billRef.current
    const calm = matchMedia('(prefers-reduced-motion:reduce)').matches
    let k = 0, t = null
    const total = dots.length
    function render() {
      dots.forEach(function (d, i) { d.classList.toggle('on', i < k) })
      n.textContent = k >= total ? '∞' : k
    }
    function step() {
      if (k >= total) { k = -1; setTimeout(function () { k = 0; render() }, 1400); return }
      if (k < 0) return
      k++; render()
      bill.classList.remove('tick'); void bill.offsetWidth; bill.classList.add('tick')
    }
    function start() { if (t) return; t = setInterval(step, 420) }
    function stop() { clearInterval(t); t = null }
    if (calm) { k = total; render(); return }
    let io = null
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) { es.forEach(function (e) { e.isIntersecting ? start() : stop() }) }, { threshold: .3 })
      io.observe(box)
    } else start()
    return () => { if (io) io.disconnect(); stop() }
  }, [])

  return (
    <section className="free rv" aria-labelledby="free-h">
      <div className="free-txt">
        <span className="tag">Free for guests</span>
        <h2 id="free-h">Guests <span className="hl">never</span> count toward your bill.</h2>
        <p>Invite as many clients, vendors and reviewers as you need. Group them into guest teams and choose which phases, tasks and files each team can see.</p>
        <p>Review links work without an account, so the people giving feedback never have to sign up.</p>
      </div>
      <div className="free-viz" aria-hidden="true" ref={boxRef}>
        <div className="fv-row"><span className="fv-lb">Planners <em>billed</em></span><span className="fv-pl"><i style={{ background: '#d9a07a' }}>S</i><i style={{ background: '#9aa6ff' }}>A</i><i style={{ background: '#8c7cf6' }}>D</i></span></div>
        <div className="fv-row"><span className="fv-lb">Guests invited</span><b className="fv-n" id="gn" ref={nRef}>0</b></div>
        <div className="fv-crowd">{DOTS.map((c, i) => <i style={{ '--c': c }} key={i} />)}</div>
        <div className="fv-bill"><span>Guests added to your bill</span><b ref={billRef}>$0</b></div>
      </div>
    </section>
  )
}
