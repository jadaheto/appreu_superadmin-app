import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks an endpoint as accessible without a JWT (login, health checks). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
