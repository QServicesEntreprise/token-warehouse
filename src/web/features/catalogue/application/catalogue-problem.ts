export interface CatalogueProblem {
  code?: string;
  fieldErrors: Record<string, string[]>;
  title: string;
}
