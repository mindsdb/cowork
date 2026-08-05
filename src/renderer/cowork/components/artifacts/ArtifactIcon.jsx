// ArtifactIcon — the file-type glyph shown on every artifact card / list row.
//
// These are *colored, branded* file-type icons (pdf red, csv green, docx
// blue, a teal globe for live web apps, …), distinct from the theme-tinted
// line icons in `components/Icons.jsx` — so they live here, colocated with
// the resolver that maps an artifact to the right one. Design-supplied SVGs.
//
//   <ArtifactIcon artifact={a} size={16} />
//
// Anything without a dedicated glyph falls back to a generic file with its
// extension lettered in the middle (`GenericFileIcon`).

import { useId } from 'react';

// File-type icons are authored on a 16×14 canvas; the web-app globe on 16×16.
// `width=height=size` + the natural viewBox scales uniformly (preserveAspectRatio
// "meet" default), so the non-square ones just center without distortion.

// Live web app / dashboard — teal globe with a soft top-down gradient.
// useId() keeps the gradient id unique per instance (many cards on screen).
function WebAppIcon({ size }) {
  const gid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.33325 7.99998C1.33325 11.6819 4.31802 14.6666 7.99992 14.6666C11.6818 14.6666 14.6666 11.6819 14.6666 7.99998C14.6666 4.31808 11.6818 1.33331 7.99992 1.33331C4.31802 1.33331 1.33325 4.31808 1.33325 7.99998Z" fill={`url(#${gid})`} stroke="#146573" />
      <path d="M8.66675 1.36621C8.66675 1.36621 10.6667 3.99996 10.6667 7.99996C10.6667 12 8.66675 14.6337 8.66675 14.6337" stroke="#146573" strokeLinecap="round" />
      <path d="M7.33325 14.6337C7.33325 14.6337 5.33325 12 5.33325 7.99996C5.33325 3.99996 7.33325 1.36621 7.33325 1.36621" stroke="#146573" strokeLinecap="round" />
      <path d="M1.75317 10.3333H14.247" stroke="#146573" strokeLinecap="round" />
      <path d="M1.75317 5.66669H14.247" stroke="#146573" strokeLinecap="round" />
      <defs>
        <linearGradient id={gid} x1="8" y1="1.33331" x2="8" y2="16.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D8F9FF" stopOpacity="0" />
          <stop offset="0.823151" stopColor="#CCF8FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Shared "sheet of paper with a folded corner" base (pdf / csv / docx).
const FOLDED_PAGE = 'M2 0.5H11.4668C11.512 0.500091 11.5556 0.518236 11.5869 0.550781L14.4531 3.52832C14.483 3.55932 14.4999 3.60053 14.5 3.64355V13C14.5 13.2761 14.2761 13.5 14 13.5H2C1.72386 13.5 1.5 13.2761 1.5 13V1C1.5 0.723858 1.72386 0.5 2 0.5Z';
const FOLD = 'M11 1V2.66667C11 3.40305 11.597 4 12.3333 4H14';
// Square page (txt / generic — no folded corner).
const SQUARE_PAGE = 'M2 0.5H14.333C14.4251 0.5 14.5 0.574945 14.5 0.666992V13C14.5 13.2761 14.2761 13.5 14 13.5H2C1.72386 13.5 1.5 13.2761 1.5 13V1C1.5 0.723858 1.72386 0.5 2 0.5Z';

function PdfIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path d={FOLDED_PAGE} fill="#FCFCFC" stroke="#B6BBBB" />
      <path d={FOLD} stroke="#B6BBBB" />
      <path d="M12.3615 8.75688C12.2787 8.64183 12.1713 8.53591 12.0421 8.44312C11.9358 8.36494 11.8133 8.29497 11.6769 8.23297C11.1267 7.98335 10.3738 7.91684 9.37288 8.02776L9.27217 8.03892C9.21198 7.99419 9.14971 7.94968 9.08509 7.90328C8.66708 7.60045 8.32342 7.25938 8.04221 6.86856C8.39009 5.79108 8.50909 4.85251 8.39552 4.0768C8.37677 3.94606 8.3443 3.82543 8.29806 3.71487C8.22731 3.53635 8.12533 3.3827 7.99303 3.26241C7.99071 3.26054 7.99071 3.26054 7.98836 3.25864C7.77816 3.06773 7.50462 2.97594 7.24021 3.00524C6.97372 3.03478 6.74114 3.17837 6.58646 3.41187C6.43366 3.64301 6.37137 3.94339 6.40492 4.28454C6.45632 4.80579 6.55291 5.29419 6.69148 5.73938C6.70385 5.77444 6.71415 5.8097 6.72652 5.84473C6.86037 6.24761 7.03386 6.62465 7.24204 6.97003C7.08959 7.39606 6.92896 7.7673 6.81672 8.01966C6.73174 8.21117 6.63721 8.41229 6.53847 8.61388C6.01001 8.77099 5.5657 8.94018 5.18346 9.13249C4.66602 9.38906 4.26191 9.69087 3.98489 10.0279C3.80502 10.2449 3.69161 10.4674 3.64839 10.6907C3.60167 10.9208 3.6305 11.1425 3.73226 11.3326C3.82609 11.5085 3.9754 11.6484 4.16341 11.7346C4.2082 11.7554 4.25461 11.7716 4.30287 11.7856C4.44327 11.8257 4.59341 11.8391 4.74659 11.8221C5.10121 11.7828 5.44917 11.5879 5.72689 11.2765C6.24437 10.6943 6.74579 9.79476 7.03781 9.229C7.32033 9.1527 7.62876 9.07996 7.97707 9.0028C8.38784 8.91443 8.75223 8.84835 9.08446 8.79866C9.1976 8.88038 9.30607 8.95833 9.40986 9.0325C9.98674 9.44625 10.4232 9.74277 10.8106 9.94189C10.8108 9.94399 10.8129 9.94376 10.815 9.94353C10.9682 10.0229 11.1133 10.0861 11.2567 10.1345C11.4179 10.1895 11.5774 10.2104 11.7368 10.1927C11.9383 10.1704 12.1203 10.0881 12.2653 9.95848C12.4118 9.82442 12.5087 9.64446 12.5403 9.45032C12.5761 9.2172 12.5125 8.96935 12.3615 8.75688ZM7.25248 5.03247C7.19403 4.77331 7.15117 4.50174 7.12348 4.21348C7.09743 3.94005 7.17565 3.745 7.32042 3.72896C7.42953 3.71686 7.55596 3.80353 7.6295 3.98816C7.65053 4.04365 7.6683 4.10809 7.67859 4.18192C7.69264 4.27032 7.70085 4.36367 7.70722 4.45935C7.72443 4.72951 7.7099 5.02028 7.66419 5.33596C7.63774 5.53812 7.59755 5.75036 7.5436 5.97267C7.42218 5.68199 7.3238 5.36943 7.25248 5.03247ZM4.36977 10.9899C4.32424 10.905 4.34513 10.7292 4.53991 10.4934C4.8379 10.1348 5.33222 9.82292 6.03899 9.54966C5.92162 9.75544 5.80446 9.9441 5.68985 10.1174C5.51561 10.3852 5.34556 10.614 5.18875 10.7899C5.05478 10.9418 4.90049 11.0446 4.74757 11.083C4.72077 11.0902 4.69372 11.0954 4.66644 11.0984C4.53003 11.1135 4.41273 11.0709 4.36977 10.9899ZM7.47354 8.36891L7.48566 8.34401L7.46305 8.35081C7.46608 8.33976 7.4712 8.32848 7.47656 8.31933C7.54803 8.15933 7.63789 7.95443 7.73288 7.71899L7.74595 7.7411L7.7669 7.68095C7.86909 7.79815 7.97946 7.91231 8.09354 8.02175C8.14813 8.07353 8.20458 8.12297 8.26104 8.17241L8.2277 8.17823L8.26011 8.20249C8.17478 8.21837 8.08551 8.23684 7.9962 8.25529C7.94026 8.26791 7.88197 8.27866 7.82391 8.29152C7.70365 8.31769 7.58545 8.34366 7.47354 8.36891ZM11.1513 9.29798C10.8838 9.16483 10.5796 8.96933 10.202 8.70486C10.6965 8.70146 11.0924 8.76684 11.383 8.89743C11.5104 8.95402 11.6086 9.01596 11.6772 9.07904C11.7898 9.17578 11.8363 9.26918 11.8247 9.33688C11.8152 9.40434 11.7466 9.45692 11.6564 9.46692C11.6039 9.47273 11.548 9.46609 11.4883 9.44486C11.3866 9.40901 11.2795 9.36302 11.1648 9.30506C11.1606 9.30553 11.156 9.30175 11.1513 9.29798Z" fill="#E73737" />
    </svg>
  );
}

function CsvIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path d={FOLDED_PAGE} fill="#FCFCFC" stroke="#B6BBBB" />
      <path d={FOLD} stroke="#B6BBBB" />
      <rect x="3.5" y="5.5" width="9" height="6" rx="0.5" stroke="#44C15A" />
      <rect width="2" height="5" transform="translate(4 6)" fill="#44C15A" fillOpacity="0.16" />
      <path d="M6 6V11" stroke="#44C15A" />
      <path d="M12 8H4" stroke="#44C15A" />
    </svg>
  );
}

function DocxIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path d={FOLDED_PAGE} fill="#FCFCFC" stroke="#B6BBBB" />
      <path d={FOLD} stroke="#B6BBBB" />
      <path d="M4 6H7" stroke="#0077FF" strokeLinecap="round" />
      <path d="M4 8.5H12" stroke="#0077FF" strokeLinecap="round" />
      <path d="M4 11H12" stroke="#0077FF" strokeLinecap="round" />
    </svg>
  );
}

function TxtIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path d={SQUARE_PAGE} fill="#FCFCFC" stroke="#B6BBBB" />
      <path d="M6.60244 11C6.52193 11 6.45195 10.9837 6.39252 10.951C6.33501 10.9202 6.29092 10.8794 6.26024 10.8286C6.22957 10.776 6.21423 10.7207 6.21423 10.6627C6.21423 10.5956 6.23436 10.534 6.27462 10.4777C6.3168 10.4215 6.37719 10.3807 6.45579 10.3553C6.76444 10.2629 6.97436 10.1794 7.08555 10.1051C7.19866 10.0307 7.27151 9.91741 7.3041 9.76508C7.33861 9.61095 7.35778 9.33622 7.36161 8.9409C7.36736 8.33886 7.37024 7.72774 7.37024 7.10757C7.37024 6.41304 7.36736 5.72486 7.36161 5.04303C7.35586 4.59875 7.32902 4.28594 7.28109 4.1046C7.23317 3.92326 7.1306 3.80267 6.9734 3.74283C6.81812 3.68117 6.55068 3.65216 6.1711 3.65579C5.93338 3.65941 5.72921 3.70837 5.55859 3.80267C5.38989 3.89515 5.24035 4.04838 5.10999 4.26236C4.97963 4.47453 4.85885 4.76286 4.74766 5.12735C4.71699 5.22527 4.66619 5.29962 4.59526 5.3504C4.52432 5.40117 4.44572 5.42656 4.35945 5.42656C4.29811 5.42656 4.23964 5.41296 4.18404 5.38576C4.12844 5.35856 4.08339 5.31866 4.04889 5.26607C4.0163 5.21348 4 5.15183 4 5.08111C4 5.05935 4.00096 5.04303 4.00288 5.03215L4.01438 4.93694C4.09873 4.26962 4.15528 3.77638 4.18404 3.45722C4.20129 3.29946 4.25881 3.1834 4.35658 3.10905C4.45435 3.03289 4.61347 2.99662 4.83393 3.00025C6.28325 3.02201 7.34052 3.03289 8.00575 3.03289C8.6729 3.03289 9.72346 3.02201 11.1574 3.00025C11.3089 2.99843 11.4306 3.01385 11.5226 3.04649C11.6147 3.07913 11.6837 3.13172 11.7297 3.20425C11.7776 3.27679 11.8083 3.37199 11.8217 3.48986C11.837 3.65851 11.8811 4.06198 11.954 4.7003L11.9971 5.05391L12 5.09471C12 5.19444 11.9645 5.27423 11.8936 5.33408C11.8227 5.39392 11.7393 5.42384 11.6434 5.42384C11.561 5.42384 11.4843 5.40026 11.4134 5.35312C11.3444 5.30597 11.2964 5.23797 11.2696 5.14911C11.1469 4.74472 11.0213 4.43736 10.8929 4.227C10.7644 4.01484 10.6159 3.86795 10.4472 3.78635C10.2785 3.70293 10.0599 3.65941 9.79152 3.65579H9.70237C9.37455 3.65579 9.14162 3.68571 9.00359 3.74555C8.86748 3.80539 8.77642 3.92689 8.73041 4.11004C8.68632 4.29138 8.66139 4.60237 8.65564 5.04303C8.64798 5.66502 8.64414 6.35773 8.64414 7.12117C8.64414 7.7359 8.64702 8.34248 8.65277 8.9409C8.65852 9.32896 8.67865 9.60097 8.71316 9.75692C8.74958 9.91287 8.82435 10.0289 8.93746 10.1051C9.05056 10.1813 9.25761 10.262 9.55859 10.3472C9.64294 10.3744 9.70621 10.4161 9.74838 10.4723C9.79056 10.5267 9.81165 10.5875 9.81165 10.6545C9.81165 10.7126 9.79631 10.7688 9.76564 10.8232C9.73496 10.8758 9.69183 10.9184 9.63623 10.951C9.58064 10.9837 9.51737 11 9.44644 11C8.97867 10.9891 8.50707 10.9837 8.03163 10.9837C7.56003 10.9837 7.08363 10.9891 6.60244 11Z" fill="#69696B" />
    </svg>
  );
}

