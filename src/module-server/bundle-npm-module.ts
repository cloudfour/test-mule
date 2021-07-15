import type { Plugin, RollupCache } from 'rollup';
import { rollup } from 'rollup';
import { promises as fs } from 'fs';
import commonjs from '@rollup/plugin-commonjs';
import { environmentVariablesPlugin } from './plugins/environment-variables-plugin';
import * as esbuild from 'esbuild';
import { parse } from 'cjs-module-lexer';
// @ts-expect-error @types/node@12 doesn't like this import
import { createRequire } from 'module';
import { isBareImport, npmPrefix } from './extensions-and-detection';
let npmCache: RollupCache | undefined;

/**
 * Any package names in this set will need to have their named exports detected manually via require()
 * because the export names cannot be statically analyzed
 */
const dynamicCJSModules = new Set(['prop-types', 'react-dom', 'react']);

/**
 * Bundle am npm module entry path into a single file
 * @param mod The full path of the module to bundle, including subpackage/path
 * @param id The imported identifier
 * @param optimize Whether the bundle should be a minified/optimized bundle, or the default quick non-optimized bundle
 */
export const bundleNpmModule = async (
  mod: string,
  id: string,
  optimize: boolean,
  envVars: Record<string, string>,
) => {
  let namedExports: string[] = [];
  if (dynamicCJSModules.has(id)) {
    let isValidCJS = true;
    try {
      const text = await fs.readFile(mod, 'utf8');
      // Goal: Determine if it is ESM or CJS.
      // Try to parse it with cjs-module-lexer, if it fails, assume it is ESM
      // eslint-disable-next-line @cloudfour/typescript-eslint/await-thenable
      await parse(text);
    } catch {
      isValidCJS = false;
    }

    if (isValidCJS) {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @cloudfour/typescript-eslint/no-var-requires
      const imported = require(mod);
      if (typeof imported === 'object' && !imported.__esModule)
        namedExports = Object.keys(imported);
    }
  }

  const virtualEntry = '\0virtualEntry';
  const hasSyntheticNamedExports = namedExports.length > 0;
  const bundle = await rollup({
    input: hasSyntheticNamedExports ? virtualEntry : mod,
    cache: npmCache,
    shimMissingExports: true,
    treeshake: true,
    preserveEntrySignatures: 'allow-extension',
    plugins: [
      hasSyntheticNamedExports &&
        ({
          // This plugin handles special-case packages whose named exports cannot be found via static analysis
          // For these packages, the package is require()'d, and the named exports are determined that way.
          // A virtual entry exports the named exports from the real entry package
          name: 'cjs-named-exports',
          resolveId(id) {
            if (id === virtualEntry) return virtualEntry;
          },
          load(id) {
            if (id === virtualEntry) {
              const code = `export * from '${mod}'
export {${namedExports.join(', ')}} from '${mod}'
export { default } from '${mod}'`;
              return code;
            }
          },
        } as Plugin),
      pluginNodeResolve(),
      environmentVariablesPlugin(envVars),
      commonjs({
        extensions: ['.js', '.cjs', ''],
        sourceMap: false,
        transformMixedEsModules: true,
      }),
      (optimize && {
        name: 'esbuild-minify',
        renderChunk: async (code) => {
          const output = await esbuild.transform(code, {
            minify: true,
            legalComments: 'none',
          });
          return { code: output.code };
        },
      }) as Plugin,
    ].filter(Boolean),
  });
  npmCache = bundle.cache;
  const { output } = await bundle.generate({
    format: 'es',
    indent: false,
    exports: 'named',
    preferConst: true,
  });

  return output[0].code;
};

const pluginNodeResolve = (): Plugin => {
  return {
    name: 'node-resolve',
    resolveId(id) {
      if (isBareImport(id)) return { id: npmPrefix + id, external: true };
      // If requests already have the npm prefix, mark them as external
      if (id.startsWith(npmPrefix)) return { id, external: true };
    },
  };
};
