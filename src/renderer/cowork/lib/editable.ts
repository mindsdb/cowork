/** Whether `element` is a field the person types in: a text area, a text-like input, or editable content. */
export function isEditable(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !['radio', 'checkbox', 'button', 'submit'].includes(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}
