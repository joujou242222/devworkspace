export default function ReviewsSection() {
  return (
    <div className="sec" id="reviews">
      <div className="top rv"><div><span className="tag">Present</span><h2>Login-free collaboration for all.</h2></div>
        <p>Share your calendar, assets and documents as review links so anyone can collaborate. No signup required.</p></div>
      <div className="cards">
        <div className="card rv" tabIndex={0}>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-link"/></svg>Loop Everyone In</h3><p>Share your entire calendar as a public review link so anyone can follow along</p></div>
          <div className="mk m7">
            <div className="dy"><span>W 16</span><span>T 17</span><span>F 18</span><span>S 19</span><span>S 20</span><span className="hot">M 21</span><span>T 22</span><span>W 23</span></div>
            <em style={{ left: '6%', width: '50%', top: '62px' }}><i className="ring" />Scriptwriting</em>
            <em style={{ left: '42%', width: '38%', top: '104px' }}><i className="ring" />Boards</em>
            <em style={{ left: '24%', width: '44%', top: '146px' }}><i className="ring" />Shoot Planning</em>
            <i className="today" />
            <span className="share" data-cx=".8" data-cy=".78"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-link"/></svg><s>Share Link</s><s>Link Copied</s></span>
            <u className="cur" />
          </div>
        </div>
        <div className="card rv" tabIndex={0}>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-scr"/></svg>Effortless Review</h3><p>Users can view tasks and attachments directly in the browser – no login required</p></div>
          <div className="mk m8">
            <div className="bw">
              <div className="bt"><i /><i /><i /><span><i className="ring" />Creative Meeting</span></div>
              <div className="bar2">← → ⟳<span><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-lock"/></svg>review.devworkspace.com/launch</span></div>
              <div className="er"><b className="logo">D</b>Edit Review<span className="avs"><b className="av" style={{ background: '#9aa6ff' }}>A</b><b className="av" style={{ background: '#8c7cf6' }}>D</b><b className="av" style={{ background: '#d9a07a' }}>R</b></span></div>
              <div className="img"><s className="cm">Love this shot!</s></div>
            </div>
            <u className="cur" />
          </div>
        </div>
      </div>
      <div className="cards">
        <div className="card rv" tabIndex={0}>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-eyeoff"/></svg>Segment for Privacy</h3><p>Keep your internal team’s comments apart from external viewers’ feedback</p></div>
          <div className="mk m10">
            <div className="seg"><span><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-link"/></svg>Everyone</span><span><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-lock"/></svg>Team only</span></div>
            <div className="cmt"><b className="av" style={{ background: '#d9a07a' }}>J</b><div><div className="who">Jordan<small>Client</small></div><p>Love the new cut. Can we try a warmer grade?</p></div></div>
            <div className="cmt in"><b className="av" style={{ background: '#8c7cf6' }}>M</b><div><div className="who">Maya<small className="tag-int">Internal</small></div><p>Client keeps expanding scope. Hold the extra revision.</p></div><span className="veil"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-lock"/></svg>Hidden from clients</span></div>
            <div className="cmt"><b className="av" style={{ background: '#9aa6ff' }}>S</b><div><div className="who">Sam<small>Viewer</small></div><p>Audio levels sound great to me.</p></div></div>
          </div>
        </div>
        <div className="card rv" tabIndex={0}>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-lock"/></svg>Secure Everything</h3><p>Password protection, view tracking and more</p></div>
          <div className="mk m11">
            <div className="lk"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-link"/></svg><span>review.devworkspace.com/launch</span><i className="lb"><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path className="sh" d="M8 10V7a4 4 0 0 1 8 0v3"/><rect x="4" y="10" width="16" height="11" rx="3"/></svg></i></div>
            <div className="pw"><small>PASSWORD</small><span className="dots"><em>Enter password</em><i style={{ '--k': 0 }} /><i style={{ '--k': 1 }} /><i style={{ '--k': 2 }} /><i style={{ '--k': 3 }} /><i style={{ '--k': 4 }} /><i style={{ '--k': 5 }} /><i style={{ '--k': 6 }} /><i style={{ '--k': 7 }} /></span><b>Protected</b></div>
            <div className="vt">
              <div className="vh"><span><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-eye"/></svg>Views</span><span className="cnt"><s>3 viewers</s><s>4 viewers</s></span></div>
              <div className="vr new"><b className="av" style={{ background: '#46b1b1' }}>R</b>Riley<span className="now">Just now</span></div>
              <div className="vr"><b className="av" style={{ background: '#d9a07a' }}>J</b>Jordan<span>2m ago</span></div>
              <div className="vr"><b className="av" style={{ background: '#9aa6ff' }}>S</b>Sam<span>1h ago</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
