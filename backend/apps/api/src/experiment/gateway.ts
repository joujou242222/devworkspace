import { Inject } from '@nestjs/common';
import { WebSocketGateway, type OnGatewayInit } from '@nestjs/websockets';
import { fromNodeHeaders } from 'better-auth/node';
import type { Server } from 'socket.io';
import type { ExperimentAuth } from './auth.js';
@WebSocketGateway({ transports: ['websocket'], serveClient: false })
export class ExperimentGateway implements OnGatewayInit {
  constructor(@Inject('EXPERIMENT_AUTH') private readonly auth: ExperimentAuth) {}
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        if (socket.handshake.headers.origin !== 'https://localhost:8443')
          return next(new Error('Untrusted origin'));
        const session = await this.auth.api.getSession({
          headers: fromNodeHeaders(socket.handshake.headers),
        });
        if (!session) return next(new Error('Invalid session'));
        socket.data.userId = session.user.id;
        next();
      } catch {
        next(new Error('Session validation failed'));
      }
    });
    server.on('connection', (socket) => {
      socket.on('experiment:identity', async (ack: (value: { authenticated: boolean }) => void) => {
        try {
          const session = await this.auth.api.getSession({
            headers: fromNodeHeaders(socket.handshake.headers),
          });
          if (typeof ack === 'function') ack({ authenticated: !!session });
          if (!session) socket.disconnect(true);
        } catch {
          if (typeof ack === 'function') ack({ authenticated: false });
          socket.disconnect(true);
        }
      });
    });
  }
}
