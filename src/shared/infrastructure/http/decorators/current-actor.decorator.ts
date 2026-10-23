import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PlatformActor } from '../../../application/platform-actor.js';

export interface RequestWithActor {
  actor?: PlatformActor;
}

/** Injects the {@link PlatformActor} attached by `JwtAuthGuard`. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): PlatformActor => {
  const request = ctx.switchToHttp().getRequest<RequestWithActor>();
  if (!request.actor) throw new Error('CurrentActor usado en un endpoint público.');
  return request.actor;
});
