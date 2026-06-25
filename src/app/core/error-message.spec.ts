import { formatError } from './error-message';
import { ApiError } from './api-client';

describe('formatError', () => {
  it('should return friendly message for ApiError', () => {
    const err = new ApiError('Not found', 404);
    expect(formatError(err)).toContain('Not found');
  });

  it('should return message for standard Error', () => {
    const err = new Error('Database connection failed');
    expect(formatError(err)).toBe('Database connection failed');
  });

  it('should return raw string when error is a string', () => {
    expect(formatError('Something went wrong')).toBe('Something went wrong');
  });

  it('should return fallback message for unknown error types', () => {
    expect(formatError({}, 'Custom fallback')).toBe('Custom fallback');
    expect(formatError(null)).toBe('Request failed');
  });
});
