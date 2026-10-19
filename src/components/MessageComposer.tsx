import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2, Smile, Sticker } from 'lucide-react';
import { capLength, richPasteText, MESSAGE_MAX_LENGTH } from '../lib/messageFormat';
import { EmojiPicker } from './EmojiPicker';
import { StickerPicker } from './StickerPicker';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onTyping?: () => void;
  sending?: boolean;
  placeholder?: string;
  maxLength?: number;
}

export function MessageComposer({
  value,
  onChange,
  onSend,
  onTyping,
  sending = false,
  placeholder = 'Type a message…',
  maxLength = MESSAGE_MAX_LENGTH,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showSticker, setShowSticker] = useState(false);

  const autoGrow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoGrow();
  }, [value, autoGrow]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(capLength(value.slice(0, start) + emoji + value.slice(end), maxLength));
    setShowEmoji(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }, [value, onChange, maxLength]);

  const handleStickerSelect = useCallback((sticker: { id: string; url: string; name: string }) => {
    onChange(value + ' ' + sticker.url + ' ');
    setShowSticker(false);
  }, [value, onChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      onTyping?.();
    },
    [onChange, onTyping]
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
    <div className="chat-input-row" style={{ position: 'relative', flexDirection: 'column', alignItems: 'stretch' }}>
      {(showEmoji || showSticker) && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: '8px' }}>
          {showEmoji && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />}
          {showSticker && <StickerPicker onSelect={handleStickerSelect} onClose={() => setShowSticker(false)} />}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <button type="button" onClick={() => { setShowEmoji(!showEmoji); setShowSticker(false); }} style={{ background: 'none', border: '1px solid #e1ece3', borderRadius: '6px', padding: '6px', cursor: 'pointer' }}>
            <Smile size={18} />
          </button>
          <button type="button" onClick={() => { setShowSticker(!showSticker); setShowEmoji(false); }} style={{ background: 'none', border: '1px solid #e1ece3', borderRadius: '6px', padding: '6px', cursor: 'pointer' }}>
            <Sticker size={18} />
          </button>
        </div>
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
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={onSend} disabled={sending || !value.trim()}>
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
        </button>
      </div>
    </div>
  );
}
