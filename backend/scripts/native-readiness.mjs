/** HTTP listeners can precede the volume heartbeat after a SeaweedFS restart. */
export function registeredVolumes(topology, volumeFiles) {
  const nodes = (topology?.Topology?.DataCenters ?? []).flatMap((dc) =>
    (dc.Racks ?? []).flatMap((rack) => rack.DataNodes ?? []),
  );
  const owned = nodes.find((node) => node.Url === '127.0.0.1:8080');
  if (!owned) return false;
  const available = new Set();
  for (const part of (owned.VolumeIds ?? '').trim().split(/\s+/)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) continue;
    const first = Number(match[1]),
      last = Number(match[2] ?? match[1]);
    if (last - first > 1000) return false;
    for (let id = first; id <= last; id++) available.add(id);
  }
  return volumeFiles.every((file) => {
    const match = /(\d+)\.dat$/.exec(file);
    return match && available.has(Number(match[1]));
  });
}
