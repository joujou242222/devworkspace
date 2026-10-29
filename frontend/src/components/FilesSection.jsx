export default function FilesSection() {
  return (
    <div className="sec" id="files">
      <div className="top rv"><div><span className="tag">Proof</span><h2>Add anything. We mean anything.</h2></div>
        <p>Upload hi-res assets, documents, bookmarks and more directly to your tasks.</p></div>
      <div className="cards">
        <div className="card ph rv" tabIndex={0}>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-ok"/></svg>Track Approval</h3><p>Keep everyone in the loop on where each file stands</p></div>
          <div className="mk m4">
            <div className="fl"><span>Launch_Cut_v3.mp4</span><b className="stt"><s>Set Status</s><s>Approved</s></b></div>
            <i className="hl" />
            <ul><li><i className="ring" />Set Status</li><li><i className="ring" />Approved</li><li><i className="ring" />Awaiting Feedback</li><li><i className="ring" />Changes Requested</li></ul>
          </div>
        </div>
        <div className="card rv" tabIndex={0}>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-fold"/></svg>Organize Automatically</h3><p>Just add files to your tasks and they are automatically organized within your calendar based on phase</p></div>
          <div className="mk m5">
            <div className="dy"><span>T 17</span><span>F 18</span><span>S 19</span><span>S 20</span><span className="hot">M 21</span><span>T 22</span><span>W 23</span></div>
            <aside><b>Launch Campaign</b><span>Concepting<small>12 Files</small></span><span>Production<small>6 Files</small></span><span>Finishing<small>8 Files</small></span></aside>
            <em style={{ '--y': '70px', '--x': '150px' }}><i className="ring" />Boards</em>
            <em style={{ '--y': '130px', '--x': '20px' }}><i className="ring" />Shoot Prep</em>
            <em style={{ '--y': '178px', '--x': '110px' }}><i className="ring" />Location Scouting</em>
            <i className="today" />
          </div>
        </div>
        <div className="card w rv" tabIndex={0}>
          <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-doc"/></svg>Create Documents</h3><p>Add collaborative, cloud-based documents for in-depth planning, brainstorming, logistics and more</p></div>
          <div className="mk m6">
            <div className="fan">
              <div className="tp" style={{ '--r': '-9deg', '--x': '-72px', '--c1': '#a98cff', '--c2': '#7a5af8' }}><b>Storyboard</b><i /><i /><i /><i /><i /></div>
              <div className="tp" style={{ '--r': '9deg', '--x': '72px', '--c1': '#e76fb7', '--c2': '#c2307f' }}><b>Call Sheet</b><i /><i /><i /><i /><i /></div>
              <div className="tp mid" style={{ '--r': '0deg', '--x': '0px', '--c1': '#46b1b1', '--c2': '#5b6df0' }}><b>Creative Brief</b><i /><i /><i /><i /><i /></div>
            </div>
            <h4>Choose from over 25+ document templates</h4>
          </div>
        </div>
      </div>
      <div className="feedback-updated" id="manage-feedback">
        <div className="cards">
          <article className="card w rv feedback-card" tabIndex={0}>
            <div className="ct"><h3><svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-3 2v-5.5A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h8M8 14.5h5"/></svg>Manage Feedback</h3><p>Proof assets directly within your tasks using annotations and version control</p></div>
            <div className="feedback-demo" role="img" aria-label="Hover or focus to see a pointer mark the edit point and reveal the reviewer comment">
              <div className="feedback-top"><span className="feedback-file">Headphones / hero-v2.jpg</span><span className="feedback-version">Version <b className="version-v2">v2</b><b className="version-v3">v3</b></span></div>
              <div className="feedback-stage feedback-motion">
                <div className="feedback-preview">
                  <span className="feedback-start" aria-hidden="true" />
                  <div className="feedback-art"><span className="feedback-sun" /><span className="feedback-horizon" /></div>
                  <span className="feedback-marker feedback-target" data-cx=".92" data-cy=".92">1</span>
                </div>
                <span className="feedback-divider" aria-hidden="true" />
                <div className="feedback-note">
                  <span className="feedback-note-hint">Hover or tap to view the review note</span>
                  <div className="feedback-note-card">
                    <div className="feedback-note-header"><b>Maya Chen</b><small>ANNOTATION 1</small></div>
                    <span className="feedback-message">Could we soften the light on this edge?</span>
                    <span className="feedback-context">Pinned to hero-v2.jpg</span>
                  </div>
                </div>
                <u className="cur" aria-hidden="true" />
              </div>
              <div className="feedback-foot"><span>1 annotation · 2 reviewers</span><span className="feedback-versions"><i /><i /><i /><em>Versions</em></span></div>
            </div>
          </article>
        </div>
      </div>
    </div>
  )
}
