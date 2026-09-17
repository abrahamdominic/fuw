import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, Search, Download, GraduationCap, Shield, ChevronDown, ChevronUp,
  MessageSquare, Building2, Quote, FileWarning, BookmarkCheck, HelpCircle,
  Mail, Phone
} from 'lucide-react';
import { fetchHelpCatalog, HelpCatalog, HelpTopic, FaqItem, LibraryAnnouncement } from '../lib/helpCenter';
import { useToast } from '../components/Toast';
import { SEO } from '../components/SEO';

export function HelpPage() {
  const { toast } = useToast();
  const [catalog, setCatalog] = useState<HelpCatalog>({ topics: [], faqs: [], announcements: [] });
  const [loading, setLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchHelpCatalog();
        setCatalog(data);
      } catch (err: any) {
        toast(err.message || 'Could not load help content.', 'error');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return <div className="loading-spinner-row" style={{ padding: '3rem' }}>Loading help center…</div>;
  }

  const topics = catalog.topics;
  const faqs = catalog.faqs;
  const announcements = catalog.announcements;

  const serviceCards = [
    { icon: Search, title: 'Search the Library', to: '/library', desc: 'Find lecture notes, textbooks, past questions and research.' },
    { icon: Quote, title: 'Citation Help', to: '/help#citations', desc: 'Cite library resources in APA, MLA, Chicago, and IEEE.' },
    { icon: GraduationCap, title: 'Repository Guidelines', to: '/help#repository', desc: 'Submitting theses, projects and publications.' },
    { icon: FileWarning, title: 'Report a Problem', to: '/report-problem', desc: 'Tell us about a missing, broken or incorrect resource.' },
    { icon: Shield, title: 'Report Copyright Issue', to: '/report-copyright', desc: 'Submit a copyright or takedown request.' },
    { icon: MessageSquare, title: 'Contact the Library', to: '/student/messages', desc: 'Message library staff directly from your dashboard.' }
  ];

  return (
    <>
      <SEO
        title="Help & Library Services — FUW Digital Library"
        description="Get help using the FUW Digital Library: search guide, downloads, citations, repository submission, copyright policy, and frequently asked questions."
        path="/help"
      />
      <div className="help-hero">
        <h1><HelpCircle size={28} style={{ verticalAlign: -4 }} /> Help & Library Services</h1>
        <p>Everything you need to make the most of the FUW Digital Library and Institutional Repository.</p>
      </div>

      {announcements.length > 0 && (
        <div className="help-announcements">
          {announcements.map((a) => (
            <AnnouncementItem key={a.id} announcement={a} />
          ))}
        </div>
      )}

      <div className="section-head" style={{ padding: '0 1rem' }}>
        <div>
          <p className="kicker">EXPLORE</p>
          <h2>Library services</h2>
        </div>
      </div>
      <div className="help-services-row">
        {serviceCards.map((s) => (
          <div className="help-service-card" key={s.title}>
            <s.icon size={26} />
            <b>{s.title}</b>
            <p>{s.desc}</p>
            <Link to={s.to} className="secondary-btn">Open <ChevronUp size={13} style={{ transform: 'rotate(90deg)' }} /></Link>
          </div>
        ))}
      </div>

      <div className="section-head" style={{ padding: '0 1rem' }}>
        <div>
          <p className="kicker">GUIDES</p>
          <h2>Help topics</h2>
        </div>
      </div>
      <div className="help-grid">
        {topics.map((t) => (
          <HelpTopicCard key={t.id} topic={t} />
        ))}
      </div>

      <div className="section-head" style={{ padding: '0 1rem', marginTop: '0.5rem' }}>
        <div>
          <p className="kicker">FAQs</p>
          <h2>Frequently asked questions</h2>
        </div>
      </div>
      <div className="faq-section">
        {faqs.length === 0 && (
          <div className="empty-state-card">
            <HelpCircle size={36} />
            <b>No FAQs available</b>
            <span>Check back later for updates.</span>
          </div>
        )}
        {faqs.map((f) => (
          <FaqRow key={f.id} faq={f} open={openFaq === f.id} onToggle={() => setOpenFaq(openFaq === f.id ? null : f.id)} />
        ))}
      </div>

      <div className="help-services-row" style={{ maxWidth: 860, margin: '0 auto' }}>
        <div className="help-service-card">
          <Mail size={24} />
          <b>Email the Library</b>
          <p>library@fuw.edu.ng</p>
          <a href="mailto:library@fuw.edu.ng" className="secondary-btn">Send Email</a>
        </div>
        <div className="help-service-card">
          <Phone size={24} />
          <b>Visit the Library</b>
          <p>Federal University Wukari, Wukari, Taraba State</p>
        </div>
        <div className="help-service-card">
          <BookmarkCheck size={24} />
          <b>Reading Lists</b>
          <p>Save materials into personal study collections.</p>
          <Link to="/student/reading-lists" className="secondary-btn">My Lists</Link>
        </div>
      </div>
    </>
  );
}

