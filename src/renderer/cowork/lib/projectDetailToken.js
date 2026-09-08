// Monotonic token guarding project-detail resolution. A `/projects/:id` fetch
// captures the token with begin() and applies its result only while isCurrent()
// still holds. Both starting a newer detail (begin) AND leaving detail — to the
// grid, Home, or any other route (leave) — advance the token, so a slow
// `/projects/:A` response can neither overwrite a later `/projects/:B` nor
// re-select A after the user has navigated away (e.g. Back to the grid).
export function makeProjectDetailToken() {
  let current = 0;
  return {
    begin: () => ++current,
    leave: () => { current += 1; },
    isCurrent: (captured) => captured === current,
  };
}
