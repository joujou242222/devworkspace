import { useEffect, useRef } from 'react'

export default function Header() {
  const brandRef = useRef(null)
  const navRef = useRef(null)

  useEffect(() => {
    const nav = navRef.current
    const brand = brandRef.current
    if (!nav || !brand) return
    const cleanups = []

    /* Nav pill: open at top, collapsed on scroll, opens on hover/focus (original script #1) */
    let over = false, foc = false
    function sync() { nav.dataset.state = (scrollY > 40 && !over && !foc) ? 'collapsed' : 'open' }
    const onOver = () => { over = true; sync() }
    const onOut = () => { over = false; sync() }
    const onFocIn = () => { foc = true; sync() }
    const onFocOut = () => { foc = false; sync() }
    nav.addEventListener('mouseenter', onOver)
    nav.addEventListener('mouseleave', onOut)
    nav.addEventListener('focusin', onFocIn)
    nav.addEventListener('focusout', onFocOut)

    /* Brand collapses and tucks away on scroll (original script #15) */
    let last = scrollY, tick = false
    function upd() {
      tick = false
      const y = scrollY
      brand.classList.toggle('min', y > 40)
      if (y > 160 && y > last + 4) brand.classList.add('hide')
      else if (y < last - 4 || y <= 160) brand.classList.remove('hide')
      last = y
    }
    const onScrollNav = () => { sync(); upd() }
    window.addEventListener('scroll', onScrollNav, { passive: true })
    sync(); upd()

    const ul = nav.querySelector('.fold ul')
    let ind = null, hov = null
    if (ul) {
      const links = [].slice.call(ul.querySelectorAll('a'))
      /* Sliding indicator (original script #8) */
      ind = document.createElement('span')
      ind.className = 'ind'
      ind.setAttribute('aria-hidden', 'true')
      ul.insertBefore(ind, ul.firstChild)
      const curEl = ul.querySelector('[aria-current]') || links[0]
      function place(a) {
        links.forEach(l => l.classList.toggle('on', l === a))
        ind.style.width = a.offsetWidth + 'px'
        ind.style.transform = 'translateX(' + a.offsetLeft + 'px)'
      }
      function syncInd() { place(hov || curEl) }
      nav.classList.add('has-ind'); syncInd()
      links.forEach(l => {
        const en = () => { hov = l; syncInd() }
        const le = () => { hov = null; syncInd() }
        l.addEventListener('mouseenter', en); l.addEventListener('focus', en)
        l.addEventListener('mouseleave', le); l.addEventListener('blur', le)
        cleanups.push(() => {
          l.removeEventListener('mouseenter', en); l.removeEventListener('focus', en)
          l.removeEventListener('mouseleave', le); l.removeEventListener('blur', le)
        })
      })
      const onResizeInd = () => { if (ind && document.contains(ind)) syncInd() }
      window.addEventListener('resize', onResizeInd)
      const m01 = new MutationObserver(() => { if (ind && document.contains(ind)) syncInd() })
      m01.observe(nav, { attributes: true, attributeFilter: ['data-state'] })
      cleanups.push(() => { window.removeEventListener('resize', onResizeInd); m01.disconnect() })
      let fontsThen = null
      if (document.fonts && document.fonts.ready) {
        fontsThen = () => { if (ind && document.contains(ind)) syncInd() }
        document.fonts.ready.then(fontsThen)
      }
    }

    /* Scroll progress inside the pill (original script #8) */
    function prog() {
      const h = document.documentElement.scrollHeight - innerHeight
      nav.style.setProperty('--sp', h > 0 ? Math.min(1, scrollY / h).toFixed(3) : 0)
    }
    window.addEventListener('scroll', prog, { passive: true })
    prog()

    /* Magnetic CTA (original script #8) */
    const go = nav.querySelector('.go')
    let goMove = null, goLeave = null
    if (go && !matchMedia('(prefers-reduced-motion:reduce)').matches && matchMedia('(hover:hover)').matches) {
      goMove = function (e) {
        const r = go.getBoundingClientRect()
        go.style.translate = ((e.clientX - r.left - r.width / 2) * .25) + 'px ' + ((e.clientY - r.top - r.height / 2) * .4) + 'px'
      }
      goLeave = function () { go.style.translate = '0 0' }
      go.addEventListener('pointermove', goMove)
      go.addEventListener('pointerleave', goLeave)
    }

    return () => {
      cleanups.forEach(fn => fn())
      if (ind && ind.parentNode) ind.remove()
      window.removeEventListener('scroll', onScrollNav)
      nav.removeEventListener('mouseenter', onOver)
      nav.removeEventListener('mouseleave', onOut)
      nav.removeEventListener('focusin', onFocIn)
      nav.removeEventListener('focusout', onFocOut)
      window.removeEventListener('scroll', prog)
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
              <li><a href="/" aria-current="page">Product</a></li>
              <li><a href="/pricing">Pricing</a></li>
            </ul></div>
            <a className="go" href="/login">Start Free<svg viewBox="0 0 18 15" fill="none" aria-hidden="true"><path d="M1 7.5h16m0 0L10.6 1.1M17 7.5l-6.4 6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></a>
          </div>
        </nav>
      </header>
    </>
  )
}
