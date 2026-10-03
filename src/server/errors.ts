/** Errors that are safe to show to users. `code` is stable and translatable. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("validation", message, details);
  }
}

export class PermissionDenied extends DomainError {
  constructor(permission: string) {
    super("permission_denied", `Missing permission: ${permission}`, { permission });
  }
}

export class NotFound extends DomainError {
  constructor(entity: string, id: string) {
    super("not_found", `${entity} not found: ${id}`, { entity, id });
  }
}

export class Conflict extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("conflict", message, details);
  }
}

/** Raised when a database guard (trigger/check constraint) rejects a write. */
export class IntegrityError extends DomainError {
  constructor(message: string) {
    super("integrity", message);
  }
}

/** Translate Postgres errors (possibly wrapped by Drizzle) into domain errors. */
export function fromDbError(err: unknown): unknown {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const { code, message } = e as { code?: string; message?: string };
    if (code === "23514") return new IntegrityError(message ?? "integrity check failed");
    if (code === "23505") return new Conflict(message ?? "duplicate record");
    e = (e as { cause?: unknown }).cause;
  }
  return err;
}

/** The operation is valid but must be approved first; submit it as an approval request. */
export class ApprovalRequired extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("approval_required", message, details);
  }
}
