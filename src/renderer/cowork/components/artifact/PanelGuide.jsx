// The card at the head of each viewer side panel's story (ENG-4455): Live
// edit's "Editing artifact", Comments and Stats each say what the panel is
// for and what to do. While the panel has nothing else to show it sits in the
// middle of it; once there is something (an edit, a comment, a view) it moves
// to the bottom, out of the way.

/**
 * @param {{
 *   title: string,
 *   text?: string,
 *   placement?: 'center' | 'bottom',
 *   active?: boolean,
 *   isError?: boolean,
 *   status?: boolean,
 *   children?: import('react').ReactNode,
 *   after?: import('react').ReactNode,
 * }} props
 *  `status`: announce changes to its text (Live edit's status line).
 *  `children`: under the text, inside the card (a button).
 *  `after`: under the card, moving with it (Live edit's Source code).
 */
export function PanelGuide({
  title, text = '', placement = 'center', active = false, isError = false, status = false, children = null, after = null,
}) {
  return (
    // Keyed on the placement so the move plays its settle animation.
    <div key={placement} className="artifact-panel-guide-slot" data-placement={placement}>
      <div className="artifact-panel-guide" role={status ? 'status' : undefined}>
        <span className={`artifact-html-edit-indicator${active ? ' is-active' : ''}`} aria-hidden="true" />
        <div className="artifact-panel-guide-text">
          <span className="artifact-panel-guide-title">{title}</span>
          {text && <span className={isError ? 'is-error' : ''}>{text}</span>}
          {children && <div className="artifact-panel-guide-actions">{children}</div>}
        </div>
      </div>
      {after}
    </div>
  );
}

export default PanelGuide;
