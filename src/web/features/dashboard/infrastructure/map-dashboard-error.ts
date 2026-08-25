import { HttpErrorResponse } from '@angular/common/http';
import { DashboardFailure } from '../application/dashboard-failure';
import type { DashboardFilter } from '../domain/dashboard-filter';

export function mapDashboardError(error: unknown): DashboardFailure {
  if (!(error instanceof HttpErrorResponse) || typeof error.error !== 'object' || error.error === null) {
    return new DashboardFailure('Le Dashboard ne peut pas être chargé. Réessayez.');
  }

  const problem = error.error as { title?: unknown; errors?: unknown };
  const fieldErrors: Partial<Record<keyof DashboardFilter, string>> = {};
  if (typeof problem.errors === 'object' && problem.errors !== null) {
    for (const [field, messages] of Object.entries(problem.errors)) {
      if (field !== 'from' && field !== 'to' && field !== 'type' && field !== 'mode' && field !== 'packaging') {
        continue;
      }
      fieldErrors[field] = Array.isArray(messages) && typeof messages[0] === 'string'
        ? messages[0]
        : 'Valeur invalide.';
    }
  }

  return new DashboardFailure(
    typeof problem.title === 'string' ? problem.title : 'Le Dashboard ne peut pas être chargé. Réessayez.',
    fieldErrors,
  );
}
