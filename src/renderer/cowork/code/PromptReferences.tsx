import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { host } from '../../platform/host';
import type { InputReference } from './api';


export function referencesFromFiles(files: FileList | File[]): { items: InputReference[]; error: string } {
  const items: InputReference[] = [];
  for (const file of Array.from(files)) {
    const path = host.getPathForFile(file);
    if (!path) {
      return { items: [], error: 'Local file attachments are available in the desktop app.' };
    }
    items.push({
      name: file.name,
      path,
      kind: file.type.startsWith('image/') ? 'local_image' : 'mention',
    });
  }
  return { items, error: '' };
}


export function mergeReferences(current: InputReference[], added: InputReference[]): InputReference[] {
  const next = [...current];
  for (const item of added) {
    if (!next.some((existing) => existing.path === item.path)) next.push(item);
  }
  return next.slice(0, 20);
}


export function PromptReferenceChips({
  items,
  busy,
  onRemove,
}: {
  items: InputReference[];
  busy: boolean;
  onRemove: (path: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="code-reference-chips" aria-label="Attached context">
      {items.map((item) => (
        <span className="code-reference-chip" key={item.path} title={item.path}>
          <i aria-hidden="true">{item.kind === 'local_image' ? Ico.image(12) : Ico.attach(12)}</i>
          <span>{item.name}</span>
          <Button
            icon
            variant="subtle"
            size="sm"
            disabled={busy}
            aria-label={`Remove ${item.name}`}
            onClick={() => onRemove(item.path)}
          >
            {Ico.close(10)}
          </Button>
        </span>
      ))}
    </div>
  );
}