// Generic file — square page with the extension lettered in the middle.
function GenericFileIcon({ size, ext }) {
  const label = (ext || '').toUpperCase().slice(0, 4);
  return (
    <svg width={size} height={size} viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path d={SQUARE_PAGE} fill="#FCFCFC" stroke="#B6BBBB" />
      {label && (
        <text
          x="8" y="9.6" textAnchor="middle"
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fontWeight="700" fontSize={label.length > 3 ? 3.2 : 4.2}
          letterSpacing="0.2" fill="#69696B"
        >{label}</text>
      )}
    </svg>
  );
}

// Lowercase, dot-stripped extension for an artifact (from `ext`, else path).
export function artifactExt(a) {
  const fromExt = (a?.ext || '').replace(/^\./, '').toLowerCase();
  if (fromExt) return fromExt;
  const m = (a?.path || '').match(/\.([a-z0-9]+)$/i);
  return (m?.[1] || '').toLowerCase();
}

// Single source of truth for "is this a live web app" — drives the globe
// icon, the name rendering (apps show no extension), and publishability
// (only web apps can be published).
export function isWebAppArtifact(a) {
  const type = (a?.type || '').toLowerCase();
  if (type.includes('app') || type.includes('html') || type.includes('site')) return true;
  const ext = artifactExt(a);
  return ext === 'html' || ext === 'htm';
}

