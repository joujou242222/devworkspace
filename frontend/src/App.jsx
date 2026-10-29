import { useEffect, useRef } from 'react'
import Sprite from './components/Sprite.jsx'
import Header from './components/Header.jsx'
import Hero from './components/Hero.jsx'
import Manifesto from './components/Manifesto.jsx'
import PlanSection from './components/PlanSection.jsx'
import FilesSection from './components/FilesSection.jsx'
import ReviewsSection from './components/ReviewsSection.jsx'
import Dash from './components/Dash.jsx'
import Quote from './components/Quote.jsx'
import FinalCta from './components/FinalCta.jsx'
import Dock from './components/Dock.jsx'
import Footer from './components/Footer.jsx'
import { useRevealObservers, useCardInteractions } from './lib/globalBehaviors.js'

export default function App() {
  const progressRef = useRef(null)

  useRevealObservers()
  useCardInteractions()

  /* Hidden sticky scroll-progress rail kept for parity with the original page (original script #6) */
  useEffect(() => {
    const bar = progressRef.current
    if (!bar) return
    const prog = function () {
      const h = document.documentElement.scrollHeight - innerHeight
      bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0) + ')'
    }
    addEventListener('scroll', prog, { passive: true })
    prog()
    return () => removeEventListener('scroll', prog)
  }, [])

  return (
    <>
      <Sprite />
      <Header />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <Hero />
        <Manifesto />
        <section className="wrap">
          <PlanSection />
          <FilesSection />
          <ReviewsSection />
          <Dash />
          <Quote />
          <FinalCta />
        </section>
      </main>
      <Dock />
      <Footer />
      <div className="progress" aria-hidden="true" ref={progressRef} />
    </>
  )
}
