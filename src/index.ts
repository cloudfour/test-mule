import puppeteer from 'puppeteer';
import * as vite from 'vite';
import * as path from 'path';
import { getQueriesForElement } from './pptr-testing-library';
import { connectToBrowser } from './connect-to-browser';
import { parseStackTrace } from 'errorstacks';
import './extend-expect';
import { bgRed, white, options as koloristOpts, bold, red } from 'kolorist';
import { ansiColorsLog } from './ansi-colors-browser';
import { createServer, port } from './vite-server';
import _ansiRegex from 'ansi-regex';
koloristOpts.enabled = true;
const ansiRegex = _ansiRegex({ onlyFirst: true });

/** Keeps track of all the browser contexts to can clean them up later */
const browserContexts: puppeteer.BrowserContext[] = [];
let serverPromise: Promise<vite.ViteDevServer>;

/** Pages that are in "debug mode" that the user will have to manually close */
const debuggedPages = new Set();

type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;

interface WithBrowserBase {
  (
    testFn: (
      ctx: Awaited<ReturnType<typeof createTab>>,
    ) => void | Promise<void>,
    opts?: { headless?: boolean },
  ): () => Promise<void>;
}

interface WithBrowser extends WithBrowserBase {
  headed: WithBrowserBase;
}

export const withBrowser: WithBrowser = (testFn, { headless = true } = {}) => {
  // Figure out the file that called createTab so that we can resolve paths correctly from there
  const stack = parseStackTrace(new Error().stack as string).map(
    (stackFrame) => {
      if (stackFrame.fileName) return stackFrame.fileName;
      return /\s*at\s+([\w/\-.]*)/.exec(stackFrame.raw)?.[1];
    },
  );
  const testFile = stack.find((stackItem) => {
    if (!stackItem) return false;
    // ignore if it is the current file
    if (stackItem === __filename) return false;
    // ignore if it is an internal-to-node thing
    if (!stackItem.startsWith('/')) return false;
    // find the first item that is not the current file
    return true;
  });

  const testPath = testFile
    ? path.relative(process.cwd(), testFile)
    : __filename;

  return async () => {
    const ctx = await createTab({ testPath, headless });
    await Promise.resolve(testFn(ctx)).catch(async (error) => {
      let failureMessage = bold(white(bgRed(' FAIL '))) + '\n';
      const testName = getTestName();
      if (testName) {
        failureMessage += '\n' + bold(red(`● ${testName}`)) + '\n';
      }
      failureMessage += '\n' + indent(error.message);

      await ctx.page.evaluate((colorErr) => {
        console.log(...colorErr);
      }, ansiColorsLog(failureMessage));
      if (headless) await ctx.page.close();
      ctx.page.browser().disconnect();
      throw error;
    });
    // close since test passed
    await ctx.page.close();
    ctx.page.browser().disconnect();
  };
};

const getTestName = () => {
  try {
    return expect.getState().currentTestName;
  } catch {
    return null;
  }
};

const indent = (input: string) =>
  input
    .split('\n')
    .map((l) => {
      // if there is an escape code at the beginning of the line
      // put the tab after the escape code
      // the reason for this is to prevent the indentation from getting messed up from wrapping
      // you can see this if you squish the devools window
      const match = l.match(ansiRegex);
      if (!match || match.index !== 0) return '  ' + l;
      const insertPoint = match[0].length;
      return l.slice(0, insertPoint) + '  ' + l.slice(insertPoint);
    })
    .join('\n');

withBrowser.headed = (fn, opts) =>
  withBrowser(fn, { ...opts, headless: false });

