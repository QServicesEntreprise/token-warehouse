export interface LastInventoryStorage {
  load(): string | null;
  save(id: string): void;
}
