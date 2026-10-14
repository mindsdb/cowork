import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactAuthorshipBadge } from './ArtifactAuthorshipBadge';
import { artifactAuthorship } from '../../lib/artifactAuthorship';

// Every Badge shares the `rounded-full` pill class; the muted variant is the
// only one with `text-ink-3`.
const badgeFor = (label) => screen.getByText(label).closest('.rounded-full');

describe('ArtifactAuthorshipBadge', () => {
  it('renders nothing for the owner', () => {
    const { container } = render(<ArtifactAuthorshipBadge authorship={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tags another member\'s artifact as a muted badge with an icon', () => {
    render(<ArtifactAuthorshipBadge authorship={artifactAuthorship({ role: 'reviewer' })} />);
    expect(badgeFor('Another member').className).toContain('text-ink-3');
    expect(badgeFor('Another member').querySelector('svg')).not.toBeNull();
  });

  it('tags an ownerless artifact', () => {
    render(<ArtifactAuthorshipBadge authorship={artifactAuthorship({ role: 'reviewer', ownerUnknown: true })} />);
    expect(screen.getByText('Unknown owner')).toBeInTheDocument();
    expect(screen.queryByText('Another member')).toBeNull();
  });

  it('explains the tag on hover', async () => {
    render(<ArtifactAuthorshipBadge authorship={artifactAuthorship({ role: 'reviewer' })} />);
    await userEvent.hover(screen.getByText('Another member'));
    expect(await screen.findByText(
      'Created by another member of this project. You can review it but not change it.',
    )).toBeInTheDocument();
  });
});
