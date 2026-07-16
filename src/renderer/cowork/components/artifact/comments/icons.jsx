// Figma-exact icon set for the comments chrome (toolbar + inbox panel),
// lifted 1:1 from the published-viewer redesign (ENG-472) so the in-app
// chrome renders the same glyphs: 16px grid, 1px stroke (1.5px where the
// design says so). Feature-local on purpose — these are not the app-wide
// Iconoir-style icons in components/Icons.jsx.

export const CommentIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2.5C11.0376 2.5 13.5 4.96243 13.5 8C13.5 11.0376 11.0376 13.5 8 13.5H4.40039C3.35105 13.5 2.5 12.649 2.5 11.5996V8L2.50684 7.7168C2.65422 4.81084 5.05741 2.5 8 2.5Z" stroke="currentColor" />
  </svg>
);

export const InboxIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 8H5C5.41967 8 5.81486 8.1976 6.06667 8.53333L6.26667 8.8C6.51847 9.13573 6.91367 9.33333 7.33333 9.33333H8.66667C9.08633 9.33333 9.48153 9.13573 9.73333 8.8L9.93333 8.53333C10.1851 8.1976 10.5803 8 11 8H14M14.491 7.6926L12.3839 4.00515C12.1465 3.58971 11.7047 3.33333 11.2263 3.33333H4.77377C4.29529 3.33333 3.85349 3.58971 3.61611 4.00515L1.50901 7.6926C1.39389 7.894 1.33333 8.12207 1.33333 8.35407V11.3333C1.33333 12.0697 1.93029 12.6667 2.66667 12.6667H13.3333C14.0697 12.6667 14.6667 12.0697 14.6667 11.3333V8.35407C14.6667 8.12207 14.6061 7.894 14.491 7.6926Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.33333 4.33333L11.6667 11.6667M11.6667 4.33333L4.33333 11.6667" stroke="currentColor" strokeLinecap="round" />
  </svg>
);

export const CheckCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.66667 8.33333L6.66667 10.3333L11.3333 5.66667" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 14.6667C11.6819 14.6667 14.6667 11.6819 14.6667 8C14.6667 4.3181 11.6819 1.33333 8 1.33333C4.3181 1.33333 1.33333 4.3181 1.33333 8C1.33333 11.6819 4.3181 14.6667 8 14.6667Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const DotsIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2 6.5C2.27614 6.5 2.5 6.27614 2.5 6C2.5 5.72386 2.27614 5.5 2 5.5C1.72386 5.5 1.5 5.72386 1.5 6C1.5 6.27614 1.72386 6.5 2 6.5Z" fill="currentColor" stroke="currentColor" strokeWidth="0.75" />
    <path d="M6 6.5C6.27614 6.5 6.5 6.27614 6.5 6C6.5 5.72386 6.27614 5.5 6 5.5C5.72386 5.5 5.5 5.72386 5.5 6C5.5 6.27614 5.72386 6.5 6 6.5Z" fill="currentColor" stroke="currentColor" strokeWidth="0.75" />
    <path d="M10 6.5C10.2761 6.5 10.5 6.27614 10.5 6C10.5 5.72386 10.2761 5.5 10 5.5C9.72386 5.5 9.5 5.72386 9.5 6C9.5 6.27614 9.72386 6.5 10 6.5Z" fill="currentColor" stroke="currentColor" strokeWidth="0.75" />
  </svg>
);

export const InfoIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" d="M6 1C3.23857 1 1 3.23857 1 6C1 8.7614 3.23857 11 6 11C8.7614 11 11 8.7614 11 6C11 3.23857 8.7614 1 6 1ZM5 5.5C5 5.2929 5.1679 5.125 5.375 5.125H6C6.2071 5.125 6.375 5.2929 6.375 5.5V8.125C6.375 8.3321 6.2071 8.5 6 8.5C5.7929 8.5 5.625 8.3321 5.625 8.125V5.875H5.375C5.1679 5.875 5 5.7071 5 5.5ZM6 3.625C5.7929 3.625 5.625 3.79289 5.625 4C5.625 4.2071 5.7929 4.375 6 4.375C6.2071 4.375 6.375 4.2071 6.375 4C6.375 3.79289 6.2071 3.625 6 3.625Z" fill="currentColor" />
  </svg>
);

export const ArrowUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8.16667 12.3333V4M4.16667 8L8.16667 4L12.1667 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

