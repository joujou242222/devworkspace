import { useEffect, useRef, useState } from 'react'

const TXT = 'At some point along the way project management tools got too complex. Instead of simplifying work, they did the opposite. So we stripped it all away and chose to organize everything by the most basic fundamental concept: time.'
const WORDS = TXT.split(' ')
const KW = /^(complex\.|opposite\.|time\.)$/

export default function Manifesto() {
  const trackRef = useRef(null)
  const [p, setP] = useState(0)

  useEffect(() => {
    const tr = trackRef.current
    if (!tr) return
    function mani() {
      if (!tr.isConnected) return
      const r = tr.getBoundingClientRect(), h = innerHeight
      const span = Math.max(1, r.height - h * .94)
      const v = Math.min(1, Math.max(0, (h * .03 - r.top) / span))
      setP(v)
    }
    const onScroll = () => mani()
    const onResizeM = () => mani()
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onResizeM)
    mani()
    return () => {
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onResizeM)
    }
  }, [])

  const onCount = Math.ceil(WORDS.length * 1.06 * p)
  const mins = Math.round(p * 480) + 540
  const hh = Math.floor(mins / 60), mm = mins % 60
  const clock = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
  const done = p > .97

  return (
    <section className="manifesto wrap" aria-label="Manifesto">
      <div className={'mf-track' + (done ? ' done' : '')} id="mf" ref={trackRef} style={{ '--mp': p.toFixed(4) }}>
        <div className="mf-sticky">
          <div className="mf-rail" aria-hidden="true">
            <b className="mf-clock">{clock}</b>
            <i className="mf-line"><u /></i>
            <i className="mf-end">17:00</i>
          </div>
          <div className="mf-body">
            <div className="mf-eyebrow">Why time?</div>
            <p id="mani">
              {WORDS.flatMap((w, i) => {
                const span = <span key={i} className={(KW.test(w) ? 'kw' : '') + (i < onCount ? ' on' : '')}>{w}</span>
                return i < WORDS.length - 1 ? [span, ' '] : [span]
              })}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
