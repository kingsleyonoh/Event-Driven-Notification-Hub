import Handlebars from 'handlebars';

type RenderPayload = Record<string, unknown>;

const CAPACITY_LABELS: Record<string, string> = {
  normal: 'On track',
  ok: 'On track',
  warning: 'Near cap',
  cap_reached: 'Cap reached',
  over_cap: 'Over cap',
  reset: 'Reset',
};

const CAPACITY_COLORS: Record<string, {
  accent: string;
  background: string;
  border: string;
  text: string;
  cta: string;
}> = {
  warning: {
    accent: '#d97706',
    background: '#fffbeb',
    border: '#fde68a',
    text: '#92400e',
    cta: '#b45309',
  },
  cap_reached: {
    accent: '#d97706',
    background: '#fffbeb',
    border: '#fde68a',
    text: '#92400e',
    cta: '#b45309',
  },
  over_cap: {
    accent: '#dc2626',
    background: '#fef2f2',
    border: '#fecaca',
    text: '#991b1b',
    cta: '#b91c1c',
  },
  reset: {
    accent: '#16a34a',
    background: '#f0fdf4',
    border: '#bbf7d0',
    text: '#166534',
    cta: '#15803d',
  },
  normal: {
    accent: '#4f46e5',
    background: '#f8fafc',
    border: '#e2e8f0',
    text: '#334155',
    cta: '#4f46e5',
  },
};

export function renderTemplate(
  templateStr: string,
  payload: RenderPayload,
): string {
  const compiled = Handlebars.compile(templateStr, { noEscape: false });
  return compiled(normalizeRenderPayload(payload));
}

export function renderSubjectAndBody(
  subject: string | null,
  body: string,
  payload: RenderPayload,
): { renderedSubject: string | null; renderedBody: string } {
  return {
    renderedSubject: subject ? renderTemplate(subject, payload) : null,
    renderedBody: renderTemplate(body, payload),
  };
}

function normalizeRenderPayload(payload: RenderPayload): RenderPayload {
  if (!isCapacityPayload(payload)) return payload;
  const stateKey = capacityStateKey(payload);
  if (!stateKey) return payload;

  const unit = unitLabel(payload);
  const balance = capacityBalance(payload, unit);
  const colors = CAPACITY_COLORS[stateKey] ?? CAPACITY_COLORS.normal;

  return {
    ...payload,
    unitLabel: payload.unitLabel ?? unit,
    statusLabel: readableState(stateKey),
    warningState: readableState(stateKey),
    thresholdKey: readableState(stateKey),
    balanceLabel: balance.label,
    balanceValue: balance.value,
    stateAccentColor: payload.stateAccentColor ?? colors.accent,
    stateBackgroundColor: payload.stateBackgroundColor ?? colors.background,
    stateBorderColor: payload.stateBorderColor ?? colors.border,
    stateTextColor: payload.stateTextColor ?? colors.text,
    ctaColor: payload.ctaColor ?? colors.cta,
  };
}

function isCapacityPayload(payload: RenderPayload): boolean {
  return typeof payload.budgetName === 'string' || typeof payload.budgetId === 'string';
}

function capacityStateKey(payload: RenderPayload): string | null {
  for (const key of ['thresholdKey', 'warningState', 'statusLabel']) {
    const value = payload[key];
    if (typeof value === 'string') {
      const normalized = value.toLowerCase().replace(/\s+/g, '_');
      if (normalized in CAPACITY_LABELS) return normalized;
    }
  }
  return null;
}

function readableState(stateKey: string): string {
  return CAPACITY_LABELS[stateKey] ?? 'On track';
}

function unitLabel(payload: RenderPayload): string {
  if (typeof payload.unitLabel === 'string' && payload.unitLabel.length > 0) return payload.unitLabel;
  if (payload.unitType === 'custom' && typeof payload.customUnitLabel === 'string') {
    return payload.customUnitLabel || 'units';
  }
  return typeof payload.unitType === 'string' && payload.unitType.length > 0 ? payload.unitType : 'units';
}

function capacityBalance(payload: RenderPayload, unit: string): { label: string; value: string } {
  const remaining = numeric(payload.remaining);
  const overage = numeric(payload.overageAmount);
  const overBy = Math.max(overage ?? 0, remaining !== null && remaining < 0 ? Math.abs(remaining) : 0);
  if (overBy > 0) return { label: 'Over by', value: `${formatAmount(overBy)} ${unit}` };
  if (remaining !== null) return { label: 'Remaining capacity', value: `${formatAmount(remaining)} ${unit}` };
  return {
    label: typeof payload.balanceLabel === 'string' ? payload.balanceLabel : 'Remaining capacity',
    value: typeof payload.balanceValue === 'string' ? payload.balanceValue : '',
  };
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatAmount(value: number): string {
  return Number(value.toFixed(4)).toString();
}
