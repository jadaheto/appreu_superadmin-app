/**
 * An application service implementing exactly one business use case.
 *
 * Use cases orchestrate domain objects and output ports; they never know
 * about HTTP, ORM or any framework detail (Single Responsibility + Dependency
 * Inversion principles).
 */
export interface UseCase<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}
