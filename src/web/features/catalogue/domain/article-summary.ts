import { Article } from './article';

export type ArticleSummary = Omit<Article, 'priceQuotes' | 'stock'>;
