// Monitor glyph — THE Browser Control icon. Single source for every surface
// that renders the feature (directory tile, workflow connector logo, the
// post-approval note) so they all read as one feature.
//
// `size` is optional on purpose: callers that size the svg via CSS (the
// ConnectorLogo class in ConnectWorkflowView) omit it, callers that need
// intrinsic dimensions pass a pixel size.
export default function MonitorIcon({ size, strokeWidth = 1.8 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      {...(size ? { width: size, height: size } : {})}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </svg>
  );
}
