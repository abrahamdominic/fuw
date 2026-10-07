import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, Search, Download, GraduationCap, Shield, ChevronDown, ChevronUp,
  MessageSquare, Building2, Quote, FileWarning, BookmarkCheck, HelpCircle,
  Mail, Phone, BadgeCheck, Crown
} from 'lucide-react';
import { fetchHelpCatalog, HelpCatalog, HelpTopic, FaqItem, LibraryAnnouncement, ANNOUNCEMENT_TYPES } from '../lib/helpCenter';
import { useToast } from '../components/Toast';
import { ConfirmDialog, ConfirmDialogState } from '../components/ConfirmDialog';
import { SEO } from '../components/SEO';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { PUBLIC_ROUTES } from '../lib/seo/routes';
import { MessageText } from '../components/MessageText';

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
    { icon: MessageSquare, title: 'Contact the Library', to: '/student/messages', desc: 'Message library staff directly from your dashboard.' },
    { icon: BadgeCheck, title: 'Verification & Premium', to: '/help#access', desc: 'How academic verification and premium access work.' }
  ];

  return (
    <>
      <SEO path="/help" breadcrumbs={PUBLIC_ROUTES['/help'].breadcrumbs} />
      <Breadcrumbs trail={PUBLIC_ROUTES['/help'].breadcrumbs} />
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
          <p className="kicker">GETTING STARTED</p>
          <h2>How the library works</h2>
        </div>
      </div>
      <ol className="help-steps">
        {[
          {
            title: 'Create your account',
            desc: 'Register with your university details to access the library.'
          },
          {
            title: 'Verify your academic identity',
            desc: 'Submit your matric number, faculty, department and level. A library officer reviews it (this is not email verification).'
          },
          {
            title: 'Browse everything',
            desc: 'Search, preview and read titles, past questions and repository publications. Browsing is always free.'
          },
          {
            title: 'Get premium access',
            desc: 'Downloads and full-text reading need a verified identity plus an active plan, which a library officer activates for you. Nothing is charged automatically.'
          },
          {
            title: 'Get help',
            desc: 'Contact the library if a submission is rejected, a plan is missing, or a resource is broken.'
          }
        ].map((step) => (
          <li className="help-step" key={step.title}>
            <span className="help-step-num" aria-hidden="true" />
            <div className="help-step-text">
              <b>{step.title}</b>
              <p>{step.desc}</p>
            </div>
          </li>
        ))}
      </ol>

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
          <p className="kicker">ACCESS</p>
          <h2>Verification and premium access</h2>
        </div>
      </div>
      <div className="help-access" id="access">
        <div className="help-access-card">
          <BadgeCheck size={24} />
          <b>1. Academic verification</b>
          <p>
            Verification confirms you are a registered FUW student. You submit your matric number,
            faculty, department and level with one supporting document; a library officer approves or
            rejects it with a reason. Email confirmation is a separate thing and does not count.
          </p>
        </div>
        <div className="help-access-card">
          <Crown size={24} />
          <b>2. An active plan</b>
          <p>
            Plans are activated by a library officer after you have been verified: there is no
            online payment and no auto-renewal. Ask at the library office or message staff.
          </p>
        </div>
        <div className="help-access-card">
          <Shield size={24} />
          <b>What stays free</b>
          <p>
            Browsing the catalogue, abstracts, previews, study tools, reading lists, citations and the
            AI study assistant are open to everyone. Only the document files need premium.
          </p>
        </div>
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
  const typeLabel = ANNOUNCEMENT_TYPES.find((t) => t.value === announcement.announcement_type)?.label ?? 'General';
  const sender = announcement.sender_name?.trim();
  const date = new Date(announcement.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <article className={`help-announcement-card type-${announcement.announcement_type || 'general'}`}>
      <div className="announcement-card-head">
        <span className="announcement-type-tag">{typeLabel}</span>
      </div>
      <h3 className="announcement-title">{announcement.title}</h3>
      <div className="announcement-card-body">
        <MessageText body={announcement.body} />
      </div>
      <div className="announcement-meta">
        {sender && <span>By {sender}</span>}
        <span>{date}</span>
      </div>
    </article>
  );
}

function HelpTopicCard({ topic }: { topic: HelpTopic }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="help-card">
      <h3>
        <BookOpen size={16} /> {topic.title}
      </h3>
      <div className={open ? 'help-topic-body open' : 'help-topic-body'} style={!open ? { WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', display: '-webkit-box' } : undefined}>
        <HelpBody content={topic.body} />
      </div>
      <button className="link-btn" onClick={() => setOpen(!open)}>
        {open ? <>Show less <ChevronUp size={13} /></> : <>Read more <ChevronDown size={13} /></>}
      </button>
    </div>
  );
}

/** Inline emphasis for help copy: **bold** and *italic* become real text. */
function helpInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      match[1] !== undefined ? <strong key={key++}>{match[1]}</strong> : <em key={key++}>{match[2]}</em>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? <>{parts}</> : text;
}

/** Render help-topic bodies (paragraphs, bullet/numbered lists). */
function HelpBody({ content }: { content: string }) {
  const paragraphs = content.split(/\n{2,}/).map((raw) => raw.trim()).filter(Boolean);
  return (
    <>
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n');
        const isBulletList = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const isNumberedList = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (isBulletList || isNumberedList) {
          return (
            <ul className="chat-list" key={pi}>
              {lines.map((l, li) => (
                <li key={li}>{helpInline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={pi}>{helpInline(para)}</p>;
      })}
    </>
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
      <SEO
        title="Report a problem with a material"
        description="Report a missing, incorrect or broken academic material to the FUW E-Library team."
        path="/report-problem"
        noindex
      />
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
  const [confirm, setConfirm] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
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
    setConfirm({
      open: true,
      title: 'Submit copyright report?',
      message: 'The library team will review the information in this report.',
      confirmLabel: 'Submit report',
      onConfirm: async () => {
        setSubmitting(true);
        try {
          const { submitCopyrightReport } = await import('../lib/copyrightReports');
          await submitCopyrightReport({
            materialId: form.materialId || null,
            complaintType: form.complaintType,
            description: form.description,
            claimantName: form.claimantName,
            claimantEmail: form.claimantEmail
          });
          toast('Report submitted. The library will review it.', 'success');
          setForm({ complaintType: 'copyright', description: '', claimantName: '', claimantEmail: '', materialId: '' });
        } catch (err: any) {
          toast(err.message || 'Could not submit the report.', 'error');
        } finally {
          setSubmitting(false);
        }
      }
    });
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <SEO
        title="Report a copyright concern"
        description="Submit a copyright or takedown concern about material published in the FUW E-Library."
        path="/report-copyright"
        noindex
      />
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
      <ConfirmDialog {...confirm} onClose={() => setConfirm((c) => ({ ...c, open: false }))} />
    </div>
  );
}