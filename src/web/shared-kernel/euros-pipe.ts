import { Pipe, type PipeTransform } from '@angular/core';

const PLAIN = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const SIGNED = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });

@Pipe({ name: 'euros' })
export class EurosPipe implements PipeTransform {
  transform(cents: number, signed = false): string {
    return (signed ? SIGNED : PLAIN).format(cents / 100);
  }
}
