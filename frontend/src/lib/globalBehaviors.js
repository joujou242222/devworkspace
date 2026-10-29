/* Global page behaviors ported verbatim from the original vanilla JS. */

import { useEffect } from 'react'

export function useRevealObservers() {
  useEffect(() => {
    /* Reveal on scroll, staggered inside each group (original script #1 tail) */
    const els = [].slice.call(document.querySelectorAll('.rv'))
    const io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
      })
    }, { threshold: .15 })
    els.forEach(function (el) {
      const sibs = el.parentElement.querySelectorAll(':scope > .rv')
      const i = Array.prototype.indexOf.call(sibs, el)
      el.style.setProperty('--d', (i * .09) + 's')
      io.observe(el)
    })

    /* Stagger + reveal feature items and quote (original script #6 tail) */
    document.querySelectorAll('.items').forEach(function (g) {
      [].forEach.call(g.children, function (c, i) { c.style.setProperty('--n', i) })
    })
    const tg = [].slice.call(document.querySelectorAll('.items,.quote'))
    const show = e => e.classList.add(e.classList.contains('items') ? 'show' : 'in')
    let io2 = null
    if ('IntersectionObserver' in window) {
      io2 = new IntersectionObserver(function (es) {
        es.forEach(function (x) { if (x.isIntersecting) { show(x.target); io2.unobserve(x.target) } })
      }, { threshold: .2 })
      tg.forEach(function (e) { io2.observe(e) })
    } else tg.forEach(show)

    return () => { io.disconnect(); if (io2) io2.disconnect() }
  }, [])
}