// Display name for an artifact: title-primary, with the filename as a
// secondary line for file artifacts (ENG-1123). Web apps show only the
// title — there is no meaningful "filename" for a live app.
//   - Web apps → title (falls back to filename, then "Untitled").
//   - Files    → title (falls back to filename, then "file") as the
//                primary line; the parsed filename as a secondary line,
//                so the accurate extension stays visible even though the
//                primary text is now the agent's title, not the filename.
export function fileNameOf(a) {
  return (a?.path || '').split(/[\\/]/).pop() || '';
}

export function displayTitle(a) {
  const fname = fileNameOf(a);
  if (isWebAppArtifact(a)) return a?.title || fname || 'Untitled';
  return a?.title || fname || 'file';
}

function splitFileName(fname) {
  const m = fname.match(/^(.+?)(\.[A-Za-z0-9]{1,8})$/);
  return m ? { name: m[1], ext: m[2].toLowerCase() } : { name: fname, ext: '' };
}

export function splitArtifactName(a) {
  const fname = fileNameOf(a);
  return {
    base: displayTitle(a),
    secondary: isWebAppArtifact(a) ? null : (fname ? splitFileName(fname) : null),
  };
}

const EXT_BY_GROUP = {
  pdf: new Set(['pdf']),
  csv: new Set(['csv', 'tsv']),
  docx: new Set(['doc', 'docx', 'rtf']),
  txt: new Set(['txt', 'md', 'markdown', 'log']),
};

export function ArtifactIcon({ artifact, size = 16 }) {
  const ext = artifactExt(artifact);
  // Live web apps / dashboards → teal globe.
  if (isWebAppArtifact(artifact)) {
    return <WebAppIcon size={size} />;
  }
  if (EXT_BY_GROUP.pdf.has(ext)) return <PdfIcon size={size} />;
  if (EXT_BY_GROUP.csv.has(ext)) return <CsvIcon size={size} />;
  if (EXT_BY_GROUP.docx.has(ext)) return <DocxIcon size={size} />;
  if (EXT_BY_GROUP.txt.has(ext)) return <TxtIcon size={size} />;
  return <GenericFileIcon size={size} ext={ext} />;
}

export default ArtifactIcon;