function AnnouncementItem({ announcement }: { announcement: LibraryAnnouncement }) {
  return (
    <div className="help-announcement-card">
      <b>{announcement.title}</b>
      <span>{announcement.body}</span>
      <span style={{ display: 'block', marginTop: 4, fontSize: '0.72rem', opacity: 0.7 }}>
        {new Date(announcement.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
    </div>
  );
}

function HelpTopicCard({ topic }: { topic: HelpTopic }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="help-card">
      <h3>
        <BookOpen size={16} /> {topic.title}
      </h3>
      <p style={{ display: open ? 'block' : '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {topic.body}
      </p>
      <button className="link-btn" onClick={() => setOpen(!open)}>
        {open ? <>Show less <ChevronUp size={13} /></> : <>Read more <ChevronDown size={13} /></>}
      </button>
    </div>
  );
}

function FaqRow({ faq, open, onToggle }: { faq: FaqItem; open: boolean; onToggle: () => void }) {
  return (
    <div className="faq-item">
      <button className="faq-question" onClick={onToggle} aria-expanded={open}>
        {faq.question}
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && <div className="faq-answer">{faq.answer}</div>}
    </div>
  );
}

export function ReportProblemPage() {
  const { toast } = useToast();
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <div className="section-head">
        <div>
          <p className="kicker">FEEDBACK</p>
          <h2>Report a Problem</h2>
        </div>
      </div>
      <div className="help-card" style={{ padding: '1.4rem' }}>
        <p style={{ marginBottom: '0.8rem', lineHeight: 1.6 }}>
          Cannot find a material? Found an error in the catalogue? Facing a technical issue?
        </p>
        <p style={{ marginBottom: '1rem', lineHeight: 1.6 }}>
          The best way to reach the library team is through the <b>Messages</b> section on your dashboard.
          <Link to="/student/messages" className="link-btn" style={{ display: 'inline-block', marginLeft: 6 }}>Open Messages →</Link>
        </p>
        <div className="request-info-banner">
          <Mail size={14} /> You can also email the library directly at library@fuw.edu.ng
        </div>
      </div>
    </div>
  );
}

export function ReportCopyrightPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    complaintType: 'copyright',
    description: '',
    claimantName: '',
    claimantEmail: '',
    materialId: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) {
      toast('Please describe the concern.', 'error');
      return;
    }
    if (!window.confirm('Submit this report? The library team will review it.')) return;
    setSubmitting(true);
    import('../lib/copyrightReports').then(({ submitCopyrightReport }) =>
      submitCopyrightReport({
        materialId: form.materialId || null,
        complaintType: form.complaintType,
        description: form.description,
        claimantName: form.claimantName,
        claimantEmail: form.claimantEmail
      })
    ).then(() => {
      toast('Report submitted. The library will review it.', 'success');
      setForm({ complaintType: 'copyright', description: '', claimantName: '', claimantEmail: '', materialId: '' });
    }).catch((err: any) => {
      toast(err.message || 'Could not submit the report.', 'error');
    }).finally(() => setSubmitting(false));
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <div className="section-head">
        <div>
          <p className="kicker">POLICY</p>
          <h2>Report a Copyright Concern</h2>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="help-card" style={{ padding: '1.4rem', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-field">
          <label className="form-label">Concern Type *</label>
          <select className="form-input" value={form.complaintType} onChange={(e) => setForm({ ...form, complaintType: e.target.value })}>
            <option value="copyright">Copyright concern</option>
            <option value="incorrect_attribution">Incorrect attribution</option>
            <option value="unauthorized_upload">Unauthorized upload</option>
            <option value="sensitive_material">Sensitive material</option>
            <option value="incorrect_metadata">Incorrect metadata</option>
            <option value="other">Other concern</option>
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">Material ID (optional)</label>
          <input className="form-input" value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })} placeholder="Paste the material ID from the resource page if known" />
        </div>
        <div className="form-field">
          <label className="form-label">Description *</label>
          <textarea
            className="form-input form-textarea"
            rows={5}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            required
            placeholder="Describe the concern, including which resource it relates to and why you believe it should be reviewed."
          />
        </div>
        <div className="form-row-2col">
          <div className="form-field">
            <label className="form-label">Your Name</label>
            <input className="form-input" value={form.claimantName} onChange={(e) => setForm({ ...form, claimantName: e.target.value })} />
          </div>
          <div className="form-field">
            <label className="form-label">Your Email</label>
            <input className="form-input" type="email" value={form.claimantEmail} onChange={(e) => setForm({ ...form, claimantEmail: e.target.value })} />
          </div>
        </div>
        <button type="submit" className="primary submit-btn" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit Report'}
        </button>
        <div className="request-info-banner">
          <Shield size={14} /> Reports are reviewed by the library's moderation team. Decisions are recorded and, where appropriate, action is taken within a reasonable timeframe.
        </div>
      </form>
    </div>
  );
}