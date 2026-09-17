import type { Rule } from '../../types';

// Docker stores everything in a single sparse disk image (Docker.raw), so
// pruning frees space inside the image that macOS reclaims only as the VM
// grows back into it — the file may shrink gradually, not instantly.
const VIRTUAL_ROOTS = ['/var/run/docker.sock'];

export const dockerRules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'docker.build-cache',
    title: 'Docker build cache',
    category: 'dev',
    tier: 0,
    requires: ['docker'],
    roots: VIRTUAL_ROOTS,
    matcher: { kind: 'probe', probe: 'docker-df' },
    action: 'docker-builder-prune',
    rationale:
      'BuildKit keeps every intermediate layer so future builds can reuse them; the cache is safe to drop since Docker rebuilds it from the Dockerfile. Space is returned inside Docker.raw, which macOS reclaims only gradually as the image shrinks.',
    regeneration:
      'The next build re-executes the cached steps; nothing is downloaded again, but that build is slower.',
  },
  {
    schemaVersion: 1,
    id: 'docker.dangling-images',
    title: 'Dangling Docker images',
    category: 'dev',
    tier: 1,
    requires: ['docker'],
    roots: VIRTUAL_ROOTS,
    matcher: { kind: 'probe', probe: 'docker-df' },
    action: 'docker-image-prune',
    rationale:
      'An untagged image is a layer set no container or tag refers to any more, usually left behind when an image was rebuilt. Pruning removes only these, and Docker.raw may shrink only gradually afterwards.',
    regeneration:
      'Re-pulled or rebuilt from the registry or Dockerfile the next time the image is needed.',
  },
  {
    schemaVersion: 1,
    id: 'docker.unused-images',
    title: 'Unused Docker images',
    category: 'dev',
    tier: 1,
    requires: ['docker'],
    roots: VIRTUAL_ROOTS,
    matcher: { kind: 'probe', probe: 'docker-df' },
    action: 'docker-image-prune',
    rationale:
      'Tagged images with no container using them are kept only as a warm cache for the next run. Removing them never affects a running container, though Docker.raw may shrink only gradually as the VM releases the space.',
    regeneration:
      'Re-pulled from the registry on the next `docker run` or `docker compose up`, which needs network access.',
  },
  {
    schemaVersion: 1,
    id: 'docker.stopped-containers',
    title: 'Stopped Docker containers',
    category: 'dev',
    tier: 1,
    requires: ['docker'],
    roots: VIRTUAL_ROOTS,
    matcher: { kind: 'probe', probe: 'docker-df' },
    action: 'docker-container-prune',
    rationale:
      'A container that is not running only holds its writable layer; the image it came from is untouched. Pruning them discards that layer, and Docker.raw may shrink only gradually after the space is freed.',
    regeneration:
      '`docker run` or `docker compose up` starts a fresh container from the image; any data not on a mounted volume is gone.',
  },
  {
    schemaVersion: 1,
    id: 'docker.volumes',
    title: 'Docker volumes',
    category: 'dev',
    tier: 3,
    requires: ['docker'],
    roots: VIRTUAL_ROOTS,
    matcher: { kind: 'probe', probe: 'docker-df' },
    action: null,
    manualCommand: 'docker volume ls',
    rationale:
      'Volumes hold databases and other container data; macsweep never deletes them.',
    regeneration:
      'Nothing restores a removed volume unless the application that used it can rebuild its data from elsewhere.',
  },
];
