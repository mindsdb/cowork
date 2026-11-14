import { describe, expect, it } from 'vitest';
import { reduceAll } from './responseStreamAdapter';
import drafted from './__fixtures__/connectorDrafted.json';

// The fixture is the `response.connector_drafted` frame cowork-server emits for
// the pod's real connector line.
describe('responseStreamAdapter — connector template card', () => {
  it('adds one Connector step carrying the template', () => {
    const state = reduceAll([drafted]);
    const steps = state.steps.filter((s) => s.badge === 'Connector');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      id: 'connector-acme_crm',
      label: 'Acme CRM',
      status: 'completed',
      data: drafted.connector,
    });
  });

  it('does not double a card when the same template replays in a turn', () => {
    const state = reduceAll([drafted, drafted]);
    expect(state.steps.filter((s) => s.badge === 'Connector')).toHaveLength(1);
  });

  it('keeps two different templates', () => {
    const other = { ...drafted, connector: { ...drafted.connector, connector_id: 'acme_billing' } };
    const state = reduceAll([drafted, other]);
    expect(state.steps.filter((s) => s.badge === 'Connector').map((s) => s.id))
      .toEqual(['connector-acme_crm', 'connector-acme_billing']);
  });

  it.each([
    [{ type: 'response.connector_drafted' }],
    [{ type: 'response.connector_drafted', connector: { label: 'No id' } }],
    [{ type: 'response.connector_drafted', connector: 'acme' }],
  ])('ignores a frame without a template id: %j', (event) => {
    expect(reduceAll([event]).steps.filter((s) => s.badge === 'Connector')).toHaveLength(0);
  });
});
