import type polka from 'polka';
import type { SourceDescription } from 'rollup';
import type { Plugin } from './plugin';
import { indexHTMLMiddleware } from './middleware/index-html';
import { jsMiddleware } from './middleware/js';
import { npmPlugin } from './plugins/npm-plugin';
import { environmentVariablesPlugin } from './plugins/environment-variables-plugin';
import { resolveExtensionsPlugin } from './plugins/resolve-extensions-plugin';
import { createServer } from './server';
import { esbuildPlugin } from './plugins/esbuild-plugin';
import { cssPlugin } from './plugins/css';
import { cssMiddleware } from './middleware/css';
import { staticMiddleware } from './middleware/static';
import type * as esbuild from 'esbuild';

export interface ModuleServerOpts {
  root?: string;
  /** List of Rollup/Vite/WMR plugins to add */
  plugins?: (Plugin | false | undefined)[];
  /**
   * Environment variables to pass into the bundle.
   * They can be accessed via import.meta.env.<name> (or process.env.<name> for compatability)
   */
  envVars?: Record<string, string>;
  /** Options to pass to esbuild. Set to false to disable esbuild */
  esbuild?: esbuild.TransformOptions | false;
}

export const createModuleServer = async ({
  root = process.cwd(),
  plugins: userPlugins = [],
  envVars: _envVars = {},
  esbuild: esbuildOptions = {},
}: ModuleServerOpts = {}) => {
  const prePlugins: Plugin[] = [];
  const normalPlugins: Plugin[] = [];
  const postPlugins: Plugin[] = [];

  const envVars = {
    NODE_ENV: 'development',
    ..._envVars,
  };

  for (const plugin of userPlugins) {
    if (!plugin) continue;
    if (plugin.enforce === 'pre') prePlugins.push(plugin);
    else if (plugin.enforce === 'post') postPlugins.push(plugin);
    else normalPlugins.push(plugin);
  }

  const plugins: (Plugin | false | undefined)[] = [
    ...prePlugins,

    ...normalPlugins,

    resolveExtensionsPlugin(),
    environmentVariablesPlugin(envVars),
    npmPlugin({ root, envVars }),

    esbuildOptions && esbuildPlugin(esbuildOptions),
    cssPlugin({ root }),

    ...postPlugins,
  ];
  const filteredPlugins = plugins.filter(Boolean) as Plugin[];
  const requestCache = new Map<string, SourceDescription>();
  const middleware: polka.Middleware[] = [
    indexHTMLMiddleware,
    jsMiddleware({ root, plugins: filteredPlugins, requestCache }),
    cssMiddleware({ root }),
    staticMiddleware({ root }),
  ];
  return {
    ...(await createServer({ middleware })),
    requestCache,
  };
};
