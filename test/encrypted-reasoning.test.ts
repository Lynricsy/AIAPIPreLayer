import { describe, expect, test } from 'bun:test';
import {
  hasEncryptedReasoningContent,
  dropLastReasoningEncryptedContent,
  dropAllReasoningEncryptedContent,
} from '../src/processors/encrypted-reasoning.ts';

function makeBody(reasoningItems: Array<{ encrypted?: string }>) {
  return {
    model: 'o3',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ...reasoningItems.map((r, i) => ({
        type: 'reasoning',
        id: `rs_${i}`,
        content: r.encrypted
          ? [{ type: 'reasoning_encrypted', encrypted_content: r.encrypted }]
          : [{ type: 'summary_text', text: 'some reasoning' }],
      })),
    ],
  };
}

describe('hasEncryptedReasoningContent', () => {
  test('returns true when reasoning item has encrypted_content', () => {
    const body = makeBody([{ encrypted: 'abc123' }]);
    expect(hasEncryptedReasoningContent(body)).toBe(true);
  });

  test('returns true when multiple reasoning items and last has encrypted_content', () => {
    const body = makeBody([{}, { encrypted: 'xyz' }]);
    expect(hasEncryptedReasoningContent(body)).toBe(true);
  });

  test('returns true when multiple reasoning items and first has encrypted_content', () => {
    const body = makeBody([{ encrypted: 'abc' }, {}]);
    expect(hasEncryptedReasoningContent(body)).toBe(true);
  });

  test('returns false when reasoning item has no encrypted_content', () => {
    const body = makeBody([{}]);
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });

  test('returns false when no reasoning items', () => {
    const body = { model: 'o3', input: [{ type: 'message', role: 'user', content: [] }] };
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });

  test('returns false when input array is empty', () => {
    const body = { model: 'o3', input: [] };
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });

  test('returns false for null body', () => {
    expect(hasEncryptedReasoningContent(null)).toBe(false);
  });

  test('returns false for undefined body', () => {
    expect(hasEncryptedReasoningContent(undefined)).toBe(false);
  });

  test('returns false for string body', () => {
    expect(hasEncryptedReasoningContent('some string')).toBe(false);
  });

  test('returns false for number body', () => {
    expect(hasEncryptedReasoningContent(42)).toBe(false);
  });

  test('returns false when body.input is not array', () => {
    const body = { model: 'o3', input: 'not-an-array' };
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });

  test('returns false when body.input is null', () => {
    const body = { model: 'o3', input: null };
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });

  test('skips items without type field', () => {
    const body = {
      model: 'o3',
      input: [
        { id: 'rs_0', content: [{ type: 'reasoning_encrypted', encrypted_content: 'abc' }] },
      ],
    };
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });

  test('skips items with type != reasoning', () => {
    const body = {
      model: 'o3',
      input: [
        {
          type: 'message',
          content: [{ type: 'reasoning_encrypted', encrypted_content: 'abc' }],
        },
      ],
    };
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });

  test('returns false when encrypted_content is empty string (falsy)', () => {
    const body = {
      model: 'o3',
      input: [
        {
          type: 'reasoning',
          id: 'rs_0',
          content: [{ type: 'reasoning_encrypted', encrypted_content: '' }],
        },
      ],
    };
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });

  test('returns false when reasoning content is not array', () => {
    const body = {
      model: 'o3',
      input: [{ type: 'reasoning', id: 'rs_0', content: 'not-array' }],
    };
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });
});

