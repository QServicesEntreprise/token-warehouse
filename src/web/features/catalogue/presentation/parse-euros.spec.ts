import { describe, expect, it } from 'vitest';
import { parseEuros } from './parse-euros';

describe('parseEuros', () => {
  it('reads the comma and the point as the same decimal separator', () => {
    expect(parseEuros('12,50')).toBe(1250);
    expect(parseEuros('12.50')).toBe(1250);
  });

  it('completes a single decimal and accepts a whole amount', () => {
    expect(parseEuros('12,5')).toBe(1250);
    expect(parseEuros('12')).toBe(1200);
    expect(parseEuros('0,05')).toBe(5);
  });

  it('tolerates surrounding and grouping whitespace', () => {
    expect(parseEuros('  12,50 ')).toBe(1250);
    expect(parseEuros('12 50')).toBe(null);
  });

  it('keeps the sign of a negative amount', () => {
    expect(parseEuros('-0,50')).toBe(-50);
  });

  it('rejects what is not a euro amount', () => {
    for (const raw of ['', 'abc', '12,505', '12.5.0', '1 2', '12€']) expect(parseEuros(raw)).toBe(null);
  });
});
