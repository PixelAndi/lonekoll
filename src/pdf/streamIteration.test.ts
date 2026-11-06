import { describe, expect, it } from 'vitest';
import { addStreamIteration } from './browser.ts';

// Safari can't loop over a ReadableStream with `for await`, which pdf.js does when it reads a page's
// text. A stream class without the loop, as in Safari, gets it from addStreamIteration.
class SafariLikeStream {
  constructor(private chunks: string[]) {}
  getReader() {
    const chunks = [...this.chunks];
    return {
      read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }),
      cancel: async () => undefined,
      releaseLock: () => undefined,
    } as unknown as ReadableStreamDefaultReader<unknown>;
  }
}

describe('looping over a stream where the browser lacks it', () => {
  it('adds the loop and reads every chunk in order', async () => {
    const proto = SafariLikeStream.prototype as unknown as Parameters<typeof addStreamIteration>[0];
    expect((proto as Record<PropertyKey, unknown>)[Symbol.asyncIterator]).toBeUndefined();
    addStreamIteration(proto);
    const read: string[] = [];
    for await (const chunk of new SafariLikeStream(['a', 'b', 'c']) as unknown as AsyncIterable<string>) read.push(chunk);
    expect(read).toEqual(['a', 'b', 'c']);
  });
  it('leaves a browser that has the loop alone', () => {
    const own = async function* () {};
    const proto = { getReader: () => ({}) as never, [Symbol.asyncIterator]: own } as unknown as Parameters<typeof addStreamIteration>[0];
    addStreamIteration(proto);
    expect((proto as Record<PropertyKey, unknown>)[Symbol.asyncIterator]).toBe(own);
  });
});
