import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import {
  BusinessRuleViolationError,
  ConflictError,
  DomainError,
  ExternalServiceError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../domain/domain-error.js';

/** Uniform error body returned by the API. */
export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

const STATUS_BY_ERROR = new Map<abstract new (...args: never[]) => DomainError, HttpStatus>([
  [NotFoundError, HttpStatus.NOT_FOUND],
  [ConflictError, HttpStatus.CONFLICT],
  [BusinessRuleViolationError, HttpStatus.UNPROCESSABLE_ENTITY],
  [UnauthorizedError, HttpStatus.UNAUTHORIZED],
  [ForbiddenError, HttpStatus.FORBIDDEN],
  [ExternalServiceError, HttpStatus.BAD_GATEWAY],
]);

/**
 * Translates every error into {@link ErrorResponseBody}. Domain errors map to
 * their HTTP status; Nest `HttpException`s keep theirs; anything else is a 500
 * whose internals are logged but never leaked to the client.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    response.status(body.statusCode).json(body);
  }

  toBody(exception: unknown): ErrorResponseBody {
    if (exception instanceof DomainError) {
      const status = [...STATUS_BY_ERROR].find(([type]) => exception instanceof type)?.[1] ?? HttpStatus.BAD_REQUEST;
      return { statusCode: status, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      return {
        statusCode: status,
        code: status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : (HttpStatus[status] ?? 'HTTP_ERROR'),
        message: Array.isArray(message) ? 'Datos inválidos.' : message,
        details: Array.isArray(message) ? message : undefined,
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error inesperado. Intente de nuevo más tarde.',
    };
  }
}
