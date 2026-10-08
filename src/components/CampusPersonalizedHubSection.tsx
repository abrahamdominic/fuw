import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Sparkles,
  Bookmark,
  Clock,
  Calendar,
  Layers,
  Brain,
  CheckCircle2,
  ArrowRight,
  TrendingUp,
  Compass,
  X,
  GraduationCap
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { store, ReadingProgressRecord, MaterialItem } from '../lib/store';
import {
  fetchCampusRecommendations,
  dismissRecommendation,
  CampusRecommendation
} from '../lib/recommendations';
import { supabase } from '../lib/supabase';

interface AcademicEventItem {
  id: string;
  title: string;
  category: string;
  startsAt: string;
}

export function CampusPersonalizedHubSection() {
  const { user, profile, isAuthenticated } = useAuth();
  const [readingItem, setReadingItem] = useState<ReadingProgressRecord | null>(null);
  const [recentItems, setRecentItems] = useState<MaterialItem[]>([]);
  const [recommendations, setRecommendations] = useState<CampusRecommendation[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<AcademicEventItem[]>([]);
  const [savedCount, setSavedCount] = useState<number>(0);
  const [isLoadingRecs, setIsLoadingRecs] = useState<boolean>(true);

  useEffect(() => {
    if (!isAuthenticated) return;

    // 1. Reading progress & recent items from local store
    const reading = store.getReadingHistory();
    if (reading && reading.length > 0) {
      setReadingItem(reading[0]);
    }
    const recent = store.getRecentMaterials();
    setRecentItems(recent.slice(0, 3));

    // 2. Saved items count
    if (supabase && user) {
      void supabase
        .from('user_saved_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .then(
          ({ count }) => {
            if (count !== null) setSavedCount(count);
          },
          () => {}
        );
    }

    // 3. Upcoming academic milestones
    if (supabase) {
      void supabase
        .from('academic_events')
        .select('id, title, category, starts_at')
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(3)
        .then(
          ({ data }) => {
            if (data && data.length > 0) {
              setUpcomingEvents(
                data.map((d) => ({
                  id: d.id,
                  title: d.title,
                  category: d.category || 'Academic',
                  startsAt: d.starts_at
                }))
              );
            }
          },
          () => {}
        );
    }

    // 4. Personalized recommendations
    setIsLoadingRecs(true);
    fetchCampusRecommendations(
      {
        id: user?.id,
        department: profile?.department,
        faculty: profile?.faculty,
        level: profile?.level
      },
      4
    )
      .then((recs) => {
        setRecommendations(recs);
      })
      .catch(() => {})
      .finally(() => {
        setIsLoadingRecs(false);
      });
  }, [isAuthenticated, user?.id, profile?.department, profile?.faculty, profile?.level]);

  if (!isAuthenticated) {
    return null;
  }

  const handleDismissRec = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dismissRecommendation(id);
    setRecommendations((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <section
      aria-label="Personalized Campus Workspace"
      style={{
        marginTop: 40,
        marginBottom: 44,
        display: 'flex',
        flexDirection: 'column',
        gap: 28
      }}
    >
      {/* AI & Academic Intelligence Quick Hub */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: '20px 24px',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(22, 163, 74, 0.12)',
                color: 'var(--green-700)',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                FUW Student AI &amp; Academic Toolkit
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                Fast AI tutors, question solving, spaced-repetition flashcards, and exam plans.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              to="/student/saved"
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <Bookmark size={13} />
              <span>Saved ({savedCount})</span>
            </Link>
            <Link
              to="/student/activity"
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <Clock size={13} />
              <span>Activity</span>
            </Link>
          </div>
        </div>

        {/* Quick Launch Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
            gap: 12
          }}
        >
          <Link
            to="/student/ai"
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textDecoration: 'none',
              color: 'inherit',
              transition: 'transform 0.15s var(--ease)'
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(59, 130, 246, 0.12)',
                color: '#2563eb',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Brain size={18} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>FUW AI Tutor</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Course Q&amp;A &amp; Concepts</div>
            </div>
          </Link>

          <Link
            to="/student/question-analyzer"
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textDecoration: 'none',
              color: 'inherit',
              transition: 'transform 0.15s var(--ease)'
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(168, 85, 247, 0.12)',
                color: '#9333ea',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Question Analyzer</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Breakdown &amp; traps</div>
            </div>
          </Link>

          <Link
            to="/student/exam-prep"
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textDecoration: 'none',
              color: 'inherit',
              transition: 'transform 0.15s var(--ease)'
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(234, 88, 12, 0.12)',
                color: '#ea580c',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <TrendingUp size={18} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Exam Readiness</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Score &amp; Revision Plan</div>
            </div>
          </Link>

          <Link
            to="/student/flashcards"
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: 'var(--surface-alt)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textDecoration: 'none',
              color: 'inherit',
              transition: 'transform 0.15s var(--ease)'
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#059669',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Layers size={18} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Smart Flashcards</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Spaced Repetition</div>
            </div>
          </Link>
        </div>
      </div>

      {/* Two Columns: Left = Continue Reading & Recommendations; Right = Milestones & Recents */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
          gap: 24
        }}
      >
        {/* Left Card: Continue Studying */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BookOpen size={16} color="var(--green-700)" />
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Continue Studying</h4>
              </div>
              <Link
                to="/catalogue"
                style={{ fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none' }}
              >
                Browse all
              </Link>
            </div>

            {readingItem ? (
              <div
                style={{
                  background: 'var(--surface-alt)',
                  borderRadius: 12,
                  padding: '16px',
                  border: '1px solid var(--border)',
                  marginBottom: 16
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: 'var(--green-800)',
                      textTransform: 'uppercase'
                    }}
                  >
                    {readingItem.course || 'Course Material'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Page {readingItem.currentPage} of {readingItem.totalPages}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px', lineHeight: 1.3 }}>
                  {readingItem.materialTitle}
                </div>
                {/* Progress bar */}
                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--border)',
                    overflow: 'hidden',
                    marginBottom: 12
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, readingItem.percentage))}%`,
                      background: 'var(--green-600)',
                      borderRadius: 999
                    }}
                  />
                </div>
                <Link
                  to={`/materials/${readingItem.materialId}`}
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '8px 14px', width: '100%', justifyContent: 'center' }}
                >
                  <span>Resume Reading ({readingItem.percentage}%)</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            ) : (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  background: 'var(--surface-alt)',
                  borderRadius: 12,
                  border: '1px dashed var(--border)',
                  marginBottom: 16
                }}
              >
                <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  You haven't opened any course texts recently.
                </p>
                <Link to="/catalogue" className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }}>
                  Explore Course Library
                </Link>
              </div>
            )}
          </div>

          {/* Quick Recent Materials */}
          {recentItems.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Recently Viewed Texts
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentItems.map((item) => (
                  <Link
                    key={item.id}
                    to={`/materials/${item.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'var(--surface-alt)',
                      textDecoration: 'none',
                      color: 'inherit',
                      fontSize: 12
                    }}
                  >
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </span>
                    <span style={{ color: 'var(--green-700)', fontWeight: 700, marginLeft: 8 }}>
                      {item.course || item.type}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Card: Recommendations & Academic Milestones */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Compass size={16} color="var(--green-700)" />
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Recommended For You</h4>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                {profile?.department || 'Campus signals'}
              </span>
            </div>

            {isLoadingRecs ? (
              <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                Finding personalized study recommendations...
              </div>
            ) : recommendations.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--border)',
                      gap: 10
                    }}
                  >
                    <Link
                      to={rec.url}
                      style={{
                        textDecoration: 'none',
                        color: 'inherit',
                        flex: 1,
                        minWidth: 0
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {rec.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--green-800)', fontWeight: 600 }}>
                        {rec.reason}
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => handleDismissRec(rec.id, e)}
                      title="Dismiss recommendation"
                      aria-label="Dismiss recommendation"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: 4,
                        borderRadius: 4
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: '20px 16px',
                  textAlign: 'center',
                  background: 'var(--surface-alt)',
                  borderRadius: 12,
                  fontSize: 13,
                  color: 'var(--text-secondary)'
                }}
              >
                All caught up! Check back as you explore more courses.
              </div>
            )}
          </div>

          {/* Upcoming Academic Milestones */}
          {upcomingEvents.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={13} />
                <span>Upcoming Milestones</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {upcomingEvents.map((evt) => (
                  <div
                    key={evt.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'var(--surface-alt)',
                      fontSize: 12
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{evt.title}</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                      {new Date(evt.startsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
