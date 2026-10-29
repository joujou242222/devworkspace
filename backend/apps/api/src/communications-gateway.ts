import { Inject, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayInit } from '@nestjs/websockets';
import { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { ProductApplication } from '@devworkspace/server';
import { socketContext, socketSubscription } from '@devworkspace/contracts';
type Session = Awaited<ReturnType<ProductApplication['identity']['session']>>;
type State = {
  user: Session;
  context: ReturnType<typeof socketContext.parse>;
  projects: Set<string>;
  checking?: boolean;
};
@WebSocketGateway({
  transports: ['websocket'],
  serveClient: false,
  maxHttpBufferSize: 2048,
  allowRequest: (request, done) => done(null, request.headers.origin === 'https://localhost:8443'),
})
export class CommunicationsGateway implements OnGatewayInit, OnModuleDestroy {
  private redis?: Redis;
  private timer?: ReturnType<typeof setInterval>;
  constructor(@Inject('PRODUCT_APPLICATION') readonly product: ProductApplication) {}
  async validate(state: State, project?: string) {
    const c = state.context,
      r = this.product.notifications.reviews;
    await r.scoped(
      state.user,
      c.organization_id,
      c.principal_id,
      c.capacity === 'CLIENT',
      async (tx, actor) => {
        if (project) await r.access(tx, c.organization_id, project, actor);
        if (c.capacity === 'CLIENT' && !project) {
          const row = await tx.query(
            "SELECT 1 FROM public.client_project_access g JOIN public.project p ON p.organization_id=g.organization_id AND p.id=g.project_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id WHERE g.organization_id=$1 AND g.contact_id=$2 AND g.status='ACTIVE' AND p.portal_enabled AND p.status<>'ARCHIVED' AND x.status='ACTIVE' LIMIT 1",
            [c.organization_id, c.principal_id],
          );
          if (!row.rowCount) throw new Error('Capacity unavailable');
        }
      },
    );
  }
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        const context = socketContext.parse(socket.handshake.auth);
        const headers = new Headers();
        if (socket.handshake.headers.cookie) headers.set('cookie', socket.handshake.headers.cookie);
        const user = await this.product.identity.session(headers);
        const state: State = { user, context, projects: new Set() };
        await this.validate(state, context.project_id);
        if (context.project_id) state.projects.add(context.project_id);
        socket.data.communications = state;
        next();
      } catch {
        next(new Error('Connection unavailable'));
      }
    });
    server.on('connection', (socket) => {
      const state = socket.data.communications as State,
        c = state.context;
      void socket.join(`recipient:${c.organization_id}:${c.capacity}:${c.principal_id}`);
      socket.on('subscribe', async (input: unknown, ack: unknown) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const p = socketSubscription.parse(input);
          if (state.projects.size >= 25 && !state.projects.has(p.project_id))
            throw new Error('Subscription limit');
          await this.validate(state, p.project_id);
          state.projects.add(p.project_id);
          await socket.join(
            `project:${c.organization_id}:${c.capacity}:${c.principal_id}:${p.project_id}`,
          );
          reply({ status: 'ok' });
        } catch {
          reply({ status: 'denied' });
        }
      });
      socket.on('sync', async (input: unknown, ack: unknown) => {
        try {
          if (input !== null) throw new Error('Invalid request');
          await this.validate(state);
          if (typeof ack === 'function') ack({ status: 'ok' });
        } catch {
          if (typeof ack === 'function') ack({ status: 'denied' });
          socket.disconnect(true);
        }
      });
    });
    this.timer = setInterval(() => {
      for (const socket of server.sockets.sockets.values()) {
        const s = socket.data.communications as State | undefined;
        if (!s || s.checking) continue;
        s.checking = true;
        void (async () => {
          await this.validate(s);
          for (const p of s.projects) await this.validate(s, p);
        })()
          .catch(() => socket.disconnect(true))
          .finally(() => {
            s.checking = false;
          });
      }
    }, 1000);
    this.timer.unref();
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(2000, attempt * 100),
    });
    this.redis.on('error', () => {});
    this.redis.on('ready', () => {
      void this.redis!.subscribe('dw-notifications-v6').catch(() => {});
    });
    this.redis.on('message', (_channel, message) => {
      let hint: { organization_id: string; event_id: string };
      try {
        const parsed = JSON.parse(message);
        hint = {
          organization_id: socketContext.shape.organization_id.parse(parsed.organization_id),
          event_id: socketContext.shape.organization_id.parse(parsed.event_id),
        };
      } catch {
        return;
      }
      for (const socket of server.sockets.sockets.values())
        void this.emit(socket, hint).catch(() => socket.disconnect(true));
    });
    void this.redis.connect().catch(() => {});
  }
  async emit(socket: Socket, hint: { organization_id: string; event_id: string }) {
    const s = socket.data.communications as State,
      c = s.context;
    if (c.organization_id !== hint.organization_id) return;
    await this.product.notifications.scoped(
      s.user,
      c.organization_id,
      c.principal_id,
      c.capacity === 'CLIENT',
      async (tx) => {
        if (
          (
            await tx.query(
              'SELECT 1 FROM public.notification WHERE organization_id=$1 AND event_id=$2 LIMIT 1',
              [c.organization_id, hint.event_id],
            )
          ).rowCount
        )
          socket.emit('notifications.changed', { event_id: hint.event_id });
        const { rows } = await tx.query(
          'SELECT project_id,resource_kind,resource_id,action FROM public.tenant_event WHERE organization_id=$1 AND id=$2',
          [c.organization_id, hint.event_id],
        );
        const e = rows[0];
        if (!e || !s.projects.has(e.project_id)) return;
        const visible = await tx.query(
          'SELECT public.notification_access($1,$2,$3,$4,$5,$6,$7,$8) visible',
          [
            c.organization_id,
            s.user.user.id,
            c.principal_id,
            c.capacity,
            e.project_id,
            e.resource_kind,
            e.resource_id,
            e.action,
          ],
        );
        if (visible.rows[0].visible)
          socket.emit('state.changed', { project_id: e.project_id, event_id: hint.event_id });
      },
    );
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.redis?.disconnect();
  }
}
