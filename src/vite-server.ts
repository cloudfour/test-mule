import { URLSearchParams, fileURLToPath } from 'url';
import * as vite from 'vite';
import * as path from 'path';

const defaultHTML = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:;base64,=" />
    <title>pleasantest</title>
  </head>
  <body>
    <h1 style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)">
      Your test will run here
    </h1>
  </body>
</html>
`;

export let port = 3000;

export const createServer = async () => {
  const inlineModulePlugin = (): vite.Plugin => {
    const pluginName = 'pleasantest-inline-module-plugin';
    return {
      name: pluginName,
      // Has to run resolveId before vite's other resolve handlers
      enforce: 'pre',
      resolveId(id) {
        const [idWithoutQuery, qs] = id.split('?');
        if (!qs) return null;
        const parsedParams = new URLSearchParams(qs);
        const inlineCode = parsedParams.get('inline-code');
        if (!inlineCode) return null;
        // Puts it into a hash so esbuild doesn't trip over it
        return `.${idWithoutQuery}#inline-code=${encodeURIComponent(
          inlineCode,
        )}`;
      },
      load(id) {
        const hash = id.split('#')[1];
        if (!hash) return null;
        const inlineCode = new URLSearchParams(hash).get('inline-code');
        if (!inlineCode) return null;
        return inlineCode;
      },
    };
  };

  const indexHTMLPlugin = (): vite.Plugin => ({
    name: 'pleasantest-index-html',
    configureServer({ middlewares }) {
      middlewares.use((req, res, next) => {
        if (req.url !== '/') return next();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.write(defaultHTML);
        res.end();
      });
    },
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const clientRuntimePlugin = (): vite.Plugin => ({
    name: 'pleasantest-client-runtime',
    resolveId(id) {
      if (!id.startsWith('/@pleasantest')) return null;
      return path.join(
        currentDir,
        id === '/@pleasantest/jest-dom'
          ? '../jest-dom.js'
          : id === '/@pleasantest/user-util'
          ? '../user-util.js'
          : '../pptr-testing-library-client.js',
      );
    },
  });

  const disablePollingPlugin = (): vite.Plugin => ({
    name: 'pleasantest-disable-polling',
    transform(code, id) {
      if (!id.endsWith('vite/dist/client/client.js')) return null;
      return code
        .replace(
          // Here is code sninppet we are removing:
          // socket.addEventListener('close', () => {
          //   ...
          // }, 1000);});
          /socket\.addEventListener\('close'[\W\w]*?, \d*\);\s*}\);/,
          '',
        )
        .replace(/console\.log\(["'`]\[vite] connecting...["'`]\)/, '')
        .replace(/console\.log\(["'`]\[vite] connected.["'`]\)/, '')
        .replace(/setInterval\(\(\) => socket\.send\('ping'\), \w+\)/, '');
    },
  });

  const server = await vite.createServer({
    optimizeDeps: { entries: [] },
    server: { port, cors: true, hmr: false },
    plugins: [
      indexHTMLPlugin(),
      inlineModulePlugin(),
      clientRuntimePlugin(),
      disablePollingPlugin(),
    ],
    logLevel: 'warn',
  });

  await server.listen();

  // If original port was not available, use whichever vite ended up choosing
  port = server.config.server.port || port;

  return server;
};
