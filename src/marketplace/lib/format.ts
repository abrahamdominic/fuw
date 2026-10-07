export function formatNaira(koboOrNaira: number, isKobo: boolean = true): string {
  const naira = isKobo ? koboOrNaira / 100 : koboOrNaira;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: naira % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(naira).replace('NGN', '₦');
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-NG').format(num);
}

export function formatTimeAgo(isoString: string | null | undefined): string {
  // A conversation with no messages yet has no timestamp to compare against.
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '-';
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek}w ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCondition(condition?: string): string {
  switch (condition) {
    case 'new': return 'Brand New';
    case 'like_new': return 'Like New';
    case 'good': return 'Good Condition';
    case 'fair': return 'Fair / Used';
    case 'not_applicable': return 'Service';
    default: return condition || 'Standard';
  }
}

export function formatOrderStatus(status: string): { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' } {
  switch (status) {
    case 'pending_payment':
      return { label: 'Awaiting Payment', tone: 'warning' };
    case 'paid':
      return { label: 'Paid · Payment Protected', tone: 'info' };
    case 'order_confirmed':
      return { label: 'Order Confirmed', tone: 'info' };
    case 'preparing':
      return { label: 'Preparing / In Progress', tone: 'info' };
    case 'ready_for_delivery':
      return { label: 'Ready for Pickup / Delivery', tone: 'info' };
    case 'delivered':
      return { label: 'Delivered · Awaiting Confirmation', tone: 'warning' };
    case 'completed':
      return { label: 'Completed', tone: 'success' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'danger' };
    case 'disputed':
      return { label: 'In Dispute', tone: 'danger' };
    case 'refunded':
      return { label: 'Refunded', tone: 'neutral' };
    default:
      return { label: status.replace(/_/g, ' '), tone: 'neutral' };
  }
}
