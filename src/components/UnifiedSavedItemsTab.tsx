import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Bookmark,
  BookOpen,
  ShoppingBag,
  Home,
  Users,
  Calendar,
  Bell,
  Trash2,
  ExternalLink,
  Search,
  Loader2,
  Heart
} from 'lucide-react';
import {
  fetchUnifiedSavedItems,
  removeUnifiedItem,
  UnifiedSavedItem,
  SavedItemType
} from '../lib/savedItems';
import { MaterialItem } from '../lib/store';
import { MaterialCard } from './MaterialCard';
import { useToast } from './Toast';
import { fx } from '../lib/motion';

interface UnifiedSavedItemsTabProps {
  savedMaterials: MaterialItem[];
  onReadOnline: (m: MaterialItem) => void;
  onAskAi: (m: MaterialItem) => void;
  onRemoveMaterial: (id: string) => void;
}

export function UnifiedSavedItemsTab({
  savedMaterials,
  onReadOnline,
  onAskAi,
  onRemoveMaterial
}: UnifiedSavedItemsTabProps) {
  const { toast } = useToast();
  const [unifiedItems, setUnifiedItems] = useState<UnifiedSavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'all' | 'materials' | 'marketplace' | 'accommodation' | 'roommates' | 'events'>('all');

  const loadItems = async () => {
    setLoading(true);
    try {
      const items = await fetchUnifiedSavedItems();
      setUnifiedItems(items);
    } catch {
      // Non-blocking
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  const handleRemove = async (item: UnifiedSavedItem) => {
    const ok = await removeUnifiedItem(item.itemType, item.itemId);
    if (ok) {
      setUnifiedItems((prev) => prev.filter((i) => !(i.itemType === item.itemType && i.itemId === item.itemId)));
      if (item.itemType === 'material') {
        onRemoveMaterial(item.itemId);
      }
      toast('Item removed from saved list.', 'info');
    }
  };

  // Combine legacy materials and unified items
  const nonMaterialItems = useMemo(() => {
    return unifiedItems.filter((i) => i.itemType !== 'material');
  }, [unifiedItems]);

  const totalCount = savedMaterials.length + nonMaterialItems.length;

  const filteredNonMaterials = useMemo(() => {
    if (selectedTab === 'all') return nonMaterialItems;
    if (selectedTab === 'marketplace') return nonMaterialItems.filter((i) => i.itemType === 'product' || i.itemType === 'vendor');
    if (selectedTab === 'accommodation') return nonMaterialItems.filter((i) => i.itemType === 'accommodation');
    if (selectedTab === 'roommates') return nonMaterialItems.filter((i) => i.itemType === 'roommate');
    if (selectedTab === 'events') return nonMaterialItems.filter((i) => i.itemType === 'event' || i.itemType === 'announcement');
    return [];
  }, [nonMaterialItems, selectedTab]);

  const showMaterials = selectedTab === 'all' || selectedTab === 'materials';

  const getItemIcon = (type: SavedItemType) => {
    switch (type) {
      case 'material':
        return <BookOpen size={16} color="var(--brand-green, #12603d)" />;
      case 'product':
      case 'vendor':
        return <ShoppingBag size={16} color="#ea580c" />;
      case 'accommodation':
        return <Home size={16} color="#16a34a" />;
      case 'roommate':
        return <Users size={16} color="#8b5cf6" />;
      case 'event':
        return <Calendar size={16} color="#059669" />;
      case 'announcement':
        return <Bell size={16} color="#d97706" />;
      default:
        return <Bookmark size={16} color="var(--brand-green, #12603d)" />;
    }
  };

  return (
    <div className="portal-view-fade">
      {/* Top Banner */}
      <div className="portal-top" style={{ marginBottom: 20 }}>
        <div>
          <p className="kicker">UNIFIED REPOSITORY</p>
          <h1>Unified Saved Items ({totalCount})</h1>
          <p className="subtitle">
            All your bookmarked course materials, marketplace finds, verified student lodges, roommate requests, and campus events in one place.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
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
        <button
          type="button"
          onClick={() => setSelectedTab('all')}
          className={`btn ${selectedTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 20 }}
        >
          All Items ({totalCount})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('materials')}
          className={`btn ${selectedTab === 'materials' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 20 }}
        >
          E-Library ({savedMaterials.length})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('marketplace')}
          className={`btn ${selectedTab === 'marketplace' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 20 }}
        >
          Marketplace ({nonMaterialItems.filter((i) => i.itemType === 'product' || i.itemType === 'vendor').length})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('accommodation')}
          className={`btn ${selectedTab === 'accommodation' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 20 }}
        >
          Accommodation ({nonMaterialItems.filter((i) => i.itemType === 'accommodation').length})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('roommates')}
          className={`btn ${selectedTab === 'roommates' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 20 }}
        >
          Roommates ({nonMaterialItems.filter((i) => i.itemType === 'roommate').length})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('events')}
          className={`btn ${selectedTab === 'events' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 20 }}
        >
          Events &amp; News ({nonMaterialItems.filter((i) => i.itemType === 'event' || i.itemType === 'announcement').length})
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="empty-state card-empty">
          <Heart size={44} style={{ opacity: 0.5, marginBottom: 12 }} />
          <b>No saved items yet</b>
          <span>Tap the bookmark or save icon on any material, product, hostel, or event across the campus hub to organize them here.</span>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Link to="/library" className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
              Explore Library
            </Link>
            <Link to="/hub" className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>
              Campus Hub
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* E-Library Materials Section */}
          {showMaterials && savedMaterials.length > 0 && (
            <div>
              {selectedTab === 'all' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <BookOpen size={18} color="var(--brand-green, #12603d)" />
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                    Saved Course Materials ({savedMaterials.length})
                  </h3>
                </div>
              )}
              <div className="grid materials">
                {savedMaterials.map((m) => (
                  <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} onAskAi={onAskAi} />
                ))}
              </div>
            </div>
          )}

          {/* Non-Material Saved Items (Marketplace, Lodges, Events, Roommates) */}
          {filteredNonMaterials.length > 0 && (
            <div>
              {selectedTab === 'all' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <Bookmark size={18} color="var(--brand-green, #12603d)" />
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
                    Campus &amp; Marketplace Bookmarks ({filteredNonMaterials.length})
                  </h3>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 14 }}>
                {filteredNonMaterials.map((item) => (
                  <div
                    key={item.id}
                    className="card"
                    style={{
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      borderRadius: 12,
                      gap: 12
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: 'var(--surface-alt)',
                            border: '1px solid var(--border)',
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0
                          }}
                        >
                          {getItemIcon(item.itemType)}
                        </div>
                        <div>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              color: 'var(--text-secondary)'
                            }}
                          >
                            {item.itemType}
                          </span>
                          <h4 style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                            {item.title}
                          </h4>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemove(item)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: 4
                        }}
                        title="Remove bookmark"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {item.subtitle && (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                        {item.subtitle}
                      </p>
                    )}

                    <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Saved {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                      <Link
                        to={item.url}
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: 12, borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <span>View</span>
                        <ExternalLink size={12} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
