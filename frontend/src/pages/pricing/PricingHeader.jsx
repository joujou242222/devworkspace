import { useEffect, useRef } from 'react'

/* Pricing nav + brand: ports of scripts #1 (nav), #7 (indicator/--sp/magnetic) and #8 (brand) */
export default function PricingHeader() {
  const brandRef = useRef(null)
  const navRef = useRef(null)

  useEffect(() => {
    const nav = navRef.current
    const brand = brandRef.current
    if (!nav || !brand) return

    /* Nav pill: open at top, collapsed on scroll (original script #1) */
    let over = false, focus = false
    function sync() { nav.dataset.state = (window.scrollY > 40 && !over && !focus) ? 'collapsed' : 'open' }
    const onOver = () => { over = true; sync() }
    const onOut = () => { over = false; sync() }
    const onFocIn = () => { focus = true; sync() }
    const onFocOut = () => { focus = false; sync() }
    nav.addEventListener('mouseenter', onOver)
    nav.addEventListener('mouseleave', onOut)
    nav.addEventListener('focusin', onFocIn)
    nav.addEventListener('focusout', onFocOut)
    window.addEventListener('scroll', sync, { passive: true })
    sync()

    /* Sliding indicator + scroll progress + magnetic CTA (original script #7) */
    const ul = nav.querySelector('.fold ul')
    let ind = null, cleanups2 = []
    const links = ul ? [].slice.call(ul.querySelectorAll('a')) : []
    const go = nav.querySelector('.go')
    if (ul && links.length) {
      ind = document.createElement('span')
      ind.className = 'ind'
      ind.setAttribute('aria-hidden', 'true')
      ul.insertBefore(ind, ul.firstChild)
      const cur = ul.querySelector('[aria-current]') || links[0]
      let hov = null
      function place(a) { links.forEach(function (l) { l.classList.toggle('on', l === a) }); ind.style.width = a.offsetWidth + 'px'; ind.style.transform = 'translateX(' + a.offsetLeft + 'px)' }
      function syncInd() { place(hov || cur) }
      nav.classList.add('has-ind'); syncInd()
      links.forEach(function (l) {
        const en = () => { hov = l; syncInd() }
        const le = () => { hov = null; syncInd() }
        l.addEventListener('mouseenter', en); l.addEventListener('focus', en)
        l.addEventListener('mouseleave', le); l.addEventListener('blur', le)
        cleanups2.push(() => { l.removeEventListener('mouseenter', en); l.removeEventListener('focus', en); l.removeEventListener('mouseleave', le); l.removeEventListener('blur', le) })
      })
      const onResize = () => syncInd()
      window.addEventListener('resize', onResize)
      window.addEventListener('load', onResize)
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncInd)
      const mo = new MutationObserver(syncInd).observe(nav, { attributes: true, attributeFilter: ['data-state'] })
      cleanups2.push(() => { window.removeEventListener('resize', onResize); window.removeEventListener('load', onResize); if (mo) mo.disconnect() })
    }
    function prog() { const h = document.documentElement.scrollHeight - innerHeight; nav.style.setProperty('--sp', h > 0 ? Math.min(1, scrollY / h).toFixed(3) : 0) }
    window.addEventListener('scroll', prog, { passive: true })
    prog()
    let goMove = null, goLeave = null
    if (go && !matchMedia('(prefers-reduced-motion:reduce)').matches && matchMedia('(hover:hover)').matches) {
      goMove = function (e) { const r = go.getBoundingClientRect(); go.style.translate = ((e.clientX - r.left - r.width / 2) * .25) + 'px ' + ((e.clientY - r.top - r.height / 2) * .4) + 'px' }
      goLeave = function () { go.style.translate = '0 0' }
      go.addEventListener('pointermove', goMove)
      go.addEventListener('pointerleave', goLeave)
    }

    /* Brand collapses and tucks away on scroll (original script #8) */
    let last = scrollY, tick = false
    function upd() {
      tick = false
      const y = scrollY
      brand.classList.toggle('min', y > 40)
      if (y > 160 && y > last + 4) brand.classList.add('hide')
      else if (y < last - 4 || y <= 160) brand.classList.remove('hide')
      last = y
    }
    const onScrollUpd = function () { if (!tick) { tick = true; requestAnimationFrame(upd) } }
    window.addEventListener('scroll', onScrollUpd, { passive: true })
    upd()

    return () => {
      nav.removeEventListener('mouseenter', onOver)
      nav.removeEventListener('mouseleave', onOut)
      nav.removeEventListener('focusin', onFocIn)
      nav.removeEventListener('focusout', onFocOut)
      window.removeEventListener('scroll', sync)
      window.removeEventListener('scroll', prog)
      window.removeEventListener('scroll', onScrollUpd)
      cleanups2.forEach(fn => fn())
      if (ind && ind.parentNode) ind.remove()
      if (go && goMove) { go.removeEventListener('pointermove', goMove); go.removeEventListener('pointerleave', goLeave) }
    }
  }, [])

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>

      <header>
        <a className="brand" href="/" aria-label="Devworkspace home" ref={brandRef}><span className="lgm" aria-hidden="true"><i /><i /><i /></span><span className="lgw" aria-hidden="true">Dev<span>workspace</span></span></a>
        <nav className="nav" id="nav" aria-label="Main" data-state="open" ref={navRef}>
          <div className="pill">
            <span className="lead" aria-hidden="true"><i /><i /><i /></span>
            <div className="fold"><ul>
              <li><a href="/">Product</a></li>
              <li><a href="/pricing" aria-current="page">Pricing</a></li>
            </ul></div>
            <a className="go" href="#plans">Start Free<svg viewBox="0 0 18 15" fill="none" aria-hidden="true"><path d="M1 7.5h16m0 0L10.6 1.1M17 7.5l-6.4 6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></a>
          </div>
        </nav>
      </header>
    </>
  )
}
