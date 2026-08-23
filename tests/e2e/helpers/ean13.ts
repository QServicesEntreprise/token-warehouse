export const leadingZeroEan13 = '0123456789012';
export const invalidChecksumEan13 = '0123456789013';

export const ean13ForAttempt = (prefix: string, attempt: number): string => {
  const body = `${prefix}${String(attempt).padStart(3, '0')}`;
  const checksum = (10 - [...body].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  ) % 10) % 10;
  return `${body}${checksum}`;
};
