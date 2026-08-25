import type { Packaging } from '../domain/packaging';

export const packagingLabel = (packaging: Packaging | undefined): string =>
  packaging === 'new' ? 'Neuf'
    : packaging === 'refurbished' ? 'Reconditionné'
      : packaging === 'unsellable' ? 'Invendable' : '—';
