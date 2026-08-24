export interface ProblemDetailsDto {
  code?: string;
  errors?: Record<string, string[]>;
  title?: string;
}
