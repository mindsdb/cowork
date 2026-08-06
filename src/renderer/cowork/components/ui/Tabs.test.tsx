import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabList, Tab, TabPanel } from './Tabs';

function Fixture(props: React.ComponentProps<typeof Tabs>) {
  return (
    <Tabs {...props}>
      <TabList>
        <Tab value="overview">Overview</Tab>
        <Tab value="activity">Activity</Tab>
      </TabList>
      <TabPanel value="overview">overview panel</TabPanel>
      <TabPanel value="activity">activity panel</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('exposes tablist/tab/tabpanel roles and selects defaultValue', () => {
    render(<Fixture defaultValue="overview" />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const activity = screen.getByRole('tab', { name: 'Activity' });
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(activity.getAttribute('aria-selected')).toBe('false');
    // Only the active panel is exposed (inactive ones are hidden/unmounted).
    expect(screen.getByRole('tabpanel').textContent).toBe('overview panel');
  });

  it('switches the selected tab and panel on click (uncontrolled)', () => {
    render(<Fixture defaultValue="overview" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel').textContent).toBe('activity panel');
  });

  it('honors controlled value + onValueChange', () => {
    const onValueChange = vi.fn();
    const { rerender } = render(<Fixture value="overview" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(onValueChange).toHaveBeenCalledWith('activity', expect.anything());
    // Controlled: stays on overview until the parent updates the prop.
    expect(screen.getByRole('tabpanel').textContent).toBe('overview panel');
    rerender(<Fixture value="activity" onValueChange={onValueChange} />);
    expect(screen.getByRole('tabpanel').textContent).toBe('activity panel');
  });

  it('does not select a disabled tab', () => {
    render(
      <Tabs defaultValue="overview">
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="activity" disabled>Activity</Tab>
        </TabList>
        <TabPanel value="overview">overview panel</TabPanel>
        <TabPanel value="activity">activity panel</TabPanel>
      </Tabs>,
    );
    const activity = screen.getByRole('tab', { name: 'Activity' });
    expect(activity.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(activity);
    expect(screen.getByRole('tabpanel').textContent).toBe('overview panel');
  });

  it('forwards a custom className on every part alongside its base classes', () => {
    render(
      <Tabs defaultValue="overview" className="mt-4">
        <TabList className="gap-6">
          <Tab value="overview" className="uppercase">Overview</Tab>
        </TabList>
        <TabPanel value="overview" className="pl-6">overview panel</TabPanel>
      </Tabs>,
    );
    const list = screen.getByRole('tablist');
    // Root carries the passed className alongside the base w-full.
    expect(list.parentElement!.className).toContain('mt-4');
    // Each part merges its custom className with its base classes.
    expect(list.className).toContain('gap-6');
    expect(list.className).toContain('border-b'); // base retained
    const tab = screen.getByRole('tab', { name: 'Overview' });
    expect(tab.className).toContain('uppercase');
    expect(tab.className).toContain('border-b-2'); // base retained
    const panel = screen.getByRole('tabpanel');
    expect(panel.className).toContain('pl-6');
    expect(panel.className).toContain('pt-3'); // base retained
  });
});
