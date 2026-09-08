/** Text controls own native undo, even when their undo stack is empty. */
export function isTextEditing(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly &&
      !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color', 'hidden'].includes(element.type)
  }
  return element instanceof HTMLElement && element.isContentEditable
}
