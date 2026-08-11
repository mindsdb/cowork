// App-wide icon set — Lucide (lucide-react), consolidated in ENG-634.
//
// Same call-style API as the old hand-rolled set: `Ico.search(16)` renders a
// 16px icon. Keys are stable — several call sites resolve them dynamically
// from data (`Ico[connector.logo]`, `Ico[item.icon]`), so never rename or
// remove a key without grepping for its string form too.
//
// Stroke width is UNIFIED at 1.5 across the entire app (CEO call, ENG-634) —
// no per-icon weights. If you need a heavier glyph, that's a design-system
// conversation, not a local override.
//
// Kept hand-rolled: brand marks (mindsdb, googleDrive) — Lucide ships no
// brand icons — and the composer's solid stop/pause glyphs, which are
// deliberately smaller than Lucide's filled shapes to fit the composer
// button design.
import {
  ArrowUp,
  ArrowUpRight,
  Bot,
  Box,
  Brain,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CodeXml,
  Copy,
  Database,
  Download,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  Gamepad2,
  Globe,
  Image,
  KeyRound,
  LayoutGrid,
  Link,
  List,
  Lock,
  Mail,
  Menu,
  MessagesSquare,
  Mic,
  Moon,
  Palette,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  SquareCheckBig,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  Users,
  Wifi,
  X,
} from 'lucide-react';

// (Component, default size) → the old call-style drawer fn. Lucide adds
// aria-hidden itself on childless icons, so no a11y props needed here.
const ico = (Cmp, d = 16) => (s = d) => <Cmp size={s} strokeWidth={1.5} />;

const Ico = {
  search:   ico(Search),
  chats:    ico(MessagesSquare),
  list:     ico(List),
  // 2x2 grid — used in the Projects page view-toggle.
  grid:     ico(LayoutGrid),
  image:    ico(Image),
  sidebar:  ico(PanelLeft),
  sidebarCollapseLeft: ico(PanelLeftClose),
  sidebarExpandRight:  ico(PanelLeftOpen),
  panelCollapseRight:  ico(PanelRightClose),
  panelExpandLeft:     ico(PanelRightOpen),
  menu:     ico(Menu),
  sun:      ico(Sun),
  moon:     ico(Moon),
  // Retro gamepad — the 8-Bit skin toggle.
  gamepad:  ico(Gamepad2),
  // Painter's palette — the Custom (design-your-own) skin.
  palette:  ico(Palette),
  power:    ico(Power),
  // Disconnect / power-off — reads as "click to turn off".
  powerOff: ico(PowerOff),
  // Message-action affordances under each Anton turn.
  copy:     ico(Copy),
  refresh:  ico(RotateCw),
  thumbUp:  ico(ThumbsUp),
  thumbDown: ico(ThumbsDown),
  chevronRight: ico(ChevronRight),
  code:     ico(CodeXml),
  plus:     ico(Plus),
  folder:   ico(Folder),
  phone:    ico(Smartphone),
  clock:    ico(Clock),
  sparkle:  ico(Sparkles),
  slider:   ico(SlidersHorizontal),
  settings: ico(Settings),
  pin:      ico(Pin),
  chevDown: ico(ChevronDown, 14),
  chevRight: ico(ChevronRight, 14),
  chevLeft: ico(ChevronLeft, 14),
  mic:      ico(Mic),
  // Up arrow — the composer's send affordance.
  send:     ico(ArrowUp),
  attach:   ico(Paperclip),
  download: ico(Download),
  check:    ico(Check, 14),
  // Rounded-square card with an inner tick — the onboarding "Get to know
  // Cowork" / "you've got the basics" glyph.
  taskCheck: ico(SquareCheckBig),
  more:     ico(Ellipsis),
  // Vertical 3-dot kebab — per-row task action menu in the sidebar and
  // the chat header.
  moreVert: ico(EllipsisVertical),
  // Pencil — rename action.
  edit:     ico(Pencil),
  // Trash — delete action.
  trash:    ico(Trash2),
  // Move to project — folder + inbound arrow.
  moveTo:   ico(FolderInput),
  // Schedule — calendar/clock blend.
  schedule: ico(CalendarClock),
  doc:      ico(FileText),
  globe:    ico(Globe),
  brain:    ico(Brain),
  database: ico(Database),
  mail:     ico(Mail),
  upload:   ico(Upload),
  wifi:     ico(Wifi),
  key:      ico(KeyRound),
  lock:     ico(Lock),
  people:   ico(Users),
  robot:    ico(Bot),
  link:     ico(Link),
  // Isometric cube — a discrete composable unit; Skills library nav.
  cube:     ico(Box),
  // External link — "opens in browser" affordance.
  externalLink: ico(ExternalLink, 14),
  // Close glyph — any dismissable affordance.
  close:    ico(X, 14),
  // Eye / eye-off — masked API key fields in Settings.
  eye:      ico(Eye, 14),
  eyeOff:   ico(EyeOff, 14),
  // ── Artifact-viewer top-bar icons ─────────────────────────────────────
  // "Open the artifact's local folder".
  openFolder:   ico(FolderOpen),
  // Manual reload of the preview.
  reload:       ico(RefreshCw),
  // "Open in the default browser".
  arrowUpRight: ico(ArrowUpRight),
  // Save — thinking-step marker (mdb-ai adapter `step.icon` string).
  save:     ico(Save),

  // ── Hand-rolled exceptions (no Lucide equivalent) ─────────────────────
  // Brand marks: Lucide ships no brand icons.
  // Official Drive mark (same geometry as public/logos/google_drive.svg),
  // filled with currentColor so it sits monochrome alongside the neutral menu
  // icons instead of the brand green.
  googleDrive: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z"/></svg>,
  mindsdb:  (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 17v3h3M21 7V4h-3M3 7V4h3M21 17v3h-3"/><circle cx="12" cy="12" r="4"/></svg>,
  // Solid composer glyphs — sized to the composer button design (Lucide's
  // filled Square/Pause fill the full 24-grid and read too heavy here).
  stop:     (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>,
  pause:    (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>,
};

export default Ico;
