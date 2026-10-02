// Message body normalization, sanitization, and formatting.
//
// FUW E-Library messages are stored as plain text in a shared Supabase
// `messages.body` column. To keep every platform rendering identically we use a
// restrained "markdown-lite" internal format:
//
//   **bold**    __underline__   *italic*    `code`
//   [label](url)
//   - bullets / 1. numbered lists
//   paragraphs separated by blank lines, soft breaks via single newlines
//   ```  code fences (content kept verbatim)
//
// Anything pasted from another application (Word, Google Docs, web pages,
// WhatsApp, …) is sanitized and converted into this format before it is stored,
// so malicious or platform-specific markup never reaches the database. The same
// normalizer runs on both the web app and the mobile app.

export const MESSAGE_MAX_LENGTH = 2000;

/** Cap a string to a maximum number of Unicode code points (surrogate-safe). */
export function capLength(text: string, max: number): string {
  const arr = Array.from(text || '');
  return arr.length <= max ? text : arr.slice(0, max).join('');
}

/**
 * True when a URL is safe to turn into a clickable link. Only http(s), mailto
 * and tel are allowed; javascript:, data:, vbscript:, file: and whitespace
 * (URL-breaking / obfuscation) payloads are rejected.
 */
export function isSafeUrl(raw: string): boolean {
  const value = (raw || '').trim();
  if (!value || /[\s<>]/.test(value)) return false;
  const lower = value.toLowerCase();
  if (/^(https?|mailto|tel):/i.test(value)) return true;
  if (/^(?:javascript|data|vbscript|file):/.test(lower)) return false;
  // Protocol-less bare host, e.g. example.com/path
  return /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i.test(value);
}

const URL_TOKEN_RE = /(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?/gi;

/** Collapse runs of 2+ spaces on a prose line while preserving URLs. */
function normalizeLineSpaces(line: string): string {
  const tokens: string[] = [];
  const masked = line.replace(URL_TOKEN_RE, (m) => {
    tokens.push(m);
    return `\u0000${tokens.length - 1}\u0000`;
  });
  const collapsed = masked.replace(/ {2,}/g, ' ');
  return collapsed.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

/**
 * Collapse whitespace in prose but keep content where spacing is meaningful:
 * code fences, indented code, and URLs.
 */
function collapseProseSpaces(text: string): string {
  const lines = (text || '').split('\n');
  let inFence = false;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || /^( {4}|\t)/.test(line)) return line;
      return normalizeLineSpaces(line);
    })
    .join('\n');
}

/**
 * Normalize incoming text (from typing or a plain-text paste) into the
 * canonical message body format. Safe for normal user-typed text.
 */
export function normalizeMessageText(input: string): string {
  let text = (input || '').replace(/\r\n?/g, '\n');
  // Trim trailing spaces on each line.
  text = text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');
  // Never more than one blank line between paragraphs.
  text = text.replace(/\n{3,}/g, '\n\n');
  // Normalize inconsistent multi-space runs (prose only).
  text = collapseProseSpaces(text);
  // Trim leading/trailing blank lines but keep intended indentation (code).
  text = text.replace(/^[ \t]*\n+/, '');
  text = text.replace(/\n+$/, '');
  if (!/^( {4}|\t)/.test(text)) text = text.replace(/^ +/, '');
  return capLength(text, MESSAGE_MAX_LENGTH);
}

/** Final normalization applied just before a message is stored / sent. */
export function normalizeMessageBody(body: string): string {
  return normalizeMessageText(body || '');
}

