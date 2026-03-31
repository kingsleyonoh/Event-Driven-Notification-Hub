import Handlebars from 'handlebars';

export function renderTemplate(
  templateStr: string,
  payload: Record<string, unknown>,
): string {
  const compiled = Handlebars.compile(templateStr, { noEscape: false });
  return compiled(payload);
}

export function renderSubjectAndBody(
  subject: string | null,
  body: string,
  payload: Record<string, unknown>,
): { renderedSubject: string | null; renderedBody: string } {
  return {
    renderedSubject: subject ? renderTemplate(subject, payload) : null,
    renderedBody: renderTemplate(body, payload),
  };
}
