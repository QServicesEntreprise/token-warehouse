import { Article } from './article';

type WithoutDetails<T> = T extends Article ? Omit<T, 'priceQuotes' | 'stock'> : never;

export type ArticleSummary = WithoutDetails<Article>;
