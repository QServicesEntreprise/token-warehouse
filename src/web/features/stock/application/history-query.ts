export type HistoryQuery =
  | { scope: 'global' }
  | { scope: 'article'; ean13: string };
