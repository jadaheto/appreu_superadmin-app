import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BusinessRuleViolationError,
  ConflictError,
  ExternalServiceError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../domain/domain-error.js';
import { DomainExceptionFilter } from './domain-exception.filter.js';

describe('DomainExceptionFilter', () => {
  const filter = new DomainExceptionFilter();

  it.each([
    [new NotFoundError('Estudiante', 3), 404, 'NOT_FOUND'],
    [new ConflictError('duplicado'), 409, 'CONFLICT'],
    [new BusinessRuleViolationError('regla', 'MY_RULE'), 422, 'MY_RULE'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new ExternalServiceError('DIAN', 'caído'), 502, 'EXTERNAL_SERVICE_ERROR'],
  ])('maps %s to HTTP %i', (error, status, code) => {
    expect(filter.toBody(error)).toMatchObject({ statusCode: status, code, message: error.message });
  });

  it('flattens class-validator messages', () => {
    const body = filter.toBody(new BadRequestException(['email must be an email']));
    expect(body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Datos inválidos.',
      details: ['email must be an email'],
    });
  });

  it('keeps the status of other HTTP exceptions', () => {
    expect(filter.toBody(new NotFoundException('Ruta'))).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('hides unexpected errors', () => {
    const body = filter.toBody(new Error('SQL syntax near password'));
    expect(body.statusCode).toBe(500);
    expect(body.message).not.toContain('SQL');
  });

  it('writes the response', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as any;
    filter.catch(new ForbiddenError(), host);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
