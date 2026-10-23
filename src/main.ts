import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ENVIRONMENT, type Environment } from './shared/infrastructure/config/environment.js';
import { DomainExceptionFilter } from './shared/infrastructure/http/filters/domain-exception.filter.js';

/** Global prefix of every endpoint except `/health` and `/docs`. */
const API_PREFIX = 'api/platform/v1';

/** Loads `.env` when present (Node ≥ 20.12). Real environment variables take precedence. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: rely on the process environment (production).
  }
}

async function bootstrap() {
  loadDotEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const env = app.get<Environment>(ENVIRONMENT);
  // Behind superadmin-web's nginx: the login throttle must see the client IP, not the proxy's.
  app.set('trust proxy', env.trustProxy);

  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  app.use(helmet());
  app.enableCors({ origin: env.corsOrigins, credentials: false, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  if (env.nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Apreu Superadmin API')
      .setDescription(
        'Consola de la plataforma: autenticación de superadmin, gestión y aprovisionamiento de colegios, KPIs cross-tenant.',
      )
      .setVersion('2.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
  }

  await app.listen(env.port);
}
await bootstrap();
