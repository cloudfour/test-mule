// Copied from https://github.com/preactjs/wmr/blob/c03abcc36c26dc936af8701ab9031ddff44995a5/packages/wmr/src/plugins/resolve-extensions-plugin.js

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
  Differences from original:
  - Types
  - Function style changed
  - Comments changed
  - ESLint fixes
  - Parsing errors are thrown with code frame
  */

import { parse } from 'es-module-lexer';
import { createCodeFrame } from 'simple-code-frame';
import * as colors from 'kolorist';
import { cssExts, jsExts } from './extensions-and-detection';

type MaybePromise<T> = Promise<T> | T;
type ResolveFn = (
  specifier: string,
  id: string,
) => MaybePromise<string | false | null | void>;

interface Options {
  /** Replace `import.meta.FIELD` with a JS string. Return `false`/`null` to preserve. */
  resolveImportMeta?: ResolveFn;
  /** Return a replacement for import specifiers */
  resolveId?: ResolveFn;
  /** `false` preserves, `null` falls back to resolveId() */
  resolveDynamicImport?: ResolveFn;
}

export const transformImports = async (
  code: string,
  id: string,
  { resolveImportMeta, resolveId, resolveDynamicImport }: Options = {},
) => {
  let imports;
  try {
    // eslint-disable-next-line @cloudfour/typescript-eslint/await-thenable
    imports = (await parse(code, id))[0];
  } catch (error) {
    if (!('idx' in error)) throw error;
    const linesUntilError = code.slice(0, error.idx).split('\n');
    const line = linesUntilError.length;
    const column = linesUntilError[linesUntilError.length - 1].length;
    const frame = createCodeFrame(code, line - 1, column);
    let message = `${colors.red(colors.bold(error.message))}

${colors.red(`${id}:${line}:${column + 1}`)}

${frame}
`;
    if (!jsExts.test(id) && !cssExts.test(id))
      message += `${colors.yellow(
        'You may need to add transform plugins to handle non-JS input',
      )}\n`;

    const modifiedError = new Error(message);
    modifiedError.stack = message;
    throw modifiedError;
  }

  let out = '';
  let offset = 0;

  // Import specifiers are synchronously converted into placeholders.
  // Resolutions are async+parallel, held in a mapping to their placeholders.
  let resolveIds = 0;
  const toResolve = new Map();

  // Get a [deduplicated] placeholder for a specifier and kick off resolution
  const field = (spec: string, resolver: ResolveFn, a: string, b?: string) => {
    const match = toResolve.get(spec);
    if (match) return match.placeholder;
    const placeholder = `%%_RESOLVE_#${++resolveIds}#_%%`;
    toResolve.set(spec, {
      placeholder,
      spec,
      p: resolver(a, b as string),
    });
    return placeholder;
  };

  // Falls through to resolveId() if null, preserves spec if false
  const doResolveDynamicImport = async (spec: string, id: string) => {
    let f = resolveDynamicImport && (await resolveDynamicImport(spec, id));
    if ((f === null || f === undefined) && resolveId)
      f = await resolveId(spec, id);
    return f;
  };

  for (const item of imports) {
    // Skip items that were already processed by being wrapped in an import - eg `import(import.meta.url)`
    if (item.s < offset) continue;

    out += code.slice(offset, item.s);

    const isImportMeta = item.d === -2;
    const isDynamicImport = item.d > -1;

    if (isDynamicImport) {
      // Bugfix: `import(import.meta.url)` returns an invalid negative end_offset.
      // We detect that here and find the closing paren to estimate the offset.
      if (item.e < 0) {
        // @ts-expect-error it is not readonly
        item.e = code.indexOf(')', item.s);
      }

      // Dynamic import() has no statement_end, so we take the position following the closing paren:
      // @ts-expect-error it is not readonly
      item.se = code.indexOf(')', item.e) + 1;
    }

    let quote = '';
    const after = code.slice(item.e, item.se);

    let spec = code.slice(item.s, item.e);
    offset = item.se;

    if (isImportMeta) {
      // Check for *simple* property access immediately following `import.meta`:
      const r = /\s*\.\s*([$_a-z][\w$]*)/gi;
      r.lastIndex = offset;
      const match = r.exec(code);
      if (match && match.index === offset) {
        // Advance past it and append it to the "specifier":
        offset = r.lastIndex;
        spec += match[0];
        // Resolve it:
        const property = match[1];
        if (resolveImportMeta) {
          spec = field(spec, resolveImportMeta, property);
        }
      }

      out += spec;
      continue;
    }

    // Dynamic import()
    if (isDynamicImport) {
      // Strip comments - these are usually Webpack magic comments.
      spec = spec
        .replace(/\/\*[\S\s]*\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .trim();

      // For dynamic imports, spec is a JavaScript expression.
      // We need to try to convert it to a specifier, or bail if it's not static.
      quote = (/^\s*(["'`])/.exec(spec) || [])[1];
      if (!quote) {
        // Warn if we were supposed to pass an AST node to resolveDynamicImport(), which is not implemented.
        if (resolveDynamicImport) {
          console.warn(`Cannot resolve dynamic expression in import(${spec})`);
        }

        out += spec + after;
        continue;
      }

      spec = spec.replace(/^\s*(["'`])(.*)\1\s*$/g, '$2');

      if (resolveDynamicImport) {
        spec = field(spec, doResolveDynamicImport, spec, id);
        out += quote + spec + quote + after;
        continue;
      }
    }

    if (resolveId) {
      spec = field(spec, resolveId, spec, id);
    }

    out += quote + spec + quote + after;
  }

  out += code.slice(Math.max(0, offset));

  // Wait for all resolutions to finish and map them to placeholders
  const mapping = new Map();
  await Promise.all(
    [...toResolve.values()].map(async (v) => {
      mapping.set(v.placeholder, (await v.p) || v.spec);
    }),
  );

  out = out.replace(/%%_RESOLVE_#\d+#_%%/g, (s) => mapping.get(s));

  return out;
};
