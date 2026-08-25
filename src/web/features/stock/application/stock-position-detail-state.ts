import type { StockPosition } from '../domain/stock-position';

export type StockPositionDetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; position: StockPosition }
  | { status: 'error'; message: string };
