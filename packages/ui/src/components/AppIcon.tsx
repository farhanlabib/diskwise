import { useEffect, useState } from 'react';
import { fetchBlob, useMock } from '../api/client';

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
    let objectUrl: string | null = null;
    fetchBlob(`/api/apps/${encodeURIComponent(bundleId)}/icon`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setIconUrl(objectUrl);
      })
      .catch(() => {
        if (active) setIconUrl(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
