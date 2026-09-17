// Minimal XML plist reader for `diskutil`/`tmutil`-style output. Deliberately
// hand-written: no dependencies, and enough coverage for the scalar types those
// tools emit (dict, array, string, integer, real, true, false, data, date).

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

interface Tag {
  closing: boolean;
  selfClosing: boolean;
  name: string;
}

export function parsePlist(xml: string): unknown {
  const src = xml
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  let i = 0;

  const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  const skipWs = (): void => {
    while (i < src.length && isWs(src[i] as string)) i += 1;
  };

  const readText = (): string => {
    const start = i;
    while (i < src.length && src[i] !== '<') i += 1;
    return src.slice(start, i);
  };

  const readTag = (): Tag => {
    i += 1; // consume '<'
    let closing = false;
    if (src[i] === '/') {
      closing = true;
      i += 1;
    }
    const start = i;
    while (i < src.length && src[i] !== '>' && src[i] !== '/' && !isWs(src[i] as string)) i += 1;
    const name = src.slice(start, i);
    while (i < src.length && src[i] !== '>') i += 1;
    if (src[i] === '>') i += 1;
    return { closing, selfClosing: src[i - 2] === '/', name };
  };

  const readDict = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (;;) {
      skipWs();
      if (i >= src.length || src.startsWith('</dict>', i)) {
        if (src.startsWith('</dict>', i)) i += '</dict>'.length;
        break;
      }
      const keyOpen = readTag();
      if (keyOpen.closing || keyOpen.name !== 'key') break;
      const key = decodeEntities(readText());
      readTag(); // </key>
      out[key] = parseValue();
    }
    return out;
  };

  const readArray = (): unknown[] => {
    const out: unknown[] = [];
    for (;;) {
      skipWs();
      if (i >= src.length || src.startsWith('</array>', i)) {
        if (src.startsWith('</array>', i)) i += '</array>'.length;
        break;
      }
      out.push(parseValue());
    }
    return out;
  };

  function parseValue(): unknown {
    skipWs();
    if (src[i] !== '<') return null;
    const tag = readTag();
    if (tag.closing) return null;
    switch (tag.name) {
      case 'plist':
        return parseValue();
      case 'dict':
        return readDict();
      case 'array':
        return readArray();
      case 'true':
        return true;
      case 'false':
        return false;
      case 'integer': {
        const text = readText();
        readTag(); // </integer>
        return parseInt(text.trim(), 10);
      }
      case 'real': {
        const text = readText();
        readTag(); // </real>
        return Number.parseFloat(text.trim());
      }
      case 'string':
      case 'data':
      case 'date': {
        const text = readText();
        readTag(); // </string|data|date>
        return decodeEntities(text);
      }
      default:
        return null;
    }
  }

  return parseValue();
}
