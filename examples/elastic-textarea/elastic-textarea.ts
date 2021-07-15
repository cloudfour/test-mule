/**
 * Create Elastic TextArea
 *
 * Copied from https://github.com/cloudfour/cloudfour.com-patterns/
 *
 * Adds an event listener to a `textarea` elment that responds to input events
 * by either increasing or decreasing the `rows` attribute based on whether the
 * `textarea` is scrolling or not. Returns an object containing a `destroy()`
 * method to remove the event listener.
 *
 * @param textarea - the target `textarea` element
 */
export const createElasticTextArea = (textarea: HTMLTextAreaElement) => {
  const minRows = Number(textarea.getAttribute('rows')) || 2;
  let rows = Number(textarea.getAttribute('rows')) || minRows;
  textarea.setAttribute('rows', String(rows));

  /** Check if the textarea is currently scrolling */
  const isScrolling = () => textarea.scrollHeight > textarea.clientHeight;

  /** Grow until the textarea stops scrolling */
  const grow = () => {
    // Store initial height of textarea
    let previousHeight = textarea.clientHeight;

    while (isScrolling()) {
      rows++;
      textarea.setAttribute('rows', String(rows));

      // Get height after rows change is made
      const newHeight = textarea.clientHeight;

      // If the height hasn't changed, break the loop
      // This sanity check is to prevent an infinite loop in IE11
      if (newHeight === previousHeight) break;

      // Store the updated height for the next comparison and proceed
      previousHeight = newHeight;
    }
  };

  /** Shrink until the textarea matches the minimum rows or starts scrolling */
  const shrink = () => {
    while (!isScrolling() && rows > minRows) {
      rows--;
      textarea.setAttribute('rows', String(Math.max(rows, minRows)));

      if (isScrolling()) {
        grow();
        break;
      }
    }
  };

  /** Decide whether to grow or shrink the textarea */
  const update = () => {
    if (isScrolling()) {
      grow();
    } else {
      shrink();
    }
  };

  /** As part of the public API, allow users to remove the event listener */
  const destroy = () => textarea.removeEventListener('input', update);

  // Initialize the textarea with elastic behavior
  textarea.addEventListener('input', update);

  // Run the update method to set the initial size correctly
  update();

  // Return a public API for consumers of this component
  return {
    destroy,
  };
};
