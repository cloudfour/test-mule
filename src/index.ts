import * as puppeteer from 'puppeteer';
import { relative, join, isAbsolute, dirname, posix, sep, resolve } from 'path';
import type { BoundQueries } from './pptr-testing-library';
import { getQueriesForElement } from './pptr-testing-library';
import { connectToBrowser } from './connect-to-browser';
import { parseStackTrace } from 'errorstacks';
import './extend-expect';
import { bgRed, white, options as koloristOpts, bold, red } from 'kolorist';
import { ansiColorsLog } from './ansi-colors-browser';
import _ansiRegex from 'ansi-regex';
import { fileURLToPath } from 'url';
import type { PleasantestUser } from './user';
import { pleasantestUser } from './user';
import {
  assertElementHandle,
  printStackLine,
  removeFuncFromStackTrace,
} from './utils';
import type { ModuleServerOpts } from './module-server';
import { createModuleServer } from './module-server';
import { cleanupClientRuntimeServer } from './module-server/client-runtime-server';
import { Console } from 'console';

export { JSHandle, ElementHandle } from 'puppeteer';
koloristOpts.enabled = true;
const ansiRegex = _ansiRegex({ onlyFirst: true });
export type { PleasantestUser };

export interface PleasantestUtils {
  /**
   * Execute a JS code string in the browser.
   * The code string inherits the syntax abilities of the file it is in,
   * i.e. if your test file is a .tsx file, then the code string can include JSX and TS.
   * The code string can use (static or dynamic) ES6 imports to import other modules,
   * including TS/JSX modules, and it supports resolving from node_modules,
   * and relative paths from the test file.
   * The code string supports top-level await to wait for a Promise to resolve.
   * You can pass an array of variables to be passed into the browser as the 2nd parameter.
   */
  runJS(code: string, args?: unknown[]): Promise<void>;

  /** Set the contents of a new style tag */
  injectCSS(css: string): Promise<void>;

  /** Set the contents of document.body */
  injectHTML(html: string): Promise<void>;

  /** Load a CSS (or Sass, Less, etc.) file into the browser. Pass a path that will be resolved from your test file. */
  loadCSS(cssPath: string): Promise<void>;
  /** Load a JS (or TS, JSX) file into the browser. Pass a path that will be resolved from your test file. */
  loadJS(jsPath: string): Promise<void>;
}

export interface PleasantestContext {
  /** DOM Testing Library queries that are bound to the document */
  screen: BoundQueries;
  utils: PleasantestUtils;
  /** Returns DOM Testing Library queries that only search within a single element */
  within(element: puppeteer.ElementHandle | null): BoundQueries;
  page: puppeteer.Page;
  user: PleasantestUser;
}

export interface WithBrowserOpts {
  headless?: boolean;
  device?: puppeteer.devices.Device;
  moduleServer?: ModuleServerOpts;
}

interface TestFn {
  (ctx: PleasantestContext): boolean | void | Promise<boolean | void>;
}

interface WithBrowserFn {
  (testFn: TestFn): () => Promise<void>;
  (options: WithBrowserOpts, testFn: TestFn): () => Promise<void>;
}

interface WithBrowser extends WithBrowserFn {
  headed: WithBrowserFn;
}

// Call signatures of withBrowser:
// withBrowser(() => {})
// withBrowser({ ... }, () => {})
// withBrowser.headed(() => {})
// withBrowser.headed({ ... }, () => {})

