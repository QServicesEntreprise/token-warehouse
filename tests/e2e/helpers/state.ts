/**
 * These helpers prepare state through the public HTTP contracts. A test must use
 * the UI, not a helper, for the journey step whose behaviour it observes.
 * Seed decision: build domain state here (option A); keep seeds only for existing
 * daily-flow time data so test fixtures do not grow in the production assembly.
 */
import { expect, type APIResponse, type Page } from '@playwright/test';
import type { Article } from '../../../src/web/features/catalogue/domain/article';
import type { Packaging } from '../../../src/web/features/catalogue/domain/packaging';
import type { ConsumptionMode } from '../../../src/web/shared-kernel/consumption-mode';
import type { InventoryReceiptDto } from '../../../src/web/features/stock/infrastructure/dto/inventory-receipt.dto';
import type { SaleResult } from '../../../src/web/features/sales/domain/sale-result';
import type { RecordBulkSupplyResponseDto } from '../../../src/web/features/stock/infrastructure/dto/record-bulk-supply-response.dto';
import type { RecordSupplyResponseDto } from '../../../src/web/features/stock/infrastructure/dto/record-supply-response.dto';
import { apiUrl as apiBaseUrl } from '../fixtures';
import { ean13ForAttempt } from './ean13';

export { apiBaseUrl };
const defaultFoodEan13 = ean13ForAttempt('111111111', 0);
const defaultNonFoodEan13 = ean13ForAttempt('222222222', 0);

const expectOkJson = async <T>(response: APIResponse): Promise<T> => {
  await expect(response).toBeOK();
  return response.json() as Promise<T>;
};

export const createFoodArticle = async (
  page: Page,
  options: {
    modes: ConsumptionMode[];
    dlc: string;
    priceHtCents: number;
    ean13?: string;
    name?: string;
  },
): Promise<Article> => {
  const ean13 = options.ean13 ?? defaultFoodEan13;
  return expectOkJson(await page.request.post(`${apiBaseUrl}/api/articles`, {
    data: {
      ean13,
      type: 'food',
      name: options.name ?? `Article alimentaire ${ean13}`,
      priceHtCents: options.priceHtCents,
      dlc: options.dlc,
      consumptionModes: options.modes,
    },
  }));
};

export const createNonFoodArticle = async (
  page: Page,
  options: {
    packaging: Packaging;
    priceHtCents: number;
    ean13?: string;
    name?: string;
  },
): Promise<Article> => {
  const ean13 = options.ean13 ?? defaultNonFoodEan13;
  return expectOkJson(await page.request.post(`${apiBaseUrl}/api/articles`, {
    data: {
      ean13,
      type: 'nonFood',
      name: options.name ?? `Article non alimentaire ${ean13}`,
      priceHtCents: options.priceHtCents,
      packaging: options.packaging,
    },
  }));
};

export const supply = async (page: Page, ean13: string, quantity: number): Promise<RecordSupplyResponseDto> =>
  expectOkJson(await page.request.post(`${apiBaseUrl}/api/supplies`, { data: { ean13, quantity } }));

export const supplyBulk = async (
  page: Page,
  lines: Array<{ ean13: string; quantity: number }>,
): Promise<RecordBulkSupplyResponseDto> => expectOkJson(await page.request.post(
  `${apiBaseUrl}/api/supplies/bulk`,
  { data: { lines } },
));

export const archive = async (page: Page, ean13: string): Promise<Article> =>
  expectOkJson(await page.request.post(`${apiBaseUrl}/api/articles/${encodeURIComponent(ean13)}/archive`));

export const reactivate = async (page: Page, ean13: string): Promise<Article> =>
  expectOkJson(await page.request.post(`${apiBaseUrl}/api/articles/${encodeURIComponent(ean13)}/reactivate`));

export const sell = async (
  page: Page,
  ean13: string,
  quantity: number,
  context?: ConsumptionMode,
): Promise<SaleResult> => expectOkJson(await page.request.post(`${apiBaseUrl}/api/sales`, {
  data: { ean13, quantity, ...(context === undefined ? {} : { context }) },
}));

export const inventory = async (
  page: Page,
  ean13: string,
  countedQuantity: number,
): Promise<InventoryReceiptDto> => expectOkJson(await page.request.post(
  `${apiBaseUrl}/api/inventories`,
  { data: { ean13, countedQuantity } },
));
