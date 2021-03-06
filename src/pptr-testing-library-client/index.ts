// @ts-expect-error types are not defined for this internal import
import { configure } from '@testing-library/dom/dist/config';
import { addToElementCache } from '../serialize';
// @ts-expect-error types are not defined for this internal import
export * from '@testing-library/dom/dist/queries';

export {
  reviveElementsInString,
  printElement,
  addToElementCache,
} from '../serialize';

(configure as typeof import('@testing-library/dom').configure)({
  getElementError(message, container) {
    // Message is undefined sometimes, for example in the error message for "found multiple elements"
    if (!message) {
      return new Error(addToElementCache(container));
    }

    const error = new Error(message);
    // @ts-expect-error container property is added by DTL
    error.container = container;
    error.name = 'TestingLibraryElementError';
    return error;
  },
});