/** Remove markdown markers so a body reads as clean plain text (previews). */
export function stripMessageMarkdown(body: string | null | undefined): string {
  if (!body) return '';
  return (body || '')
    .replace(/```/g, '\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)\n\s]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Produce a short, clean preview string for conversation/notification lists. */
export function messagePreview(body: string | null | undefined, maxLength = 60): string {
  const clean = stripMessageMarkdown(body || '');
  if (!clean) return '';
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
}

/* ── HTML paste sanitization & conversion (web only) ────────────────── */

const DANGEROUS_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'base', 'title', 'head', 'noscript', 'template',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button',
  'select', 'textarea', 'option', 'optgroup', 'video', 'audio', 'source', 'track',
  'svg', 'math', 'canvas', 'dialog', 'keygen', 'marquee',
]);

/** Strip every disallowed node and all attributes from a parsed HTML tree. */
function sanitizeHtmlTree(root: Element) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tag)) {
      if (el.parentNode) el.parentNode.removeChild(el);
      continue;
    }
    // Capture the only data we ever consume from anchors / lists before we
    // wipe every attribute (this is how CSS, event handlers, js: URLs die).
    if (tag === 'a') {
      const href = (el.getAttribute('href') || '').trim();
      if (href && isSafeUrl(href)) el.setAttribute('data-fuw-href', href);
    }
    if (tag === 'ol') {
      const startRaw = el.getAttribute('start');
      const n = startRaw ? parseInt(startRaw, 10) : 1;
      if (!Number.isNaN(n)) el.setAttribute('data-fuw-start', String(n));
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'data-fuw-href' || attr.name === 'data-fuw-start') continue;
      el.removeAttribute(attr.name);
    }
  }
}

function wrapEmphasis(marker: string, el: Element): string {
  const inner = nodeToMarkdown(el).trim();
  return inner ? `${marker}${inner}${marker}` : '';
}

function renderList(el: Element): string {
  const ordered = el.tagName.toLowerCase() === 'ol';
  let start = 1;
  if (ordered) {
    const s = el.getAttribute('data-fuw-start');
    if (s) start = parseInt(s, 10) || 1;
  }
  let idx = start;
  let out = '\n';
  for (const child of Array.from(el.children)) {
    if ((child.tagName || '').toLowerCase() !== 'li') continue;
    const prefix = ordered ? `${idx}. ` : '• ';
    idx += 1;
    const liText = nodeToMarkdown(child).trim().replace(/\n{2,}/g, '\n');
    out += prefix + liText + '\n';
  }
  return out + '\n';
}

function nodeToMarkdown(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    out += elementToMarkdown(child);
  });
  return out;
}

function elementToMarkdown(node: Node): string {
  if (node.nodeType === 8) return ''; // comment
  if (node.nodeType === 3) return node.nodeValue || ''; // text
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'br':
      return '\n';
    case 'b':
    case 'strong':
      return wrapEmphasis('**', el);
    case 'i':
    case 'em':
      return wrapEmphasis('*', el);
    case 'u':
    case 'ins':
      return wrapEmphasis('__', el);
    case 'a': {
      const label = nodeToMarkdown(el).trim();
      const href = el.getAttribute('data-fuw-href');
      return href && label ? `[${label}](${href})` : label;
    }
    case 'code':
      return `\`${(el.textContent || '').replace(/`/g, '')}\``;
    case 'pre':
      return `\n\`\`\`\n${(el.textContent || '').trim()}\n\`\`\`\n`;
    case 'ul':
    case 'ol':
      return renderList(el);
    case 'li':
      return `• ${nodeToMarkdown(el).trim().replace(/\n{2,}/g, '\n')}\n`;
    case 'p':
    case 'div':
    case 'section':
    case 'article':
    case 'header':
    case 'footer':
    case 'aside':
    case 'main':
    case 'nav':
    case 'blockquote':
    case 'figure':
    case 'figcaption':
    case 'address':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
    case 'table':
    case 'thead':
    case 'tbody':
    case 'tfoot':
    case 'caption':
    case 'tr':
    case 'td':
    case 'th':
    case 'dl':
    case 'dt':
    case 'dd':
    case 'hr':
      return `\n${nodeToMarkdown(el)}\n`;
    default:
      // span, font, small, … recurse keeping inner formatting.
      return nodeToMarkdown(el);
  }
}

function decodeEntities(text: string): string {
  const holder = document.createElement('textarea');
  holder.innerHTML = text;
  return holder.value;
}

/**
 * Convert untrusted pasted HTML into sanitized markdown-lite. Scripts, styles,
 * iframes, event handlers, images, inline CSS and every attribute but the
 * validated anchor href are discarded before any content is produced.
 */
export function htmlToMarkdown(html: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html || '', 'text/html');
  } catch {
    return normalizeMessageText(decodeEntities((html || '').replace(/<[^>]*>/g, '')));
  }
  sanitizeHtmlTree(doc.body);
  return normalizeMessageText(nodeToMarkdown(doc.body));
}

/**
 * Produce the text that should be inserted from a clipboard paste event.
 * Returns null when the clipboard holds nothing usable.
 */
export function richPasteText(html: string, plain: string): string | null {
  if (html && html.trim()) return htmlToMarkdown(html);
  if (plain) return normalizeMessageText(plain);
  return null;
}

/* ── Render-side parsing (shared by web + mobile renderers) ─────────── */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'underline'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string };

export type Block =
  | { type: 'code'; text: string }
  | { type: 'list'; items: { ordered: boolean; text: string }[] }
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'para'; text: string };

/** Split a message body into code / list / paragraph blocks. */
export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  (body || '').split(/```/).forEach((segment, si) => {
    if (si % 2 === 1) {
      const lines = segment.split('\n');
      const hasLangTag = lines.length > 1 && /^[a-z0-9+#.-]*$/i.test(lines[0].trim());
      blocks.push({
        type: 'code',
        text: (hasLangTag ? lines.slice(1) : lines).join('\n').replace(/\n$/, ''),
      });
      return;
    }
    segment.split(/\n{2,}/).forEach((rawPara) => {
      const para = rawPara.trim();
      if (!para) return;
      const lines = para.split('\n');
      const heading = lines.length === 1 ? /^(#{1,3})\s+(.+)$/.exec(para) : null;
      if (heading) {
        blocks.push({
          type: 'heading',
          level: (heading[1].length + 1) as 2 | 3 | 4,
          text: heading[2].trim()
        });
        return;
      }
      const markers = lines.map((l) => /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(l));
      if (markers.every(Boolean)) {
        blocks.push({
          type: 'list',
          items: markers.map((m) => ({
            ordered: /\d/.test(m![1]),
            text: (m![2] || '').trim(),
          })),
        });
      } else {
        blocks.push({ type: 'para', text: para });
      }
    });
  });
  return blocks;
}

/** Parse inline formatting tokens into a node tree. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*]+)\*|\[([^\]\n]+)\]\((\S+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined) nodes.push({ type: 'bold', value: m[1] });
    else if (m[2] !== undefined) nodes.push({ type: 'underline', value: m[2] });
    else if (m[3] !== undefined) nodes.push({ type: 'code', value: m[3] });
    else if (m[4] !== undefined) nodes.push({ type: 'italic', value: m[4] });
    else if (m[5] !== undefined) {
      const href = m[6];
      nodes.push(
        isSafeUrl(href)
          ? { type: 'link', label: m[5], href }
          : { type: 'text', value: `${m[5]}(${href})` }
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) });
  return nodes;
}