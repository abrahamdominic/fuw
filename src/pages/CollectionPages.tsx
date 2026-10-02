import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layers, Loader2, ArrowLeft, FileText, Landmark, Eye, BookOpen } from 'lucide-react';
import {
  fetchCollections,
  fetchCollection,
  CollectionGroup,
  CollectionItem
} from '../lib/collections';
import { RESEARCH_TYPE_LABELS } from '../lib/repository';
import { useToast } from '../components/Toast';
import { SEO } from '../components/SEO';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { PUBLIC_ROUTES } from '../lib/seo/routes';
import { collectionMeta } from '../lib/seo/dynamic';

export function CollectionsPage() {
  const { toast } = useToast();
  const [collections, setCollections] = useState<CollectionGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setCollections(await fetchCollections());
      } catch (err: any) {
        toast(err.message || 'Could not load collections.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  return (
    <>
      <SEO path="/collections" breadcrumbs={PUBLIC_ROUTES['/collections'].breadcrumbs} />
      <Breadcrumbs trail={PUBLIC_ROUTES['/collections'].breadcrumbs} />
      <div className="repo-hero">
        <h1><Layers size={26} style={{ verticalAlign: -4 }} /> Curated Collections</h1>
        <p>Expertly curated sets of materials assembled by FUW librarians to support courses, research and exam preparation.</p>
      </div>

      <div className="public-section container" style={{ marginTop: '1rem' }}>
        {loading ? (
          <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
        ) : collections.length === 0 ? (
          <div className="empty-state-card">
            <Layers size={36} />
            <b>No collections published yet</b>
            <span>Librarians are preparing curated collections. Check back soon.</span>
          </div>
        ) : (
          <div className="rl-grid">
            {collections.map((c) => (
              <Link key={c.id} to={`/collections/${c.slug}`} className="rl-card" style={{ textDecoration: 'none' }}>
                <div className="rl-card-icon" style={{ background: c.cover_color || '#0B6B3A' }}>
                  <Layers size={20} />
                </div>
                <div className="rl-card-name">{c.name}</div>
                {c.description && <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{c.description}</div>}
                <div className="rl-card-count">{c.item_count || 0} resources</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function CollectionDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [collection, setCollection] = useState<CollectionGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const c = await fetchCollection(slug || '');
        if (!c) { setNotFound(true); return; }
        setCollection(c);
      } catch (err: any) {
        toast(err.message || 'Could not load the collection.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, toast]);

  const handleOpen = async (item: CollectionItem) => {
    if (item.material_id) {
      navigate(`/materials/${item.material_id}`);
    } else if (item.research_item_id) {
      navigate(`/repository/${item.research_item_id}`);
    }
  };

  if (loading) {
    return <div className="loading-spinner-row" style={{ padding: '3rem' }}><Loader2 size={20} className="animate-spin" /> Loading collection…</div>;
  }

  if (notFound || !collection) {
    return (
      <div className="empty-state-card" style={{ margin: '3rem auto', maxWidth: 480 }}>
        <SEO title="Collection not found" path={`/collections/${slug ?? ''}`} noindex />
        <Layers size={40} />
        <b>Collection not found</b>
        <span>This collection may have been unpublished or removed.</span>
        <Link to="/collections" className="secondary-btn" style={{ marginTop: '1rem' }}><ArrowLeft size={14} /> All collections</Link>
      </div>
    );
  }

  return (
    <>
      <SEO
        {...collectionMeta({
          slug: collection.slug,
          name: collection.name,
          description: collection.description,
          itemCount: collection.item_count ?? collection.items?.length ?? 0
        })}
      />
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Collections', path: '/collections' },
          { name: collection.name, path: `/collections/${collection.slug}` }
        ]}
      />
      <div className="repo-hero">
        <button className="secondary-btn btn-sm" style={{ marginBottom: '0.8rem' }} onClick={() => navigate('/collections')}>
          <ArrowLeft size={14} /> All collections
        </button>
        <h1><Layers size={26} style={{ verticalAlign: -4 }} /> {collection.name}</h1>
        {collection.description && <p>{collection.description}</p>}
      </div>

      <div className="public-section container" style={{ marginTop: '1rem' }}>
        {!collection.items || collection.items.length === 0 ? (
          <div className="empty-state-card">
            <BookOpen size={36} />
            <b>This collection is empty</b>
            <span>Resources will be added by the library team.</span>
          </div>
        ) : (
          <div className="result-list">
            {collection.items.map((item) => {
              const isResearch = !item.material_id && !!item.research_item_id;
              const title = item.title_override
                || (item.material as any)?.title
                || (item.research_item as any)?.title
                || 'Untitled resource';
              const meta = isResearch
                ? `${RESEARCH_TYPE_LABELS[(item.research_item as any)?.research_type] || 'Publication'}${(item.research_item as any)?.year ? ' · ' + (item.research_item as any).year : ''}`
                : `${(item.material as any)?.course_code || ''}${(item.material as any)?.level ? ' · ' + (item.material as any).level : ''}`;
              return (
                <div key={item.id} className="result-card" onClick={() => handleOpen(item)} style={{ cursor: 'pointer' }}>
                  <div className="result-icon">{isResearch ? <Landmark size={20} /> : <FileText size={20} />}</div>
                  <div className="result-body">
                    <div className="result-title">{title}</div>
                    <div className="result-meta">{meta}</div>
                  </div>
                  <div className="result-actions">
                    <button className="link-btn" title="View" onClick={(e) => { e.stopPropagation(); handleOpen(item); }}><Eye size={16} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}