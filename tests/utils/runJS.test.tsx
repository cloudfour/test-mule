import { withBrowser } from 'pleasantest';
import type { PleasantestContext, PleasantestUtils } from 'pleasantest';
import { printErrorFrames } from '../test-utils';
import vuePlugin from 'rollup-plugin-vue';
import aliasPlugin from '@rollup/plugin-alias';

const createHeading = async ({
  utils,
  screen,
}: {
  utils: PleasantestUtils;
  screen: PleasantestContext['screen'];
}) => {
  await utils.injectHTML(`
    <h1>I'm a heading</h1>
  `);

  return screen.getByRole('heading', { name: /i'm a heading/i });
};

test(
  'basic inline code',
  withBrowser(async ({ utils, screen }) => {
    const heading = await createHeading({ utils, screen });

    await expect(heading).toBeInTheDocument();

    await utils.runJS(`
      const heading = document.querySelector('h1')
      heading.remove()
    `);

    await expect(heading).not.toBeInTheDocument();
  }),
);

test(
  'allows passing ElementHandles and serializable values into browser',
  withBrowser(async ({ utils, screen }) => {
    const heading = await createHeading({ utils, screen });
    await utils.runJS(
      `
        export default (heading, object) => {
          if (heading.outerHTML !== "<h1>I'm a heading</h1>") {
            throw new Error('element was not passed correctly')
          }
          if (object.some.serializable.value !== false) {
            throw new Error('object was not passed correctly')
          }
        }
      `,
      [heading, { some: { serializable: { value: false } } }],
    );
  }),
);

describe('Waiting for Promises in executed code', () => {
  it(
    'should not wait for non-exported promises',
    withBrowser(async ({ utils, screen }) => {
      const heading = await createHeading({ utils, screen });

      await expect(heading).toBeInTheDocument();

      await utils.runJS(`
        const heading = document.querySelector('h1')

        new Promise(r => setTimeout(r, 50))
          .then(() => heading.remove())
      `);

      // Since it didn't wait for the promise
      await expect(heading).toBeInTheDocument();
    }),
  );
  it(
    'should wait for top-level-await',
    withBrowser(async ({ utils, screen }) => {
      const heading = await createHeading({ utils, screen });

      await expect(heading).toBeInTheDocument();

      await utils.runJS(`
        const heading = document.querySelector('h1')

        await new Promise(r => setTimeout(r, 50))
          .then(() => heading.remove())
      `);
      await expect(heading).not.toBeInTheDocument();
    }),
  );
});

test(
  'supports TS in snippet',
  withBrowser(async ({ utils, screen }) => {
    const heading = await createHeading({ utils, screen });

    await expect(heading).toBeInTheDocument();

    // Note: the snippet inherits the language support from the test file that includes it
    // So since this file is a .ts file, the snippet supports TS syntax
    await utils.runJS(`
      type foo = 'stringliteraltype'
      document.querySelector('h1').remove()
    `);
    await expect(heading).not.toBeInTheDocument();
  }),
);

test(
  'throws error with real source-mapped location',
  withBrowser(async ({ utils }) => {
    // Manually-thrown error
    const error = await utils
      .runJS(
        `type foo = 'stringliteraltype'
        throw new Error('errorFromTs')`,
      )
      .catch((error) => error);

    expect(await printErrorFrames(error)).toMatchInlineSnapshot(`
      "Error: errorFromTs
      -------------------------------------------------------
      tests/utils/runJS.test.tsx

              throw new Error('errorFromTs')\`,
                    ^"
      `);

    // Implicitly created error
    const error2 = await utils
      .runJS(
        `type foo = 'stringliteraltype'
        thisVariableDoesntExist`,
      )
      .catch((error) => error);

    expect(await printErrorFrames(error2)).toMatchInlineSnapshot(`
      "ReferenceError: thisVariableDoesntExist is not defined
      -------------------------------------------------------
      tests/utils/runJS.test.tsx

              thisVariableDoesntExist\`,
              ^"
      `);

    // Syntax error
    const error3 = await utils.runJS(`asdf()}`).catch((error) => error);

    expect(await printErrorFrames(error3)).toMatchInlineSnapshot(`
      "TypeError: Failed to load runJS code (most likely due to a transpilation error)
      -------------------------------------------------------
      tests/utils/runJS.test.tsx

          const error3 = await utils.runJS(\`asdf()}\`).catch((error) => error);
                         ^
      -------------------------------------------------------
      dist/cjs/index.cjs"
      `);
  }),
);

test(
  'allows importing .tsx file, and errors from imported file are source mapped',
  withBrowser(async ({ utils, page }) => {
    await utils.runJS(`
      import { render } from './external'
      render()
    `);

    expect(
      await page.evaluate(() => document.body.innerHTML.trim()),
    ).toMatchInlineSnapshot(`"<h1 style=\\"\\">Hi</h1>"`);

    await utils.injectHTML('');

    const error = await utils
      .runJS(
        `import { renderThrow } from './external'
        renderThrow()`,
      )
      .catch((error) => error);

    expect(await printErrorFrames(error)).toMatchInlineSnapshot(`
      "Error: you have rendered the death component
      -------------------------------------------------------
      tests/utils/external.tsx

        throw new Error('you have rendered the death component');
              ^
      -------------------------------------------------------
      tests/utils/external.tsx

        preactRender(<ThrowComponent />, document.body);
        ^
      -------------------------------------------------------
      tests/utils/runJS.test.tsx

              renderThrow()\`,
              ^"
      `);
  }),
);

test.todo(
  'if an imported file has a syntax error the location is source mapped',
);
test.todo(
  'if the code string has a syntax error the location is source mapped',
);
test.todo('resolution error if a package does not exist in node_modules');

test(
  'Allows importing CSS into JS file',
  withBrowser(async ({ utils, screen }) => {
    await utils.injectHTML('<h1>This is a heading</h1>');
    const heading = await screen.getByRole('heading');
    await expect(heading).toBeVisible();
    await utils.runJS(`
      import './external.sass'
    `);
    await expect(heading).not.toBeVisible();
  }),
);

describe('CJS interop edge cases', () => {
  test(
    'Named exports implicitly created from default-only export',
    withBrowser(async ({ utils }) => {
      // Prop-types is CJS and provides non-statically-analyzable named exports
      await utils.runJS(`
        import { number } from 'prop-types'
        import PropTypes from 'prop-types'
        if (number !== PropTypes.number) {
          throw new Error('Named import did not yield same result as default import')
        }
        PropTypes.checkPropTypes(
          { name: number },
          { name: 5 },
        );
      `);
    }),
  );
  test(
    'react and react-dom can be imported, and JSX works',
    withBrowser(async ({ utils, screen }) => {
      await utils.runJS(`
        import * as React from 'react'
        import React2 from 'react'
        if (React.createElement !== React2.createElement) {
          throw new Error('Namespace import did not yield same result as direct import')
        }
        import { render } from 'react-dom'

        const root = document.createElement('div')
        document.body.innerHTML = ''
        document.body.append(root)
        render(<h1>Hi</h1>, root)
      `);
      const heading = await screen.getByRole('heading');
      await expect(heading).toHaveTextContent('Hi');
    }),
  );
  test(
    'vue component can be imported via rollup-plugin-vue',
    withBrowser(
      {
        moduleServer: {
          plugins: [
            {
              name: 'replace-for-vue',
              transform(code) {
                return code
                  .replace(/__VUE_OPTIONS_API__/g, 'true')
                  .replace(/__VUE_PROD_DEVTOOLS__/g, 'false');
              },
            },
            vuePlugin(),
          ],
        },
      },
      async ({ utils, screen }) => {
        await utils.injectHTML('<div id="app"></div>');
        await utils.runJS(`
          import { createApp } from 'vue'
          import VueComponent from './vue-component.vue'
          const app = createApp(VueComponent)
          app.mount('#app')
        `);
        const heading = await screen.getByRole('heading');
        await expect(heading).toHaveTextContent('Hiya');
        await expect(heading).toHaveStyle({ color: 'green' });
      },
    ),
  );
});

test(
  'can use @rollup/plugin-alias',
  withBrowser(
    {
      moduleServer: {
        plugins: [
          aliasPlugin({
            entries: { asdf: 'preact', foo: './external' },
          }),
        ],
      },
    },
    async ({ utils }) => {
      await utils.runJS(`
        import * as preact from 'asdf'
        if (!preact.h || !preact.Fragment || !preact.Component)
          throw new Error('Alias did not load preact correctly')
        import * as external from 'foo'
        if (!external.render || !external.renderThrow)
          throw new Error('Alias did not load ./external.tsx correctly')
      `);
    },
  ),
);

test(
  'environment variables are injected into browser code',
  withBrowser(
    {
      moduleServer: {
        envVars: { asdf: '1234' },
      },
    },
    async ({ utils }) => {
      await utils.runJS(`
        if (process.env.NODE_ENV !== 'development')
          throw new Error('process.env.NODE_ENV not set correctly')
        if (import.meta.env.NODE_ENV !== 'development')
          throw new Error('import.meta.env.NODE_ENV not set correctly')
        if (process.env.asdf !== '1234')
          throw new Error('process.env.asdf not set correctly')
        if (import.meta.env.asdf !== '1234')
          throw new Error('import.meta.env.asdf not set correctly')
      `);
    },
  ),
);
