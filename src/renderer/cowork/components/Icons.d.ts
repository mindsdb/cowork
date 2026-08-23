import type { ReactNode } from 'react';

type IconRenderer = (size?: number) => ReactNode;

declare const Ico: {
  attach: IconRenderer;
  check: IconRenderer;
  chevDown: IconRenderer;
  close: IconRenderer;
  code: IconRenderer;
  edit: IconRenderer;
  folder: IconRenderer;
  image: IconRenderer;
  lock: IconRenderer;
  mindsdb: IconRenderer;
  moreVert: IconRenderer;
  openFolder: IconRenderer;
  panelExpandLeft: IconRenderer;
  refresh: IconRenderer;
  send: IconRenderer;
  settings: IconRenderer;
  stop: IconRenderer;
  trash: IconRenderer;
};

export default Ico;
