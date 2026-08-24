export const stockNonSellableReasonLabel = (
  reason: 'archived' | 'dlcExpired' | 'unsellablePackaging' | null,
): string => reason === 'archived'
  ? 'Article archivé'
  : reason === 'dlcExpired'
    ? 'DLC dépassée'
    : reason === 'unsellablePackaging'
      ? 'Packaging invendable'
      : '—';
