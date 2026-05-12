/**
 * S-01: MCP pipe hello — acceptance test for tecr-core layer.
 *
 * Exit criterion: hello() returns the TECR version prefix and the original message.
 */

import { describe, it, expect } from 'vitest';
import { hello, VERSION } from '../index.js';

describe('S-01 hello', () => {
  it('returns TECR version prefix', () => {
    expect(hello('world')).toBe(`TECR ${VERSION}: world`);
  });

  it('round-trips arbitrary messages unchanged', () => {
    const messages = ['hello', 'foo bar baz', '`@tecr hello` in VS Code chat'];
    for (const msg of messages) {
      expect(hello(msg)).toContain(msg);
    }
  });
});
