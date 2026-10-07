import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { Modal } from './Modal';
import { createReview } from '../lib/api';
import { useToast } from './Toast';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
  onSuccess: () => void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  onSuccess,
}) => {
  const { toast } = useToast();
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || body.trim().length < 5) {
      toast('Please write at least a few words about your experience', 'error');
      return;
    }

    setBusy(true);
    try {
      await createReview({
        order_id: orderId,
        rating,
        title: title.trim() || undefined,
        body: body.trim(),
      });
      toast('Thank you! Your verified review has been published.', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to submit review', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Review Order #${orderNumber}`}
      description="Help fellow FUW students by sharing your honest experience with this vendor."
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Star Rating Selector */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary, #17231d)' }}>
            Rating
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  color: (hoverRating || rating) >= star ? '#b45309' : '#d1d5db',
                  transform: (hoverRating || rating) >= star ? 'scale(1.15)' : 'scale(1)',
                  transition: 'transform 0.1s ease',
                }}
              >
                <Star size={28} fill={(hoverRating || rating) >= star ? '#b45309' : 'none'} />
              </button>
            ))}
            <span style={{ marginLeft: 8, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary, #55675b)' }}>
              {rating === 5 ? 'Excellent' : rating === 4 ? 'Very Good' : rating === 3 ? 'Average' : rating === 2 ? 'Poor' : 'Terrible'}
            </span>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary, #17231d)' }}>
            Review Title (optional)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Great meal, quick delivery to Hostel B"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border, #dcebe0)',
              background: 'var(--surface, #ffffff)',
              color: 'var(--text-primary, #17231d)',
              fontSize: 14,
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary, #17231d)' }}>
            Your feedback
          </label>
          <textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="How was the product or service quality? Was delivery on time? Would you recommend this vendor to other students?"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border, #dcebe0)',
              background: 'var(--surface, #ffffff)',
              color: 'var(--text-primary, #17231d)',
              fontSize: 14,
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '9px 16px',
              borderRadius: 8,
              border: '1px solid var(--border, #dcebe0)',
              background: 'var(--surface, #ffffff)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--green-800, #12603d)',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
