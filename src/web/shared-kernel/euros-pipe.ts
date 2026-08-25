import { Pipe, type PipeTransform } from '@angular/core';
import { formatEuros } from './format-euros';

@Pipe({ name: 'euros' })
export class EurosPipe implements PipeTransform {
  transform(cents: number, signed = false): string {
    return formatEuros(cents, signed);
  }
}
