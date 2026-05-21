// Local replacement for `fastify-socket.io`. The upstream package is a thin
// wrapper around socket.io's Server constructor (~15 lines of real code) and
// stopped tracking new Fastify majors at v5.1.0 (still declares
// `fastify: 4.x.x` as its peer). Inlining removes one dependency and the
// stale peer-mismatch warning that came with it.
//
// Re-evaluate if upstream ever adds non-trivial behavior:
//   https://github.com/ducktors/fastify-socket.io

import fastifyPlugin from "fastify-plugin";
import { Server, ServerOptions } from "socket.io";

export type FastifySocketIOOptions = Partial<ServerOptions> & {
  preClose?: (done: () => void) => void;
};

declare module "fastify" {
  interface FastifyInstance {
    io: Server;
  }
}

export default fastifyPlugin<FastifySocketIOOptions>(
  async function (fastify, opts) {
    const io = new Server(fastify.server, opts);
    fastify.decorate("io", io);

    fastify.addHook("preClose", done => {
      if (opts.preClose) {
        return opts.preClose(done);
      }
      io.local.disconnectSockets(true);
      done();
    });

    fastify.addHook("onClose", (_fastify, done) => {
      io.close();
      done();
    });
  },
  { fastify: ">=4.x.x", name: "fastify-socketio" }
);
