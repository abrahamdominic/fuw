import React, { useCallback, useEffect, useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { capLength, richPasteText, MESSAGE_MAX_LENGTH } from '../lib/messageFormat';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  placeholder?: string;
  maxLength?: number;
}

export function MessageComposer({
  value,
  onChange,
  onSend,
  sending = false,
  placeholder = 'Type a message…',
  maxLength = MESSAGE_MAX_LENGTH,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoGrow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoGrow();
  }, [value, autoGrow]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const inserted = richPasteText(
        e.clipboardData.getData('text/html'),
        e.clipboardData.getData('text/plain')
      );
      if (inserted === null) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      onChange(capLength(value.slice(0, start) + inserted + value.slice(end), maxLength));
      const pos = Math.min(start + inserted.length, maxLength);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [value, onChange, maxLength]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (value.trim()) onSend();
      }
    },
    [value, onSend]
  );

  return (
    <div className="chat-input-row">
      <textarea
        ref={ref}
        className="msg-composer"
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={sending}
        rows={1}
        maxLength={maxLength}
        aria-label="Message"
      />
      <button className="primary" onClick={onSend} disabled={sending || !value.trim()}>
        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
      </button>
    </div>
  );
}