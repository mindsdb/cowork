import type { ReactNode } from 'react';

type IconRenderer = (size?: number) => ReactNode;

declare const Ico: {
  attach: IconRenderer;
  arrowUpLeft: IconRenderer;
  arrowUpRight: IconRenderer;
  appWindow: IconRenderer;
  check: IconRenderer;
  chevDown: IconRenderer;
  chevLeft: IconRenderer;
  chevRight: IconRenderer;
  clock: IconRenderer;
  close: IconRenderer;
  code: IconRenderer;
  computer: IconRenderer;
  cube: IconRenderer;
  edit: IconRenderer;
  externalLink: IconRenderer;
  folder: IconRenderer;
  globe: IconRenderer;
  image: IconRenderer;
  lock: IconRenderer;
  mindsdb: IconRenderer;
  moreVert: IconRenderer;
  openFolder: IconRenderer;
  panelExpandLeft: IconRenderer;
  plus: IconRenderer;
  refresh: IconRenderer;
  search: IconRenderer;
  link: IconRenderer;
  list: IconRenderer;
  pin: IconRenderer;
  play: IconRenderer;
  phone: IconRenderer;
  reload: IconRenderer;
  send: IconRenderer;
  settings: IconRenderer;
  slider: IconRenderer;
  stop: IconRenderer;
  trash: IconRenderer;
};

export default Ico;
