import type { Candidate } from '../../types';

// `docker system df -v --format '{{json .}}'` prints one JSON object with these
// four arrays. Sizes are human strings using decimal units.
interface RawImage {
  Repository?: string;
  Tag?: string;
  ID?: string;
  Size?: string;
  Containers?: number | string;
}

interface RawContainer {
  Names?: string;
  State?: string;
  Size?: string;
}

interface RawVolume {
  Name?: string;
  Size?: string;
  Links?: number | string;
}

interface RawBuildCache {
  Size?: string;
  Reclaimable?: string;
}

interface RawDockerDf {
  Images?: RawImage[];
  Containers?: RawContainer[];
  Volumes?: RawVolume[];
  BuildCache?: RawBuildCache[];
}

export type DockerGroup =
  | 'build-cache'
  | 'dangling-images'
  | 'unused-images'
  | 'stopped-containers'
  | 'volumes';

const SIZE_UNITS: Record<string, number> = {
  '': 1,
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
};

export function parseDockerSize(s: string): number {
  const match = /^\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)\s*$/.exec(s);
  if (match === null) return 0;
  const multiplier = SIZE_UNITS[(match[2] ?? '').toLowerCase()];
  if (multiplier === undefined) return 0;
  return Math.round(Number(match[1]) * multiplier);
}

function toCount(value: number | string | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function shortId(id: string | undefined): string {
  if (!id) return '<unknown>';
  return id.replace(/^sha256:/, '').slice(0, 6);
}

function bytesHint(bytes: number): Candidate['bytesHint'] {
  return { allocated: bytes, apparent: bytes };
}

export interface DockerDf {
  buildCache: number;
  danglingImages: Candidate[];
  unusedImages: Candidate[];
  stoppedContainers: Candidate[];
  volumes: Candidate[];
}

export function parseDockerDf(json: string): DockerDf {
  const parsed = JSON.parse(json) as RawDockerDf;

  let buildCache = 0;
  for (const entry of parsed.BuildCache ?? []) {
    if (entry === null || typeof entry !== 'object') continue;
    // Modern docker reports `Reclaimable` for older cache types; when the field
    // is absent (as in recent versions) every entry is reclaimable.
    if (entry.Reclaimable !== undefined && !entry.Reclaimable) continue;
    buildCache += parseDockerSize(entry.Size ?? '');
  }

  const danglingImages: Candidate[] = [];
  const unusedImages: Candidate[] = [];
  for (const image of parsed.Images ?? []) {
    if (image === null || typeof image !== 'object') continue;
    const repository = image.Repository ?? '<none>';
    const tag = image.Tag ?? '<none>';
    const dangling = repository === '<none>';
    const containers = toCount(image.Containers);
    if (!dangling && containers !== 0) continue;
    const size = parseDockerSize(image.Size ?? '');
    const name = tag === '<none>' ? repository : `${repository}:${tag}`;
    const candidate: Candidate = {
      kind: 'virtual',
      detail: `image ${name} (${shortId(image.ID)})`,
      bytesHint: bytesHint(size),
    };
    if (dangling) {
      candidate.actionArgs = { group: 'dangling-images' };
      danglingImages.push(candidate);
    } else {
      candidate.actionArgs = { all: 'true', group: 'unused-images' };
      unusedImages.push(candidate);
    }
  }

  const stoppedContainers: Candidate[] = [];
  for (const container of parsed.Containers ?? []) {
    if (container === null || typeof container !== 'object') continue;
    const state = (container.State ?? '').trim();
    if (state.toLowerCase() === 'running') continue;
    stoppedContainers.push({
      kind: 'virtual',
      detail: `container ${container.Names ?? '<unnamed>'} (${state || 'unknown'})`,
      actionArgs: { group: 'stopped-containers' },
      bytesHint: bytesHint(parseDockerSize(container.Size ?? '')),
    });
  }

  const volumes: Candidate[] = [];
  for (const volume of parsed.Volumes ?? []) {
    if (volume === null || typeof volume !== 'object') continue;
    const links = toCount(volume.Links);
    volumes.push({
      kind: 'virtual',
      detail: `volume ${volume.Name ?? '<unnamed>'} (${links} ${links === 1 ? 'link' : 'links'})`,
      actionArgs: { group: 'volumes' },
      bytesHint: bytesHint(parseDockerSize(volume.Size ?? '')),
    });
  }

  return { buildCache, danglingImages, unusedImages, stoppedContainers, volumes };
}

const BUILD_CACHE_DETAIL = 'Docker build cache';

// All groups in one flat list, each tagged so a rule can pick its own group.
export function dockerDfCandidates(json: string): Candidate[] {
  const df = parseDockerDf(json);
  const candidates = [
    ...df.danglingImages,
    ...df.unusedImages,
    ...df.stoppedContainers,
    ...df.volumes,
  ];
  if (df.buildCache > 0) {
    candidates.push({
      kind: 'virtual',
      detail: BUILD_CACHE_DETAIL,
      actionArgs: { group: 'build-cache' },
      bytesHint: bytesHint(df.buildCache),
    });
  }
  return candidates;
}

export function filterDockerGroup(candidates: Candidate[], group: DockerGroup): Candidate[] {
  return candidates.filter((candidate) => candidate.actionArgs?.group === group);
}
