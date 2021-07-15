# Pleasantest

Pleasantest is a library that allows you test web applications using real browsers in your Jest tests. Pleasantest is focused on helping you write tests that are [as similar as possible to how users use your application](https://twitter.com/kentcdodds/status/977018512689455106).

## Pleasantest Goals

- Use a real browser so that the test environment is the same as what a real user uses.
- Integrate with existing tests - browser testing should not be a "separate thing" from other tests.
- Build on top of existing [Testing Library](https://testing-library.com) tools.
- Make the testing experience as fast and painless as possible.

---

- [Usage](#usage)
  - [Getting Started](#getting-started)
  - [Loading Content](#loading-content)
  - [Selecting Rendered Elements](#selecting-rendered-elements)
  - [Making Assertions](#making-assertions)
  - [Performing Actions](#performing-actions)
  - [Loading Styles](#loading-styles)
  - [Troubleshooting/Debugging a Failing Test](#troubleshootingdebugging-a-failing-test)
  - [Actionability](#actionability)
- [Full Example](#full-example)
- [API](#api)
  - [`withBrowser`](#withbrowser)
  - [`PleasantestContext`](#pleasantestcontext-object-passed-into-test-function-wrapped-by-withbrowser)
  - [User API: `PleasantestUser`](#user-api-pleasantestuser)
  - [Utilities API: `PleasantestUtils`](#utilities-api-pleasantestutils)
  - [`jest-dom` Matchers](#jest-dom-matchers)
- [Puppeteer Tips](#puppeteer-tips)
- [Comparisons with other testing tools](#comparisons-with-other-testing-tools)
- [Limitations](#limitationsarchitectural-decisions)

## Usage

### Getting Started

Pleasantest integrates with Jest tests. If you haven't set up Jest yet, [here is Jest's getting started guide](https://jestjs.io/docs/en/getting-started).

```
npm i -D jest pleasantest
```

Then you can enable support for `import` statements in Jest by running:

```
npm i -D babel-jest @babel/core @babel/preset-env
```

and then adding to your Babel config (if you don't have one yet, create a `babel.config.js` at the root of your project):

```js
// babel.config.js
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
```

If you are using Babel outside of Jest, you can make your Babel config change based on whether it is being used in Jest, by following [these instructions](https://jestjs.io/docs/getting-started#using-babel).

Then you can create a test file, for example `something.test.ts`:

```js
test('test name', () => {
  // Your test code here
});
```

To add Pleasantest to the test, wrap the test function with [`withBrowser`](#withbrowser), and mark the function as `async`. The `withBrowser` wrapper tells Pleasantest to launch a browser for the test. By default, a headless browser will be launched. The browser will close at the end of the test, unless the test failed. It is possible to have browser tests and non-browser tests in the same test suite.

```js
import { withBrowser } from 'pleasantest';

test(
  'test name',
  withBrowser(async () => {
    // Your test code here
  }),
);
```

### Loading Content

#### Option 1: Rendering using a client-side framework

If your app is client-side rendered, you can use [`utils.runJS`](#pleasantestutilsrunjscode-string-promisevoid) to tell Pleasantest how to render your app:

```js
import { withBrowser } from 'pleasantest';

test(
  'client side framework rendering',
  withBrowser(async ({ utils }) => {
    await utils.runJS(`
      // ./app could be a .js, .jsx .ts, or .tsx file
      import { App } from './app'
      import { render } from 'react-dom'

      render(<App />, document.body)
    `);
  }),
);
```

#### Option 2: Injecting HTML content

If you have the HTML content available as a string, you can use that as well, using [`utils.injectHTML`](#pleasantestutilsinjecthtmlhtml-string-promisevoid):

```js
import { withBrowser } from 'pleasantest';

const htmlString = `
  <h1>This is the HTML content</h1>
`;

test(
  'injected html',
  withBrowser(async ({ utils }) => {
    await utils.injectHTML(htmlString);
  }),
);
```

You could also load the HTML string from another file, for example if you are using [handlebars](https://handlebarsjs.com):

```js
import { withBrowser } from 'pleasantest';
import fs from 'fs';
import Handlebars from 'handlebars';

const template = Handlebars.compile(fs.readFileSync('./content.hbs', 'utf8'));
const htmlString = template({ dataForTemplate: 'something' });

test(
  'injected html from external file',
  withBrowser(async ({ utils }) => {
    await utils.injectHTML(htmlString);
  }),
);
```

#### Option 3: Navigating to a real page

You can start a web server for your code (separately from Jest) and navigate to the site. This is similar to how [Cypress](https://www.cypress.io) works.

You can navigate using Puppeteer's `page.goto` method. [The `page` object comes from `PleasantestContext`](#pleasantestcontextpage). which is a parameter to the `withBrowser` callback:

```js
import { withBrowser } from 'pleasantest';

test(
  'navigating to real site',
  withBrowser(async ({ page }) => {
    await page.goto('http://localhost:3000');
  }),
);
```

### Selecting Rendered Elements

You can use [Testing Library queries](https://testing-library.com/docs/queries/about#overview) to find elements on the page. The goal is to select elements in a way similar to how a user would; for example by selecting based on a button's text rather than its class name.

The Testing Library queries are exposed through the [`screen` property](#pleasantestcontextscreen) in the test context parameter.

> :warning: **Don't forget to `await` the result of the query!** This is necessary because of the asynchronous communication with the browser. If you forget, your matchers may execute after your test finishes, and you may get obscure errors.

```js
import { withBrowser } from 'pleasantest';

test(
  'selecting elements example',
  withBrowser(async ({ utils, screen }) => {
    await utils.injectHTML('<button>Log In</button>');

    const loginButton = await screen.getByText(/log in/i);
  }),
);
```

Sometimes, you may want to traverse the DOM tree to find parent, sibling, or descendant elements. Pleasantest communicates asynchronously with the browser, so you do not have synchronous access to the DOM tree. You can use [`ElementHandle.evaluate`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-elementhandleevaluatepagefunction-args) to run code in the browser using an `ElementHandle` returned from a query:

```js
import { withBrowser } from 'pleasantest';

test(
  'DOM traversal with ElementHandle.evaluate',
  withBrowser(async ({ utils, screen }) => {
    const button = await screen.getByText(/search/i);
    // Because the evaluate callback function runs in the browser,
    // it does not have access to variables from the scope it is defined in.
    const container = await button.evaluate((buttonEl) => buttonEl.parentNode);
  }),
);
```

### Making Assertions

You can use [`jest-dom`'s matchers](https://github.com/testing-library/jest-dom#table-of-contents) to make assertions against the state of the document.

> :warning: **Don't forget to `await` assertions!** This is necessary because the matchers execute in the browser. If you forget, your matchers may execute after your test finishes, and you may get obscure errors.

```js
import { withBrowser } from 'pleasantest';

test(
  'making assertions example',
  withBrowser(async ({ utils, screen }) => {
    await utils.injectHTML('<button>Log In</button>');

    const loginButton = await screen.getByText(/log in/i);

    await expect(loginButton).toBeVisible();
    await expect(loginButton).not.toBeDisabled();
  }),
);
```

### Performing Actions

You can use the [User API](#user-api-pleasantestuser) to perform actions in the browser.

If the User API is missing a method that you need, you can instead use [methods on `ElementHandle`s directly](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-elementhandle)

```js
test(
  'performing actions example',
  withBrowser(async ({ utils, screen, user }) => {
    await utils.injectHTML('<button>Log In</button>');

    const loginButton = await screen.getByText(/log in/i);

    await expect(loginButton).toBeVisible();
    await expect(loginButton).not.toBeDisabled();

    // Click using the User API
    await user.click(loginButton);

    // User API does not support `.hover` yet, so we perform the action directly on the ElementHandle instead:
    await loginButton.hover();
  }),
);
```

### Loading Styles

This might be helpful if your tests depend on CSS classes that change the visibility of elements.

If you loaded your content by navigating to a real page, you shouldn't have to worry about this; your CSS should already be loaded. Also, if you rendered your content using a client-side framework and you import your CSS (or Sass, Less, etc.) into your JS (i.e. `import './something.css'`), then it should also just work.

Otherwise, you need to manually tell Pleasantest to load your CSS, using [`utils.loadCSS`](#pleasantestutilsloadcsscsspath-string-promisevoid)

```js
import { withBrowser } from 'pleasantest';

test(
  'loading css with utils.loadCSS',
  withBrowser(async ({ utils }) => {
    // ... Whatever code you had before to load your content

    // You can import CSS (or Sass, Less, etc.) files
    await utils.loadCSS('./something.css');
  }),
);
```

### Troubleshooting/Debugging a Failing Test

1. Switch to headed mode to open a visible browser and see what is going on. You can use the DOM inspector, network tab, console, and anything else that might help you figure out what is wrong.

```js
import { withBrowser } from 'pleasantest';

test(
  'test name',
  withBrowser.headed(async () => {
    // Your test code here
  }),
);
```

2. Log queried elements in the headed browser.

```js
import { withBrowser } from 'pleasantest';

test(
  'test name',
  withBrowser.headed(async ({ screen, page }) => {
    const button = screen.getByText(/login/i);
    // Maybe the query returned an element that I didn't expect
    // We can log the element that was returned by the query, in the browser:
    await button.evaluate((el) => console.log(el));
  }),
);
```

### Actionability

Pleasantest performs actionability checks when interacting with the page using the [User API](#user-api-pleasantestuser). This concept is closely modeled after [Cypress](https://docs.cypress.io/guides/core-concepts/interacting-with-elements.html#Actionability) and [Playwright's](https://playwright.dev/docs/actionability) implementations of actionability.

The core concept behind actionability is that if a real user would not be able to perform an action in your page, you should not be able to perform the actions in your test either. For example, since a user cannot click on an invisible element, your test should not allow you to click on invisible elements.

We are working on adding more actionability checks.

Here are the actionability checks that are currently implemented. Different methods in the User API perform different actionability checks based on what makes sense. In the API documentation for the [User API](#user-api-pleasantestuser), the actionability checks that each method performs are listed.

#### Attached

Ensures that the element is attached to the DOM, using [`Node.isConnected`](https://developer.mozilla.org/en-US/docs/Web/API/Node/isConnected). For example, if you use `document.createElement()`, the created element is not attached to the DOM until you use `ParentNode.append()` or similar.

#### Visible

Ensures that the element is visible to a user. Currently, the following checks are performed (more will likely be added):

- Element is [Attached](#attached) to the DOM
- Element does not have `display: none` or `visibility: hidden`
- Element has a size (its [bounding box](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) has a non-zero width and height)
- Element's opacity is greater than 0.05 (opacity of parent elements are considered)

## Full Examples

You can find more detailed examples in the [examples folder](./examples/).

- [Elastic Textarea](./examples/elastic-textarea/elastic-textarea.test.ts)
- [Menu](./examples/menu/index.test.ts)

## API

### `withBrowser`

Use `withBrowser` to wrap any test function that needs access to a browser:

```js
import { withBrowser } from 'pleasantest';

test(
  'test name',
  withBrowser(async () => {
    // Your test code here
  }),
);
```

Call Signatures:

- `withBrowser(testFn: (context: PleasantestContext) => Promise<void>)`
- `withBrowser(opts: WithBrowserOpts, testFn: (context: PleasantestContext) => Promise<void>)`
- `withBrowser.headed(testFn: (context: PleasantestContext) => Promise<void>)`
- `withBrowser.headed(opts: WithBrowserOpts, testFn: (context: PleasantestContext) => Promise<void>)`

`WithBrowserOpts`:

- `headless`: `boolean`, default `true`: Whether to open a headless (not visible) browser. If you use the `withBrowser.headed` chain, that will override the value of `headless`.
- `device`: Device Object [described here](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pageemulateoptions).

By default, `withBrowser` will launch a headless Chromium browser. You can tell it to instead launch a headed (visible) browser by chaining `.headed`:

```js
import { withBrowser } from 'pleasantest';

test(
  'test name',
  withBrowser.headed(async () => {
    // Your test code here
  }),
);
```

If the test passes, the browser will close. You can force the browser to stay open by making the test fail by throwing something, for example `throw new Error('leave the browser open')`

You can also emulate a device viewport and user agent, by passing the `device` property to the options object in `withBrowser`:

```js
import { withBrowser, devices } from 'pleasantest';
const iPhone = devices['iPhone 11'];

test(
  'test name',
  withBrowser({ device: iPhone }, async () => {
    // Your test code here
  }),
);
```

The `devices` import from `pleasantest` is re-exported from Puppeteer, [here is the full list of available devices](https://github.com/puppeteer/puppeteer/blob/v7.1.0/src/common/DeviceDescriptors.ts).

### `PleasantestContext` Object (passed into test function wrapped by `withBrowser`)

#### `PleasantestContext.screen`

The `PleasantestContext` object exposes the [`screen`](https://testing-library.com/docs/queries/about/#screen) property, which is an [object with Testing Library queries pre-bound to the document](https://testing-library.com/docs/queries/about/#screen). All of the [Testing Library queries](https://testing-library.com/docs/queries/about#overview) are available. These are used to find elements in the DOM for use in your tests. There is one difference in how you use the queries in Pleasantest compared to Testing Library: in Pleasantest, all queries must be `await`ed to handle the time it takes to communicate with the browser. In addition, since your tests are running in Node, the queries return Promises that resolve to [`ElementHandle`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-elementhandle)'s from Puppeteer.

List of queries attached to screen object:

- [`byRole`](https://testing-library.com/docs/queries/byrole): `getByRole`, `queryByRole`, `getAllByRole`, `queryAllByRole`, `findByRole`, `findAllByRole`
- [`byLabelText`](https://testing-library.com/docs/queries/bylabeltext): `getByLabelText`, `queryByLabelText`, `getAllByLabelText`, `queryAllByLabelText`, `findByLabelText`, `findAllByLabelText`
- [`byPlaceholderText`](https://testing-library.com/docs/queries/byplaceholdertext): `getByPlaceholderText`, `queryByPlaceholderText`, `getAllByPlaceholderText`, `queryAllByPlaceholderText`, `findByPlaceholderText`, `findAllByPlaceholderText`
- [`byText`](https://testing-library.com/docs/queries/bytext): `getByText`, `queryByText`, `getAllByText`, `queryAllByText`, `findByText`, `findAllByText`
- [`byDisplayValue`](https://testing-library.com/docs/queries/bydisplayvalue): `getByDisplayValue`, `queryByDisplayValue`, `getAllByDisplayValue`, `queryAllByDisplayValue`, `findByDisplayValue`, `findAllByDisplayValue`
- [`byAltText`](https://testing-library.com/docs/queries/byalttext): `getByAltText`, `queryByAltText`, `getAllByAltText`, `queryAllByAltText`, `findByAltText`, `findAllByAltText`
- [`byTitle`](https://testing-library.com/docs/queries/bytitle): `getByTitle`, `queryByTitle`, `getAllByTitle`, `queryAllByTitle`, `findByTitle`, `findAllByTitle`
- [`byTestId`](https://testing-library.com/docs/queries/bytestid): `getByTestId`, `queryByTestId`, `getAllByTestId`, `queryAllByTestId`, `findByTestId`, `findAllByTestId`

```js
import { withBrowser } from 'pleasantest';

test(
  'test name',
  withBrowser(async ({ screen }) => {
    //                 ^^^^^^

    const helloElement = await screen.getByText(/hello/i);
  }),
);
```

#### `PleasantestContext.within(element: ElementHandle)`

The `PleasantestContext` object exposes the `within` property, which is similar to [`screen`](#pleasantestcontextscreen), but instead of the queries being pre-bound to the document, they are pre-bound to whichever element you pass to it. [Here's Testing Library's docs on `within`](https://testing-library.com/docs/dom-testing-library/api-within). Like `screen`, it returns an object with all of the pre-bound Testing Library queries.

```js
import { withBrowser } from 'pleasantest';

test(
  'test name',
  withBrowser(async ({ within, screen }) => {
    //                 ^^^^^^
    const containerElement = await screen.getByText(/hello/i);
    const container = within(containerElement);

    // Now `container` has queries bound to the container element
    // You can use `container` in the same way as `screen`

    // Find elements matching /some element/i within the container element.
    const someElement = await container.getByText(/some element/i);
  }),
);
```

#### `PleasantestContext.page`

The `PleasantestContext` object exposes the `page` property, which is an instance of Puppeteer's [`Page` class](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-page). This will most often be used for navigation ([`page.goto`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagegotourl-options)), but you can do anything with it that you can do with puppeteer.

```js
import { withBrowser } from 'pleasantest';

test(
  'test name',
  withBrowser(async ({ page }) => {
    //                 ^^^^

    // Navigate to a page
    await page.goto('https://google.com');

    // Get access to the BrowserContext object
    const browser = page.browserContext();
  }),
);
```

#### `PleasantestContext.user`: `PleasantestUser`

See the [`PleasantestUser`](#user-api-pleasantestuser) documentation.

#### `PleasantestContext.utils`: `PleasantestUtils`

See the [`PleasantestUtils`](#utilities-api-pleasantestutils) documentation.

### User API: `PleasantestUser`

The user API allows you to perform actions on behalf of the user. If you have used [`user-event`](https://github.com/testing-library/user-event), then this API will feel familiar. This API is exposed via the [`user` property in `PleasantestContext`](#pleasantestcontextuser-pleasantestuser).

#### `PleasantestUser.click(element: ElementHandle, options?: { force?: boolean }): Promise<void>`

Clicks an element, if the element is visible and the center of it is not covered by another element. If the center of the element is covered by another element, an error is thrown. This is a thin wrapper around Puppeteer's [`ElementHandle.click` method](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-elementhandleclickoptions). The difference is that `PleasantestUser.click` checks that the target element is an element that actually can be clicked before clicking it!

**Actionability checks**: It refuses to click elements that are not [**attached**](#attached) or not [**visible**](#visible). You can override the visibility check by passing `{ force: true }`.

Additionally, it refuses to click an element if there is another element covering it. `{ force: true }` overrides this behavior.

```js
import { withBrowser } from 'pleasantest';

test(
  'click example',
  withBrowser(async ({ utils, user, screen }) => {
    await utils.injectHTML('<button>button text</button>');
    const button = await screen.getByRole('button', { name: /button text/i });
    await user.click(button);
  }),
);
```

#### `PleasantestUser.type(element: ElementHandle, text: string, options?: { force?: boolean, delay?: number }): Promise<void>`

Types text into an element, if the element is visible. The element must be an `<input>` or `<textarea>` or have `[contenteditable]`.

If the element already has text in it, the additional text is appended to the existing text. **This is different from Puppeteer and Playwright's default .type behavior**.

The `delay` option controls the amount of time (ms) between keypresses (defaults to 1ms).

**Actionability checks**: It refuses to type into elements that are not [**attached**](#attached) or not [**visible**](#visible). You can override the visibility check by passing `{ force: true }`.

In the text, you can pass special commands using curly brackets to trigger special keypresses, similar to [user-event](https://github.com/testing-library/user-event#special-characters) and [Cypress](https://docs.cypress.io/api/commands/type.html#Arguments). Open an issue if you want more commands available here! Note: If you want to simulate individual keypresses independent from a text field, you can use Puppeteer's [page.keyboard API](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagekeyboard)

| Text string    | Key        | Notes                                                                                   |
| -------------- | ---------- | --------------------------------------------------------------------------------------- |
| `{enter}`      | Enter      |                                                                                         |
| `{tab}`        | Tab        |                                                                                         |
| `{backspace}`  | Backspace  |                                                                                         |
| `{del}`        | Delete     |                                                                                         |
| `{selectall}`  | N/A        | Selects all the text of the element. Does not work for elements using `contenteditable` |
| `{arrowleft}`  | ArrowLeft  |                                                                                         |
| `{arrowright}` | ArrowRight |                                                                                         |
| `{arrowup}`    | ArrowUp    |                                                                                         |
| `{arrowdown}`  | ArrowDown  |                                                                                         |

```js
import { withBrowser } from 'pleasantest';

test(
  'type example',
  withBrowser(async ({ utils, user, screen }) => {
    await utils.injectHTML('<input />');
    const input = await screen.getByRole('textbox');
    await user.type(input, 'this is some text..{backspace}{arrowleft} asdf');
  }),
);
```

#### `PleasantestUser.clear(element: ElementHandle, options?: { force?: boolean }): Promise<void>`

Clears a text input's value, if the element is visible. The element must be an `<input>` or `<textarea>`.

**Actionability checks**: It refuses to clear elements that are not [**attached**](#attached) or not [**visible**](#visible). You can override the visibility check by passing `{ force: true }`.

```js
import { withBrowser } from 'pleasantest';

test(
  'clear example',
  withBrowser(async ({ utils, user, screen }) => {
    await utils.injectHTML('<input value="text"/>');
    const input = await screen.getByRole('textbox');
    await user.clear(input);
  }),
);
```

#### `PleasantestUser.selectOptions(element: ElementHandle, values: ElementHandle | ElementHandle[] | string[] | string, options?: { force?: boolean }): Promise<void>`

Selects the specified option(s) of a `<select>` or a `<select multiple>` element. Values can be passed as either strings (option values) or as [`ElementHandle`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-elementhandle) references to elements.

**Actionability checks**: It refuses to select in elements that are not [**attached**](#attached) or not [**visible**](#visible). You can override the visibility check by passing `{ force: true }`.

```js
import { withBrowser } from 'pleasantest';

test(
  'select example',
  withBrowser(async ({ utils, user, screen }) => {
    await utils.injectHTML(`
      <select>
        <option value="1">A</option>
        <option value="2">B</option>
        <option value="3">C</option>
      </select>,
    `);
    const selectEl = await screen.getByRole('combobox');
    await user.selectOptions(selectEl, '2');
    await expect(selectEl).toHaveValue('2');
  }),
);
```

### Utilities API: `PleasantestUtils`

The utilities API provides shortcuts for loading and running code in the browser. The methods are wrappers around behavior that can be performed more verbosely with the [Puppeteer `Page` object](#pleasantestcontextpage). This API is exposed via the [`utils` property in `PleasantestContext`](#pleasantestcontextutils-pleasantestutils)

#### `PleasantestUtils.runJS(code: string): Promise<void>`

Execute a JS code string in the browser. The code string inherits the syntax abilities of the file it is in, i.e. if your test file is a `.tsx` file, then the code string can include JSX and TS. The code string can use (static or dynamic) ES6 imports to import other modules, including TS/JSX modules, and it supports resolving from `node_modules`, and relative paths from the test file. The code string supports top-level await to wait for a Promise to resolve. Since the code in the string is only a string, you cannot access variables that are defined in the Node.js scope. It is proably a bad idea to use interpolation in the code string, only static strings should be used, so that the source location detection works when an error is thrown.

The code that is allowed in `runJS` is designed to work similarly to the [TC39 Module Blocks Proposal](https://github.com/tc39/proposal-js-module-blocks), and eventually we hope to be able to switch to that official syntax.

```js
import { withBrowser } from 'pleasantest';

test(
  'runJS example',
  withBrowser(async ({ utils }) => {
    await utils.runJS(`
      // ./other-file is resolved from the test file that called `runJS`
      import { render } from './other-file'
      // top-level await is supported
      await render()
    `);
  }),
);
```

To pass variables from the test environment into the browser, you can pass them as the 2nd parameter. Note that they must either be JSON-serializable or they can be a [`JSHandle`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-jshandle) or an [`ElementHandle`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-elementhandle). The arguments can be received in the browser as parameters to a default-exported function:

```js
import { withBrowser } from 'pleasantest';

test(
  'runJS example with argument',
  withBrowser(async ({ utils, screen }) => {
    // element is an ElementHandle (pointer to an element in the browser)
    const element = await screen.getByText(/button/i);
    // we can pass element into runJS and the default exported function can access it as an Element
    await utils.runJS(
      `
        export default (element) => console.log(element);
      `,
      [element],
    );
  }),
);
```

#### `PleasantestUtils.loadJS(jsPath: string): Promise<void>`

Load a JS (or TS, JSX) file into the browser. Pass a path that will be resolved from your test file.

```js
import { withBrowser } from 'pleasantest';

test(
  'loadJS example',
  withBrowser(async ({ utils }) => {
    await utils.loadJS('./button');
  }),
);
```

#### `PleasantestUtils.loadCSS(cssPath: string): Promise<void>`

Load a CSS (or Sass, Less, etc.) file into the browser. Pass a path that will be resolved from your test file.

```js
import { withBrowser } from 'pleasantest';

test(
  'loadCSS example',
  withBrowser(async ({ utils }) => {
    await utils.loadCSS('./button.css');
  }),
);
```

#### `PleasantestUtils.injectCSS(css: string): Promise<void>`

Set the contents of a new `<style>` tag.

```js
import { withBrowser } from 'pleasantest';

test(
  'injectCSS example',
  withBrowser(async ({ utils }) => {
    await utils.injectCSS(`
      .button {
        background: green;
      }
    `);
  }),
);
```

#### `PleasantestUtils.injectHTML(html: string): Promise<void>`

Set the contents of `document.body`.

```js
import { withBrowser } from 'pleasantest';

test(
  'injectHTML example',
  withBrowser(async ({ utils }) => {
    await utils.injectHTML(`
      <h1>Hi</h1>
    `);
  }),
);
```

### [`jest-dom`](https://github.com/testing-library/jest-dom) Matchers

Pleasantest adds [`jest-dom`'s matchers](https://github.com/testing-library/jest-dom#table-of-contents) to Jest's `expect` global. They are slightly modified from the original matchers, they are wrapped to execute in the browser, and return a Promise.

List of matchers:

[`toBeDisabled`](https://github.com/testing-library/jest-dom#tobedisabled), [`toBeEnabled`](https://github.com/testing-library/jest-dom#tobeenabled), [`toBeEmptyDOMElement`](https://github.com/testing-library/jest-dom#tobeemptydomelement), [`toBeInTheDocument`](https://github.com/testing-library/jest-dom#tobeinthedocument), [`toBeInvalid`](https://github.com/testing-library/jest-dom#tobeinvalid), [`toBeRequired`](https://github.com/testing-library/jest-dom#toberequired), [`toBeValid`](https://github.com/testing-library/jest-dom#tobevalid), [`toBeVisible`](https://github.com/testing-library/jest-dom#tobevisible), [`toContainElement`](https://github.com/testing-library/jest-dom#tocontainelement), [`toContainHTML`](https://github.com/testing-library/jest-dom#tocontainhtml), [`toHaveAccessibleDescription`](https://github.com/testing-library/jest-dom#tohaveaccessibledescription), [`toHaveAccessibleName`](https://github.com/testing-library/jest-dom#tohaveaccessiblename), [`toHaveAttribute`](https://github.com/testing-library/jest-dom#tohaveattribute), [`toHaveClass`](https://github.com/testing-library/jest-dom#tohaveclass), [`toHaveFocus`](https://github.com/testing-library/jest-dom#tohavefocus), [`toHaveFormValues`](https://github.com/testing-library/jest-dom#tohaveformvalues), [`toHaveStyle`](https://github.com/testing-library/jest-dom#tohavestyle), [`toHaveTextContent`](https://github.com/testing-library/jest-dom#tohavetextcontent), [`toHaveValue`](https://github.com/testing-library/jest-dom#tohavevalue), [`toHaveDisplayValue`](https://github.com/testing-library/jest-dom#tohavedisplayvalue), [`toBeChecked`](https://github.com/testing-library/jest-dom#tobechecked), [`toBePartiallyChecked`](https://github.com/testing-library/jest-dom#tobepartiallychecked), [`toHaveErrorMessage`](https://github.com/testing-library/jest-dom#tohaveerrormessage).
.

> :warning: **Don't forget to `await` matchers!** This is necessary because the matchers execute in the browser. If you forget, your matchers may execute after your test finishes, and you may get obscure errors.

```js
import { withBrowser } from 'pleasantest';

test(
  'jest-dom matchers example',
  withBrowser(async ({ screen }) => {
    const button = await screen.getByRole('button');
    // jest-dom matcher -- Runs in browser, *must* be awaited
    await expect(button).toBeVisible();
    // Built-in Jest matcher -- Runs only in Node, does not need to be awaited
    expect(5).toEqual(5);
  }),
);
```

## Puppeteer Tips

Pleasantest uses [Puppeteer](https://github.com/puppeteer/puppeteer) under the hood. You don't need to know how to use Puppeteer in order to use Pleasantest, but a little bit of Puppeteer knowledge might come in handy. Here are the parts of Puppeteer that are most helpful and relevant for Pleasantest:

### [`ElementHandle`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-elementhandle)

An `ElementHandle` is a reference to a DOM element in the browser. When you use one of the [Testing Library queries](#pleasantestcontextscreen) to find elements, the queries return promises that resolve to `ElementHandle`s.

You can use the [`.evaluate`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-elementhandleevaluatepagefunction-args) method to execute code in the browser, using a reference to the actual `Element` instance that the `ElementHandle` points to. For example, if you want to get the [`innerText`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText) of an element:

```js
import { withBrowser } from 'pleasantest';

test(
  'Puppeteer .evaluate example',
  withBrowser(async ({ screen }) => {
    const button = await screen.getByRole('button');
    const text = await button.evaluate((buttonEl) => {
      // Everything inside this callback runs inside the browser

      // buttonEl is the Element instance corresponding to the button ElementHandle
      return buttonEl.innerText;
    });
    // text is the string that was returned by the evaluate callback
  }),
);
```

Sometimes, you may want to return another `ElementHandle` from the browser callback, or some other value that can't be serialized in order to be transferred from the browser to Node. To do this, you can use the [`.evaluateHandle`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-elementhandleevaluatehandlepagefunction-args) method. In this example, we want to get a reference to the parent of an element.

```js
import { withBrowser } from 'pleasantest';

test(
  'Puppeteer .evaluate example',
  withBrowser(async ({ screen }) => {
    const button = await screen.getByRole('button');
    const parentOfButton = await button.evaluateHandle((buttonEl) => {
      // buttonEl is the Element instance corresponding to the button ElementHandle
      return buttonEl.parentElement; // We return another Element
    });
    // parentOfButton is another ElementHandle
  }),
);
```

### [`Page`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-page)

The page object is one of the properties that is passed into the test callback by [`withBrowser`](#withbrowser). You can use `.evaluate` and `.evaluateHandle` on `Page`, and those methods work the same as on `ElementHandle`.

Here are some useful methods that are exposed through `Page`:

[`page.cookies`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagecookiesurls), [`page.emulateMediaFeatures`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pageemulatemediafeaturesfeatures), [`page.emulateNetworkConditions`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pageemulatenetworkconditionsnetworkconditions), [`page.evaluate`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pageevaluatepagefunction-args), [`page.evaluateHandle`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pageevaluatehandlepagefunction-args), [`page.exposeFunction`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pageexposefunctionname-puppeteerfunction), [`page.goBack`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagegobackoptions), [`page.goForward`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagegoforwardoptions), [`page.goto`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagegotourl-options), [`page.metrics`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagemetrics), [`page.reload`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagereloadoptions), [`page.screenshot`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagescreenshotoptions), [`page.setGeolocation`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagesetgeolocationoptions), [`page.setOfflineMode`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagesetofflinemodeenabled), [`page.setRequestInterception`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagesetrequestinterceptionvalue-cachesafe), [`page.title`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagetitle), [`page.url`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pageurl), [`page.waitForNavigation`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-pagewaitfornavigationoptions), [`page.browserContext().overridePermissions`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-browsercontextoverridepermissionsorigin-permissions), [`page.keyboard.press`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-keyboardpresskey-options), [`page.mouse.move`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-mousemovex-y-options), [`page.mouse.click`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-mouseclickx-y-options), [`page.touchscreen.tap`](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-touchscreentapx-y)

## Comparisons with other testing tools

### [Cypress](https://www.cypress.io/)

Cypress is a browser testing tool that specializes in end-to-end tests.

- Cypress is not integrated with Jest.
- Cypress is not well-suited for testing individual components of an application, it specializes in end-to-end tests. Note: this will change as [Component Testing](https://docs.cypress.io/guides/component-testing/introduction.html#Getting-Started) support stabilizes.
- Cypress uses different assertion syntax from Jest. If you are using Cypress for browser tests, and Jest for non-browser tests, it can be difficult to remember both the Chai assertions and the Jest assertions.
- Cypress's chaining syntax increases the barrier to entry over using native JS promises with `async`/`await`. In many ways Cypress implements a "Cypress way" of doing things that is different from the intuitive way for people who are familiar with JavaScript.
- Cypress does not have first-class support for [Testing Library](https://testing-library.com) (though there is a [plugin](https://github.com/testing-library/cypress-testing-library)).
- Cypress [does not support having multi-tab tests](https://docs.cypress.io/guides/references/trade-offs.html#Multiple-tabs).

### [jsdom](https://github.com/jsdom/jsdom) + Jest

Jest uses [jsdom](https://github.com/jsdom/jsdom) and exposes browser-like globals to your tests (like `document` and `window`). This is helpful to write tests for browser code, for example using [DOM Testing Library](https://testing-library.com/docs/dom-testing-library/intro/), [React Testing Library](https://testing-library.com/docs/react-testing-library/intro), or something similar. However, there are some downsides to this approach because jsdom is not a real browser:

- jsdom does not implement a rendering engine. It does not render visual content. Because of this, your tests may pass, even when your code is broken, and your tests may fail even when your code is correct.
- jsdom is [missing many browser API's](https://github.com/jsdom/jsdom#unimplemented-parts-of-the-web-platform). If your code uses API's unsupported by jsdom, you'd have to patch them in. Since Pleasantest uses a real browser, any API's that Chrome supports can be used.
- jsdom does not support [navigation](https://github.com/jsdom/jsdom#unimplemented-parts-of-the-web-platform) or multi-tab tests.
- It is harder to debug since you do not have access to browser devtools to inspect the DOM.

### [pptr-testing-library](https://github.com/testing-library/pptr-testing-library) + Jest

`pptr-testing-library` makes versions of the [Testing Library](https://testing-library.com) queries that work with Puppeteer's [ElementHandle](https://pptr.dev/#?product=Puppeteer&version=v10.1.0&show=api-class-elementhandle)s, similarly to how Pleasantest does.

- It does not make the [jest-dom](https://github.com/testing-library/jest-dom) assertions work with Puppeteer ElementHandles.
- It does not manage the browser for you. You must manually set up and tear down the browser.
- It does not produce error messages as nicely as Pleasantest does.
- In general, it is a good solution to a small piece of the puzzle, but it is not a complete solution like Pleasantest is.

### [jest-puppeteer](https://github.com/smooth-code/jest-puppeteer) + Jest

`jest-puppeteer` is a [Jest environment](https://jestjs.io/docs/en/configuration#testenvironment-string) that manages launching browsers via puppeteer in Jest tests.

- It does not support [Testing Library](https://testing-library.com) or [jest-dom](https://github.com/testing-library/jest-dom) (but Testing Library support could be added via [pptr-testing-library](https://github.com/testing-library/pptr-testing-library)).
- Lacking maintenance

### [Playwright test runner](https://github.com/microsoft/playwright-test)

`@playwright/test` is a test runner from the Playwright team that is designed to run browser tests.

- It does not support [Testing Library](https://testing-library.com) or [jest-dom](https://github.com/testing-library/jest-dom).
- Since it is its own test runner, it does not integrate with Jest, so you still have to run your non-browser tests separately. Fortunately, the test syntax is almost the same as Jest, and it uses Jest's `expect` as its library.
- There is [no watch mode yet](https://github.com/microsoft/playwright-test/issues/33).

## Limitations/Architectural Decisions

### Out of scope/separate projects

- **Visual Regression Testing**: You can use [`jest-image-snapshot`](https://github.com/americanexpress/jest-image-snapshot#see-it-in-action) to do visual regression testing. We don't plan to bring this functionality directly into Pleasantest, but `jest-image-snapshot` integrates pretty seamlessly:

  ```js
  import { withBrowser } from 'pleasantest';
  import { toMatchImageSnapshot } from 'jest-image-snapshot';

  expect.extend({ toMatchImageSnapshot });

  test(
    'screenshot testing example',
    withBrowser(async ({ page }) => {
      await page.goto('https://github.com');
      const image = await page.screenshot();
      expect(image).toMatchImageSnapshot();
    }),
  );
  ```

- **No Synchronous DOM Access**: Because Jest runs your tests, Pleasantest will never support synchronously and directly modifying the DOM. While you can use [`utils.runJS`](#pleasantestutilsrunjscode-string-promisevoid) to execute snippets of code in the browser, all other browser manipulation must be through the provided asynchronous APIs. This is an advantage [jsdom](https://github.com/jsdom/jsdom)-based tests will always have over Pleasantest tests.

### Temporary Limitations

- **Browser Support**: We only support Chromium for now. We have also tested connecting with Edge and that test was successful, but we do not yet expose an API for that. We will also support Firefox in the near future, since Puppeteer supports it. We have prototyped with integrating Firefox with Pleasantest and we have seen that it works. We will not support Safari/Webkit [until Puppeteer supports it](https://github.com/puppeteer/puppeteer/issues/5984). We will not support Internet Explorer. ([Tracking issue](https://github.com/cloudfour/pleasantest/issues/32))
- **Tied to Jest**: For now, Pleasantest is designed to work with Jest, and not other test runners like Mocha or Ava. You could _probably_ make it work by loading Jest's `expect` into the other test runners, but this workflow has not been tested. ([Tracking issue](https://github.com/cloudfour/pleasantest/issues/34))
