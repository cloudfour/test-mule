/*
 * Refactored based on https://github.com/preactjs/wmr/blob/main/packages/wmr/src/lib/rollup-plugin-container.js
 */

/*
  https://github.com/preactjs/wmr/blob/main/LICENSE
  MIT License
  Copyright (c) 2020 The Preact Authors
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  */

/*
  Specific commit: https://github.com/preactjs/wmr/blob/7e653cd1000b40bca32ae824401d2ddd16807c8d/packages/wmr/src/lib/rollup-plugin-container.js

  Differences from original:
  - Inline types added
  - ESLint fixes
  - WMR-specific debugging removed
  - opts removed
  - options, watchChange, resolveImportMeta, resolveFileUrl hooks removed
  - ctx.emitFile, ctx.addWatchFile, ctx.setAssetSource, ctx.getFileName removed
  - relative resolution fixed to handle '.' for ctx.resolveId
  - Source map handling added to transform hook
  - Error handling (with code frame, using source maps) added to transform hook
  */

import { resolve, dirname } from 'path';
import { Parser } from 'acorn';
import type {
  LoadResult,
  PluginContext as RollupPluginContext,
  ResolveIdResult,
} from 'rollup';
import type { Plugin } from './plugin';
import { combineSourceMaps } from './combine-source-maps';
import { createCodeFrame } from 'simple-code-frame';
import type {
  DecodedSourceMap,
  RawSourceMap,
} from '@ampproject/remapping/dist/types/types';
import * as colors from 'kolorist';
import { promises as fs } from 'fs';

/** Fast splice(x,1) when order doesn't matter (h/t Rich) */
const popIndex = (array: any[], index: number) => {
  const tail = array.pop();
  if (index !== array.length) array[index] = tail;
};

/** Get a unique key for a (id,importer) resolve pair */
const identifierPair = (id: string, importer?: string) => {
  if (importer) return `${id}\n${importer}`;
  return id;
};