export function useCardInteractions() {
  useEffect(() => {
    /* Illustrated pointer anchored to real content, not fixed offsets (original script #2) */
    var routes = {
      m7: ['.dy .hot', '.share'],
      m8: ['.er .avs', '.img'],
      'feedback-motion': ['.feedback-start', '.feedback-target']
    }
    const feedbackTimers = new WeakMap()

    function typeFeedbackComment(card, active) {
      const message = card.querySelector('.feedback-message')
      if (!message) return
      const previous = feedbackTimers.get(card)
      if (previous) { clearTimeout(previous.start); clearInterval(previous.interval) }
      const text = message.dataset.fullText || message.textContent.trim()
      message.dataset.fullText = text
      message.classList.remove('is-typing')
      message.textContent = ''
      if (!active) return
      const state = { start: 0, interval: 0 }
      state.start = setTimeout(function () {
        const characters = Array.from(text); let index = 0
        message.classList.add('is-typing')
        state.interval = setInterval(function () {
          message.textContent += characters[index++]
          if (index >= characters.length) {
            clearInterval(state.interval)
            message.classList.remove('is-typing')
          }
        }, 30)
      }, 1250)
      feedbackTimers.set(card, state)
    }

    function moveCursor(card, active) {
      const cursor = card.querySelector('.cur')
      if (!cursor) return
      const stage = cursor.closest('.mk') || cursor.closest('.feedback-stage')
      if (!stage) return
      let route = null
      Object.keys(routes).forEach(function (name) { if (stage.classList.contains(name)) route = name })
      if (!route) return
      const from = card.querySelector(routes[route][0])
      const to = card.querySelector(routes[route][1])
      if (!from || !to) return
      const box = stage.getBoundingClientRect()
      function point(target) {
        const rect = target.getBoundingClientRect()
        let fx = parseFloat(target.dataset.cx), fy = parseFloat(target.dataset.cy)
        if (isNaN(fx)) fx = .5; if (isNaN(fy)) fy = .5
        return { x: rect.left + rect.width * fx - box.left - 2, y: rect.top + rect.height * fy - box.top - 2 }
      }
      const start = point(from), end = point(to)
      function at(p) { return 'translate3d(' + p.x + 'px,' + p.y + 'px,0)' }
      if (!active) {
        card.classList.remove('cursor-active')
        if (route === 'feedback-motion') typeFeedbackComment(card, false)
        cursor.style.transition = 'transform .22s ease-out,opacity .18s ease'
        cursor.style.transform = at(start)
        return
      }
      const alreadyActive = card.classList.contains('cursor-active')
      card.classList.add('cursor-active')
      if (route === 'feedback-motion' && !alreadyActive) typeFeedbackComment(card, true)
      cursor.style.transition = 'none'
      cursor.style.transform = at(start)
      cursor.getBoundingClientRect()
      requestAnimationFrame(function () {
        if (!card.matches(':hover,:focus-within,.play')) return
        cursor.style.transition = ''
        cursor.style.transform = at(end)
      })
    }

    const cards = [].slice.call(document.querySelectorAll('.card'))
    const onEnter = c => e => moveCursor(e.currentTarget, true)
    const cleanups = []
    cards.forEach(function (card) {
      const h1 = function () { moveCursor(card, true) }
      const h2 = function () { if (!card.matches(':focus-within,.play')) moveCursor(card, false) }
      const h3 = function () { moveCursor(card, true) }
      const h4 = function () {
        requestAnimationFrame(function () {
          if (!card.matches(':hover,:focus-within,.play')) moveCursor(card, false)
        })
      }
      card.addEventListener('mouseenter', h1)
      card.addEventListener('mouseleave', h2)
      card.addEventListener('focusin', h3)
      card.addEventListener('focusout', h4)
      cleanups.push(() => {
        card.removeEventListener('mouseenter', h1)
        card.removeEventListener('mouseleave', h2)
        card.removeEventListener('focusin', h3)
        card.removeEventListener('focusout', h4)
      })
    })
    let playObserver = null
    if (matchMedia('(hover:none)').matches) {
      playObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          const card = entry.target
          card.classList.toggle('play', entry.isIntersecting)
          moveCursor(card, entry.isIntersecting || card.matches(':hover,:focus-within'))
        })
      }, { threshold: .6 })
      cards.forEach(function (card) { playObserver.observe(card) })
    }
    const onResizeCards = function () {
      document.querySelectorAll('.card.cursor-active').forEach(function (card) { moveCursor(card, true) })
    }
    window.addEventListener('resize', onResizeCards, { passive: true })

    /* Create Tasks pointer + ring spin while staying inside the card (original script #4) */
    const mk = document.querySelector('.m1')
    let m1Cleanup = null
    if (mk) {
      const card = mk.closest('.card'), cur = mk.querySelector('.cur'), st = mk.querySelector('.st')
      if (card && cur && st) {
        let rest = { x: 0, y: 0 }, tgt = { x: 0, y: 0 }
        function layout() {
          const w = mk.offsetWidth
          tgt = { x: st.offsetLeft + st.offsetWidth * .8 - 2, y: st.offsetTop + st.offsetHeight * .6 - 2 }
          rest = { x: Math.min(w - 36, tgt.x + w * .3), y: tgt.y + 100 }
        }
        function at(p) { return 'translate3d(' + p.x + 'px,' + p.y + 'px,0)' }
        function on() { return card.matches(':hover,:focus-visible,.play') }
        function sync(instant) {
          layout()
          if (instant) cur.style.transition = 'none'
          cur.style.transform = at(on() ? tgt : rest)
          if (instant) { cur.getBoundingClientRect(); cur.style.transition = '' }
        }
        const ring = st.querySelector('.ring')
        const calm = matchMedia('(prefers-reduced-motion:reduce)').matches
        let spinA = null, spinning = false
        function spinSync() {
          if (!ring || calm) return
          const want = on()
          if (want && !spinning) {
            spinning = true; if (spinA) spinA.cancel(); ring.classList.remove('settling')
            spinA = ring.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 1200, delay: 1200, iterations: Infinity })
          } else if (!want && spinning) {
            spinning = false
            const t = spinA ? (spinA.currentTime || 0) : 0
            const ang = t < 1200 ? 0 : ((t - 1200) % 1200) / 1200 * 360
            if (spinA) spinA.cancel()
            if (ang > 2 && ang < 358) {
              ring.classList.add('settling')
              spinA = ring.animate([{ transform: 'rotate(' + ang + 'deg)' }, { transform: 'rotate(360deg)' }], { duration: 350 + (360 - ang) / 360 * 450, easing: 'cubic-bezier(.2,.7,.3,1)' })
              spinA.onfinish = function () { ring.classList.remove('settling'); spinA = null }
            } else spinA = null
          }
        }
        function later() { requestAnimationFrame(function () { sync(false); spinSync() }) }
        ;['mouseenter', 'mouseleave', 'focusin', 'focusout'].forEach(function (e) { card.addEventListener(e, later) })
        const mo = new MutationObserver(later)
        mo.observe(card, { attributes: true, attributeFilter: ['class'] })
        const onResizeM1 = function () { sync(true) }
        window.addEventListener('resize', onResizeM1)
        const onLoadM1 = function () { sync(true) }
        window.addEventListener('load', onLoadM1)
        let fontsThen = null
        if (document.fonts && document.fonts.ready) { fontsThen = function () { sync(true) }; document.fonts.ready.then(fontsThen) }
        sync(true)
        m1Cleanup = () => {
          ;['mouseenter', 'mouseleave', 'focusin', 'focusout'].forEach(function (e) { card.removeEventListener(e, later) })
          mo.disconnect()
          window.removeEventListener('resize', onResizeM1)
          window.removeEventListener('load', onLoadM1)
          if (spinA) spinA.cancel()
        }
      }
    }

    /* Put the "today" line exactly under the highlighted day (original script #3) */
    function align() {
      document.querySelectorAll('.m7').forEach(function (m) {
        const hot = m.querySelector('.dy .hot'), line = m.querySelector('.today')
        if (hot && line) line.style.left = (hot.offsetLeft + hot.offsetWidth / 2 - .75) + 'px'
      })
    }
    align()
    const onResizeAlign = function () { align() }
    window.addEventListener('resize', onResizeAlign)
    window.addEventListener('load', onResizeAlign)
    let fontsThen2 = null
    if (document.fonts && document.fonts.ready) { fontsThen2 = align; document.fonts.ready.then(fontsThen2) }

    /* Cursor glare position (original script #11) */
    if (matchMedia('(hover:hover)').matches) {
      const glare = []
      document.querySelectorAll('.card').forEach(function (c) {
        const fn = function (e) {
          const r = c.getBoundingClientRect()
          c.style.setProperty('--mx', (e.clientX - r.left) + 'px')
          c.style.setProperty('--my', (e.clientY - r.top) + 'px')
        }
        c.addEventListener('pointermove', fn)
        glare.push([c, fn])
      })
      return () => {
        globalCleanup(); glare.forEach(function (a) { a[0].removeEventListener('pointermove', a[1]) })
      }
    }
    function globalCleanup() {
      cleanups.forEach(fn => fn())
      if (playObserver) playObserver.disconnect()
      window.removeEventListener('resize', onResizeCards)
      if (m1Cleanup) m1Cleanup()
      window.removeEventListener('resize', onResizeAlign)
      window.removeEventListener('load', onResizeAlign)
    }
    return globalCleanup
  }, [])
}
