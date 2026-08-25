import { HttpErrorResponse } from '@angular/common/http';
import type { CatalogueProblem } from '../application/catalogue-problem';
import type { ProblemDetailsDto } from './dto/problem-details.dto';

export const mapProblemDetails = (error: unknown, fallback: string): CatalogueProblem => {
  const dto = error instanceof HttpErrorResponse && typeof error.error === 'object' && error.error !== null
    ? error.error as ProblemDetailsDto
    : {};
  return {
    code: dto.code,
    fieldErrors: dto.errors ?? {},
    title: dto.title ?? fallback,
  };
};
