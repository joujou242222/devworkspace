const QA = [
  ['Do I need a credit card to start?', 'No. Start the 14-day trial without a card and add one when you decide to stay.'],
  ['Who counts as a planner?', 'Anyone who creates or edits tasks on your calendar. Clients and reviewers who only view, comment or approve are guests and are free.'],
  ['Can I change plans later?', 'Yes. Move up or down at any time; the change applies from your next billing date.'],
  ['What happens when the trial ends?', 'Your projects stay saved. Choose a plan to keep editing, or export your files first.'],
  ['Do guests ever count toward my bill?', 'No. Clients, vendors and reviewers who view, comment or approve are always free, on every plan, with no cap on how many you invite.'],
  ['Can I try every plan before paying?', 'Yes. Every plan starts with a 14-day free trial, and no credit card is required to begin.']
]

/* FAQ: static markup only — <details> behaves natively, animations are CSS-driven */
export default function Faq() {
  return (
    <section className="faq rv" aria-labelledby="faq-h">
      <div className="faq-side">
        <span className="tag">FAQ</span>
        <h2 id="faq-h">Questions about <span className="hl">pricing</span></h2>
        <p className="faq-note">Short answers, no fine print. Still unsure? Every plan starts with a free trial.</p>
        <p className="faq-count"><b id="faq-n">6</b> answers</p>
        <div className="faq-art" aria-hidden="true"><span className="fb b1">?</span><span className="fb b2">$</span></div>
      </div>
      <div className="faq-list">
        {QA.map(([q, a], i) => (
          <details key={i} style={{ '--n': i }}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
