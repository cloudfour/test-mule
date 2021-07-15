import postcssPlugin from 'rollup-plugin-postcss';
import { transformCssImports } from '../transform-css-imports';
import { posix, relative, resolve, sep } from 'path';
import { cssExts } from '../extensions-and-detection';

export const cssPlugin = ({
  returnCSS = false,
  root,
}: {
  returnCSS?: boolean;
  root: string;
}) => {
  const transformedCSS = new Map<string, string>();
  const plugin = postcssPlugin({
    inject: (cssVariable) => {
      return `
        const style = document.createElement('style')
        style.type = 'text/css'
        const promise = new Promise(r => style.addEventListener('load', r))
        style.appendChild(document.createTextNode(${cssVariable}))
        document.head.append(style)
        await promise
      `;
    },
    // They are executed right to left. We want our custom loader to run last
    use: ['rewriteImports', 'sass', 'stylus', 'less'],
    loaders: [
      {
        // Rewrites emitted url(...) and @imports to be relative to the project root.
        // Otherwise, relative paths don't work for injected stylesheets
        name: 'rewriteImports',
        test: cssExts,
        async process({ code, map }: { code: string; map?: string }) {
          code = await transformCssImports(code, this.id, {
            resolveId: (spec, id) => {
              if (!spec.startsWith('./'))
                return spec.split(sep).join(posix.sep);
              const absolutePath = resolve(id, '..', spec);
              return `./${relative(root, absolutePath)
                .split(sep)
                .join(posix.sep)}`;
            },
          });
          if (returnCSS) {
            transformedCSS.set(this.id, code);
          }

          return { code, map };
        },
      },
    ],
  });
  // Adds .meta.css to returned object (for use in CSS middleware)
  if (returnCSS) {
    const originalTranform = plugin.transform!;
    plugin.transform = async function (code, id) {
      let result = await originalTranform.call(this, code, id);
      if (result === null || result === undefined) return result;
      if (typeof result === 'string') result = { code: result, map: '' };
      if (!result.meta) result.meta = {};
      result.meta.css = transformedCSS.get(id);
      return result;
    };
  }

  return plugin;
};
