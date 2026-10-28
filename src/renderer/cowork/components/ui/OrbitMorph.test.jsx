import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import OrbitMorph from './OrbitMorph';

let rafSpy;
let cancelSpy;

beforeEach(() => {
  let nextId = 0;
  rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => ++nextId);
  cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const renderOrb = (props) => {
  const view = render(<OrbitMorph {...props} />);
  const host = view.container.querySelector('.orbit-morph');
  return {
    ...view,
    svg: host.querySelector(':scope > svg'),
    satLayer: host.querySelector(':scope > span'),
  };
};

describe('OrbitMorph frame loop', () => {
  it('draws idle once and spins its satellite with CSS', () => {
    const { svg, satLayer } = renderOrb({ state: 'idle' });
    expect(rafSpy).not.toHaveBeenCalled();
    expect(svg.querySelector('circle')).not.toBeNull();
    expect(satLayer.style.display).toBe('block');
    expect(satLayer.style.animation).toContain('spin 4500ms');
    expect(satLayer.style.animationPlayState).toBe('running');
  });

  it('draws done once and hides the idle satellite', () => {
    const { svg, satLayer } = renderOrb({ state: 'done' });
    expect(rafSpy).not.toHaveBeenCalled();
    expect(svg.querySelector('path')).not.toBeNull();
    expect(satLayer.style.display).toBe('none');
    expect(satLayer.style.animation).toBe('');
  });

  it('runs frames while thinking and hides the idle satellite', () => {
    const { satLayer } = renderOrb({ state: 'thinking' });
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(satLayer.style.display).toBe('none');
  });

  it('stops frames while paused and resumes when unpaused', () => {
    const { rerender, svg } = renderOrb({ state: 'thinking', paused: true });
    expect(rafSpy).not.toHaveBeenCalled();
    expect(svg.childNodes.length).toBeGreaterThan(0);

    rerender(<OrbitMorph state="thinking" />);
    expect(rafSpy).toHaveBeenCalledTimes(1);

    rerender(<OrbitMorph state="thinking" paused />);
    expect(cancelSpy).toHaveBeenCalledWith(1);
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it('pauses the idle satellite without restarting its animation', () => {
    const { rerender, satLayer } = renderOrb({ state: 'idle' });
    const animation = satLayer.style.animation;

    rerender(<OrbitMorph state="idle" paused />);
    expect(satLayer.style.animationPlayState).toBe('paused');
    expect(satLayer.style.animation).toBe(animation);

    rerender(<OrbitMorph state="idle" />);
    expect(satLayer.style.animationPlayState).toBe('running');
    expect(satLayer.style.animation).toBe(animation);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('stops the loop when thinking turns idle and restarts it when thinking again', () => {
    const { rerender } = renderOrb({ state: 'thinking' });
    expect(rafSpy).toHaveBeenCalledTimes(1);

    rerender(<OrbitMorph state="idle" />);
    expect(cancelSpy).toHaveBeenCalledWith(1);

    rerender(<OrbitMorph state="thinking" />);
    expect(rafSpy).toHaveBeenCalledTimes(2);
  });

  it('recolors the idle satellite on a theme change without a frame or a restart', () => {
    const { rerender, satLayer } = renderOrb({ state: 'idle', theme: 'light' });
    const sat = satLayer.querySelector('circle');
    const animation = satLayer.style.animation;
    expect(sat.getAttribute('fill')).toBe('#1F9CB0');

    rerender(<OrbitMorph state="idle" theme="dark" />);
    expect(sat.getAttribute('fill')).toBe('rgb(34, 211, 238)');
    expect(satLayer.style.animation).toBe(animation);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('restarts the idle satellite when its period changes', () => {
    const { rerender, satLayer } = renderOrb({ state: 'idle' });
    rerender(<OrbitMorph state="idle" orbitPeriodMs={3000} />);
    expect(satLayer.style.animation).toContain('spin 3000ms');
  });

  it('cancels the pending frame and removes both layers on unmount', () => {
    const { unmount, svg, satLayer } = renderOrb({ state: 'thinking' });
    unmount();
    expect(cancelSpy).toHaveBeenCalledWith(1);
    expect(svg.parentNode).toBeNull();
    expect(satLayer.parentNode).toBeNull();
  });
});
