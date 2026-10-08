import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  Download,
  CheckCircle2,
  Layers,
  ShoppingBag,
  Home,
  Bot,
  Bookmark,
  Calendar,
  Clock,
  Trash2,
  Loader2,
  Filter,
  ExternalLink
} from 'lucide-react';
import {
  fetchUserActivity,
  deleteUserActivityItem,
  UserActivityItem,
  ActivityType
} from '../lib/activity';
import { useToast } from './Toast';
import { fx } from '../lib/motion';

const ACTIVITY_FILTERS: { id: ActivityType | 'all'; label: string }[] = [
  { id: 'all', label: 'All Activity' },
  { id: 'material_viewed', label: 'Reading' },
  { id: 'material_downloaded', label: 'Downloads' },
  { id: 'study_task_completed', label: 'Tasks Completed' },
  { id: 'flashcard_reviewed', label: 'Flashcards' },
  { id: 'ai_tutor_session', label: 'AI Tutor' },
  { id: 'marketplace_viewed', label: 'Marketplace' },
  { id: 'accommodation_viewed', label: 'Accommodation' },
  { id: 'item_saved', label: 'Saved Items' }
];

export function CampusActivityTimeline() {
  const { toast } = useToast();
  const [activities, setActivities] = useState<UserActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<ActivityType | 'all'>('all');
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const loadActivities = async () => {
    setLoading(true);
    try {
      const items = await fetchUserActivity({
        activityType: selectedFilter === 'all' ? undefined : selectedFilter,
        limit: pageSize,
        offset: page * pageSize
      });
      setActivities(items);
    } catch {
      // Non-blocking
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadActivities();
  }, [selectedFilter, page]);

  const handleDelete = async (id: string) => {
    const ok = await deleteUserActivityItem(id);
    if (ok) {
      setActivities((prev) => prev.filter((a) => a.id !== id));
      toast('Activity entry removed.', 'info');
    }
  };

  const getActivityIcon = (type: ActivityType) => {
    switch (type) {
      case 'material_viewed':
        return <BookOpen size={16} color="var(--brand-green, #12603d)" />;
      case 'material_downloaded':
        return <Download size={16} color="#0284c7" />;
      case 'study_task_completed':
        return <CheckCircle2 size={16} color="#16a34a" />;
      case 'flashcard_reviewed':
        return <Layers size={16} color="#8b5cf6" />;
      case 'ai_tutor_session':
        return <Bot size={16} color="#059669" />;
      case 'marketplace_viewed':
      case 'marketplace_ordered':
        return <ShoppingBag size={16} color="#ea580c" />;
      case 'accommodation_viewed':
      case 'accommodation_inquired':
        return <Home size={16} color="#16a34a" />;
      case 'item_saved':
        return <Bookmark size={16} color="var(--brand-green, #12603d)" />;
      default:
        return <Activity size={16} color="var(--text-secondary)" />;
    }
  };

  const getActivityLabel = (type: ActivityType) => {
    switch (type) {
      case 'material_viewed':
        return 'Read Material';
      case 'material_downloaded':
        return 'Downloaded Material';
      case 'study_task_completed':
        return 'Completed Task';
      case 'flashcard_reviewed':
        return 'Reviewed Flashcards';
      case 'study_guide_created':
        return 'Generated Study Guide';
      case 'ai_tutor_session':
        return 'AI Tutor Question';
      case 'marketplace_viewed':
        return 'Viewed Product';
      case 'marketplace_ordered':
        return 'Placed Order';
      case 'accommodation_viewed':
        return 'Viewed Lodge';
      case 'accommodation_inquired':
        return 'Contacted Caretaker';
      case 'item_saved':
        return 'Saved Item';
      default:
        return 'Campus Activity';
    }
  };

  const formatActivityTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="portal-view-fade">
      {/* Top Banner */}
      <div className="portal-top" style={{ marginBottom: 20 }}>
        <div>
          <p className="kicker">PERSONAL TIMELINE</p>
          <h1>Campus Activity Timeline</h1>
          <p className="subtitle">
            Private, cross-device history of your reading, downloads, completed study tasks, flashcard reviews, and campus inquiries.
          </p>
        </div>
      </div>

      {/* Activity Filter Chips */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 8,
          marginBottom: 24,
          borderBottom: '1px solid var(--border)'
        }}
      >
        {ACTIVITY_FILTERS.map((f) => {
          const active = selectedFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setSelectedFilter(f.id);
                setPage(0);
              }}
              className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 14px', fontSize: 13, borderRadius: 20, whiteSpace: 'nowrap' }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Loader2 size={32} className="spin" color="var(--brand-green, #12603d)" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Loading your campus activity...</div>
        </div>
      ) : activities.length === 0 ? (
        <div className="empty-state card-empty">
          <Activity size={44} style={{ opacity: 0.5, marginBottom: 12 }} />
          <b>No recent activity recorded</b>
          <span>As you read library materials, complete study planner tasks, review flashcards, and interact with the campus hub, your timeline will appear here.</span>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Link to="/library" className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
              Browse E-Library
            </Link>
            <Link to="/student/planner" className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>
              Study Planner
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activities.map((item) => (
            <div
              key={item.id}
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 18px',
                borderRadius: 12
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0
                }}
              >
                {getActivityIcon(item.activityType)}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      color: 'var(--brand-green, #12603d)',
                      letterSpacing: '0.04em'
                    }}
                  >
                    {getActivityLabel(item.activityType)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>·</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {formatActivityTime(item.createdAt)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {item.entityTitle}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: 6
                }}
                title="Remove from history"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}

          {/* Pagination Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="btn btn-secondary"
              style={{ padding: '6px 14px', fontSize: 13, opacity: page === 0 ? 0.5 : 1 }}
            >
              Previous
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {page + 1}</span>
            <button
              type="button"
              disabled={activities.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
              className="btn btn-secondary"
              style={{ padding: '6px 14px', fontSize: 13, opacity: activities.length < pageSize ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
