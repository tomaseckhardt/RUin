// Enter sends the form a multi-line field belongs to, anywhere in the app:
// the chat, a photo comment, an RSVP excuse, a nudge, a description...
// One-line inputs already do that natively (a form's implicit submission);
// this gives textareas the same. Shift+Enter (or Alt+Enter) still starts a
// new line, and an Enter that finishes an IME composition is left alone.
//
// Like implicit submission, it goes through the form's first submit button
// and does nothing while that button is disabled (an empty chat message, a
// request still running...), so each form's own guards keep applying.

function isSubmitKey(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented
}

function handleKeyDown(event) {
  const field = event.target

  if (!(field instanceof HTMLTextAreaElement) || !field.form || !isSubmitKey(event)) {
    return
  }

  event.preventDefault()

  const { form } = field
  const submitter = Array.from(form.elements).find((element) => element.type === 'submit')

  if (submitter?.disabled) {
    return
  }

  form.requestSubmit(submitter)
}

// Shows "send" on the Enter key of phone keyboards.
function handleFocusIn(event) {
  const field = event.target

  if (field instanceof HTMLTextAreaElement && field.form && !field.hasAttribute('enterkeyhint')) {
    field.setAttribute('enterkeyhint', 'send')
  }
}

export function installEnterToSubmit(root = document) {
  root.addEventListener('keydown', handleKeyDown)
  root.addEventListener('focusin', handleFocusIn)

  return () => {
    root.removeEventListener('keydown', handleKeyDown)
    root.removeEventListener('focusin', handleFocusIn)
  }
}
