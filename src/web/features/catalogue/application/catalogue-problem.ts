export interface CatalogueProblem {
  code?: string | undefined;
  fieldErrors: Record<string, string[]>;
  title: string;
}
