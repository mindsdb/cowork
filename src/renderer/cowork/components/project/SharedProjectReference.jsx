/** Distinguish received projects without revealing their owners' identities. */
export default function SharedProjectReference({ project }) {
  if (!project?.shared || !project.id) return null;
  return (
    <span title={`Project ID: ${project.id}`} className="text-xs font-mono text-ink-3">
      Project · {project.id.slice(-8)}
    </span>
  );
}
