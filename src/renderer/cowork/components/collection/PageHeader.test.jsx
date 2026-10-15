import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('collection/PageHeader', () => {
  it('title shape renders an h1 + subtitle and no breadcrumb links', () => {
    render(<PageHeader title="Projects" subtitle="All your workspaces" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('All your workspaces')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('trail shape renders crumb links + the current leaf, and no h1', () => {
    const onClick = vi.fn();
    render(<PageHeader crumbs={[{ label: 'Scheduled Tasks', onClick }]} current="Daily digest" />);
    const link = screen.getByRole('button', { name: 'Scheduled Tasks' });
    link.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Daily digest')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('trail with a title puts the ancestors above an h1 and the actions beside it', () => {
    render(
      <PageHeader
        crumbs={[{ label: 'Scheduled Tasks', onClick: () => {} }]}
        title="Daily digest"
        subtitle="Every day at 9:00 AM"
        actions={<button>Run now</button>}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Scheduled Tasks');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).not.toHaveTextContent('Daily digest');
    expect(screen.getByRole('heading', { level: 1, name: 'Daily digest' })).toBeInTheDocument();
    expect(screen.getByText('Every day at 9:00 AM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument();
  });

  it('back shape renders a "← label" link that invokes onBack', () => {
    const onBack = vi.fn();
    render(<PageHeader onBack={onBack} backLabel="Skills" current="My skill" />);
    screen.getByRole('button', { name: '← Skills' }).click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the actions slot in both shapes', () => {
    render(<PageHeader title="Tasks" actions={<button>New task</button>} />);
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
  });

  // The trail header floats above the body with no divider. Guard against a
  // border creeping back in: preflight is disabled, so any `border-solid`
  // without a `border-0` reset would leave the other three sides at the UA's
  // default `medium` width and draw a full box (the old ENG-1038 bug).
  it('trail shape renders no border', () => {
    const { container } = render(
      <PageHeader crumbs={[{ label: 'Scheduled Tasks', onClick: () => {} }]} current="test" />,
    );
    const header = container.querySelector('header');
    expect(header.className).not.toContain('border');
  });
});
