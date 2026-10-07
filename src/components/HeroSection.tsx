import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  Search,
  CheckCircle2,
  BookOpen,
  Sparkles,
  ArrowRight,
  Pause,
  Play
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { catalogue } from '../data/catalogue';
import { safeMediaPlay, usePrefersStaticBackdrop } from '../lib/backdrop';

/**
 * Decorative hero background.
 *
 * Performance notes (this is the largest above-the-fold asset on the site):
 *
 *  * The still frame (`animation-poster.jpg`, ~20 KB) is what paints first. The
 *    `<video>` element carries it as its `poster`, so nothing larger is
 *    requested during the critical path.
 *  * The video sources are attached only after the page is interactive
 *    (`requestIdleCallback`, with a timeout fallback). They are ~190 KB for
 *    H.264 and VP9 instead of the 5.9 MB animated GIF this replaced — a ~31x
 *    reduction — and they never compete with the LCP image.
 *  * `<video>` is pausable, so the motion toggle really stops the animation
 *    rather than swapping in a still frame the way a GIF required.
 *  * Visitors on small/low-memory viewports, and anyone who prefers reduced
 *    motion, never download the video at all.
 */
const HERO_POSTER = '/images/animation-poster.jpg';
const HERO_SOURCES = [
  { src: '/images/hero-loop.webm', type: 'video/webm' },
  { src: '/images/hero-loop.mp4', type: 'video/mp4' }
];

export function HeroSection() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const useStaticPoster = usePrefersStaticBackdrop();

  const store = useStore();
  const approvedMaterials = store.getApprovedMaterials();
  const departmentsCount = catalogue.reduce((acc, f) => acc + f.departments.length, 0);

  const navigate = useNavigate();

  // Deferred: never compete with the LCP element.
  useEffect(() => {
    if (useStaticPoster) return;
    const load = () => setShouldLoadVideo(true);
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;

    if (typeof idle === 'function') {
      const handle = idle(load, { timeout: 2500 });
      return () => {
        const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        if (cancel) cancel(handle);
      };
    }
    const timer = window.setTimeout(load, 1200);
    return () => window.clearTimeout(timer);
  }, [useStaticPoster]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate('/library?q=' + encodeURIComponent(searchQuery.trim()));
    } else {
      navigate('/library');
    }
  };

  // React only honours the muted+playsInline combination for programmatic play.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      safeMediaPlay(video);
    } else {
      video.pause();
    }
  }, [isPlaying, shouldLoadVideo]);

  const showStillFrame = useStaticPoster || videoError;

  return (
    <section className="hero hero-heroic" aria-label="FUW E-Library Hero Section">
      {/* Decorative background layer. Never the LCP element: the poster image
          paints immediately and the video is attached after first paint. */}
      <div className={`hero-video-wrapper ${shouldLoadVideo && !showStillFrame ? 'loaded' : ''}`}>
        {showStillFrame ? (
          <img
            className="hero-video"
            src={HERO_POSTER}
            alt=""
            aria-hidden="true"
            width={272}
            height={484}
            fetchPriority="low"
            decoding="async"
          />
        ) : (
          <video
            ref={videoRef}
            className="hero-video"
            poster={HERO_POSTER}
            width={272}
            height={484}
            muted
            loop
            playsInline
            autoPlay={shouldLoadVideo}
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            onError={() => setVideoError(true)}
          >
            {shouldLoadVideo &&
              HERO_SOURCES.map((source) => (
                <source key={source.src} src={source.src} type={source.type} />
              ))}
          </video>
        )}
        <div className="hero-overlay" />
        <div className="hero-gradient-mesh" />
      </div>

      {/* Hero Content Layer */}
      <div className="hero-content">
        <div className="hero-grid">
          <div className="hero-left">
            <div className="eyebrow hero-badge">
              <span className="badge-pulse" />
              <GraduationCap size={15} />
              <span>FEDERAL UNIVERSITY WUKARI · E-LIBRARY</span>
            </div>

            <h1 className="hero-title">
              Your gateway to<br />
              <em className="hero-highlight">academic knowledge.</em>
            </h1>

            <p className="hero-desc">
              Discover trusted learning resources, from verified lecture notes and textbooks to past questions
              and research publications, all curated for the FUW community.
            </p>

            <form className="search hero-search-form" onSubmit={handleSearchSubmit}>
              <Search size={20} className="search-icon" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search books, lecture notes, past questions, courses..."
                aria-label="Search learning resources"
              />
              <button type="submit">Search</button>
            </form>

            <div className="quick">
              <span className="quick-label">Popular:</span>
              <div className="quick-links">
                <Link to="/library?q=Past+questions">Past questions</Link>
                <Link to="/library?q=Computer+Science">Computer Science</Link>
                <Link to="/library?q=Lecture+notes">Lecture notes</Link>
                <Link to="/library?q=Economics">Economics</Link>
              </div>
            </div>

            <div className="hero-trust-bar">
              <div className="trust-item">
                <CheckCircle2 size={15} />
                <span>24/7 Digital Access</span>
              </div>
              <div className="trust-item">
                <CheckCircle2 size={15} />
                <span>Verified Curriculum</span>
              </div>
              <div className="trust-item">
                <CheckCircle2 size={15} />
                <span>Fast PDF Downloads</span>
              </div>
            </div>
          </div>

          <div className="hero-right">
            <div className="showcase-card">
              <div className="showcase-glow" />
              <div className="showcase-card-header">
                <div className="showcase-tag">
                  <BookOpen size={14} />
                  <span>Publisher</span>
                </div>
                <span className="live-status">
                  <span className="live-dot" /> ACTIVE PORTAL
                </span>
              </div>

              <div className="showcase-stats-row">
                <div className="showcase-stat">
                  <b>{catalogue.length}</b>
                  <span>Faculties</span>
                </div>
                <div className="showcase-stat-sep" />
                <div className="showcase-stat">
                  <b>{departmentsCount}</b>
                  <span>Departments</span>
                </div>
                <div className="showcase-stat-sep" />
                <div className="showcase-stat">
                  <b>{approvedMaterials.length.toLocaleString()}{approvedMaterials.length > 0 ? '+' : ''}</b>
                  <span>Materials</span>
                </div>
              </div>

              <div className="showcase-highlight-box">
                <div className="highlight-icon">
                  <Sparkles size={18} />
                </div>
                <div className="highlight-text">
                  <h4>Curated by FUW Faculty</h4>
                  <p>Organized by faculty, department, level, and semester for seamless academic study.</p>
                </div>
              </div>

              <div className="showcase-actions">
                <Link to="/library" className="showcase-btn-primary">
                  Browse Collection <ArrowRight size={15} />
                </Link>
                <Link to="/faculties" className="showcase-btn-secondary">
                  View Faculties
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Motion toggle. Only offered when there is motion to control. */}
        {!showStillFrame && (
          <div className="hero-media-controls">
            <button
              type="button"
              className="media-control-pill"
              onClick={() => setIsPlaying((p) => !p)}
              aria-pressed={!isPlaying}
              aria-label={isPlaying ? 'Pause background animation' : 'Play background animation'}
              title={isPlaying ? 'Pause background animation' : 'Play background animation'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              <span>{isPlaying ? 'Pause Motion' : 'Play Motion'}</span>
            </button>
            {useStaticPoster && (
              <span className="media-control-note">Still image shown to save data</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}