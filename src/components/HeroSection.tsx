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
  Play,
  Volume2,
  VolumeX,
  Radio
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { catalogue } from '../data/catalogue';

export function HeroSection() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [userWantsSound, setUserWantsSound] = useState(true);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isInView, setIsInView] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Live repository statistics straight from the database
  const store = useStore();
  const approvedMaterials = store.getApprovedMaterials();
  const departmentsCount = catalogue.reduce((acc, f) => acc + f.departments.length, 0);

  const heroRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const userWantsSoundRef = useRef(true);
  const navigate = useNavigate();

  userWantsSoundRef.current = userWantsSound;

  // 1. Initial Autoplay + Audio setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');

    // Attempt unmuted autoplay when site is opened
    video.muted = false;
    video.volume = 0.75;

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true);
          setIsMuted(false);
          setUserWantsSound(true);
        })
        .catch((_err) => {
          // Autoplay with audio was restricted by browser policy -> start muted, then unmute on first user interaction
          video.muted = true;
          setIsMuted(true);
          video
            .play()
            .then(() => setIsPlaying(true))
            .catch(() => setIsPlaying(false));
        });
    }

    // Auto-unmute upon first user interaction if browser initially blocked unmuted autoplay
    const handleFirstInteraction = () => {
      if (videoRef.current && userWantsSoundRef.current && heroRef.current) {
        const rect = heroRef.current.getBoundingClientRect();
        // Only unmute if hero is currently in view
        if (rect.bottom > 100) {
          videoRef.current.muted = false;
          setIsMuted(false);
        }
      }
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };

    window.addEventListener('click', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });
    window.addEventListener('touchstart', handleFirstInteraction, { once: true });

    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, []);

  // 2. Scroll-aware sound muting when user scrolls down and animation video is no longer showing
  useEffect(() => {
    const heroEl = heroRef.current;
    const video = videoRef.current;
    if (!heroEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.12) {
            // Hero animation video is in view
            setIsInView(true);
            if (videoRef.current) {
              if (userWantsSoundRef.current) {
                videoRef.current.muted = false;
                setIsMuted(false);
              }
              if (videoRef.current.paused) {
                videoRef.current.play().catch(() => {});
                setIsPlaying(true);
              }
            }
          } else {
            // Hero animation video is no longer visible on screen (scrolled down)
            // MUTE sound immediately!
            setIsInView(false);
            if (videoRef.current) {
              videoRef.current.muted = true;
              setIsMuted(true);
            }
          }
        });
      },
      {
        root: null,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0]
      }
    );

    observer.observe(heroEl);

    // Fallback scroll listener for older browsers / webviews
    const handleScroll = () => {
      if (!heroRef.current || !videoRef.current) return;
      const rect = heroRef.current.getBoundingClientRect();
      const visible = rect.bottom > 80 && rect.top < window.innerHeight;
      if (!visible) {
        videoRef.current.muted = true;
        setIsMuted(true);
        setIsInView(false);
      } else if (userWantsSoundRef.current) {
        videoRef.current.muted = false;
        setIsMuted(false);
        setIsInView(true);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isMuted) {
      video.muted = false;
      video.volume = 0.75;
      setIsMuted(false);
      setUserWantsSound(true);
      if (video.paused) {
        video.play().catch(() => {});
        setIsPlaying(true);
      }
    } else {
      video.muted = true;
      setIsMuted(true);
      setUserWantsSound(false);
    }
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video
        .play()
        .then(() => {
          setIsPlaying(true);
          if (userWantsSoundRef.current && isInView) {
            video.muted = false;
            setIsMuted(false);
          }
        })
        .catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate('/library?q=' + encodeURIComponent(searchQuery.trim()));
    } else {
      navigate('/library');
    }
  };

  return (
    <section ref={heroRef} className="hero hero-heroic" aria-label="FUW E-Library Hero Section">
      {/* Background Video Animation Layer */}
      <div className={`hero-video-wrapper ${videoLoaded ? 'loaded' : ''}`}>
        {!videoError && (
          <video
            ref={videoRef}
            className="hero-video"
            autoPlay
            loop
            playsInline
            preload="auto"
            onLoadedData={() => setVideoLoaded(true)}
            onError={() => {
              setVideoError(true);
              setVideoLoaded(false);
            }}
          >
            <source src="/images/animation.mp4" type="video/mp4" />
            <source src="/animation.mp4" type="video/mp4" />
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
                  <span>Digital Repository</span>
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

        {/* Media Controls Strip (Sound Toggle + Motion Toggle + Auto-Mute Indicator) */}
        {!videoError && (
          <div className="hero-media-controls">
            <button
              type="button"
              className={`media-control-pill ${!isMuted ? 'active-audio' : 'muted-audio'}`}
              onClick={toggleSound}
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              title={isMuted ? 'Click to turn sound on' : 'Click to mute sound'}
            >
              {!isMuted ? <Volume2 size={13} /> : <VolumeX size={13} />}
              <span>{!isMuted ? 'Sound Playing' : 'Sound Muted'}</span>
              {!isMuted && <span className="audio-wave-dot" />}
            </button>

            <button
              type="button"
              className="media-control-pill"
              onClick={togglePlayback}
              aria-label={isPlaying ? 'Pause background animation' : 'Play background animation'}
              title={isPlaying ? 'Pause background animation' : 'Play background animation'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              <span>{isPlaying ? 'Pause Motion' : 'Play Motion'}</span>
            </button>

            {!isInView && (
              <span className="scroll-mute-badge" title="Sound automatically muted while scrolled down">
                <Radio size={11} /> Auto-muted offscreen
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
