import React from 'react';
import { parseBlocks, parseInline, InlineNode, isSafeUrl } from '../lib/messageFormat';

function renderInlineNodes(nodes: InlineNode[], inlineLink = false): React.ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'bold':
        return <strong key={i}>{n.value}</strong>;
      case 'italic':
        return <em key={i}>{n.value}</em>;
      case 'underline':
        return <u key={i}>{n.value}</u>;
      case 'code':
        return (
          <code key={i} className="msg-inline-code">
            {n.value}
          </code>
        );
      case 'link': {
        // Only safe schemes become real anchors; anything else renders as
        // plain text (mirrors the mobile guard so both platforms agree).
        const safe = isSafeUrl(n.href);
        if (inlineLink || !safe) {
          return (
            <span key={i} className="msg-inline-link">
              {n.label}
            </span>
          );
        }
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {n.label}
          </a>
        );
      }
      default:
        return <React.Fragment key={i}>{n.value}</React.Fragment>;
    }
  });
}

/**
 * Render a paragraph text string into React nodes, preserving single-newline
 * soft breaks as <br /> elements and applying inline formatting.
 */
function renderParaText(text: string, inlineLink = false): React.ReactNode[] {
  return text.split('\n').map((line, i) => (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      {renderInlineNodes(parseInline(line), inlineLink)}
    </React.Fragment>
  ));
}

interface MessageTextProps {
  body: string;
  /** Render as phrasing content (spans + <br>) so it is valid inside a <button>. */
  inline?: boolean;
}

export function MessageText({ body, inline = false }: MessageTextProps) {
  if (!body) return null;
  const blocks = parseBlocks(body);

  if (inline) {
    // Inline variant: flatten everything into spans and <br>s.
    const inlineContent: React.ReactNode[] = [];
    blocks.forEach((block, bi) => {
      if (bi > 0) inlineContent.push(<br key={`sep-${bi}`} />);
      if (block.type === 'code') {
        inlineContent.push(
          <code key={bi} className="msg-inline-code msg-code-inline">
            {block.text}
          </code>
        );
      } else if (block.type === 'list') {
        block.items.forEach((it, j) => {
          if (j > 0) inlineContent.push(<br key={`${bi}-${j}-br`} />);
          inlineContent.push(
            <span key={`${bi}-${j}`}>
              {it.ordered ? `${j + 1}. ` : '• '}
              {renderInlineNodes(parseInline(it.text), true)}
            </span>
          );
        });
      } else if (block.type === 'quote') {
        inlineContent.push(
          <span key={bi} className="msg-quote-inline">
            “{renderParaText(block.text, true)}”
          </span>
        );
      } else {
        inlineContent.push(
          <span key={bi}>{renderParaText(block.text, true)}</span>
        );
      }
    });
    return <span className="msg-body msg-body-inline">{inlineContent}</span>;
  }

  // Block variant: proper semantic HTML for rich announcement/message display.
  const content = blocks.map((block, i) => {
    if (block.type === 'heading') {
      const Tag = `h${block.level}` as 'h2' | 'h3' | 'h4';
      return <Tag key={i} className="msg-heading">{renderInlineNodes(parseInline(block.text))}</Tag>;
    }
    if (block.type === 'quote') {
      return (
        <blockquote key={i} className="msg-quote">
          {renderParaText(block.text)}
        </blockquote>
      );
    }
    if (block.type === 'code') {
      return (
        <pre key={i} className="msg-code">
          <code>{block.text}</code>
        </pre>
      );
    }
    if (block.type === 'list') {
      const ordered = block.items.some((it) => it.ordered);
      const Tag = ordered ? 'ol' : 'ul';
      return (
        <Tag key={i} className="msg-list">
          {block.items.map((it, j) => (
            <li key={j}>{renderInlineNodes(parseInline(it.text))}</li>
          ))}
        </Tag>
      );
    }
    // Paragraph block — honour single-newline soft breaks.
    return (
      <p key={i} className="msg-para">
        {renderParaText(block.text)}
      </p>
    );
  });

  return <div className="msg-body">{content}</div>;
}

export default MessageText;
