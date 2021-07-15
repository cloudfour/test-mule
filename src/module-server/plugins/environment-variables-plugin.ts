import type { Plugin } from '../plugin';

/**
 * Passes environment variables to pass into the bundle.  They can be accessed via import.meta.env.<name> (or process.env.<name> for compatability)
 */
export const environmentVariablesPlugin = (
  env: Record<string, string>,
): Plugin => {
  return {
    name: 'process-global',
    transform(code) {
      for (const [property, value] of Object.entries(env)) {
        code = code.replace(
          new RegExp(`(?:import\\.meta|process)\\.env\\.${property}`, 'g'),
          JSON.stringify(value),
        );
      }

      return code;
    },
  };
};
