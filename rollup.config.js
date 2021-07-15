import jestDomConfig from './src/jest-dom/rollup.config';
import pptrTestingLibraryConfig from './src/pptr-testing-library-client/rollup.config';
import userUtilsConfig from './src/user-util/rollup.config';

import dts from 'rollup-plugin-dts';
import babel from '@rollup/plugin-babel';
import nodeResolve from '@rollup/plugin-node-resolve';
const extensions = ['.js', '.jsx', '.es6', '.es', '.mjs', '.ts', '.tsx'];

const external = [
  'puppeteer',
  'source-map',
  'acorn',
  'es-module-lexer',
  'cjs-module-lexer',
  'rollup',
  '@rollup/plugin-commonjs',
  'esbuild',
  /postcss/,
  /mime/,
];

/** @type {import('rollup').RollupOptions} */
const mainConfig = {
  input: ['src/index.ts'],
  output: [
    {
      format: 'esm',
      dir: 'dist/esm',
      entryFileNames: '[name].mjs',
      chunkFileNames: '[name].mjs',
    },
    {
      format: 'cjs',
      dir: 'dist/cjs',
      entryFileNames: '[name].cjs',
      chunkFileNames: '[name].cjs',
      externalLiveBindings: false,
      interop: (id) => {
        if (id === 'puppeteer') return 'esModule';
        return 'auto';
      },
    },
  ],
  plugins: [
    babel({ babelHelpers: 'bundled', extensions }),
    nodeResolve({ extensions }),
    bundlePlugin(),
  ],
  external,
};

/** @type {import('rollup').RollupOptions} */
const typesConfig = {
  input: 'src/index.ts',
  output: [{ file: 'dist/index.d.ts', format: 'es' }],
  external: [...external, 'polka'],
  plugins: [dts({ respectExternal: true })],
};

export default [
  mainConfig,
  userUtilsConfig,
  jestDomConfig,
  pptrTestingLibraryConfig,
  typesConfig,
];

/**
 * Creates sub-bundles when you do `import fileName from "bundle:./path-here"
 * Mostly taken from https://github.com/preactjs/wmr/blob/1.0.0/src/plugins/bundle-plugin.js
 * @returns {import('rollup').Plugin}
 */
function bundlePlugin() {
  return {
    name: 'bundle-plugin',
    async resolveId(id, importer) {
      if (!id.startsWith('bundle:')) return;
      const resolved = await this.resolve(id.slice(7), importer, {
        skipSelf: true,
      });
      if (resolved) {
        resolved.id = `\0bundle:${resolved.id}`;
      }

      return resolved;
    },
    resolveFileUrl({ relativePath, format }) {
      return format === 'es'
        ? `new URL('${relativePath}', import.meta.url).href`
        : `require('path').join(__dirname,'${relativePath}')`;
    },
    resolveImportMeta(property, { format }) {
      if (property === 'url' && format === 'cjs') {
        // eslint-disable-next-line no-template-curly-in-string
        return '`file://${__filename}`';
      }

      return null;
    },
    async load(id) {
      if (!id.startsWith('\0bundle:')) return;
      id = id.slice(8);

      const fileId = this.emitFile({
        type: 'chunk',
        id,
      });
      this.addWatchFile(id);
      return `export default import.meta.ROLLUP_FILE_URL_${fileId}`;
    },
  };
}
