import { renderTemplate } from '../templates/renderer.js';
import { AttachmentFetchError } from '../lib/errors.js';

export interface AttachmentConfigEntry {
  filename_template: string;
  url_field: string;
}

export interface FetchedAttachment {
  filename: string;
  content_base64: string;
}

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;
const SIZE_CAP_BYTES = 38 * 1024 * 1024; // 38 MB

/**
 * Resolve a dot-path against a payload object.
 * Returns the resolved value, or null if any segment is missing.
 */
function resolveDotPath(path: string, payload: Record<string, unknown>): unknown {
  const parts = path.split('.');
  let current: unknown = payload;
  for (const key of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? null;
}

/**
 * Fetch a URL with a 30s timeout via AbortController.
 * Treats network errors and 5xx responses as retryable.
 */
async function fetchOnce(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a URL with up to MAX_RETRIES retries on network failure or 5xx.
 * Returns the Response on the final attempt (success or non-retryable failure).
 */
async function fetchWithRetry(url: string): Promise<{
  response: Response | null;
  retries: number;
  lastError: string | null;
}> {
  let retries = 0;
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) retries = attempt;
    try {
      const response = await fetchOnce(url);
      if (response.ok) {
        return { response, retries, lastError: null };
      }
      // 5xx → retry; 4xx → non-retryable
      if (response.status >= 500 && response.status < 600) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      // 4xx — bail
      return {
        response: null,
        retries,
        lastError: `HTTP ${response.status}`,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Network / abort error — retry
      continue;
    }
  }

  return { response: null, retries, lastError };
}

/**
 * Fetch attachments for a notification according to a template's attachments_config.
 *
 * @param config - Array of attachment config entries from the template, or null/undefined.
 * @param payload - The event payload to resolve url_field dot-paths against and
 *                  to render filename_template with Handlebars.
 * @returns Array of fetched attachments with base64-encoded content.
 * @throws AttachmentFetchError on missing url path, fetch failure, or size cap exceeded.
 */
export async function fetchAttachments(
  config: AttachmentConfigEntry[] | null | undefined,
  payload: Record<string, unknown>,
): Promise<FetchedAttachment[]> {
  if (!config || config.length === 0) {
    return [];
  }

  const results: FetchedAttachment[] = [];
  let totalBytes = 0;

  for (const entry of config) {
    const resolved = resolveDotPath(entry.url_field, payload);

    if (resolved === null || resolved === undefined || typeof resolved !== 'string') {
      throw new AttachmentFetchError(
        `Attachment url_field '${entry.url_field}' did not resolve to a URL string in payload`,
        {
          failed_url: null,
          reason: 'URL_FIELD_MISSING',
          attempted_retries: 0,
        },
      );
    }

    const url = resolved;
    const filename = renderTemplate(entry.filename_template, payload);

    const { response, retries, lastError } = await fetchWithRetry(url);

    if (!response) {
      throw new AttachmentFetchError(
        `Failed to fetch attachment from ${url}: ${lastError ?? 'unknown error'}`,
        {
          failed_url: url,
          reason: 'FETCH_FAILED',
          attempted_retries: retries,
        },
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    totalBytes += buffer.byteLength;

    if (totalBytes > SIZE_CAP_BYTES) {
      throw new AttachmentFetchError(
        `Attachment size cap exceeded (${totalBytes} bytes > ${SIZE_CAP_BYTES} bytes)`,
        {
          failed_url: url,
          reason: 'SIZE_CAP_EXCEEDED',
          attempted_retries: retries,
        },
      );
    }

    results.push({
      filename,
      content_base64: buffer.toString('base64'),
    });
  }

  return results;
}
