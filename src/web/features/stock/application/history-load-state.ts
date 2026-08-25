import { HistoryEntry } from '../domain/history-entry';

export type HistoryLoadState =
  | { status: 'idle'; entries: readonly HistoryEntry[] }
  | { status: 'loading'; entries: readonly HistoryEntry[] }
  | { status: 'ready'; entries: readonly HistoryEntry[] }
  | { status: 'empty'; entries: readonly HistoryEntry[] }
  | { status: 'error'; entries: readonly HistoryEntry[]; message: string };
