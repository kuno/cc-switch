export function getActiveElementInTree(
  ref: HTMLElement | null,
): Element | null {
  if (!ref) {
    return document.activeElement;
  }

  const root = ref.getRootNode();

  if (root instanceof ShadowRoot) {
    return root.activeElement;
  }

  return document.activeElement;
}
