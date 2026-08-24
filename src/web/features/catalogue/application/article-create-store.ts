import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Article } from '../domain/article';
import { ArticleCreateCommand } from './article-create-command';
import { CATALOGUE_GATEWAY } from './catalogue-gateway-token';
import { toCatalogueProblem } from './to-catalogue-problem';

@Injectable()
export class ArticleCreateStore {
  private readonly gateway = inject(CATALOGUE_GATEWAY);
  private readonly submittingSignal = signal(false);
  private readonly errorSignal = signal('');
  private readonly fieldErrorsSignal = signal<Record<string, string[]>>({});

  readonly submitting = this.submittingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly fieldErrors = this.fieldErrorsSignal.asReadonly();

  async create(command: ArticleCreateCommand): Promise<Article | null> {
    this.submittingSignal.set(true);
    this.errorSignal.set('');
    this.fieldErrorsSignal.set({});
    try {
      return await firstValueFrom(this.gateway.create(command));
    } catch (error) {
      const problem = toCatalogueProblem(error, 'La création a échoué.');
      this.errorSignal.set(problem.title);
      this.fieldErrorsSignal.set(problem.fieldErrors);
      return null;
    } finally {
      this.submittingSignal.set(false);
    }
  }
}
