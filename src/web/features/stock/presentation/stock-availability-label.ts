export const stockAvailabilityLabel = (
  availability: 'available' | 'outOfStock' | 'notSellable',
): string => availability === 'available'
  ? 'Disponible'
  : availability === 'outOfStock'
    ? 'Rupture'
    : 'Non vendable';
