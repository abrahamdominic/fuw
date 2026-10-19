import React, { useState } from 'react';
import { X, Star, StarOff, Plus } from 'lucide-react';

const DEFAULT_STICKERS = [
  { id: '1', url: 'https://emojicdn.elk.sh/😊', name: 'smile', category: 'default' },
  { id: '2', url: 'https://emojicdn.elk.sh/❤️', name: 'heart', category: 'default' },
  { id: '3', url: 'https://emojicdn.elk.sh/👍', name: 'thumbsup', category: 'default' },
  { id: '4', url: 'https://emojicdn.elk.sh/😂', name: 'laugh', category: 'default' },
  { id: '5', url: 'https://emojicdn.elk.sh/🎉', name: 'party', category: 'default' },
  { id: '6', url: 'https://emojicdn.elk.sh/🔥', name: 'fire', category: 'default' },
  { id: '7', url: 'https://emojicdn.elk.sh/💯', name: 'hundred', category: 'default' },
  { id: '8', url: 'https://emojicdn.elk.sh/👏', name: 'clap', category: 'default' },
];

interface StickerPickerProps {
  onSelect: (sticker: { id: string; url: string; name: string }) => void;
  onClose?: () => void;
}

export function StickerPicker({ onSelect, onClose }: StickerPickerProps) {
  const [stickers, setStickers] = useState(DEFAULT_STICKERS);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('fuw_sticker_favorites') || '[]');
    } catch {
      return [];
    }
  });

  const toggleFavorite = (id: string) => {
    const newFavs = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id];
    setFavorites(newFavs);
    localStorage.setItem('fuw_sticker_favorites', JSON.stringify(newFavs));
  };

  const favoriteStickers = stickers.filter(s => favorites.includes(s.id));
  const otherStickers = stickers.filter(s => !favorites.includes(s.id));

  return (
    <div className="sticker-picker" style={{ position: 'relative', background: 'white', border: '1px solid #e1ece3', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', maxWidth: '320px', maxHeight: '280px', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
      {onClose && (
        <button onClick={onClose} style={{ position: 'absolute', top: '4px', right: '4px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', zIndex: 11 }}>
          <X size={16} />
        </button>
      )}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e1ece3', fontWeight: '600', fontSize: '14px' }}>
        Stickers
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {favoriteStickers.length > 0 && (
          <>
            <div style={{ fontSize: '11px', color: '#6b7c6b', marginBottom: '6px', textTransform: 'uppercase', fontWeight: '600' }}>Favorites</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {favoriteStickers.map(sticker => (
                <div key={sticker.id} style={{ position: 'relative' }}>
                  <button
                    onClick={() => onSelect(sticker)}
                    style={{ background: '#f4f8f5', border: '1px solid #e1ece3', borderRadius: '6px', padding: '6px', cursor: 'pointer', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <img src={sticker.url} alt={sticker.name} style={{ maxWidth: '32px', maxHeight: '32px', objectFit: 'contain' }} />
                  </button>
                  <button
                    onClick={() => toggleFavorite(sticker.id)}
                    style={{ position: 'absolute', top: '2px', right: '2px', background: 'white', border: '1px solid #e1ece3', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0' }}
                  >
                    <Star size={10} fill="#f59e0b" color="#f59e0b" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ fontSize: '11px', color: '#6b7c6b', marginBottom: '6px', textTransform: 'uppercase', fontWeight: '600' }}>All Stickers</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {otherStickers.map(sticker => (
            <div key={sticker.id} style={{ position: 'relative' }}>
              <button
                onClick={() => onSelect(sticker)}
                style={{ background: '#f4f8f5', border: '1px solid #e1ece3', borderRadius: '6px', padding: '6px', cursor: 'pointer', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img src={sticker.url} alt={sticker.name} style={{ maxWidth: '32px', maxHeight: '32px', objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </button>
              <button
                onClick={() => toggleFavorite(sticker.id)}
                style={{ position: 'absolute', top: '2px', right: '2px', background: 'white', border: '1px solid #e1ece3', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0' }}
              >
                <Star size={10} color="#9ca3af" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
