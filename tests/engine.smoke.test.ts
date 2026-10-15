import { describe, it, expect } from 'vitest';
import { convertToInline, createPreview, DEFAULT_RENDER_WIDTH } from '../src/engine/css-converter';
import { removeWhitespace, parseDeclarations, extractBody } from '../src/engine/utils';

describe('engine import smoke', () => {
  it('exports exist', () => {
    expect(typeof convertToInline).toBe('function');
    expect(typeof createPreview).toBe('function');
    expect(DEFAULT_RENDER_WIDTH).toBe(1000);
  });
  it('pure utils work', () => {
    expect(removeWhitespace('<p>a</p>  \n  <p>b</p>')).toContain('<p>a</p>');
    expect(parseDeclarations('color: red; border: 1px solid #000').map((d) => d.prop)).toEqual(['color', 'border']);
    expect(extractBody('<html><body><p>x</p></body></html>')).toContain('<p>x</p>');
  });
});
