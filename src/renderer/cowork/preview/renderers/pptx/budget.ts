/*
 * The deck-wide element budget: how many more elements of the slides' shape
 * trees, tables and text the renderer may read, from ctx.limits.
 * maxSlideElements. Every slide draws from the one budget, so a master's or
 * layout's shapes count again on each slide that draws them. Each loop over
 * such a container walks it with walk(), which takes one element at a time,
 * whether or not the renderer then draws it, so a tree of hidden shapes or
 * merged cells costs the budget as much as one it draws.
 */

export interface ElementBudget {
  /* How many more elements walk() may hand out. */
  left: number;
  /* Whether walk() has refused an element, so the deck shows less than the
     file holds. */
  exhausted: boolean;
}

export function elementBudget(max: number): ElementBudget {
  return { left: Math.max(0, max), exhausted: false };
}

/* The element children of el, in order, one taken from the budget for each.
   Once the budget runs out the walk ends, and so does every later walk. */
export function* walk(budget: ElementBudget, el: Element | null | undefined): Generator<Element> {
  for (const node of Array.from(el?.children ?? [])) {
    if (budget.left === 0) {
      budget.exhausted = true;
      return;
    }
    budget.left -= 1;
    yield node;
  }
}