const createTab = async ({
  testPath,
  headless,
}: {
  testPath: string;
  headless: boolean;
}) => {
  if (!serverPromise) serverPromise = createServer();
  const browser = await connectToBrowser('chromium', headless);
  const browserContext = await browser.createIncognitoBrowserContext();
  browserContexts.push(browserContext);
  const page = await browserContext.newPage();

  page.on('console', (message) => {
    const text = message.text();
    // ignore vite spam
    if (text.startsWith('[vite]')) return;
    // This is naive, there is probably something better to check
    // If the text includes %c, then it probably came from the jest output being forwarded into the browser
    // So we don't need to print it _again_ in node, since it already came from node
    if (text.includes('%c')) return;
    const type = message.type();
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

  await serverPromise;

  await page.goto(`http://localhost:${port}`);

  const runJS = async (code: string) => {
    const encodedCode = encodeURIComponent(code);
    // This uses the testPath as the url so that if there are relative imports
    // in the inline code, the relative imports are resolved relative to the test file
    const url = `http://localhost:${port}/${testPath}?inline-code=${encodedCode}`;
    await page.evaluateHandle(`import(${JSON.stringify(url)})`).catch((e) => {
      debuggedPages.add(page);
      throw e;
    });
  };

  const debug = () => {
    if (headless) {
      throw removeFuncFromStackTrace(
        new Error(
          'debug() can only be used in headed mode. Pass { headless: false } to createTab()',
        ),
        debug,
      );
    }
    debuggedPages.add(page);
    throw removeFuncFromStackTrace(new Error('[debug mode]'), debug);
  };

  /** Set the contents of document.body */
  const injectHTML = async (html: string) => {
    await page.evaluate((html) => {
      document.body.innerHTML = html;
    }, html);
  };

  /** Set the contents of a new style tag */
  const injectCSS = async (css: string) => {
    await page.evaluate((css) => {
      const styleTag = document.createElement('style');
      styleTag.innerHTML = css;
      document.head.append(styleTag);
    }, css);
  };

  /** Load a CSS (or sass, less, etc.) file. Pass a path that will be resolved from your test file */
  const loadCSS = async (cssPath: string) => {
    const fullPath = path.join(path.dirname(testPath), cssPath);
    await page.evaluateHandle(
      `import(${JSON.stringify(
        `http://localhost:${port}/${fullPath}?import`,
      )})`,
    );
  };

  /** Load a JS (or TS, JSX) file. Pass a path that will be resolved from your test file */
  const loadJS = async (jsPath: string) => {
    const fullPath = jsPath.startsWith('.')
      ? path.join(path.dirname(testPath), jsPath)
      : jsPath;
    await page.evaluateHandle(
      `import(${JSON.stringify(`http://localhost:${port}/${fullPath}`)})`,
    );
  };

  const utils = { runJS, injectCSS, injectHTML, loadCSS, loadJS };

  const screen = getQueriesForElement(page);

  /** Returns DOM Testing Library queries that only search within a single element */
  // the | null is so you can pass directly the result of page.$() which returns null if not found
  const within = (element: puppeteer.ElementHandle | null) => {
    const type =
      element === null
        ? 'null'
        : // @ts-expect-error this is doing manual type checking
        typeof element === 'object' && Promise.resolve(element) === element // https://stackoverflow.com/questions/27746304/how-do-i-tell-if-an-object-is-a-promise/38339199#38339199
        ? 'Promise'
        : typeof element;
    if (type === 'Promise') {
      throw removeFuncFromStackTrace(
        new Error(
          `Must pass elementhandle to within(el), received ${type}. Did you forget await?`,
        ),
        within,
      );
    }
    if (type !== 'object' || element === null || !element.asElement) {
      throw removeFuncFromStackTrace(
        new Error(`Must pass elementhandle to within(el), received ${type}`),
        within,
      );
    }
    // returns null if it is a JSHandle that does not point to an element
    const el = element.asElement();
    if (!el) {
      throw new Error(
        'Must pass elementhandle to within(el), received a JSHandle that did not point to an element',
      );
    }
    return getQueriesForElement(page, element);
  };

  return { screen, debug, utils, page, within };
};

/**
 * Manipulate the stack trace and remove fn from it
 * That way jest will show a code frame from the user's code, not ours
 * https://kentcdodds.com/blog/improve-test-error-messages-of-your-abstractions
 */
const removeFuncFromStackTrace = (
  error: Error,
  fn: (...params: any[]) => any,
) => {
  if (Error.captureStackTrace) {
    Error.captureStackTrace(error, fn);
  }
  return error;
};

afterAll(async () => {
  if (serverPromise) {
    const server = await serverPromise;
    await server.close();
  }
});
