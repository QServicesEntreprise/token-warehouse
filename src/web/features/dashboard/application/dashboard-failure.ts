import { DashboardFilter } from '../domain/dashboard-filter';

export class DashboardFailure extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Partial<Record<keyof DashboardFilter, string>> = {},
  ) {
    super(message);
  }
}
