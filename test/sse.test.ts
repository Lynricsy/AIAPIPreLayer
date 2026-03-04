import { describe, expect, test } from 'bun:test';
import {
  parseSSEChunk,
  createSSELineParser,
  isOutputEvent,
  isFastModelPreprocessFailure,
  serializeSSEEvent,
} from '../src/utils/sse';

describe('parseSSEChunk', () => {
  test('parses single event with event and data fields', () => {
    const result = parseSSEChunk('event: foo\ndata: bar\n\n');
    expect(result).toEqual([{ event: 'foo', data: 'bar' }]);
  });

  test('parses multiple events in one chunk', () => {
    const result = parseSSEChunk('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n');
    expect(result).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  test('handles data-only events (no event field)', () => {
    const result = parseSSEChunk('data: hello\n\n');
    expect(result).toEqual([{ data: 'hello' }]);
  });

  test('handles multi-line data (multiple data: lines joined with \\n)', () => {
    const result = parseSSEChunk('data: line1\ndata: line2\ndata: line3\n\n');
    expect(result).toEqual([{ data: 'line1\nline2\nline3' }]);
  });

  test('handles id field', () => {
    const result = parseSSEChunk('id: 42\ndata: payload\n\n');
    expect(result).toEqual([{ id: '42', data: 'payload' }]);
  });

  test('handles retry field', () => {
    const result = parseSSEChunk('retry: 3000\ndata: reconnect\n\n');
    expect(result).toEqual([{ retry: 3000, data: 'reconnect' }]);
  });

  test('handles all fields together', () => {
    const result = parseSSEChunk('event: update\nid: 99\nretry: 5000\ndata: content\n\n');
    expect(result).toEqual([{ event: 'update', id: '99', retry: 5000, data: 'content' }]);
  });

  test('returns empty array for empty chunk', () => {
    expect(parseSSEChunk('')).toEqual([]);
  });

  test('returns empty array for whitespace-only chunk', () => {
    expect(parseSSEChunk('   \n\n  ')).toEqual([]);
  });

  test('ignores comment lines starting with :', () => {
    const result = parseSSEChunk(': this is a comment\ndata: real data\n\n');
    expect(result).toEqual([{ data: 'real data' }]);
  });

  test('ignores comment-only blocks (no data)', () => {
    const result = parseSSEChunk(': just a comment\n\n');
    expect(result).toEqual([]);
  });

  test('blocks without data field are discarded', () => {
    const result = parseSSEChunk('event: foo\n\n');
    expect(result).toEqual([]);
  });

  test('handles value with no leading space after colon', () => {
    const result = parseSSEChunk('data:no-space\n\n');
    expect(result).toEqual([{ data: 'no-space' }]);
  });
});

describe('createSSELineParser', () => {
  test('parses a complete event pushed in one chunk', () => {
    const parser = createSSELineParser();
    const events = parser.push('event: foo\ndata: bar\n\n');
    expect(events).toEqual([{ event: 'foo', data: 'bar' }]);
  });

  test('empty push returns empty array', () => {
    const parser = createSSELineParser();
    expect(parser.push('')).toEqual([]);
  });

  test('accumulates chunks split mid-line', () => {
    const parser = createSSELineParser();
    expect(parser.push('event: fo')).toEqual([]);
    expect(parser.push('o\ndata: ba')).toEqual([]);
    const events = parser.push('r\n\n');
    expect(events).toEqual([{ event: 'foo', data: 'bar' }]);
  });

  test('accumulates chunks split mid-event', () => {
    const parser = createSSELineParser();
    expect(parser.push('event: test\n')).toEqual([]);
    expect(parser.push('data: value\n')).toEqual([]);
    const events = parser.push('\n');
    expect(events).toEqual([{ event: 'test', data: 'value' }]);
  });

  test('parses multiple events across multiple pushes', () => {
    const parser = createSSELineParser();
    const e1 = parser.push('data: first\n\n');
    expect(e1).toEqual([{ data: 'first' }]);
    const e2 = parser.push('data: second\n\n');
    expect(e2).toEqual([{ data: 'second' }]);
  });

  test('flush() returns buffered incomplete event', () => {
    const parser = createSSELineParser();
    parser.push('data: partial');
    const remaining = parser.flush();
    expect(remaining).toEqual([{ data: 'partial' }]);
  });

  test('flush() returns empty array when nothing buffered', () => {
    const parser = createSSELineParser();
    expect(parser.flush()).toEqual([]);
  });

  test('flush() after complete event returns empty array', () => {
    const parser = createSSELineParser();
    parser.push('data: done\n\n');
    expect(parser.flush()).toEqual([]);
  });

  test('handles chunks split between two events', () => {
    const parser = createSSELineParser();
    const e1 = parser.push('data: first\n\ndata: sec');
    expect(e1).toEqual([{ data: 'first' }]);
    const e2 = parser.push('ond\n\n');
    expect(e2).toEqual([{ data: 'second' }]);
  });

  test('ignores comment lines in stream', () => {
    const parser = createSSELineParser();
    const events = parser.push(': comment\ndata: real\n\n');
    expect(events).toEqual([{ data: 'real' }]);
  });
});

describe('isOutputEvent', () => {
  test('true for response.output_item.added', () => {
    expect(isOutputEvent({ event: 'response.output_item.added', data: '' })).toBe(true);
  });

  test('true for response.output_item.done', () => {
    expect(isOutputEvent({ event: 'response.output_item.done', data: '' })).toBe(true);
  });

  test('true for response.content_part.added', () => {
    expect(isOutputEvent({ event: 'response.content_part.added', data: '' })).toBe(true);
  });

  test('true for response.content_part.done', () => {
    expect(isOutputEvent({ event: 'response.content_part.done', data: '' })).toBe(true);
  });

  test('true for response.function_call_arguments.delta', () => {
    expect(isOutputEvent({ event: 'response.function_call_arguments.delta', data: '' })).toBe(true);
  });

  test('false for response.created', () => {
    expect(isOutputEvent({ event: 'response.created', data: '' })).toBe(false);
  });

  test('false for response.in_progress', () => {
    expect(isOutputEvent({ event: 'response.in_progress', data: '' })).toBe(false);
  });

  test('false for error', () => {
    expect(isOutputEvent({ event: 'error', data: '' })).toBe(false);
  });

  test('false for response.failed', () => {
    expect(isOutputEvent({ event: 'response.failed', data: '' })).toBe(false);
  });

  test('false when event field is undefined', () => {
    expect(isOutputEvent({ data: 'something' })).toBe(false);
  });

  test('false for empty string event', () => {
    expect(isOutputEvent({ event: '', data: '' })).toBe(false);
  });
});

describe('isFastModelPreprocessFailure', () => {
  const failureEvents = [
    { event: 'response.created', data: '' },
    { event: 'response.in_progress', data: '' },
    { event: 'error', data: '{"message":"decrypt failed"}' },
    { event: 'response.failed', data: '' },
  ];

  test('true: all required events present, no output events, elapsed < 10000', () => {
    expect(isFastModelPreprocessFailure(failureEvents, 1000)).toBe(true);
  });

  test('true: elapsed just under threshold (9999ms)', () => {
    expect(isFastModelPreprocessFailure(failureEvents, 9999)).toBe(true);
  });

  test('false: elapsed >= 10000ms', () => {
    expect(isFastModelPreprocessFailure(failureEvents, 10000)).toBe(false);
  });

  test('false: elapsed > 10000ms', () => {
    expect(isFastModelPreprocessFailure(failureEvents, 15000)).toBe(false);
  });

  test('false: has output events present', () => {
    const events = [
      ...failureEvents,
      { event: 'response.output_item.added', data: '' },
    ];
    expect(isFastModelPreprocessFailure(events, 1000)).toBe(false);
  });

  test('false: missing error event', () => {
    const events = failureEvents.filter((e) => e.event !== 'error');
    expect(isFastModelPreprocessFailure(events, 1000)).toBe(false);
  });

  test('false: missing response.failed event', () => {
    const events = failureEvents.filter((e) => e.event !== 'response.failed');
    expect(isFastModelPreprocessFailure(events, 1000)).toBe(false);
  });

  test('false: missing response.created event', () => {
    const events = failureEvents.filter((e) => e.event !== 'response.created');
    expect(isFastModelPreprocessFailure(events, 1000)).toBe(false);
  });

  test('false: missing response.in_progress event', () => {
    const events = failureEvents.filter((e) => e.event !== 'response.in_progress');
    expect(isFastModelPreprocessFailure(events, 1000)).toBe(false);
  });

  test('false: empty events array', () => {
    expect(isFastModelPreprocessFailure([], 1000)).toBe(false);
  });

  test('false: only has response.created (incomplete failure pattern)', () => {
    const events = [{ event: 'response.created', data: '' }];
    expect(isFastModelPreprocessFailure(events, 1000)).toBe(false);
  });
});

describe('serializeSSEEvent', () => {
  test('serializes event with event and data fields', () => {
    const result = serializeSSEEvent({ event: 'foo', data: 'bar' });
    expect(result).toBe('event: foo\ndata: bar\n\n');
  });

  test('serializes data-only event', () => {
    const result = serializeSSEEvent({ data: 'hello' });
    expect(result).toBe('data: hello\n\n');
  });

  test('multi-line data splits into multiple data: lines', () => {
    const result = serializeSSEEvent({ data: 'line1\nline2\nline3' });
    expect(result).toBe('data: line1\ndata: line2\ndata: line3\n\n');
  });

  test('includes id field when present', () => {
    const result = serializeSSEEvent({ id: '123', data: 'payload' });
    expect(result).toBe('id: 123\ndata: payload\n\n');
  });

  test('includes retry field when present', () => {
    const result = serializeSSEEvent({ retry: 3000, data: 'reconnect' });
    expect(result).toBe('retry: 3000\ndata: reconnect\n\n');
  });

  test('serializes all fields together', () => {
    const result = serializeSSEEvent({ event: 'update', id: '99', retry: 5000, data: 'content' });
    expect(result).toBe('event: update\nid: 99\nretry: 5000\ndata: content\n\n');
  });

  test('always ends with \\n\\n', () => {
    const result = serializeSSEEvent({ data: 'test' });
    expect(result.endsWith('\n\n')).toBe(true);
  });

  test('serializes empty data string', () => {
    const result = serializeSSEEvent({ data: '' });
    expect(result).toBe('data: \n\n');
  });

  test('round-trip: parseSSEChunk(serializeSSEEvent(event)) returns original event', () => {
    const original = { event: 'test', id: '1', retry: 1000, data: 'hello\nworld' };
    const serialized = serializeSSEEvent(original);
    const parsed = parseSSEChunk(serialized);
    expect(parsed).toEqual([original]);
  });
});
