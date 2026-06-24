import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { CollabGateway } from './collab/collab.gateway.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })
  );
  app.setGlobalPrefix('api', { exclude: ['collab'] });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // Attach the collab websocket onto the same http server.
  const collab = app.get(CollabGateway);
  collab.attach(app.getHttpServer());

  console.log(`[server] listening on http://localhost:${port}`);
  console.log(`[server] collab ws on    ws://localhost:${port}/collab`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
