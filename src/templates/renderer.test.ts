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
