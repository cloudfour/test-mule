import { Console } from 'console';
import type { AddressInfo, Socket } from 'net';
import type { Polka } from 'polka';
import polka from 'polka';

interface ServerOpts {
  middleware: polka.Middleware[];
}

export const createServer = ({ middleware }: ServerOpts) =>
  new Promise<{ port: number; server: Polka; close: () => Promise<void> }>(
    (resolve) => {
      const server = polka({
        onError(err, req, res) {
          const fullPath = req.originalUrl.replace(/\?.+$/, '');

          // ignore missing favicon requests
          if (fullPath === '/favicon.ico') {
            res.writeHead(200, {
              'content-type': 'image/x-icon',
              'content-length': '0',
            });
            return res.end('');
          }

          // @ts-expect-error TS doesn't know about err.code
          const code = typeof err.code === 'number' ? err.code : 500;

          res.statusCode = code;

          res.writeHead(code, { 'content-type': 'text/plain' });
          if (code === 404) return res.end('not found');
          res.end(err.stack);
          // Create a new console instance instead of using the global one
          // Because the global one is overridden by Jest, and it adds a misleading second stack trace and code frame below it
          const console = new Console(process.stdout, process.stderr);
          console.log(err.stack || err.message || err);
        },
      });
      if (middleware.length > 0) server.use(...middleware);

      const sockets = new Set<Socket>();

      server.listen(
        // 0 means the OS will choose a random free port
        0,
        undefined,
        () => {
          const serv = server.server!;
          serv.on('connection', (socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
          });
          resolve({
            port: (server.server!.address() as AddressInfo).port,
            server,
            close: async () => {
              for (const socket of sockets) socket.destroy();
              await new Promise<void>((resolve, reject) => {
                serv.close((err) => (err ? reject(err) : resolve()));
              });
            },
          });
        },
      );
    },
  );
