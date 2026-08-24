import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { mapProblemDetails } from './map-problem-details';

describe('mapProblemDetails', () => {
  it('keeps server errors attached to their fields', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        title: 'Création refusée',
        code: 'INVALID_ARTICLE',
        errors: { ean13: ['Checksum invalide.'], priceHtCents: ['Prix invalide.'] },
      },
    });

    expect(mapProblemDetails(error, 'Échec')).toEqual({
      title: 'Création refusée',
      code: 'INVALID_ARTICLE',
      fieldErrors: { ean13: ['Checksum invalide.'], priceHtCents: ['Prix invalide.'] },
    });
  });
});
