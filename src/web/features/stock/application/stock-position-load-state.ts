import { StockPosition } from '../domain/stock-position';

export type StockPositionLoadState =
  | { status: 'loading'; positions: readonly StockPosition[] }
  | { status: 'ready'; positions: readonly StockPosition[] }
  | { status: 'empty'; positions: readonly StockPosition[] }
  | { status: 'error'; positions: readonly StockPosition[]; message: string };
