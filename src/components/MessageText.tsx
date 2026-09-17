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

  const content = blocks.map((block, i) => {
    if (block.type === 'code') {
      return (
        <code key={i} className="msg-inline-code msg-code-inline">
          {block.text}
        </code>
      );
    }
    if (block.type === 'list') {
      return (
        <React.Fragment key={i}>
          {block.items.map((it, j) => (
            <React.Fragment key={j}>
              {j > 0 && <br />}
              {it.ordered ? `${j + 1}. ` : '• '}
              {renderInlineNodes(parseInline(it.text), inline)}
            </React.Fragment>
          ))}
        </React.Fragment>
      );
    }
    return <React.Fragment key={i}>{renderParaText(block.text, inline)}</React.Fragment>;
  });

  if (inline) {
    const inlineContent: React.ReactNode[] = [];
    content.forEach((node, i) => {
      inlineContent.push(node);
      if (i < content.length - 1) inlineContent.push(<br key={`sep-${i}`} />);
    });
    return <span className="msg-body msg-body-inline">{inlineContent}</span>;
  }
  return <div className="msg-body">{content}</div>;
}