class ErrorWithLocation extends Error {
  line: number;
  column?: number;
  constructor({
    message,
    line,
    column,
  }: {
    message: string;
    line: number;
    column?: number;
  }) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

type PluginContext = Omit<
  RollupPluginContext,
  // Undocumented
  | 'cache'
  // Deprecated
  | 'emitAsset'
  | 'emitChunk'
  | 'getAssetFileName'
  | 'getChunkFileName'
  | 'isExternal'
  | 'moduleIds'
  | 'resolveId'
>;

export const createPluginContainer = (plugins: Plugin[]) => {
  const MODULES = new Map();

  let plugin: Plugin | undefined;
  const parser = Parser;

  const ctx: PluginContext = {
    meta: {
      rollupVersion: '2.8.0',
      watchMode: true,
    },
    parse(code, opts) {
      return parser.parse(code, {
        sourceType: 'module',
        ecmaVersion: 2020,
        locations: true,
        onComment: [],
        ...opts,
      });
    },
    async resolve(id, importer, { skipSelf = false } = { skipSelf: false }) {
      const skip = [];
      if (skipSelf && plugin) skip.push(plugin);
      let out = await container.resolveId(id, importer, skip);
      if (typeof out === 'string') out = { id: out };
      if (!out || !out.id) out = { id };
      if (/^\.\.?[/\\]/.test(out.id) || out.id === '.') {
        out.id = resolve('.', importer ? dirname(importer) : '.', out.id);
      }

      return (out as any) || false;
    },
    getModuleInfo(id) {
      let mod = MODULES.get(id);
      if (mod) return mod.info;
      mod = {
        info: {},
      };
      MODULES.set(id, mod);
      return mod.info;
    },
    emitFile() {
      throw new Error('emitFile is not implemented');
    },
    setAssetSource() {
      throw new Error('setAssetSource is not implemented');
    },
    getFileName() {
      throw new Error('getFileName is not implemented');
    },
    addWatchFile() {
      // No-op
    },
    getWatchFiles() {
      throw new Error('getWatchFiles is not implemented');
    },
    getModuleIds() {
      throw new Error('getModuleIds is not implemented');
    },
    warn(...args) {
      console.log(`[${plugin?.name}]`, ...args);
    },
    error(error, pos) {
      if (pos === undefined) {
        if (typeof error === 'string') throw new Error(error);
        throw error;
      }

      throw new ErrorWithLocation({
        message: error as string,
        line: typeof pos === 'number' ? pos : pos.line,
        column: (pos as any).column,
      });
    },
  };

  const container = {
    ctx,
    async buildStart() {
      await Promise.all(
        plugins.map((plugin) => plugin.buildStart?.call(ctx as any, {} as any)),
      );
    },

    async resolveId(
      id: string,
      importer?: string,
      _skip?: Plugin[],
    ): Promise<ResolveIdResult> {
      const key = identifierPair(id, importer);

      const opts: { id?: string } = {};
      for (const p of plugins) {
        if (!p.resolveId) continue;

        if (_skip) {
          if (_skip.includes(p)) continue;
          if (resolveSkips.has(p, key)) continue;
          resolveSkips.add(p, key);
        }

        plugin = p;

        let result;
        try {
          result = await p.resolveId.call(ctx as any, id, importer, {});
        } finally {
          if (_skip) resolveSkips.delete(p, key);
        }

        if (!result) continue;
        if (typeof result === 'string') {
          id = result;
        } else {
          id = result.id;
          Object.assign(opts, result);
        }

        // ResolveId() is hookFirst - first non-null result is returned.
        break;
      }

      opts.id = id;
      return Object.keys(opts).length > 1 ? (opts as { id: string }) : id;
    },

    async transform(
      originalCode: string,
      id: string,
      inputMap?: DecodedSourceMap | RawSourceMap | string,
    ) {
      let code = originalCode;
      // TODO: if any of the transforms is missing sourcemaps, then there should be no source maps emitted
      const sourceMaps: (DecodedSourceMap | RawSourceMap)[] = [];
      if (inputMap)
        sourceMaps.push(
          typeof inputMap === 'string' ? JSON.parse(inputMap) : inputMap,
        );
      for (plugin of plugins) {
        if (!plugin.transform) continue;
        try {
          const result = await plugin.transform.call(ctx as any, code, id);
          if (!result) continue;

          if (typeof result === 'object') {
            if (!result.code) continue;
            code = result.code;
            if (result.map)
              sourceMaps.push(
                typeof result.map === 'string'
                  ? JSON.parse(result.map)
                  : result.map,
              );
          } else {
            code = result;
          }
        } catch (error) {
          if (error instanceof ErrorWithLocation) {
            let line = error.line;
            let column = error.column || 0;
            if (sourceMaps.length > 0) {
              const { SourceMapConsumer } = await import('source-map');
              const consumer = await new SourceMapConsumer(
                combineSourceMaps(id, sourceMaps) as any,
              );
              const sourceLocation = consumer.originalPositionFor({
                line,
                column,
              });
              consumer.destroy();
              if (sourceLocation.line !== null) {
                line = sourceLocation.line;
                column = sourceLocation.column || 0;
                if (sourceLocation.source) {
                  originalCode = await fs.readFile(
                    sourceLocation.source,
                    'utf8',
                  );
                }
              }
            }

            const frame = createCodeFrame(originalCode, line - 1, column);
            const message = `[${plugin.name}] ${colors.red(
              colors.bold(error.message),
            )}

${colors.red(`${id}:${line}:${column + 1}`)}

${frame}`;
            const modifiedError = new Error(message);
            modifiedError.stack = message;
            throw modifiedError;
          }

          throw error;
        }
      }

      return {
        code,
        map: combineSourceMaps(id, sourceMaps),
      };
    },

    async load(id: string): Promise<LoadResult> {
      for (plugin of plugins) {
        if (!plugin.load) continue;
        const result = await plugin.load.call(ctx as any, id);
        if (result) {
          return result;
        }
      }

      return null;
    },
  };

  // Tracks recursive resolveId calls
  const resolveSkips = {
    skip: new Map<Plugin, string[]>(),
    has(plugin: Plugin, key: string) {
      const skips = this.skip.get(plugin);
      return skips ? skips.includes(key) : false;
    },
    add(plugin: Plugin, key: string) {
      const skips = this.skip.get(plugin);
      if (skips) skips.push(key);
      else this.skip.set(plugin, [key]);
    },
    delete(plugin: Plugin, key: string) {
      const skips = this.skip.get(plugin);
      if (!skips) return;
      const i = skips.indexOf(key);
      if (i !== -1) popIndex(skips, i);
    },
  };

  return container;
};
