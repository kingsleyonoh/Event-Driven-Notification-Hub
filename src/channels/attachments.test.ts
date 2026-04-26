import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAttachments } from './attachments.js';
import { AttachmentFetchError } from '../lib/errors.js';

describe('fetchAttachments', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array immediately when config is null/undefined/empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await fetchAttachments(null, { foo: 'bar' })).toEqual([]);
    expect(await fetchAttachments(undefined, { foo: 'bar' })).toEqual([]);
    expect(await fetchAttachments([], { foo: 'bar' })).toEqual([]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders Handlebars filename_template against payload and returns base64 content', async () => {
    const body = new TextEncoder().encode('PDF DATA');
    const expectedB64 = Buffer.from(body).toString('base64');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => body.buffer,
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = [
      { filename_template: '{{invoice_number}}.pdf', url_field: 'pdf_signed_url' },
    ];
    const payload = {
      invoice_number: '1234',
      pdf_signed_url: 'https://example.com/signed/abc',
    };

    const result = await fetchAttachments(config, payload);

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('1234.pdf');
    expect(result[0].content_base64).toBe(expectedB64);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/signed/abc',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('resolves nested dot-paths in url_field; throws AttachmentFetchError when path missing', async () => {
    // First call: nested path resolves
    const body = new TextEncoder().encode('NESTED');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => body.buffer,
    });
    vi.stubGlobal('fetch', mockFetch);

    const okResult = await fetchAttachments(
      [{ filename_template: 'invoice.pdf', url_field: 'invoice.url' }],
      { invoice: { url: 'https://example.com/n' } },
    );
    expect(okResult).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/n',
      expect.objectContaining({ signal: expect.anything() }),
    );

    // Missing path → throws
    await expect(
      fetchAttachments(
        [{ filename_template: 'x.pdf', url_field: 'does.not.exist' }],
        { invoice: { url: 'https://example.com/n' } },
      ),
    ).rejects.toThrow(AttachmentFetchError);
  });

  it('throws AttachmentFetchError with reason SIZE_CAP_EXCEEDED when total > 38MB', async () => {
    // Build a 20MB chunk of bytes
    const twentyMb = new Uint8Array(20 * 1024 * 1024);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => twentyMb.buffer,
    });
    vi.stubGlobal('fetch', mockFetch);

    const config = [
      { filename_template: 'a.pdf', url_field: 'a' },
      { filename_template: 'b.pdf', url_field: 'b' },
    ];
    const payload = {
      a: 'https://example.com/a',
      b: 'https://example.com/b',
    };

    try {
      await fetchAttachments(config, payload);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AttachmentFetchError);
      const ae = err as AttachmentFetchError;
      // details is JSON stringified into details[0]
      const detailsStr = ae.details.join(' ');
      expect(detailsStr).toContain('SIZE_CAP_EXCEEDED');
    }
  });

  it('retries once on 503 then succeeds', async () => {
    const body = new TextEncoder().encode('RECOVERED');

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        arrayBuffer: async () => new ArrayBuffer(0),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => body.buffer,
      });
    vi.stubGlobal('fetch', mockFetch);

    const config = [{ filename_template: 'x.pdf', url_field: 'u' }];
    const payload = { u: 'https://example.com/x' };

    const result = await fetchAttachments(config, payload);

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('x.pdf');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws AttachmentFetchError after retry exhausted', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('network fail'));
    vi.stubGlobal('fetch', mockFetch);

    const config = [{ filename_template: 'x.pdf', url_field: 'u' }];
    const payload = { u: 'https://example.com/x' };

    await expect(fetchAttachments(config, payload)).rejects.toThrow(AttachmentFetchError);
    expect(mockFetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
