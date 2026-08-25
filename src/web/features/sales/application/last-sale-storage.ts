export interface LastSaleStorage {
  load(): string | null;
  save(operationId: string): void;
}
