import {
  encodeFrame,
  createFrameDecoder,
} from '../main/daemon/framing';

describe('daemon framing', () => {
  it('round-trips a single object', () => {
    const received: unknown[] = [];
    const decode = createFrameDecoder((obj) => received.push(obj));
    decode(encodeFrame({ hello: 'world' }));
    expect(received).toEqual([{ hello: 'world' }]);
  });

  it('handles a message split across two chunks', () => {
    const received: unknown[] = [];
    const decode = createFrameDecoder((obj) => received.push(obj));
    const frame = encodeFrame({ a: 1, b: 2 });
    const splitAt = Math.floor(frame.length / 2);
    decode(frame.slice(0, splitAt));
    decode(frame.slice(splitAt));
    expect(received).toEqual([{ a: 1, b: 2 }]);
  });

  it('handles two messages arriving in one chunk', () => {
    const received: unknown[] = [];
    const decode = createFrameDecoder((obj) => received.push(obj));
    decode(encodeFrame({ n: 1 }) + encodeFrame({ n: 2 }));
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('drops a malformed line without throwing', () => {
    const received: unknown[] = [];
    const decode = createFrameDecoder((obj) => received.push(obj));
    expect(() => decode(`not json\n${encodeFrame({ ok: true })}`)).not.toThrow();
    expect(received).toEqual([{ ok: true }]);
  });
});
