// Above this many line pairs the line-by-line diff costs more memory than a
// comparison is worth, and the changed middle is shown as one change.
const MAX_DIFF_CELLS = 4_000_000;

function hunk(beforeStart, beforeEnd, afterStart, afterEnd) {
  return { beforeStart, beforeEnd, afterStart, afterEnd };
}

// Longest-common-subsequence walk over the lines between the common prefix
// and suffix. Each run of removed and added lines becomes one change. Ends are
// inclusive; a side with no lines in a change has end = start - 1, and start is
// where the other side's lines would sit.
function middleHunks(before, after, start, beforeEnd, afterEnd) {
  const n = beforeEnd - start + 1;
  const m = afterEnd - start + 1;
  if (n <= 0 || m <= 0 || n * m > MAX_DIFF_CELLS) {
    return [hunk(start, beforeEnd, start, afterEnd)];
  }
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i * width + j] = before[start + i] === after[start + j]
        ? lengths[(i + 1) * width + j + 1] + 1
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }

  const hunks = [];
  let open = null;
  let i = 0;
  let j = 0;
  const close = () => {
    if (!open) return;
    hunks.push(hunk(open.i, start + i - 1, open.j, start + j - 1));
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && before[start + i] === after[start + j]) {
      close();
      i += 1;
      j += 1;
      continue;
    }
    if (!open) open = { i: start + i, j: start + j };
    if (j >= m || (i < n && lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) i += 1;
    else j += 1;
  }
  close();
  return hunks;
}

export function compareSourceLines(beforeContent, afterContent) {
  const before = String(beforeContent || '').split('\n');
  const after = String(afterContent || '').split('\n');
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  if (start === before.length && start === after.length) {
    return { before, after, hunks: [], count: 0 };
  }
  let beforeEnd = before.length - 1;
  let afterEnd = after.length - 1;
  while (beforeEnd >= start && afterEnd >= start && before[beforeEnd] === after[afterEnd]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const hunks = middleHunks(before, after, start, beforeEnd, afterEnd);
  return {
    before,
    after,
    hunks,
    count: hunks.reduce(
      (total, change) => total + Math.max(
        change.beforeEnd - change.beforeStart + 1,
        change.afterEnd - change.afterStart + 1,
      ),
      0,
    ),
  };
}
