import 'reflect-metadata';
import {
  Body,
  All,
  Controller,
  Get,
  Inject,
  Module,
  Post,
  Req,
  Res,
  type INestApplication,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AllowAnonymous, AuthModule } from '@thallesp/nestjs-better-auth';
import express, { type Request, type Response } from 'express';
import {
  loadFoundationConfig,
  ProductApplication,
  type FoundationConfig,
} from '@devworkspace/server';
import { createExperimentDatabase, type ExperimentDatabase } from '@devworkspace/database';
import { createExperimentAuth, type ExperimentAuth } from './experiment/auth.js';
import { ExperimentGateway } from './experiment/gateway.js';
import { CommunicationsGateway } from './communications-gateway.js';
import { randomUUID } from 'node:crypto';
interface Context {
  config: FoundationConfig;
  database: ExperimentDatabase | null;
  auth: ExperimentAuth | null;
  product: ProductApplication | null;
}
@Controller()
@AllowAnonymous()
class ProductController {
  constructor(@Inject('PRODUCT_APPLICATION') private readonly product: ProductApplication) {}
  @All([
    'identity/*path',
    'me',
    'me/*path',
    'organizations',
    'organizations/*path',
    'invitations/*path',
  ])
  async dispatch(@Req() request: Request, @Res() response: Response) {
    const result = await this.product.handle({
      method: request.method,
      path: request.originalUrl,
      body: request.body,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value[0] : value,
        ]),
      ),
      ip: request.socket.remoteAddress ?? 'unknown',
    });
    if (result.cookies?.length) response.setHeader('Set-Cookie', result.cookies);
    for (const [key, value] of Object.entries(result.headers ?? {})) response.setHeader(key, value);
    response.status(result.status).send(result.body);
  }
}
@Controller('health')
@AllowAnonymous()
class HealthController {
  constructor(@Inject('PHASE_1_CONTEXT') private readonly context: Context) {}
  @Get('live') live() {
    return {
      status: 'ok',
      service: 'api',
      phase: this.context.product ? 6 : 1,
    };
  }
  @Get('ready') async ready(@Res({ passthrough: true }) response: Response) {
    if (this.context.product) {
      try {
        await this.context.product.organizations.database.pool.query('SELECT 1');
        await this.context.product.identity.database.$queryRaw`SELECT 1`;
        return {
          status: 'ready',
          mode: 'phase6-notifications',
          postgres: 'restricted-runtime-connected',
          redis: 'hint-transport-not-probed',
          storage: this.context.product.files
            ? 'private-adapter-configured-not-probed'
            : 'phase4-gate',
        };
      } catch {
        response.status(503);
        return { status: 'not-ready', postgres: 'unavailable' };
      }
    }
    let postgres = 'not-required-in-foundation-mode';
    if (this.context.database) {
      try {
        await this.context.database.$queryRaw`SELECT 1`;
        postgres = 'connected';
      } catch {
        response.status(503);
        return { status: 'not-ready', postgres: 'unavailable' };
      }
    }
    return {
      status: 'ready',
      mode: this.context.auth ? 'isolated-auth-experiment' : 'foundation',
      postgres,
      redis: 'not-checked',
      storage: 'not-checked',
    };
  }
}
@Controller('experiment')
class ExperimentController {
  constructor(@Inject('PHASE_1_CONTEXT') private readonly context: Context) {}
  @Post('echo') @AllowAnonymous() echo(@Body() body: unknown) {
    return { received: body };
  }
  @Get('session') async session(@Req() request: Request) {
    const result = await this.context.auth!.api.getSession({
      headers: new Headers({ cookie: request.headers.cookie ?? '' }),
    });
    return { authenticated: !!result };
  }
}
export async function createApi(): Promise<{
  app: INestApplication;
  config: FoundationConfig;
  database: ExperimentDatabase | null;
  auth: ExperimentAuth | null;
}> {
  const config = loadFoundationConfig();
  const product = process.env.PRODUCT_ENABLED === 'true' ? new ProductApplication() : null;
  if (product && config.EXPERIMENT_AUTH_ENABLED === 'true')
    throw new Error('Product and compatibility experiment must run in separate modes');
  const database =
    config.EXPERIMENT_AUTH_ENABLED === 'true'
      ? createExperimentDatabase(config.DATABASE_URL!)
      : null;
  const auth = database ? createExperimentAuth(config, database) : null;
  const context: Context = { config, database, auth, product };
  @Module({
    imports: auth
      ? [
          AuthModule.forRoot({
            auth,
            bodyParser: { json: { limit: '64kb' }, urlencoded: { enabled: false } },
          }),
        ]
      : [],
    controllers: [
      ...(auth ? [HealthController, ExperimentController] : [HealthController]),
      ...(product ? [ProductController] : []),
    ],
    providers: [
      { provide: 'PHASE_1_CONTEXT', useValue: context },
      ...(product
        ? [{ provide: 'PRODUCT_APPLICATION', useValue: product }, CommunicationsGateway]
        : []),
      ...(auth ? [{ provide: 'EXPERIMENT_AUTH', useValue: auth }, ExperimentGateway] : []),
    ],
  })
  class ApiModule {}
  const app = await NestFactory.create(ApiModule, { bodyParser: false, logger: ['error', 'warn'] });
  app.use((request: Request, response: Response, next: () => void) => {
    if (
      request.path.startsWith('/api/auth/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== config.APP_ORIGIN
    ) {
      response.status(403).json({ code: 'UNTRUSTED_AUTH_ORIGIN' });
      return;
    }
    next();
  });
  if (!auth) app.use(express.json({ limit: '64kb' }));
  if (product)
    app.use(
      (error: { status?: number }, _request: Request, response: Response, _next: () => void) => {
        const status = error.status === 413 ? 413 : 400;
        response
          .status(status)
          .type('application/problem+json')
          .send({
            type: 'urn:devworkspace:problem:INVALID_BODY',
            title: status === 413 ? 'Request body too large' : 'Invalid JSON body',
            status,
            code: 'INVALID_BODY',
            requestId: randomUUID(),
          });
      },
    );
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_request: Request, response: Response, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  if (product)
    app
      .getHttpAdapter()
      .getInstance()
      .on('close', () => void product.close());
  await app.init();
  return { app, config, database, auth };
}
