import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { decodePlainTextAttachmentBuffer } from '../attachment-tools.js';

describe('decodePlainTextAttachmentBuffer', () => {
  it('decodes UTF-8 Chinese', () => {
    const s = '阿莉雅角色设定';
    const buf = Buffer.from(s, 'utf8');
    expect(decodePlainTextAttachmentBuffer(buf)).toBe(s);
  });

  it('decodes GB18030 / Windows ANSI-style Chinese .txt', () => {
    const s = '阿莉雅角色设定说明';
    const buf = iconv.encode(s, 'gb18030');
    expect(decodePlainTextAttachmentBuffer(buf)).toBe(s);
  });

  it('strips UTF-8 BOM and decodes', () => {
    const body = Buffer.from('你好', 'utf8');
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    expect(decodePlainTextAttachmentBuffer(Buffer.concat([bom, body]))).toBe('你好');
  });

  it('decodes UTF-16 LE with BOM', () => {
    const body = Buffer.from('测试', 'utf16le');
    const bom = Buffer.from([0xff, 0xfe]);
    expect(decodePlainTextAttachmentBuffer(Buffer.concat([bom, body]))).toBe('测试');
  });

  it('ASCII unchanged', () => {
    const buf = Buffer.from('hello\nworld', 'ascii');
    expect(decodePlainTextAttachmentBuffer(buf)).toBe('hello\nworld');
  });
});