export const withBrowser: WithBrowser = (...args: any[]) => {
  const testFn: TestFn = args.length === 1 ? args[0] : args[1];
  const options: WithBrowserOpts = args.length === 1 ? {} : args[0];
  const thisFile = fileURLToPath(import.meta.url);
  // Figure out the file that called withBrowser so that we can resolve paths correctly from there
  // eslint-disable-next-line @cloudfour/unicorn/error-message
  const stack = parseStackTrace(new Error().stack as string).map(
    (stackFrame) => {
      if (stackFrame.fileName) return stackFrame.fileName;
      return /\s*at\s+([\w./-]*)/.exec(stackFrame.raw)?.[1];
    },
  );
  const testFile = stack.find((stackItem) => {
    if (!stackItem) return false;
    // ignore if it is the current file
    if (stackItem === thisFile) return false;
    // ignore if it is an internal-to-node thing
    if (!stackItem.startsWith('/')) return false;
    // Find the first item that is not the current file
    return true;
  });

  const testPath = testFile ? relative(process.cwd(), testFile) : thisFile;

  return async () => {
    const { state, cleanupServer, ...ctx } = await createTab({
      testPath,
      options,
    });
    const cleanup = async (leaveOpen: boolean) => {
      state.isTestFinished = true;
      if (!leaveOpen || options.headless) {
        await ctx.page.close();
      }

      ctx.page.browser().disconnect();
      await cleanupServer();
    };

    try {
      await testFn(ctx);
    } catch (error) {
      const messageForBrowser: undefined | unknown[] =
        // This is how we attach the elements to the error from testing-library
        error?.messageForBrowser ||
        // This is how we attach the elements to the error from jest-dom
        error?.matcherResult?.messageForBrowser;
      // Jest hangs when sending the error
      // from the worker process up to the main process
      // if the error has circular references in it
      // (which it does if there are elementHandles)
      if (error.matcherResult) delete error.matcherResult.messageForBrowser;
      delete error.messageForBrowser;
      if (!options.headless) {
        const failureMessage: unknown[] = [
          `${bold(white(bgRed(' FAIL ')))}\n\n`,
        ];
        const testName = getTestName();
        if (testName) {
          failureMessage.push(`${bold(red(`● ${testName}`))}\n\n`);
        }

        if (messageForBrowser) {
          failureMessage.push(
            ...messageForBrowser.map((segment: unknown, i) => {
              if (typeof segment !== 'string') return segment;
              if (i !== 0 && typeof messageForBrowser[i - 1] !== 'string') {
                return indent(segment, false);
              }

              return indent(segment);
            }),
          );
        } else {
          failureMessage.push(
            indent(error instanceof Error ? error.message : String(error)),
          );
        }

        await ctx.page.evaluate((...colorErr) => {
          console.log(...colorErr);
        }, ...(ansiColorsLog(...failureMessage) as any));
      }

      await cleanup(true);
      throw error;
    }

    await cleanup(false);
  };
};

withBrowser.headed = (...args: any[]) => {
  const testFn: TestFn = args.length === 1 ? args[0] : args[1];
  const options: WithBrowserOpts = args.length === 1 ? {} : args[0];
  return withBrowser({ ...options, headless: false }, testFn);
};

const getTestName = () => {
  try {
    return expect.getState().currentTestName;
  } catch {
    return null;
  }
};

const indent = (input: string, indentFirstLine = true) =>
  input
    .split('\n')
    .map((line, i) => {
      if (!indentFirstLine && i === 0) return line;
      // If there is an escape code at the beginning of the line
      // put the tab after the escape code
      // the reason for this is to prevent the indentation from getting messed up from wrapping
      // you can see this if you squish the devtools window
      const match = ansiRegex.exec(line);
      if (!match || match.index !== 0) return `  ${line}`;
      const insertPoint = match[0].length;
      return `${line.slice(0, insertPoint)}  ${line.slice(insertPoint)}`;
    })
    .join('\n');

const createTab = async ({
  testPath,
  options: {
    headless = defaultOptions.headless ?? true,
    device = defaultOptions.device,
    moduleServer: moduleServerOpts = {},
  },
}: {
  testPath: string;
  options: WithBrowserOpts;
}): Promise<
  PleasantestContext & {
    state: { isTestFinished: boolean };
    cleanupServer: () => Promise<void>;
  }
