import { useEffect, useRef, useState } from 'react'

const TABS = [
  { n: '01', title: 'Invite away', desc: 'Invite unlimited free guests, then group them into separate guest teams by role.' },
  { n: '02', title: 'Layer your projects', desc: 'Choose which phases, tasks and files each guest team can see.' },
  { n: '03', title: 'Control the convo', desc: 'Guest feedback is grouped into separate, private threads.' },
  { n: '04', title: 'Make your mark', desc: 'Add your branding to login screens, email notifications and more.' }
]
const NAMES = ['Guests', 'Visibility', 'Threads', 'Branding']

const GUEST_GROUPS = [
  { c: '#9aa6ff', name: 'Clients', i: [['#9aa6ff', 'M', 1], ['#9aa6ff', 'J', 2], ['#9aa6ff', 'K', 3], [null, '+', 4]] },
  { c: '#d9a07a', name: 'Vendors', i: [['#d9a07a', 'R', 5], ['#d9a07a', 'T', 6], [null, '+', 7]] },
  { c: '#8c7cf6', name: 'Reviewers', i: [['#8c7cf6', 'L', 8], ['#8c7cf6', 'A', 9], ['#8c7cf6', 'N', 10], ['#8c7cf6', 'S', 11], [null, '+', 12]] }
]
const LAYERS = [
  { n: 0, name: 'Phases', em: 'Concepting · Design' },
  { n: 1, name: 'Tasks', em: '12 tasks' },
  { n: 2, name: 'Files', em: 'Final cuts only' }
]
const THREADS = [
  { title: 'Client thread', ms: ['Can we try a warmer cut?'], mo: ['On it, v4 tonight.'] },
  { title: 'Vendor thread', ms: ['Print specs attached.'], mo: ['Got it, thanks!'] }
]

export default function Dash() {
  const [active, setActive] = useState(0)
  const pbRefs = useRef([])

  const go = i => setActive(i)

  /* Reset the progress underline so its animation restarts (original script #12) */
  useEffect(() => {
    pbRefs.current.forEach(function (u) {
      if (!u) return
      u.style.animation = 'none'
      void u.offsetWidth
      u.style.animation = ''
    })
  }, [active])

  const onAnimEnd = () => { if (!matchMedia('(prefers-reduced-motion:reduce)').matches) setActive(a => (a + 1) % TABS.length) }

  return (
    <div className="dash rv" id="teams">
      <div className="dash-head">
        <span className="tag" style={{ color: 'var(--ink)' }}>Client dashboard</span>
        <h2>When review links aren’t enough.</h2>
        <p className="lede">Invite clients and vendors into your project workflow with the most powerful client dashboard in the industry.</p>
      </div>
      <div className="dtabs" role="tablist" aria-label="Client dashboard features" aria-orientation="vertical">
        {TABS.map((tb, k) => (
          <button type="button" className={'dt' + (k === active ? ' on' : '')} role="tab" id={'dt' + (k + 1)}
            aria-selected={k === active} aria-controls={'dp' + (k + 1)} key={k} onClick={() => go(k)}>
            <span className="dn">{tb.n}</span>
            <span className="dtx"><strong>{tb.title}</strong><span className="dd">{tb.desc}</span></span>
            <i className="pb" aria-hidden="true"><u ref={el => { pbRefs.current[k] = el }} onAnimationEnd={onAnimEnd} /></i>
          </button>
        ))}
      </div>
      <div className="dview" aria-live="polite">
        <div className="dwin-top" aria-hidden="true"><span className="ct-dots"><i /><i /><i /></span><b id="dview-t">{NAMES[active]}</b><em className="ct-live"><i />Live</em></div>

        <div className={'dp dp1' + (active === 0 ? ' on' : '')} id="dp1" role="tabpanel" aria-labelledby="dt1" aria-hidden={active !== 0}>
          {GUEST_GROUPS.map((g, k) => (
            <div className="gt" style={{ '--c': g.c }} key={k}>
              <b>{g.name}</b>
              <span className="gv">{g.i.map((it, j) => it[0]
                ? <i key={j} style={{ '--c': it[0], '--n': it[2] }}>{it[1]}</i>
                : <i key={j} className="m" style={{ '--n': it[2] }}>{it[1]}</i>)}</span>
              <em>Free</em>
            </div>
          ))}
          <div className="gadd"><span>+</span>Invite a guest</div>
        </div>

        <div className={'dp dp2' + (active === 1 ? ' on' : '')} id="dp2" role="tabpanel" aria-labelledby="dt2" aria-hidden={active !== 1}>
          <div className="who"><span>Guest team</span><b>Clients</b><em>can see</em></div>
          {LAYERS.map(l => (
            <div className="lay" style={{ '--n': l.n }} key={l.n}><i className="tg"><u /></i><span>{l.name}</span><em>{l.em}</em></div>
          ))}
          <div className="lay off"><i className="tg"><u /></i><span>Internal notes</span><em>Hidden</em></div>
        </div>

        <div className={'dp dp3' + (active === 2 ? ' on' : '')} id="dp3" role="tabpanel" aria-labelledby="dt3" aria-hidden={active !== 2}>
          {THREADS.map((th, k) => {
            let nStart = k === 0 ? 0 : 2
            return (
              <div className="th" key={k}>
                <header><b>{th.title}</b><i className="tlock" /></header>
                {th.ms.map((m, j) => <p className="m ms" style={{ '--n': nStart + j }} key={'a' + j}>{m}</p>)}
                {th.mo.map((m, j) => <p className="m mo" style={{ '--n': nStart + th.ms.length + j }} key={'b' + j}>{m}</p>)}
              </div>
            )
          })}
        </div>

        <div className={'dp dp4' + (active === 3 ? ' on' : '')} id="dp4" role="tabpanel" aria-labelledby="dt4" aria-hidden={active !== 3}>
          <div className="login"><i className="lg br">D</i><b>Welcome back</b><span className="in1" /><span className="in2" /><span className="lbtn br">Sign in</span></div>
          <div className="mail"><i className="lg s br">D</i><div><b>New comment on “Brand film”</b><small>Sent from your own branded address</small></div></div>
        </div>
      </div>
    </div>
  )
}
