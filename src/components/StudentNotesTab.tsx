// StudentNotesTab — personal study notes (table: student_notes).
import React, { useCallback, useEffect, useState } from 'react';
import { StickyNote, Plus, Trash2, Pencil, X, Pin, Search, CalendarDays } from 'lucide-react';
import {
  fetchStudentNotes,
  createStudentNote,
  updateStudentNote,
  deleteStudentNote,
  type StudentNote,
  type StudentNoteInput
} from '../lib/notes';
import { useToast } from './Toast';

const NOTE_COLORS = ['#fffaf0', '#f0f9ff', '#f5f3ff', '#fef2f2', '#f0fdf4', '#ffffff'];

const EMPTY_FORM: StudentNoteInput = { title: '', content: '', color: '#fffaf0' };

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function StudentNotesTab() {
  const { toast } = useToast();
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StudentNoteInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const items = await fetchStudentNotes();
    setNotes(items);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (note: StudentNote) => {
    setEditingId(note.id);
    setForm({
      title: note.title,
      content: note.content,
      color: note.color || '#ffffff',
      materialId: note.materialId
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.content.trim()) {
      toast('Please write something before saving the note.', 'error');
      return;
    }
    setSaving(true);
    const payload: StudentNoteInput = {
      ...form,
      title: form.title.trim() || 'Untitled note',
      content: form.content
    };
    if (editingId) {
      const ok = await updateStudentNote(editingId, payload);
      if (ok) toast('Note updated.', 'success');
      else toast('Could not save the note. Please try again.', 'error');
    } else {
      const created = await createStudentNote(payload);
      if (created) toast('Note saved.', 'success');
      else toast('Could not save the note. Please try again.', 'error');
    }
    setSaving(false);
    setShowForm(false);
    await load();
  };

  const handleDelete = async (id: string) => {
    const ok = await deleteStudentNote(id);
    if (ok) {
      setNotes((cur) => cur.filter((n) => n.id !== id));
      toast('Note deleted.', 'info');
    } else {
      toast('Could not delete the note. Please try again.', 'error');
    }
  };

  const handleTogglePin = async (note: StudentNote) => {
    setNotes((cur) => cur.map((n) => (n.id === note.id ? { ...n, isPinned: !n.isPinned } : n)));
    const ok = await updateStudentNote(note.id, { isPinned: !note.isPinned });
    if (!ok) setNotes((cur) => cur.map((n) => (n.id === note.id ? { ...n, isPinned: note.isPinned } : n)));
  };

  const q = search.trim().toLowerCase();
  const visible = notes.filter(
    (n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  );

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">PERSONAL NOTES</p>
          <h1>My study notes</h1>
          <p className="subtitle">Capture key points from your reading and exams.</p>
        </div>
        {!showForm && (
          <button type="button" className="primary" onClick={openCreate}>
            <Plus size={16} />
            <span>New note</span>
          </button>
        )}
      </div>

      <div className="notes-toolbar">
        <div className="notes-search">
          <Search size={15} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        <span className="notes-count">
          {notes.length} note{notes.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <div className="portal-empty">Loading your notes…</div>
      ) : !showForm && notes.length === 0 ? (
        <div className="portal-empty">
          <StickyNote size={34} className="empty-icon" />
          <p>You have not written any notes yet.</p>
          <button type="button" className="secondary-btn" onClick={openCreate}>
            <Plus size={15} /> Write your first note
          </button>
        </div>
      ) : null}

      {showForm && (
        <form className="notes-form" onSubmit={handleSubmit}>
          <div className="notes-form-head">
            <h3>{editingId ? 'Edit note' : 'New note'}</h3>
            <div className="notes-form-head-right">
              <div className="notes-color-row">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`notes-color-swatch ${form.color === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    aria-label={`Note colour ${c}`}
                  />
                ))}
              </div>
              <button
                type="button"
                className="planner-form-close"
                onClick={() => setShowForm(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <input
            className="notes-title-input"
            type="text"
            value={form.title ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Note title"
            maxLength={120}
            autoFocus
          />
          <textarea
            className="notes-content-input"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="Write your notes here…"
            rows={6}
            maxLength={8000}
          />
          <div className="planner-form-actions">
            <button type="button" className="secondary-btn" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save note'}
            </button>
          </div>
        </form>
      )}

      {visible.length > 0 ? (
        <div className="notes-grid">
          {visible.map((note) => (
            <div
              key={note.id}
              className="notes-card"
              style={{ backgroundColor: note.color || '#ffffff' }}
            >
              <div className="notes-card-head">
                <b>{note.title}</b>
                <div className="notes-card-actions">
                  <button
                    type="button"
                    className={`notes-card-btn ${note.isPinned ? 'pinned' : ''}`}
                    onClick={() => handleTogglePin(note)}
                    aria-label={note.isPinned ? 'Unpin note' : 'Pin note'}
                    title={note.isPinned ? 'Pinned' : 'Pin'}
                  >
                    <Pin size={14} />
                  </button>
                  <button type="button" className="notes-card-btn" onClick={() => openEdit(note)} aria-label="Edit note">
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="notes-card-btn danger"
                    onClick={() => handleDelete(note.id)}
                    aria-label="Delete note"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="notes-card-body">{note.content}</p>
              <div className="notes-card-foot">
                <span className="notes-date">
                  <CalendarDays size={11} /> {formatWhen(note.updatedAt)}
                </span>
                {note.isPinned && <span className="notes-pinned-label">Pinned</span>}
              </div>
            </div>
          ))}
        </div>
      ) : notes.length > 0 && !loading ? (
        <div className="portal-empty">
          <p>No notes match “{search}”.</p>
        </div>
      ) : null}
    </div>
  );
}