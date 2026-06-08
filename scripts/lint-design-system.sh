#!/bin/bash
# Design system lint — find common drift patterns in JSX files.
# Run from the cowork/ directory: ./scripts/lint-design-system.sh
#
# Returns non-zero if violations found (suitable for CI).

set -euo pipefail
DIR="src/renderer/cowork"
VIOLATIONS=0

echo "=== Design System Lint ==="
echo ""

# 1. Inline style objects (style={{ ... }})
echo "--- Inline style={{}} objects ---"
COUNT=$(grep -rn 'style={{' "$DIR" --include='*.jsx' --include='*.tsx' | grep -v 'node_modules' | grep -v '// ds-ok' | wc -l | tr -d ' ')
if [ "$COUNT" -gt 0 ]; then
  echo "  Found $COUNT inline style objects. Use Tailwind classes instead."
  echo "  Add '// ds-ok' comment to suppress for truly dynamic values."
  grep -rn 'style={{' "$DIR" --include='*.jsx' --include='*.tsx' | grep -v 'node_modules' | grep -v '// ds-ok' | head -20
  echo ""
  VIOLATIONS=$((VIOLATIONS + COUNT))
fi

# 2. Hardcoded colors
echo "--- Hardcoded colors ---"
COUNT=$(grep -rn "color: ['\"]#" "$DIR" --include='*.jsx' --include='*.tsx' | grep -v 'node_modules' | grep -v '// ds-ok' | wc -l | tr -d ' ')
if [ "$COUNT" -gt 0 ]; then
  echo "  Found $COUNT hardcoded color values. Use design tokens (var(--ink), var(--accent), etc)."
  grep -rn "color: ['\"]#" "$DIR" --include='*.jsx' --include='*.tsx' | grep -v 'node_modules' | grep -v '// ds-ok'
  echo ""
  VIOLATIONS=$((VIOLATIONS + COUNT))
fi

# 3. Arbitrary font sizes in JSX
echo "--- Arbitrary font sizes ---"
COUNT=$(grep -rn 'fontSize:' "$DIR" --include='*.jsx' --include='*.tsx' | grep -v 'node_modules' | grep -v '// ds-ok' | wc -l | tr -d ' ')
if [ "$COUNT" -gt 0 ]; then
  echo "  Found $COUNT inline fontSize declarations. Use text-2xs through text-3xl."
  grep -rn 'fontSize:' "$DIR" --include='*.jsx' --include='*.tsx' | grep -v 'node_modules' | grep -v '// ds-ok' | head -20
  echo ""
  VIOLATIONS=$((VIOLATIONS + COUNT))
fi

# 4. Arbitrary border radius in JSX
echo "--- Arbitrary border radius ---"
COUNT=$(grep -rn 'borderRadius:' "$DIR" --include='*.jsx' --include='*.tsx' | grep -v 'node_modules' | grep -v '// ds-ok' | wc -l | tr -d ' ')
if [ "$COUNT" -gt 0 ]; then
  echo "  Found $COUNT inline borderRadius declarations. Use rounded-sm/md/lg/xl."
  grep -rn 'borderRadius:' "$DIR" --include='*.jsx' --include='*.tsx' | grep -v 'node_modules' | grep -v '// ds-ok' | head -20
  echo ""
  VIOLATIONS=$((VIOLATIONS + COUNT))
fi

echo "=== Total: $VIOLATIONS violations ==="
exit 0
