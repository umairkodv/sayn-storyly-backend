import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import ws from 'ws';
import * as bodyParser from 'body-parser';

// Polyfill WebSocket
if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = ws;
}

async function bootstrap() {
  // IMPORTANT:
  // Disable Nest default body parser
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  // Stripe webhook route MUST use raw body
  app.use(
    '/billing/webhook',
    bodyParser.raw({ type: '*/*' }),
  );

  // Normal JSON parser for all OTHER routes
  app.use(bodyParser.json());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global ThrottlerGuard is registered as APP_GUARD in app.module.ts
  // so it is injected properly by NestJS DI with all required dependencies.

  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    credentials: true,
  });

  await app.listen(process.env.PORT || 4000);
}

bootstrap();