> => {
  /** Used to provide helpful warnings if things execute after the test finishes (usually means they forgot to await) */
  const state = { isTestFinished: false };
  const browser = await connectToBrowser('chromium', headless);
  const browserContext = await browser.createIncognitoBrowserContext();
  const page = await browserContext.newPage();
  const {
    requestCache,
    port,
    close: closeServer,
  } = await createModuleServer({
    ...defaultOptions.moduleServer,
    ...moduleServerOpts,
  });

  if (device) {
    if (!headless) {
      const session = await page.target().createCDPSession();
      const { windowId } = (await session.send(
        'Browser.getWindowForTarget',
      )) as any;
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          // Allow space for devtools
          // start-disowned-browser.ts sets the devtools preferences with default width
          width: device.viewport.width + 450,
          height: device.viewport.height + 79, // Allow space for toolbar
        },
      });
      await session.detach();
    }

    await page.emulate(device);
  }

  page.on('console', (message) => {
    const text = message.text();
    // This is naive, there is probably something better to check
    // If the text includes %c, then it probably came from the jest output being forwarded into the browser
    // So we don't need to print it _again_ in node, since it already came from node
    if (text.includes('%c')) return;
    const type = message.type();
    // Create a new console instance instead of using the global one
    // Because the global one is overridden by Jest, and it adds a misleading second stack trace and code frame below it
    const console = new Console(process.stdout, process.stderr);
    if (type === 'error') {
      const error = new Error(text);
      const location = message.location();
      error.stack = `Error: ${text}
    at ${location.url}`;
      console.error('[browser]', error);
    } else {
      console.log('[browser]', text);
    }
  });

  await page.goto(`http://localhost:${port}`);

  const safeEvaluate = async (
    caller: (...params: any) => any,
    ...args: Parameters<typeof page.evaluate>
  ) => {
    const forgotAwaitError = removeFuncFromStackTrace(
      new Error(
        `Cannot interact with browser using ${caller.name} after test finishes. Did you forget to await?`,
      ),
      caller,
    );
    return page.evaluate(...args).catch((error) => {
      if (state.isTestFinished && /target closed/i.test(error.message)) {
        throw forgotAwaitError;
      }

      throw error;
    });
  };

  const runJS: PleasantestUtils['runJS'] = async (code, args) => {
    // For some reason encodeURIComponent doesn't encode '
    const encodedCode = encodeURIComponent(code).replace(/'/g, '%27');
    // This uses the testPath as the url so that if there are relative imports
    // in the inline code, the relative imports are resolved relative to the test file
    const url = `http://localhost:${port}/${testPath}?inline-code=${encodedCode}`;
    const res = (await safeEvaluate(
      runJS,
      new Function(
        '...args',
        `return import(${JSON.stringify(url)})
        .then(async m => {
          if (m.default) await m.default(...args)
        })
        .catch(e =>
          e instanceof Error
            ? { message: e.message, stack: e.stack }
            : e)`,
      ) as () => any,
      ...(Array.isArray(args) ? (args as any) : []),
    )) as undefined | { message: string; stack: string };
    if (res === undefined) return;
    if (typeof res !== 'object') throw res;
    let { message, stack } = res;
    if (message.includes(`Failed to fetch dynamically imported module: ${url}`))
      message =
        'Failed to load runJS code (most likely due to a transpilation error)';

    const parsedStack = parseStackTrace(stack);
    const modifiedStack = parsedStack.map(async (stackItem) => {
      if (stackItem.raw.startsWith(stack.slice(0, stack.indexOf('\n'))))
        return null;
      if (!stackItem.fileName) return stackItem.raw;
      const fileName = stackItem.fileName;
      const line = stackItem.line;
      const column = stackItem.column;
      if (!fileName.startsWith(`http://localhost:${port}`))
        return stackItem.raw;
      const url = new URL(fileName);
      const osPath = url.pathname.slice(1).split(posix.sep).join(sep);
      // Absolute file path
      const file = resolve(process.cwd(), osPath);
      // Rollup-style Unix-normalized path "id":
      const id = file.split(sep).join(posix.sep);
      const transformResult = requestCache.get(id);
      const map = typeof transformResult === 'object' && transformResult.map;
      if (!map) {
        let p = url.pathname;
        const npmPrefix = '/@npm/';
        if (p.startsWith(npmPrefix))
          p = join(process.cwd(), 'node_modules', p.slice(npmPrefix.length));
        return printStackLine(p, line, column, stackItem.name);
      }

      const { SourceMapConsumer } = await import('source-map');
      const consumer = await new SourceMapConsumer(map as any);
      const sourceLocation = consumer.originalPositionFor({ line, column });
      consumer.destroy();
      if (sourceLocation.line === null || sourceLocation.column === null)
        return stackItem.raw;
      const mappedColumn = sourceLocation.column + 1;
      const mappedLine = sourceLocation.line;
      const mappedPath = sourceLocation.source || url.pathname;
      return printStackLine(
        mappedPath,
        mappedLine,
        mappedColumn,
        stackItem.name,
      );
    });
    const errorName = stack.slice(0, stack.indexOf(':')) || 'Error';
    const specializedErrors = {
      EvalError,
      RangeError,
      ReferenceError,
      SyntaxError,
      TypeError,
      URIError,
    } as any;
    const ErrorConstructor: ErrorConstructor =
      specializedErrors[errorName] || Error;
    const error = new ErrorConstructor(message);

    const finalStack = (await Promise.all(modifiedStack))
      .filter(Boolean)
      .join('\n');

    // If the browser error did not provide a stack, use the stack trace from node
    if (finalStack) {
      error.stack = `${errorName}: ${message}\n${finalStack}`;
    } else {
      removeFuncFromStackTrace(error, runJS);
      if (error.stack)
        error.stack = error.stack
          .split('\n')
          .filter(
            // This was appearing in stack traces and it messed up the Jest output
            (line) => !(/runMicrotasks/.test(line) && /<anonymous>/.test(line)),
          )
          .join('\n');
    }

    throw error;
  };

  const injectHTML: PleasantestUtils['injectHTML'] = async (html) => {
    await safeEvaluate(
      injectHTML,
      (html) => {
        document.body.innerHTML = html;
      },
      html,
    );
  };

  const injectCSS: PleasantestUtils['injectCSS'] = async (css) => {
    await safeEvaluate(
      injectCSS,
      (css) => {
        const styleTag = document.createElement('style');
        styleTag.innerHTML = css;
        document.head.append(styleTag);
      },
      css,
    );
  };

  const loadCSS: PleasantestUtils['loadCSS'] = async (cssPath) => {
    const fullPath = isAbsolute(cssPath)
      ? relative(process.cwd(), cssPath)
      : join(dirname(testPath), cssPath);
    await safeEvaluate(
      loadCSS,
      `import(${JSON.stringify(
        `http://localhost:${port}/${fullPath}?import`,
      )})`,
    );
  };

  const loadJS: PleasantestUtils['loadJS'] = async (jsPath) => {
    const fullPath = jsPath.startsWith('.')
      ? join(dirname(testPath), jsPath)
      : jsPath;
    await safeEvaluate(
      loadJS,
      `import(${JSON.stringify(`http://localhost:${port}/${fullPath}`)})`,
    );
  };

  const utils: PleasantestUtils = {
    runJS,
    injectCSS,
    injectHTML,
    loadCSS,
    loadJS,
  };

  const screen = getQueriesForElement(page, state);

  // The | null is so you can pass directly the result of page.$() which returns null if not found
  const within: PleasantestContext['within'] = (
    element: puppeteer.ElementHandle | null,
  ) => {
    assertElementHandle(element, within);
    return getQueriesForElement(page, state, element);
  };

  return {
    screen,
    utils,
    page,
    within,
    user: await pleasantestUser(page, state),
    state,
    cleanupServer: () => closeServer(),
  };
};

let defaultOptions: WithBrowserOpts = {};

export const configureDefaults = (options: WithBrowserOpts) => {
  defaultOptions = options;
};

export const devices = puppeteer.devices;

afterAll(async () => {
  await cleanupClientRuntimeServer();
});
