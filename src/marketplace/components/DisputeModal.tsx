import React, { useState } from 'react';
import { Modal } from './Modal';
import { openDispute } from '../lib/api';
import { useToast } from './Toast';
import type { DisputeReason } from '../lib/types';
import { AlertTriangle } from 'lucide-react';

interface DisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
  onSuccess: () => void;
}

export const DisputeModal: React.FC<DisputeModalProps> = ({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  onSuccess,
}) => {
  const { toast } = useToast();
  const [reason, setReason] = useState<DisputeReason>('item_not_received');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || description.trim().length < 15) {
      toast('Please provide a detailed explanation (at least 15 characters)', 'error');
      return;
    }

    setBusy(true);
    try {
      await openDispute(orderId, reason, description.trim());
      toast('Dispute submitted successfully. Marketplace staff will investigate.', 'success');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast(err.message || 'Failed to open dispute', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Open Dispute for Order #${orderNumber}`}
      description="If there was an issue with this order, our student protection team will hold vendor payout while investigating."
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 13 }}>
          <AlertTriangle size={20} style={{ flexShrink: 0 }} />
          <span>Vendor funds are held protected while this dispute is investigated.</span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary, #17231d)' }}>
            Reason for dispute
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as DisputeReason)}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border, #dcebe0)',
              background: 'var(--surface, #ffffff)',
              color: 'var(--text-primary, #17231d)',
              fontSize: 14,
            }}
          >
            <option value="item_not_received">Item not received</option>
            <option value="wrong_item">Received wrong item</option>
            <option value="damaged_item">Item damaged / defective</option>
            <option value="not_as_described">Significantly different from listing</option>
            <option value="order_issue">Fulfilment / delivery issue</option>
            <option value="payment_issue">Payment or pricing issue</option>
            <option value="vendor_issue">Vendor uncooperative or unreachable</option>
            <option value="other">Other problem</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary, #17231d)' }}>
            Describe the problem in detail
          </label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explain clearly what happened, dates, communication with vendor, and your expected resolution..."
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
              background: '#b91c1c',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Submitting...' : 'Open Dispute'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
