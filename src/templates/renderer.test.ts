import { describe, it, expect } from 'vitest';
import { renderTemplate, renderSubjectAndBody } from './renderer.js';

describe('renderTemplate', () => {
  it('renders variables from payload', () => {
    const result = renderTemplate('Hello {{name}}, your order #{{orderId}} is ready.', {
      name: 'Alice',
      orderId: '12345',
    });
    expect(result).toBe('Hello Alice, your order #12345 is ready.');
  });

  it('renders nested variables', () => {
    const result = renderTemplate('{{user.name}} assigned {{task.title}}', {
      user: { name: 'Bob' },
      task: { title: 'Fix bug' },
    });
    expect(result).toBe('Bob assigned Fix bug');
  });

  it('handles missing variables gracefully (renders empty)', () => {
    const result = renderTemplate('Hello {{name}}, status: {{status}}', {
      name: 'Alice',
    });
    expect(result).toBe('Hello Alice, status: ');
  });

  it('handles empty payload', () => {
    const result = renderTemplate('Static text with {{missing}}', {});
    expect(result).toBe('Static text with ');
  });
});

describe('renderSubjectAndBody', () => {
  it('renders both subject and body', () => {
    const result = renderSubjectAndBody(
      'Order {{id}} shipped',
      'Hi {{name}}, your order has shipped.',
      { id: '99', name: 'Carol' },
    );
    expect(result.renderedSubject).toBe('Order 99 shipped');
    expect(result.renderedBody).toBe('Hi Carol, your order has shipped.');
  });

  it('returns null subject when input is null', () => {
    const result = renderSubjectAndBody(null, 'Body text', {});
    expect(result.renderedSubject).toBeNull();
    expect(result.renderedBody).toBe('Body text');
  });
});

describe('capacity notification rendering', () => {
  const overCapPayload = {
    budgetName: 'Notification Copy Polish Check',
    warningState: 'over_cap',
    thresholdKey: 'over_cap',
    remaining: -0.1,
    overageAmount: 0.1,
    unitType: 'hours',
  };

  it('renders over-cap HTML with readable labels, over-by copy, and critical color', () => {
    const html = renderTemplate(
      '<div style="border-left:4px solid {{stateAccentColor}}">' +
        '<span>Status: {{warningState}}</span>' +
        '<p>{{balanceLabel}}: {{balanceValue}}</p>' +
        '</div>',
      overCapPayload,
    );

    expect(html).toContain('Status: Over cap');
    expect(html).toContain('Over by: 0.1 hours');
    expect(html).toContain('#dc2626');
    expect(html).not.toContain('over_cap');
    expect(html).not.toContain('-0.1 hours');
  });

  it('renders over-cap plain text without raw state or negative remaining', () => {
    const text = renderTemplate(
      'Status: {{warningState}}\n{{balanceLabel}}: {{balanceValue}}',
      overCapPayload,
    );

    expect(text).toContain('Status: Over cap');
    expect(text).toContain('Over by: 0.1 hours');
    expect(text).not.toContain('over_cap');
    expect(text).not.toContain('-0.1 hours');
  });

  it('renders warning and cap states with readable labels and semantic colors', () => {
    const warning = renderTemplate(
      '<span style="color:{{stateAccentColor}}">{{warningState}}</span>',
      { budgetName: 'Budget', warningState: 'warning', remaining: 0.2, unitType: 'hours' },
    );
    const cap = renderTemplate(
      'Status: {{warningState}}',
      { budgetName: 'Budget', thresholdKey: 'cap_reached', warningState: 'warning', remaining: 0, unitType: 'hours' },
    );

    expect(warning).toContain('Near cap');
    expect(warning).toContain('#d97706');
    expect(cap).toContain('Cap reached');
  });
});
