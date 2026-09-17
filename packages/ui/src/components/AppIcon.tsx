import { useEffect, useState } from 'react';
import { fetchBlob, useMock } from '../api/client';

// The page CSP allows img-src 'self' data: but not blob:, so icons are inlined
// as data URLs instead of object URLs.
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function AppIcon({
  name,
  color,
  size = 32,
  radius = 8,
  orphan = false,
  bundleId,
}: {
  name: string;
  color: string;
  size?: number;
  radius?: number;
  orphan?: boolean;
  bundleId?: string;
}) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  useEffect(() => {
    if (useMock || !bundleId) {
      setIconUrl(null);
      return undefined;
    }
    let active = true;
    fetchBlob(`/api/apps/${encodeURIComponent(bundleId)}/icon`)
      .then((blob) => blobToDataUrl(blob))
      .then((dataUrl) => {
        if (active) setIconUrl(dataUrl);
      })
      .catch(() => {
        if (active) setIconUrl(null);
      });
    return () => {
      active = false;
    };
  }, [bundleId]);

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className="flex-none"
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }

  const initial = orphan ? '?' : (name.trim().charAt(0).toUpperCase() || '?');
  return (
    <div
      className="flex flex-none items-center justify-center text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.44),
        fontWeight: 700,
        background: orphan ? 'var(--t3-dot)' : color,
      }}
    >
      {initial}
    </div>
  );
}
