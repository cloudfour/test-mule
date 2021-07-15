import type { Plugin } from '../plugin';
import { isRelativeOrAbsoluteImport } from '../extensions-and-detection';
import { resolveRelativeOrAbsolute } from '../node-resolve';

/**
 * Handles resolving './foo' to './foo.js', and './foo/index.js', and resolving through './foo/package.json'
 */
export const resolveExtensionsPlugin = (): Plugin => {
  return {
    name: 'resolve-extensions-plugin',
    async resolveId(id, importer) {
      if (!isRelativeOrAbsoluteImport(id)) return;
      return resolveRelativeOrAbsolute(id, importer);
    },
  };
};
