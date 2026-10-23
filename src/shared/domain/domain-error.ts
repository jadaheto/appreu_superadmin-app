/**
 * Base class for every error raised by the domain or application layers.
 *
 * Domain errors are transport-agnostic: they carry a stable machine-readable
 * `code` and a human readable message (in Spanish, as shown to end users).
 * The HTTP layer translates each subclass into a status code
 * (see `DomainExceptionFilter`).
 */
export abstract class DomainError extends Error {
  protected constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The requested resource does not exist (HTTP 404). */
export class NotFoundError extends DomainError {
  constructor(resource: string, id: string | number) {
    super(`${resource} con identificador "${id}" no encontrado.`, 'NOT_FOUND', { resource, id });
  }
}

/** The operation conflicts with existing state, e.g. a duplicated unique value (HTTP 409). */
export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', details);
  }
}

/** Input violates an invariant or business rule (HTTP 422). */
export class BusinessRuleViolationError extends DomainError {
  constructor(message: string, code = 'BUSINESS_RULE_VIOLATION', details?: Record<string, unknown>) {
    super(message, code, details);
  }
}

/** Credentials are missing or invalid (HTTP 401). */
export class UnauthorizedError extends DomainError {
  constructor(message = 'Credenciales inválidas.') {
    super(message, 'UNAUTHORIZED');
  }
}

/** The actor is authenticated but not allowed to perform the operation (HTTP 403). */
export class ForbiddenError extends DomainError {
  constructor(message = 'No tiene permisos para realizar esta acción.') {
    super(message, 'FORBIDDEN');
  }
}

/** An external system (DIAN, WhatsApp, SMTP, AI provider…) failed (HTTP 502). */
export class ExternalServiceError extends DomainError {
  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`Error en servicio externo ${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR', {
      service,
      ...details,
    });
  }
}
