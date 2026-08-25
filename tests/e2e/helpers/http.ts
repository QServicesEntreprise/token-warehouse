import { expect, type APIResponse, type Page, type Response } from '@playwright/test';

export const waitForRequest = (
  page: Page,
  method: string,
  pathname: string,
  matchesUrl?: (url: URL) => boolean,
): Promise<Response> => page.waitForResponse(async (response) => {
  const url = new URL(response.url());
  if (response.request().method() !== method
    || url.pathname !== pathname
    || (matchesUrl !== undefined && !matchesUrl(url))) {
    return false;
  }

  return await response.finished() === null;
});

export const expectProblemDetails = async (
  response: APIResponse | Response,
  expected: { status: number; code: string; fields?: readonly string[] },
): Promise<void> => {
  expect(response.status()).toBe(expected.status);
  expect(response.headers()['content-type']).toContain('application/problem+json');
  const problem = await response.json() as {
    code?: string;
    errors?: Record<string, string[]>;
  };
  expect(problem.code).toBe(expected.code);
  for (const field of expected.fields ?? []) {
    expect(problem.errors?.[field]).toEqual(expect.arrayContaining([expect.stringMatching(/\S+/)]));
  }
};
