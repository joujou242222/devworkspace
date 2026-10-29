import { useEffect, useRef } from 'react'
import PricingHeader from './PricingHeader.jsx'
import PricingHero from './PricingHero.jsx'
import Plans from './Plans.jsx'
import Guests from './Guests.jsx'
import Faq from './Faq.jsx'
import PricingFooter from './PricingFooter.jsx'

/* Scripts #1 (reveal observers) and #2 (progress bar, plan stagger, price count-up),
   ported in the original order so the final --d values match exactly */
function usePricingGlobals(barRef) {
  useEffect(() => {
    /* script #1 tail: reveal on scroll */
    const items = document.querySelectorAll('.rv')
    let io = null
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) { entries.forEach(function (entry) { if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target) } }) }, { threshold: .12 })
      items.forEach(function (item, index) { item.style.setProperty('--d', Math.min(index % 5, 4) * .07 + 's'); io.observe(item) })
    } else items.forEach(function (item) { item.classList.add('in') })

    /* script #2: progress bar + plan stagger + price count-up */
    const calm = matchMedia('(prefers-reduced-motion:reduce)').matches
    const bar = barRef.current
    function prog() { const h = document.documentElement.scrollHeight - innerHeight; bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0) + ')' }
    addEventListener('scroll', prog, { passive: true })
    prog()
    const plans = document.querySelectorAll('.plan')
    plans.forEach(function (pl, i) { pl.style.setProperty('--d', i * .12 + 's') })
    function count(pl) {
      const el = pl.querySelector('.price')
      if (!el || calm) return
      const n = el.firstChild
      if (!n || n.nodeType !== 3) return
      const m = n.nodeValue.match(/^(\D*)(\d+)/)
      if (!m) return
      const cur = m[1], end = +m[2], t0 = performance.now()
      ;(function f(t) { const k = Math.min(1, (t - t0) / 900); n.nodeValue = cur + Math.round(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f) })(t0)
    }
    let io2 = null
    if ('IntersectionObserver' in window) {
      io2 = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { count(e.target); io2.unobserve(e.target) } }) }, { threshold: .35 })
      plans.forEach(function (pl) { io2.observe(pl) })
    }
    return () => {
      if (io) io.disconnect()
      if (io2) io2.disconnect()
      removeEventListener('scroll', prog)
    }
  }, [])
}

export default function PricingApp() {
  const barRef = useRef(null)
  usePricingGlobals(barRef)

  return (
    <>
      <PricingHeader />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <PricingHero />
        <Plans />
        <Guests />
        <Faq />
      </main>
      <PricingFooter />
      <div className="progress" aria-hidden="true" ref={barRef} />
    </>
  )
}
