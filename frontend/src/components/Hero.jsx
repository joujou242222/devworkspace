import { useEffect, useRef } from 'react'

const RAW_TK_STYLES = [
  '--i:0;--p:1;grid-column:1/6',
  '--i:1;--p:0.42;grid-column:3/9',
  '--i:2;--p:0;grid-column:6/12',
  '--i:3;--p:0;grid-column:8/13',
  '--i:4;--p:0;grid-column:11/15'
]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TASKS = [
  { cls: '', i: 0, p: 1, col: '1/6', barCls: '', label: 'Brief and moodboard', av: [['#d9a07a', 'S']], pc: '100%', meta: '', who: [['#d9a07a', 'S']], whoTxt: 'Sam', st: 'Done', stCls: 'done' },
  { cls: '', i: 1, p: 0.42, col: '3/9', barCls: ' d', label: 'Design review', av: [['#9aa6ff', 'A'], ['#8c7cf6', 'D']], pc: '42%', meta: '', who: [['#9aa6ff', 'A'], ['#8c7cf6', 'D']], whoTxt: 'Amira, Delia', st: 'In progress', stCls: '' },
  { cls: '', i: 2, p: 0, col: '6/12', barCls: ' w', label: 'Client approval', av: [['#8c7cf6', 'D']], pc: '0%', meta: '', who: [['#8c7cf6', 'D']], whoTxt: 'Delia', st: 'Upcoming', stCls: '' },
  { cls: ' r', i: 3, p: 0, col: '8/13', barCls: '', label: 'Production', av: [['#d9a07a', 'S'], ['#9aa6ff', 'A']], pc: '0%', meta: '', who: [['#d9a07a', 'S'], ['#9aa6ff', 'A']], whoTxt: 'Sam, Amira', st: 'Upcoming', stCls: '' },
  { cls: ' r', i: 4, p: 0, col: '11/15', barCls: ' d', label: 'Launch', av: [['#9aa6ff', 'A']], pc: '0%', meta: '', who: [['#9aa6ff', 'A']], whoTxt: 'Amira', st: 'Upcoming', stCls: '' }
]
const FLOATERS = [
  { c: 'c-file', k: 'file', r: '-5deg', d: 0, icon: <svg viewBox="0 0 24 24"><use href="#i-fold"/></svg>, b: 'Brief_v3.pdf', s: 'File · Mon 20' },
  { c: 'c-note', k: 'note', r: '4deg', d: 1, icon: <svg viewBox="0 0 24 24"><use href="#i-doc"/></svg>, b: 'Moodboard ideas', s: 'Note · Tue 21' },
  { c: 'c-convo', k: 'convo', r: '-3deg', d: 2, icon: <svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>, b: 'Client feedback', s: 'Convo · Thu 23' },
  { c: 'c-todo', k: 'todo', r: '5deg', d: 3, tick: true, icon: <svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9"/></svg>, b: 'Approve final cut', s: 'To-do · Fri 24' }
]

export default function Hero() {
  const heroRef = useRef(null)
  const calRef = useRef(null)

  /* Hero timeline: reveal on scroll, progress from the Today line, dependency arrows, tooltip data (original script #5) */
  useEffect(() => {
    /* Keep the exact inline style attribute so [style*="grid-column:..."] mobile rules still match */
    const cal = calRef.current
    if (!cal) return
    cal.querySelectorAll('.row > .tk').forEach(function (tk, i) {
      if (RAW_TK_STYLES[i]) tk.setAttribute('style', RAW_TK_STYLES[i])
    })

    const days = [].slice.call(cal.querySelectorAll('.days span'))
    const tks = [].slice.call(cal.querySelectorAll('.tk'))
    const svg = cal.querySelector('.deps'), NS = 'http://www.w3.org/2000/svg'
    const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches
    const TODAY = 4
    let counted = false
    const timers = [], rafs = []
    const deps = []
    if (days[TODAY]) days[TODAY].classList.add('now')
    for (let i = 0; i < tks.length - 1; i++) {
      const d = document.createElementNS(NS, 'path')
      d.setAttribute('class', 'dp'); d.setAttribute('pathLength', '1')
      d.style.setProperty('--k', i); svg.appendChild(d); deps.push(d)
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }
    function layout() {
      const dd = days[TODAY]
      if (!dd) return
      const dl = dd.offsetLeft, dw = dd.offsetWidth, x = dl + dw / 2
      let y0 = dd.offsetTop + dd.offsetHeight + 8, y1 = 0
      tks.forEach(function (tk) {
        const L = tk.offsetLeft, R = L + tk.offsetWidth
        y1 = Math.max(y1, tk.offsetTop + tk.offsetHeight + 8)
        let p = R <= dl + dw + 1 ? 1 : clamp((x - L) / (R - L), 0, 1)
        p = Math.round(p * 100) / 100
        tk.style.setProperty('--p', p); tk.dataset.p = p
        const cs = getComputedStyle(tk), s = parseInt(cs.gridColumnStart, 10) || 1, e = parseInt(cs.gridColumnEnd, 10) || s + 1
        const a = days[s - 1], b = days[e - 2], pct = Math.round(p * 100), st = p >= 1 ? 'Done' : p > 0 ? 'In progress' : 'Upcoming'
        const meta = (a && b) ? a.textContent + ' ' + s + ' – ' + b.textContent + ' ' + (e - 1) + ' · ' + (e - s) + ' days' : ''
        const m = tk.querySelector('.t-meta'); if (m) m.textContent = meta
        const chipEl = tk.querySelector('.t-st')
        if (chipEl) { chipEl.textContent = st; chipEl.classList.toggle('done', p >= 1) }
        const who = tk.querySelector('.t-who')
        tk.setAttribute('aria-label', tk.querySelector('.tk-lb').textContent + ', ' + meta + ', ' + pct + '% complete' + (who ? ', ' + who.textContent : ''))
        const pc = tk.querySelector('.tk-pc')
        if (pc && (counted || reduce)) pc.textContent = pct + '%'
      })
      const cw = cal.clientWidth
      tks.forEach(function (tk) {
        const tip = tk.querySelector('.tip'); if (!tip) return
        const tw = tip.offsetWidth, l = clamp(0, 8 - tk.offsetLeft, cw - 8 - tw - tk.offsetLeft)
        tip.style.left = l + 'px'; tip.style.right = 'auto'
        tip.style.transformOrigin = (tk.offsetLeft + l + tw / 2 < tk.offsetLeft + tk.offsetWidth / 2 ? 'bottom left' : 'bottom right')
      })
      cal.style.setProperty('--x', x + 'px'); cal.style.setProperty('--y0', y0 + 'px'); cal.style.setProperty('--y1', y1 + 'px')
      for (let i = 0; i < deps.length; i++) {
        const A = tks[i], B = tks[i + 1], aR = A.offsetLeft + A.offsetWidth, bL = B.offsetLeft, bR = bL + B.offsetWidth
        const px = clamp(aR - 24, bL + 20, bR - 20), ya = A.offsetTop + A.offsetHeight + 1, yb = B.offsetTop - 3
        deps[i].setAttribute('d', 'M' + px + ' ' + ya + 'V' + yb + 'M' + (px - 4) + ' ' + (yb - 5) + 'L' + px + ' ' + yb + 'L' + (px + 4) + ' ' + (yb - 5))
      }
    }
    function count() {
      tks.forEach(function (tk, i) {
        const pc = tk.querySelector('.tk-pc'); if (!pc) return
        const end = Math.round(parseFloat(tk.dataset.p || 0) * 100)
        if (reduce) { pc.textContent = end + '%'; return }
        pc.textContent = '0%'
        timers.push(setTimeout(function () {
          const t0 = performance.now()
          const f = function (t) {
            if (!tk.isConnected) return
            const k = clamp((t - t0) / 900, 0, 1)
            pc.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))) + '%'
            if (k < 1) rafs.push(requestAnimationFrame(f))
          }
          rafs.push(requestAnimationFrame(f))
        }, 1100 + i * 120))
      })
      timers.push(setTimeout(function () { counted = true; layout() }, 2300))
    }
    function start() { if (cal.classList.contains('in')) return; layout(); cal.classList.add('in'); count() }
    let raf
    const onResizeCal = function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout) }
    window.addEventListener('resize', onResizeCal)
    let io = null
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting })) { io.disconnect(); io = null; start() }
      }, { threshold: .3 })
      io.observe(cal)
    } else start()
    layout()
    let fontsThen = null
    if (document.fonts && document.fonts.ready) {
      fontsThen = function () { if (cal.isConnected) layout() }
      document.fonts.ready.then(fontsThen)
    }
    return () => {
      if (io) io.disconnect()
      window.removeEventListener('resize', onResizeCal)
      timers.forEach(clearTimeout); rafs.forEach(cancelAnimationFrame); if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  /* Highlighted nouns + floating cards cycling, hover hold, gentle mouse parallax (original script #10) */
  useEffect(() => {
    const hero = heroRef.current
    if (!hero) return
    const ks = [].slice.call(hero.querySelectorAll('.k'))
    const cards = [].slice.call(hero.querySelectorAll('.hc'))
    if (!ks.length || !cards.length) return
    const calm = matchMedia('(prefers-reduced-motion:reduce)').matches
    const cleanups = []
    let idx = -1, hold = false
    function show(k) {
      ks.forEach(e => e.classList.toggle('hot', e.dataset.k === k))
      cards.forEach(c => c.classList.toggle('hot', c.dataset.k === k))
    }
    function step() { if (hold) return; idx = (idx + 1) % ks.length; show(ks[idx].dataset.k) }
    ks.concat(cards).forEach(e => {
      const enter = () => { hold = true; show(e.dataset.k) }
      const leave = () => { hold = false; show(null) }
      e.addEventListener('mouseenter', enter)
      e.addEventListener('mouseleave', leave)
      cleanups.push(() => { e.removeEventListener('mouseenter', enter); e.removeEventListener('mouseleave', leave) })
    })
    let t = null, interval = null
    if (!calm) {
      t = setTimeout(function () { step(); interval = setInterval(step, 2400) }, 2800)
    }
    /* gentle mouse parallax on desktop */
    let raf = null, onMove = null, onLeave = null
    if (!calm && matchMedia('(hover:hover) and (min-width:901px)').matches) {
      onMove = function (e) {
        if (raf) return
        raf = requestAnimationFrame(function () {
          raf = null
          const x = (e.clientX / innerWidth - .5), y = (e.clientY / innerHeight - .5)
          cards.forEach(function (c, i) { const d = (i % 2 ? -1 : 1) * (10 + i * 5); c.style.translate = (x * d) + 'px ' + (y * d * .8) + 'px' })
        })
      }
      onLeave = function () { cards.forEach(c => { c.style.translate = '0 0' }) }
      hero.addEventListener('pointermove', onMove)
      hero.addEventListener('pointerleave', onLeave)
    }
    return () => {
      cleanups.forEach(fn => fn())
      clearTimeout(t); clearInterval(interval)
      if (onMove) hero.removeEventListener('pointermove', onMove)
      if (onLeave) hero.removeEventListener('pointerleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section className="hero wrap" ref={heroRef}>
      <div className="hero-grid">
        <div className="hero-txt">
          <h1>Organize<br />your projects<br /><span className="hl3">in time.</span><svg className="clk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path className="hh" d="M12 12V7"/><path className="mh" d="M12 12V4.5"/></svg></h1>
          <p className="sub">Every <span className="k" data-k="file">file</span>, <span className="k" data-k="note">note</span>, <span className="k" data-k="convo">convo</span> and <span className="k" data-k="todo">to-do</span>. In a calendar.</p>
          <div className="cta-row">
            <a className="cta" href="/login">Get Started
              <svg viewBox="0 0 18 15" fill="none" aria-hidden="true"><path d="M1 7.5h16m0 0L10.6 1.1M17 7.5l-6.4 6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </a>
            <span className="cta-note">14-day free trial<br />No credit card</span>
          </div>
        </div>
        <div className="hv" aria-hidden="true">
          <svg className="hv-line" viewBox="0 0 400 440" preserveAspectRatio="none"><path d="M70 60C200 40 330 90 330 140S120 190 110 250 300 300 300 370"/></svg>
          {FLOATERS.map(f => (
            <div className={'hc ' + f.c} data-k={f.k} key={f.c} style={{ '--r': f.r, '--d': f.d }}>
              <i>{f.icon}</i>
              <div><b>{f.b}</b><small>{f.s}</small></div>
            </div>
          ))}
        </div>
      </div>

      <div className="cal" role="group" aria-label="Example project timeline with tasks across two weeks" ref={calRef}>
        <div className="wk" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <div className="cal-top" aria-hidden="true">
          <span className="ct-dots"><i /><i /><i /></span>
          <span className="ct-title"><b>Launch Campaign</b><em>2 weeks</em></span>
          <span className="ct-end">
            <span className="ct-av"><i style={{ background: '#d9a07a' }}>S</i><i style={{ background: '#9aa6ff' }}>A</i><i style={{ background: '#8c7cf6' }}>D</i></span>
            <span className="ct-live"><i />Live</span>
          </span>
        </div>
        <div className="days" aria-hidden="true">{DAYS.map((d, i) => <span key={i}>{d}</span>)}</div>
        {TASKS.map((t, idx) => (
          <div className="row" key={idx}>
            <div className={'tk' + t.cls} role="group" tabIndex={0}>
              {/* the exact style attribute (--i/--p/grid-column) is set verbatim in the effect */}
              <div className={'bar' + t.barCls}>
                <span className="tk-lb">{t.label}</span>
                <span className="tk-av" aria-hidden="true">{t.av.map((a, k) => <i key={k} style={{ background: a[0] }}>{a[1]}</i>)}</span>
                <b className="tk-pc">{t.pc}</b>
              </div>
              <div className="tip" role="tooltip">
                <strong>{t.label}</strong>
                <span className="t-meta" />
                <span className="t-bar"><i /></span>
                <span className="t-row">
                  <span className="t-who">{t.who.map((a, k) => <i key={k} style={{ background: a[0] }}>{a[1]}</i>)}{t.whoTxt}</span>
                  <em className={'t-st' + (t.stCls ? ' ' + t.stCls : '')}>{t.st}</em>
                </span>
              </div>
            </div>
          </div>
        ))}
        <svg className="deps" aria-hidden="true" />
        <i className="now-line" aria-hidden="true" /><b className="now-chip" aria-hidden="true">Today</b>
      </div>
    </section>
  )
}
