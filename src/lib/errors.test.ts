import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  RateLimitedError,
  InternalError,
  toErrorResponse,
} from './errors.js';

describe('AppError base class', () => {
  it('stores code, message, statusCode, and details', () => {
    const err = new AppError('TEST_ERROR', 'something broke', 418, ['detail1']);
    expect(err.code).toBe('TEST_ERROR');
    expect(err.message).toBe('something broke');
    expect(err.statusCode).toBe(418);
    expect(err.details).toEqual(['detail1']);
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults details to empty array', () => {
    const err = new AppError('TEST', 'msg', 400);
    expect(err.details).toEqual([]);
  });
});

describe('ValidationError', () => {
  it('has code VALIDATION_ERROR and status 400', () => {
    const err = new ValidationError('bad input');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('bad input');
  });

  it('accepts details array', () => {
    const err = new ValidationError('bad input', ['field "name" is required']);
    expect(err.details).toEqual(['field "name" is required']);
  });
});

describe('NotFoundError', () => {
  it('has code NOT_FOUND and status 404', () => {
    const err = new NotFoundError('rule not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('rule not found');
  });
});

describe('ConflictError', () => {
  it('has code CONFLICT and status 409', () => {
    const err = new ConflictError('duplicate name');
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('duplicate name');
  });
});

describe('UnauthorizedError', () => {
  it('has code UNAUTHORIZED and status 401', () => {
    const err = new UnauthorizedError('invalid API key');
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('invalid API key');
  });
});

describe('RateLimitedError', () => {
  it('has code RATE_LIMITED and status 429', () => {
    const err = new RateLimitedError('too many requests');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.statusCode).toBe(429);
    expect(err.message).toBe('too many requests');
  });
});

describe('InternalError', () => {
  it('has code INTERNAL_ERROR and status 500', () => {
    const err = new InternalError('unexpected failure');
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('unexpected failure');
  });
});

describe('toErrorResponse', () => {
  it('formats AppError to standard response shape', () => {
    const err = new ValidationError('bad input', ['name is required', 'email is invalid']);
    const response = toErrorResponse(err);

    expect(response).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad input',
        details: ['name is required', 'email is invalid'],
      },
    });
  });

  it('formats unknown errors as INTERNAL_ERROR', () => {
    const err = new Error('something broke');
    const response = toErrorResponse(err);

    expect(response).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: [],
      },
    });
  });

  it('formats non-Error values as INTERNAL_ERROR', () => {
    const response = toErrorResponse('string error');

    expect(response).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: [],
      },
    });
  });
});
