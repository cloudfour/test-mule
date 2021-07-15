import { posix, relative, resolve, sep } from 'path';
import type polka from 'polka';
import { promises as fs } from 'fs';
import { cssPlugin } from '../plugins/css';
import type { PluginContext, TransformPluginContext } from 'rollup';
import { cssExts } from '../extensions-and-detection';

interface CSSMiddlewareOpts {
  root: string;
}

/**
 * This middleware handles _only_ css files that were _not imported from JS_
 * CSS files that were imported from JS have the ?import param and were handled by the JS middleware (transformed to JS)
 * This middleware does not transform CSS to JS that can be imported, it just returns CSS
 * Use cases: CSS included via <link> tags, CSS included via @import
 * TODO: consider using this for loadCSS
 */
export const cssMiddleware = ({
  root,
}: CSSMiddlewareOpts): polka.Middleware => {
  const cssPlug = cssPlugin({ root, returnCSS: true });

  return async (req, res, next) => {
    try {
      if (!cssExts.test(req.path)) return next();
      // Normalized path starting with slash
      const path = posix.normalize(req.path);
      // Remove leading slash, and convert slashes to os-specific slashes
      const osPath = path.slice(1).split(posix.sep).join(sep);
      // Absolute file path
      const file = resolve(root, osPath);
      // Rollup-style CWD-relative Unix-normalized path "id":
      const id = `./${relative(root, file)
        .replace(/^\.\//, '')
        .replace(/^\0/, '')
        .split(sep)
        .join(posix.sep)}`;

      res.setHeader('Content-Type', 'text/css;charset=utf-8');
      let code = await fs.readFile(file, 'utf-8');

      if (cssPlug.transform) {
        const ctx: Partial<PluginContext> = {
          warn(...args) {
            console.log(`[${cssPlug.name}]`, ...args);
          },
          error(error) {
            if (typeof error === 'string') throw new Error(error);
            throw error;
          },
        };
        // We need to call the transform hook, but get the CSS out of it before it converts it to JS
        const result = await cssPlug.transform.call(
          ctx as TransformPluginContext,
          code,
          id,
        );
        if (
          typeof result !== 'object' ||
          result === null ||
          result.meta?.css === undefined
        )
          return next();
        code = result.meta.css;
      }

      if (!code) return next();

      res.writeHead(200, {
        'Content-Length': Buffer.byteLength(code, 'utf-8'),
      });
      res.end(code);
    } catch (error) {
      next(error);
    }
  };
};
