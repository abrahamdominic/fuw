import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Bookmark, Plus, Trash2, ListOrdered, Loader2, ChevronRight, X, Search,
  BookOpen, Eye, Download, Quote, Edit3, Check
} from 'lucide-react';
import {
  fetchMyReadingLists,
  createReadingList,
  deleteReadingList,
  ReadingList,
  READING_LIST_CATEGORIES
} from '../lib/readingLists';
import { useToast } from './Toast';
import { CitationModal } from './CitationModal';

interface ReadingListsTabProps {
  onReadOnline?: (m: any) => void;
}

export function ReadingListsTab({ onReadOnline }: ReadingListsTabProps) {
  const { toast } = useToast();
  const [lists, setLists] = useState<ReadingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('personal');
  const [creating, setCreating] = useState(false);
  const [beatified, setBeatified] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyReadingLists();
      setLists(data);
    } catch (err: any) {
      toast(err.message || 'Could not load your reading lists.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createReadingList({ name: newName, description: newDesc, category: newCategory });
      toast('Reading list created.', 'success');
      setNewName(''); setNewDesc(''); setNewCategory('personal'); setShowCreate(false);
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not create the reading list.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (list: ReadingList) => {
    if (!window.confirm(`Delete "${list.name}" and all of its items?`)) return;
    try {
      await deleteReadingList(list.id);
      toast('Reading list deleted.', 'success');
      setLists((prev) => prev.filter((l) => l.id !== list.id));
    } catch (err: any) {
      toast(err.message || 'Could not delete the reading list.', 'error');
    }
  };

  return (
    <div className="student-reading-lists-tab">
      <div className="request-page-header rl-header">
        <div>
          <h2 className="page-title"><Bookmark size={22} /> My Reading Lists</h2>
          <p className="page-subtitle">Organize materials into study kits, course collections, research folders and exam-preparation lists.</p>
        </div>
        <button className={showCreate ? 'secondary-btn' : 'primary'} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Reading List</>}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card" style={{ margin: '0 1rem 1rem', padding: '1.2rem' }}>
          <div className="form-field">
            <label className="form-label">List Name *</label>
            <input
              className="form-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              placeholder="e.g. CSC 401 Study Kit"
              autoFocus
            />
          </div>
          <div className="form-field">
            <label className="form-label">Description (optional)</label>
            <input className="form-input" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What is this list for?" />
          </div>
          <div className="form-field">
            <label className="form-label">Category</label>
            <select className="form-input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
              {READING_LIST_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace('-', ' ').replace(/^\w/, (m) => m.toUpperCase())}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="primary submit-btn form-submit-btn" disabled={creating || !newName.trim()}>
            {creating ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : <><Plus size={15} /> Create List</>}
          </button>
        </form>
      )}

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading your lists…</div>
      ) : lists.length === 0 ? (
        <div className="empty-state-card" style={{ margin: '0 1rem' }}>
          <Bookmark size={36} />
          <b>No Reading Lists Yet</b>
          <span>Create your first list to organize materials. You can add any material from its page by choosing "Save to Reading List".</span>
          <button className="secondary-btn" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Create One Now
          </button>
        </div>
      ) : (
        <div className="rl-grid">
          {lists.map((list) => (
            <div className="rl-card" key={list.id}>
              <div className="rl-card-icon"><ListOrdered size={20} /></div>
              <span className="rl-card-category">{list.category.replace('-', ' ')}</span>
              <div className="rl-card-name">{list.name}</div>
              {list.description && <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{list.description}</div>}
              <div className="rl-card-count">
                {list.item_count || 0} item{list.item_count === 1 ? '' : 's'}
                {list.is_public && ' · Public'}
              </div>
              <div className="rl-card-actions" style={{ gap: 8 }}>
                <Link to={`/student/reading-lists/${list.id}`} className="link-btn">
                  <Eye size={13} /> Open
                </Link>
                <button className="link-btn" onClick={() => handleDelete(list)}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReadingListDetailTab() {
  const { toast } = useToast();
  const [list, setList] = useState<ReadingList | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [citeItem, setCiteItem] = useState<any>(null);

  const listId = window.location.pathname.split('/').pop();

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadList = async () => {
    if (!listId) return;
    setLoading(true);
    try {
      const { fetchReadingList } = await import('../lib/readingLists');
      const { list: listData, items: itemsData } = await fetchReadingList(listId);
      setList(listData);

      const enriched: any[] = [];
      for (const item of itemsData) {
        const row: any = { ...item };
        if (item.material_id) {
          const { supabase } = await import('../lib/supabase');
          const { data } = await supabase!.from('materials')
            .select('id, title, course_code, course_title, department, faculty, material_type, level, file_url')
            .eq('id', item.material_id)
            .maybeSingle();
          row.material = data;
        }
        if (item.research_item_id) {
          const { supabase } = await import('../lib/supabase');
          const { data } = await supabase!.from('research_items')
            .select('id, title, research_type, department, year, abstract')
            .eq('id', item.research_item_id)
            .maybeSingle();
          row.researchItem = data;
        }
        enriched.push(row);
      }
      setItems(enriched);
    } catch (err: any) {
      toast(err.message || 'Could not load this reading list.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (itemId: string) => {
    const { removeReadingListItem } = await import('../lib/readingLists');
    try {
      await removeReadingListItem(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      toast('Item removed from the list.', 'info');
    } catch (err: any) {
      toast(err.message || 'Could not remove this item.', 'error');
    }
  };

  if (loading) {
    return <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading list…</div>;
  }

  if (!list) {
    return (
      <div className="empty-state-card" style={{ margin: '1rem' }}>
        <BookOpen size={36} />
        <b>Reading list not found</b>
        <Link to="/student/reading-lists" className="secondary-btn">Back to Lists</Link>
      </div>
    );
  }

  const itemLabel = (item: any) => {
    if (item.material) return { title: item.material.title, meta: `${item.material.course_code || ''}${item.material.level ? ' · ' + item.material.level : ''} · ${item.material.department || ''}` };
    if (item.researchItem) return { title: item.researchItem.title, meta: `${REPO_TYPE(item.researchItem.research_type)} · ${item.researchItem.year || ''}` };
    return { title: 'Unknown item', meta: '' };
  };

  return (
    <div className="student-reading-list-detail">
      <div className="request-page-header rl-header">
        <div>
          <h2 className="page-title"><Bookmark size={22} /> {list.name}</h2>
          <p className="page-subtitle">{list.description || `${list.item_count || items.length} items in this list`}</p>
        </div>
        <Link to="/student/reading-lists" className="secondary-btn"><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> All Lists</Link>
      </div>

      {items.length === 0 ? (
        <div className="empty-state-card" style={{ margin: '0 1rem' }}>
          <BookOpen size={36} />
          <b>This list is empty</b>
          <span>Browse the library and save materials to this list from any resource page.</span>
          <Link to="/library" className="primary"><Search size={14} /> Browse the Library</Link>
        </div>
      ) : (
        <div className="rl-detail-items">
          {items.map((item) => {
            const label = itemLabel(item);
            const detailUrl = item.material ? `/materials/${item.material.id}` : `/repository/${item.researchItem.id}`;
            return (
              <div className="rl-item-row" key={item.id}>
                <div className="rl-card-icon" style={{ width: 34, height: 34 }}><BookOpen size={16} /></div>
                <div>
                  <div className="rl-item-title">{label.title}</div>
                  <div className="rl-item-meta">{label.meta}</div>
                </div>
                <div className="rl-item-save">
                  <Link to={detailUrl} className="link-btn"><Eye size={13} /> View</Link>
                  {item.material && (
                    <button className="link-btn" onClick={() => setCiteItem(item.material)}><Quote size={13} /> Cite</button>
                  )}
                  <button className="link-btn" onClick={() => handleRemove(item.id)}><Trash2 size={13} /> Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {citeItem && <CitationModal material={citeItem} onClose={() => setCiteItem(null)} />}
    </div>
  );
}

function REPO_TYPE(t: string | null | undefined): string {
  const map: Record<string, string> = {
    final_year_project: 'Final Year Project',
    thesis: 'Thesis',
    dissertation: 'Dissertation',
    research_paper: 'Research Paper',
    journal_article: 'Journal Article',
    conference_paper: 'Conference Paper',
    technical_report: 'Technical Report',
    institutional_publication: 'Institutional Publication',
    dataset: 'Dataset',
    seminar_paper: 'Seminar Paper'
  };
  return map[t || ''] || 'Publication';
}