describe('dropLastReasoningEncryptedContent', () => {
  test('drops encrypted_content from last reasoning item, returns changed=true', () => {
    const body = makeBody([{ encrypted: 'secret' }]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as ReturnType<typeof makeBody>;
    const reasoning = newBody.input[1] as { type: string; content: Array<Record<string, unknown>> };
    expect(reasoning.content[0]).not.toHaveProperty('encrypted_content');
  });

  test('does not mutate original body (reference inequality)', () => {
    const body = makeBody([{ encrypted: 'secret' }]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.body).not.toBe(body);
  });

  test('original body still has encrypted_content after drop', () => {
    const body = makeBody([{ encrypted: 'secret' }]);
    dropLastReasoningEncryptedContent(body);
    const reasoning = body.input[1] as { content: Array<Record<string, unknown>> };
    expect(reasoning.content[0]).toHaveProperty('encrypted_content', 'secret');
  });

  test('returns changed=false and original ref when no reasoning items', () => {
    const body = { model: 'o3', input: [{ type: 'message', content: [] }] };
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  test('returns changed=false when reasoning has no encrypted_content', () => {
    const body = makeBody([{}]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  test('with multiple reasoning items: only last one is affected', () => {
    const body = makeBody([{ encrypted: 'first' }, { encrypted: 'last' }]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as ReturnType<typeof makeBody>;
    const firstReasoning = newBody.input[1] as { content: Array<Record<string, unknown>> };
    expect(firstReasoning.content[0]).toHaveProperty('encrypted_content', 'first');
    const lastReasoning = newBody.input[2] as { content: Array<Record<string, unknown>> };
    expect(lastReasoning.content[0]).not.toHaveProperty('encrypted_content');
  });

  test('with single reasoning item: that item is affected', () => {
    const body = makeBody([{ encrypted: 'only' }]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as ReturnType<typeof makeBody>;
    const reasoning = newBody.input[1] as { content: Array<Record<string, unknown>> };
    expect(reasoning.content[0]).not.toHaveProperty('encrypted_content');
  });

  test('when first reasoning has encrypted but last does not, returns changed=false', () => {
    const body = makeBody([{ encrypted: 'first' }, {}]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  test('returns changed=false for null body', () => {
    const result = dropLastReasoningEncryptedContent(null);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(null);
  });

  test('returns changed=false for non-object body', () => {
    const result = dropLastReasoningEncryptedContent('string');
    expect(result.changed).toBe(false);
    expect(result.body).toBe('string');
  });

  test('returns changed=false when input is not array', () => {
    const body = { model: 'o3', input: 'not-array' };
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });
});

describe('dropAllReasoningEncryptedContent', () => {
  test('drops encrypted_content from all reasoning items, returns changed=true', () => {
    const body = makeBody([{ encrypted: 'first' }, { encrypted: 'second' }]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as ReturnType<typeof makeBody>;
    const r1 = newBody.input[1] as { content: Array<Record<string, unknown>> };
    const r2 = newBody.input[2] as { content: Array<Record<string, unknown>> };
    expect(r1.content[0]).not.toHaveProperty('encrypted_content');
    expect(r2.content[0]).not.toHaveProperty('encrypted_content');
  });

  test('does not mutate original body (reference inequality)', () => {
    const body = makeBody([{ encrypted: 'secret' }]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.body).not.toBe(body);
  });

  test('original body still has all encrypted_content after drop', () => {
    const body = makeBody([{ encrypted: 'first' }, { encrypted: 'second' }]);
    dropAllReasoningEncryptedContent(body);
    const r1 = body.input[1] as { content: Array<Record<string, unknown>> };
    const r2 = body.input[2] as { content: Array<Record<string, unknown>> };
    expect(r1.content[0]).toHaveProperty('encrypted_content', 'first');
    expect(r2.content[0]).toHaveProperty('encrypted_content', 'second');
  });

  test('returns changed=false and original ref when no reasoning items', () => {
    const body = { model: 'o3', input: [{ type: 'message', content: [] }] };
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  test('returns changed=false when reasoning items have no encrypted_content', () => {
    const body = makeBody([{}, {}]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  test('partial: some reasoning encrypted, some not — all encrypted ones cleared', () => {
    const body = makeBody([{ encrypted: 'yes' }, {}]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as ReturnType<typeof makeBody>;
    const r1 = newBody.input[1] as { content: Array<Record<string, unknown>> };
    const r2 = newBody.input[2] as { content: Array<Record<string, unknown>> };
    expect(r1.content[0]).not.toHaveProperty('encrypted_content');
    expect(r2.content[0]).toHaveProperty('text', 'some reasoning');
  });

  test('returns changed=false for null body', () => {
    const result = dropAllReasoningEncryptedContent(null);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(null);
  });

  test('returns changed=false for non-object body', () => {
    const result = dropAllReasoningEncryptedContent(42);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(42);
  });

  test('returns changed=false when input is not array', () => {
    const body = { model: 'o3', input: {} };
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  test('single reasoning item with encrypted_content is cleared', () => {
    const body = makeBody([{ encrypted: 'only' }]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as ReturnType<typeof makeBody>;
    const r = newBody.input[1] as { content: Array<Record<string, unknown>> };
    expect(r.content[0]).not.toHaveProperty('encrypted_content');
  });
});

function makeBodyTopLevel(reasoningItems: Array<{ encrypted?: string }>) {
  return {
    model: 'gpt-5.2',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ...reasoningItems.map((r, i) => ({
        type: 'reasoning' as const,
        id: `rs_${i}`,
        ...(r.encrypted
          ? { encrypted_content: r.encrypted, summary: 'some summary' }
          : { summary: 'some reasoning without encryption' }),
      })),
    ],
  };
}

describe('hasEncryptedReasoningContent (top-level format)', () => {
  test('returns true when reasoning has top-level encrypted_content', () => {
    const body = makeBodyTopLevel([{ encrypted: 'gAAAA_abc' }]);
    expect(hasEncryptedReasoningContent(body)).toBe(true);
  });

  test('returns true with multiple reasoning items, one encrypted', () => {
    const body = makeBodyTopLevel([{}, { encrypted: 'gAAAA_xyz' }]);
    expect(hasEncryptedReasoningContent(body)).toBe(true);
  });

  test('returns false when no encrypted_content', () => {
    const body = makeBodyTopLevel([{}, {}]);
    expect(hasEncryptedReasoningContent(body)).toBe(false);
  });
});

describe('dropLastReasoningEncryptedContent (top-level format)', () => {
  test('drops top-level encrypted_content from last reasoning', () => {
    const body = makeBodyTopLevel([{ encrypted: 'first' }, { encrypted: 'last' }]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as any;
    expect(newBody.input[1]).toHaveProperty('encrypted_content', 'first');
    expect(newBody.input[2]).not.toHaveProperty('encrypted_content');
    expect(newBody.input[2]).toHaveProperty('summary', 'some summary');
  });

  test('does not mutate original body', () => {
    const body = makeBodyTopLevel([{ encrypted: 'secret' }]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.body).not.toBe(body);
    expect((body.input[1] as any).encrypted_content).toBe('secret');
  });

  test('returns changed=false when last reasoning has no encrypted_content', () => {
    const body = makeBodyTopLevel([{ encrypted: 'first' }, {}]);
    const result = dropLastReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });
});

describe('dropAllReasoningEncryptedContent (top-level format)', () => {
  test('drops top-level encrypted_content from all reasoning items', () => {
    const body = makeBodyTopLevel([{ encrypted: 'first' }, { encrypted: 'second' }]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as any;
    expect(newBody.input[1]).not.toHaveProperty('encrypted_content');
    expect(newBody.input[2]).not.toHaveProperty('encrypted_content');
    expect(newBody.input[1]).toHaveProperty('summary');
    expect(newBody.input[2]).toHaveProperty('summary');
  });

  test('does not mutate original body', () => {
    const body = makeBodyTopLevel([{ encrypted: 'a' }, { encrypted: 'b' }]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.body).not.toBe(body);
    expect((body.input[1] as any).encrypted_content).toBe('a');
    expect((body.input[2] as any).encrypted_content).toBe('b');
  });

  test('partial: only encrypted items are cleared', () => {
    const body = makeBodyTopLevel([{ encrypted: 'yes' }, {}]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(true);
    const newBody = result.body as any;
    expect(newBody.input[1]).not.toHaveProperty('encrypted_content');
  });

  test('returns changed=false when no encrypted_content exists', () => {
    const body = makeBodyTopLevel([{}, {}]);
    const result = dropAllReasoningEncryptedContent(body);
    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });
});
