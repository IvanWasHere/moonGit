/**
 * `Result` is how the git layer reports failure. It does not throw.
 *
 * The PRD's hard requirement is that the app never surfaces an uncaught
 * exception, and git is a program whose *normal* behaviour includes failing:
 * a merge conflict, a rejected push, a dirty working tree. Modelling those as
 * exceptions means every call site is one forgotten `try` away from a crash
 * dialog. Modelling them as values means the compiler asks the question
 * instead — `if (!res.ok)` is unavoidable to reach `res.value`.
 *
 * Kept deliberately tiny. This is not a functional-programming library; it is
 * the two shapes the domain services in §5 return and nothing more.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Read a value where the failure case has a sensible default (empty list, zero count). */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Transform the success value, passing the error through untouched.
 *
 * This is the parser seam: a domain service runs a command, then maps raw
 * stdout into domain objects without re-checking the error case.
 */
export function mapOk<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}
