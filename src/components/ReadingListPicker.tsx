import React, { useState, useEffect } from 'react';
import { X, Plus, Bookmark, Loader2, Check } from 'lucide-react';
import {
  fetchMyReadingLists,
  createReadingList,
  addMaterialToReadingList,
  addResearchToReadingList,
  ReadingList
} from '../lib/readingLists';
import { useToast } from './Toast';
import { AnimatedModal } from './animations/AnimatedModal';

interface ReadingListPickerProps {
  materialId?: string | null;
  researchItemId?: string | null;
  resourceTitle?: string;
  onClose: () => void;
}

export function ReadingListPicker({ materialId, researchItemId, resourceTitle, onClose }: ReadingListPickerProps) {
  const { toast } = useToast();
  const [lists, setLists] = useState<ReadingList[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedListId, setSavedListId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setLists(await fetchMyReadingLists());
      } catch (err: any) {
        toast(err.message || 'Could not load your reading lists.', 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async (list: ReadingList) => {
    setSaving(list.id);
    try {
      const added = materialId
        ? await addMaterialToReadingList(list.id, materialId)
        : await addResearchToReadingList(list.id, researchItemId!);
      if (added) {
        toast(`Added to "${list.name}".`, 'success');
      } else {
        toast('Already in this reading list.', 'info');
      }
      setSavedListId(list.id);
      setTimeout(onClose, 700);
    } catch (err: any) {
      toast(err.message || 'Could not add to the reading list.', 'error');
    } finally {
      setSaving(null);
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving('new');
    try {
      const list = await createReadingList({ name: newName });
      const added = materialId
        ? await addMaterialToReadingList(list.id, materialId)
        : await addResearchToReadingList(list.id, researchItemId!);
      toast(added ? `Created "${list.name}" and added the item.` : `Created "${list.name}".`, 'success');
      onClose();
    } catch (err: any) {
      toast(err.message || 'Could not create the reading list.', 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <AnimatedModal
      open
      onClose={onClose}
      dialogStyle={{ maxWidth: 460 }}
    >
      <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Bookmark size={18} /> Save to Reading List</h3>
          <button className="link-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">
          {resourceTitle && <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.8rem' }}>{resourceTitle}</p>}

          {loading ? (
            <div className="loading-spinner-row"><Loader2 size={16} className="animate-spin" /> Loading lists…</div>
          ) : (
            <>
              {lists.length === 0 && !showCreate && (
                <div style={{ textAlign: 'center', padding: '0.5rem 0 1rem', color: 'var(--muted)', fontSize: '0.86rem' }}>
                  You don't have any reading lists yet.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {lists.map((list) => (
                  <button
                    key={list.id}
                    className="secondary-btn"
                    style={{ justifyContent: 'space-between', display: 'flex', width: '100%', padding: '0.65rem 0.9rem', textAlign: 'left' }}
                    onClick={() => handleAdd(list)}
                    disabled={!!saving}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Bookmark size={14} /> {list.name}
                    </span>
                    {saving === list.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : savedListId === list.id ? (
                      <Check size={14} color="#0B6B3A" />
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{list.item_count || 0} items</span>
                    )}
                  </button>
                ))}
              </div>

              {showCreate ? (
                <form onSubmit={handleCreateAndAdd} style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem' }}>
                  <input
                    className="form-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New list name"
                    autoFocus
                    required
                  />
                  <button type="submit" className="primary" disabled={saving === 'new' || !newName.trim()}>
                    {saving === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  </button>
                </form>
              ) : (
                <button className="link-btn" style={{ marginTop: '0.9rem' }} onClick={() => setShowCreate(true)}>
                  <Plus size={14} /> Create a new list
                </button>
              )}
            </>
          )}
        </div>
    </AnimatedModal>
  );
}