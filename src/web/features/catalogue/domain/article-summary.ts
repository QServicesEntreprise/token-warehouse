import type { Article } from './article';

type WithoutStock<T> = T extends Article ? Omit<T, 'stock'> : never;

export type ArticleSummary = WithoutStock<Article>;
