import type { CatalogueProblem } from './catalogue-problem';

export const toCatalogueProblem = (error: unknown, fallback: string): CatalogueProblem => {
  if (typeof error === 'object' && error !== null && 'title' in error) {
    const problem = error as Partial<CatalogueProblem>;
    return {
      code: problem.code,
      fieldErrors: problem.fieldErrors ?? {},
      title: typeof problem.title === 'string' ? problem.title : fallback,
    };
  }
  return { fieldErrors: {}, title: fallback };
};
