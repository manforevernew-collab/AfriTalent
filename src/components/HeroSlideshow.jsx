import { useEffect, useState } from 'react'

// Photos: Unsplash (free to use under the Unsplash License), stored locally in /public/images/hero.
export const SLIDES = [
  { src: '/images/hero/graduates-group.jpg', alt: 'Diverse group of smiling university graduates in gowns', tag: 'Fresh graduates', caption: 'Graduate programmes & first jobs', icon: 'fas fa-user-graduate', pos: '50% 30%' },
  { src: '/images/hero/executive-african-man.jpg', alt: 'Smiling middle-aged African executive in a blue suit', tag: 'Experienced leaders', caption: 'Senior & executive opportunities', icon: 'fas fa-briefcase', pos: '50% 20%' },
  { src: '/images/hero/graduate-woman.jpg', alt: 'Smiling young graduate with braids in cap and gown', tag: 'Class of 2026', caption: 'Internships & entry-level roles', icon: 'fas fa-seedling', pos: '45% 25%' },
  { src: '/images/hero/professional-latina-woman.jpg', alt: 'Smiling middle-aged professional woman in glasses', tag: 'Work your way', caption: 'Remote, hybrid & on-site roles', icon: 'fas fa-globe', pos: '50% 25%' },
  { src: '/images/hero/senior-black-executive.jpg', alt: 'Smiling middle-aged Black businessman in a suit', tag: 'Global careers', caption: 'Visa-sponsored roles worldwide', icon: 'fas fa-passport', pos: '50% 25%' },
  { src: '/images/hero/graduates-celebrating.jpg', alt: 'Graduates of different backgrounds throwing caps in celebration', tag: 'New beginnings', caption: 'Launch your career with confidence', icon: 'fas fa-rocket', pos: '50% 35%' },
  { src: '/images/hero/senior-south-asian-man.jpg', alt: 'Smiling senior South Asian professional in a blazer', tag: 'Experience counts', caption: 'Consulting & advisory roles', icon: 'fas fa-chess-king', pos: '50% 25%' },
  { src: '/images/hero/professional-black-woman.jpg', alt: 'Smiling Black professional woman in glasses at the office', tag: 'Verified talent', caption: 'Stand out with a verified profile', icon: 'fas fa-award', pos: '50% 25%' },
  { src: '/images/hero/professional-grey-hair-man.jpg', alt: 'Smiling grey-haired professional man', tag: 'Career changers', caption: 'Every stage. Every background.', icon: 'fas fa-route', pos: '50% 25%' },
]

const INTERVAL = 5000

export default function HeroSlideshow() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (paused || reduce) return
    const t = setInterval(() => setIndex(i => (i + 1) % SLIDES.length), INTERVAL)
    return () => clearInterval(t)
  }, [paused])

  // Warm the cache for the next slide so transitions never flash
  useEffect(() => {
    const img = new Image()
    img.src = SLIDES[(index + 1) % SLIDES.length].src
  }, [index])

  const slide = SLIDES[index]

  return (
    <div className="hero-slider" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel" aria-label="AfriTalent professionals">
      <div className="hero-slider-frame">
        {SLIDES.map((s, i) => (
          <img key={s.src} src={s.src} alt={s.alt} className={`hero-slide ${i === index ? 'active' : ''}`}
            style={{ objectPosition: s.pos }} loading={i === 0 ? 'eager' : 'lazy'} fetchpriority={i === 0 ? 'high' : 'auto'}
            aria-hidden={i !== index} />
        ))}
        <div className="hero-slide-shade" />
        <div className="hero-slide-caption" key={index}>
          <span className="hero-slide-tag"><i className={slide.icon}></i> {slide.tag}</span>
          <div className="hero-slide-text">{slide.caption}</div>
        </div>
      </div>

      <div className="hero-float hero-float-top">
        <div className="hero-float-icon" style={{ background: 'rgba(22,163,74,0.15)', color: '#16a34a' }}><i className="fas fa-check"></i></div>
        <div><strong>Application sent</strong><span>Directly to the employer</span></div>
      </div>
      <div className="hero-float hero-float-bottom">
        <div className="hero-float-icon" style={{ background: '#fef3c7', color: '#d97706' }}><i className="fas fa-bolt"></i></div>
        <div><strong>New roles every hour</strong><span>Remote · Hybrid · On-site</span></div>
      </div>

      <div className="hero-dots" role="tablist">
        {SLIDES.map((s, i) => (
          <button key={s.src} role="tab" aria-selected={i === index} aria-label={`Show slide ${i + 1}: ${s.tag}`}
            className={`hero-dot ${i === index ? 'active' : ''}`} onClick={() => setIndex(i)} />
        ))}
      </div>
    </div>
  )
}
