import React, { useState, useEffect } from 'react';
import { Smile, X } from 'lucide-react';

const EMOJI_CATEGORIES = [
  { name: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'] },
  { name: 'People', emojis: ['👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'] },
  { name: 'Nature', emojis: ['🌻', '🌼', '🌸', '💐', '🌺', '🌹', '🥀', '🌷', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🌈', '🌞', '🌝', '🌚', '🌙', '⭐', '🌟', '✨', '⚡', '☄️', '💥', '🔥', '🌪️', '🌈', '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '🌊', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯'] },
  { name: 'Food', emojis: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🥞', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙', '🌮', '🌯', '🥗', '🥘', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '☕', '🍵', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊'] },
  { name: 'Objects', emojis: ['💻', '🖥️', '🖨️', '⌨️', '🖱️', '🖲️', '💾', '💿', '📀', '📱', '☎️', '📞', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏰', '⏳', '⌛', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '💎', '⚖️', '🪶', '✒️', '🖋️', '🖊️', '📝', '📁', '📂', '🗂️', '📅', '📆', '🗒️', '🗓️', '📈', '📉', '📊', '📋', '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🗃️', '🗄️', '🗑️', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️', '🔨', '🪓', '⛏️', '⚒️', '🛠️', '🗡️', '⚔️', '🔫', '🛡️', '🔧', '🔩', '⚙️', '🗜️', '⚖️', '🔗', '⛓️', '🧰'] },
  { name: 'Symbols', emojis: ['❤️', '💚', '💙', '💛', '🧡', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '✅', '✔️', '☑️', '🔘', '⚪', '⚫', '🔴', '🔵', '🟡', '🟢', '🟣', '🟤', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '🔘', '🔳', '🔲', '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇳🇬', '⭐', '🌟', '✨', '⚡', '☄️', '💥', '🔥', '💫', '🌙', '☀️', '🌤️', '⛅', '🌈', '☁️', '❄️', '⛄', '🌊', '💧', '💦', '☔', '⚡', '🔆', '🔅', '🌀', '🌪️', '🌈'] }
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose?: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState('');

  const filteredEmojis = search
    ? EMOJI_CATEGORIES.flatMap(c => c.emojis).filter(e => e.length > 0)
    : EMOJI_CATEGORIES[activeCategory].emojis;

  return (
    <div className="emoji-picker" style={{ position: 'relative', background: 'white', border: '1px solid #e1ece3', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', maxWidth: '320px', maxHeight: '280px', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
      {onClose && (
        <button onClick={onClose} style={{ position: 'absolute', top: '4px', right: '4px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', zIndex: 11 }}>
          <X size={16} />
        </button>
      )}
      <div style={{ padding: '8px', borderBottom: '1px solid #e1ece3' }}>
        <input
          type="text"
          placeholder="Search emojis..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', padding: '6px 8px', border: '1px solid #e1ece3', borderRadius: '6px', fontSize: '12px' }}
        />
      </div>
      {!search && (
        <div style={{ display: 'flex', borderBottom: '1px solid #e1ece3', overflowX: 'auto', padding: '4px' }}>
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={i}
              onClick={() => setActiveCategory(i)}
              style={{
                background: activeCategory === i ? '#e6f5ec' : 'none',
                border: 'none',
                padding: '4px 8px',
                cursor: 'pointer',
                borderRadius: '4px',
                fontSize: '16px',
                whiteSpace: 'nowrap'
              }}
            >
              {cat.emojis[0]}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignContent: 'flex-start' }}>
        {filteredEmojis.map((emoji, i) => (
          <button
            key={i}
            onClick={() => onSelect(emoji)}
            style={{
              background: 'none',
              border: 'none',
              padding: '6px',
              cursor: 'pointer',
              borderRadius: '4px',
              fontSize: '20px',
              lineHeight: '1'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f4f8f5')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
