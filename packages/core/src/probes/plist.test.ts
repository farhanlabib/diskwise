import { describe, expect, it } from 'vitest';
import { parsePlist } from './plist';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Name</key>
	<string>Macintosh &amp; HD</string>
	<key>Count</key>
	<integer>42</integer>
	<key>Ratio</key>
	<real>1.5</real>
	<key>Yes</key>
	<true/>
	<key>No</key>
	<false/>
	<key>Blob</key>
	<data>aGVsbG8=</data>
	<key>When</key>
	<date>2024-01-02T03:04:05Z</date>
	<key>List</key>
	<array>
		<string>a</string>
		<integer>2</integer>
	</array>
	<key>Nested</key>
	<dict>
		<key>Inner</key>
		<string>&#65;</string>
	</dict>
</dict>
</plist>`;

describe('parsePlist', () => {
  it('parses the scalar and container types diskutil emits', () => {
    const parsed = parsePlist(XML) as Record<string, unknown>;
    expect(parsed['Name']).toBe('Macintosh & HD');
    expect(parsed['Count']).toBe(42);
    expect(parsed['Ratio']).toBe(1.5);
    expect(parsed['Yes']).toBe(true);
    expect(parsed['No']).toBe(false);
    expect(parsed['Blob']).toBe('aGVsbG8=');
    expect(parsed['When']).toBe('2024-01-02T03:04:05Z');
    expect(parsed['List']).toEqual(['a', 2]);
    expect(parsed['Nested']).toEqual({ Inner: 'A' });
  });

  it('parses a fixture-shaped plist without the xml prologue', () => {
    const parsed = parsePlist('<plist version="1.0"><dict><key>MountPoint</key><string>/</string></dict></plist>');
    expect(parsed).toEqual({ MountPoint: '/' });
  });

  it('returns null for non-plist input', () => {
    expect(parsePlist('not xml at all')).toBeNull();
  });
});
