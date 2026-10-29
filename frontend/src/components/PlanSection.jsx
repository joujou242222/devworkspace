export default function PlanSection() {
  return (
    <div className="sec" id="plan">
      <div className="top rv"><div><span className="tag">Plan</span><h2>All you need is a <span className="hl4">timeline.</span></h2></div>
        <div className="top-r"><p>Forget complex project management tools. The simplest visual timeline provides everything that the left and right brain needs.</p>
          <div className="brain" aria-hidden="true"><span className="bl">Left brain</span><i className="bj"><svg viewBox="0 0 24 24"><use href="#i-cal"/></svg></i><span className="br">Right brain</span></div></div></div>
      <div className="cards">
        <div className="card b rv" tabIndex={0}>
          <div className="mk m1"><small>LAUNCH CAMPAIGN</small><strong>Concepting</strong>
            <span className="st"><i className="ring" /><s>Not Started</s><s>In Progress</s></span><span className="sk" />
            <h4>Checklist</h4>
            <ul className="ck"><li><i />Define objectives</li><li><i />Create moodboard</li><li><i />Write draft script</li></ul>
            <u className="cur" />
          </div>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-cal"/></svg>Create Tasks</h3><p>Add tasks to your calendar and assign them to your teammates</p></div>
        </div>
        <div className="card b rv" tabIndex={0}>
          <div className="mk m2">
            <p style={{ '--n': 1 }}><i className="ar" /><b className="chip"><i className="ring" />Concepting</b></p>
            <p style={{ '--n': 2 }}><i className="ar" /><b className="chip"><i className="ring" />Storyboarding</b></p>
            <p style={{ '--n': 3 }}><i className="ar" /><b className="chip"><i className="ring" />Design</b></p>
          </div>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-go"/></svg>Shift Effortlessly</h3><p>Shift tasks one at a time, or all at once when the schedule changes</p></div>
        </div>
        <div className="card b w rv" tabIndex={0}>
          <div className="mk m3">
            <div className="hd"><b>4</b>Projects</div>
            <i className="today">Today</i>
            <p style={{ '--a': '30%', '--z': '62%' }}><b className="dot" />Product Design<span /></p>
            <p style={{ '--a': '20%', '--z': '48%' }}><b className="dot" />Promo Video<span /></p>
            <p style={{ '--a': '4%', '--z': '40%' }}><b className="dot" />Launch Campaign<span /></p>
            <p style={{ '--a': '36%', '--z': '70%' }}><b className="dot" />Photoshoot<span /></p>
          </div>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-list"/></svg>Visualize Your Pipeline</h3><p>See a global view of all your project timelines in one place</p></div>
        </div>
        <div className="card b w rv" tabIndex={0}>
          <div className="mk m9">
            <div className="hd"><b>3</b>Teammates<i className="bal"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-ok"/></svg>Balanced</i></div>
            <p className="tl hot" style={{ '--a': '82%', '--z': '46%' }}><b className="av" style={{ background: '#9aa6ff' }}>A</b><span className="nm">Amira</span><i className="cap"><u /></i><span className="flag"><s>Overloaded</s><s>On track</s></span></p>
            <p className="tl" style={{ '--a': '30%', '--z': '64%' }}><b className="av" style={{ background: '#8c7cf6' }}>D</b><span className="nm">Delia</span><i className="cap"><u /></i><span className="flag"><s>Free Thu</s><s>+2 tasks</s></span></p>
            <p className="tl" style={{ '--a': '14%', '--z': '40%' }}><b className="av" style={{ background: '#d9a07a' }}>S</b><span className="nm">Sam</span><i className="cap"><u /></i><span className="flag"><s>Free Fri</s><s>+3 tasks</s></span></p>
          </div>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-users"/></svg>Manage Teammates</h3><p>View your team’s workload and availability across all projects</p></div>
        </div>
      </div>
    </div>
  )
}
