import { useEffect, useRef } from 'react'

const PLANS = [
  {
    key: 'solo', pick: false, max: 1, art: [['#d9a07a', 'S']], price: '$9', h2: 'Solo',
    forTxt: 'For one person keeping a few projects on schedule.',
    lis: ['1 planner', 'Timeline calendar with tasks and teammates', 'File uploads with annotations and approvals', 'Public review links, no login needed']
  },
  {
    key: 'team', pick: true, max: 15, art: [['#d9a07a', 'S'], ['#9aa6ff', 'A'], ['#8c7cf6', 'D']], price: '$19', h2: 'Team',
    forTxt: 'For a team that shares work with clients and vendors.',
    lis: ['Up to 15 planners', { inh: 1, t: 'Everything in Solo' }, 'Shift one task or the whole schedule at once', 'Collaborative documents', 'Client dashboard with private guest threads', 'Unlimited free guests']
  },
  {
    key: 'studio', pick: false, max: 999, art: [['#d9a07a', 'S'], ['#9aa6ff', 'A'], ['#8c7cf6', 'D'], ['#f1fd82', 'K'], ['more', '+']], price: '$39', h2: 'Studio',
    forTxt: 'For agencies running many projects under their own brand.',
    lis: ['Unlimited planners', { inh: 1, t: 'Everything in Team' }, 'Your branding on logins and email notifications', 'Password protection and view tracking', 'Pipeline view across all projects']
  }
]

/* Calculator + plans: markup verbatim + scripts #4 (calc) — the plan stagger and
   price count-up from script #2 live in PricingApp's global effect (same script) */
export default function Plans() {
  const outRef = useRef(null)
  const resRef = useRef(null)
  const cmRef = useRef(null)
  const cpRef = useRef(null)

  useEffect(() => {
    const cards = [].slice.call(document.querySelectorAll('[data-plan-card]'))
    const out = outRef.current, res = resRef.current, m = cmRef.current, pl = cpRef.current
    if (!cards.length || !out) return
    cards.forEach(function (c) { var t = c.querySelector('.price'), x = t && t.firstChild && t.firstChild.nodeValue.match(/(\D*)(\d+)/); c.dataset.price = x ? x[2] : '0'; c.dataset.cur = x ? x[1] : '$' })
    let n = 3
    function pick() { for (var i = 0; i < cards.length; i++) { if (n <= +cards[i].dataset.max) return cards[i] } return cards[cards.length - 1] }
    function render(bump) {
      var c = pick(), name = c.querySelector('h2').textContent, total = n * (+c.dataset.price)
      out.textContent = n
      if (bump) { out.classList.remove('bump'); void out.offsetWidth; out.classList.add('bump') }
      res.innerHTML = 'Best fit: <b>' + name + '</b> &middot; about <b>' + c.dataset.cur + total + ' / month</b> &middot; guests are free'
      cards.forEach(function (x) { x.classList.toggle('fit', x === c) })
    }
    const onM = function () { if (n > 1) { n--; render(true) } }
    const onP = function () { if (n < 99) { n++; render(true) } }
    m.addEventListener('click', onM)
    pl.addEventListener('click', onP)
    render(false)
    return () => { m.removeEventListener('click', onM); pl.removeEventListener('click', onP) }
  }, [])

  return (
    <>
      <div className="calc rv" aria-labelledby="calc-q">
        <span className="calc-q" id="calc-q">How many planners do you need?</span>
        <div className="calc-ctl">
          <button type="button" id="cm" aria-label="Fewer planners" ref={cmRef}>−</button>
          <output id="cn" aria-live="polite" ref={outRef}>3</output>
          <button type="button" id="cp" aria-label="More planners" ref={cpRef}>+</button>
        </div>
        <p className="calc-res" id="cr" aria-live="polite" ref={resRef} />
      </div>

      <section className="plans" id="plans" aria-label="Plans">
        {PLANS.map((p, i) => (
          <article className={'plan rv' + (p.pick ? ' pick' : '')} data-plan-card={p.key} data-max={p.max} key={p.key}>
            {p.pick && <span className="badge"><i className="bd-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l2.6 6.4L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.4-.6z"/></svg></i>Most teams pick this</span>}
            <div className="pl-art" aria-hidden="true">{p.art.map((a, j) => a[0] === 'more' ? <i className="more" key={j}>{a[1]}</i> : <i style={{ background: a[0] }} key={j}>{a[1]}</i>)}</div>
            <h2>{p.h2}</h2>
            <p className="for">{p.forTxt}</p>
            <p className="price">{p.price}<small>per planner / month</small></p>
            <ul>
              {p.lis.map((l, j) => {
                const inh = l && typeof l === 'object' && l.inh
                const t = inh ? l.t : l
                return inh ? <li className="inh" key={j}>{t}</li> : <li key={j}>{t}</li>
              })}
            </ul>
            <a className="btn" href={'/register?plan=' + p.key} data-plan={p.key}>Start 14-day trial</a>
          </article>
        ))}
      </section>
    </>
  )
}
