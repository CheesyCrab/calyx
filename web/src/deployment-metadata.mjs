export function matchingDeployment(release, network, cached = null) {
  if (!release?.payload_id) return null;
  if (network?.payload_id === release.payload_id) return network;
  if (cached?.payload_id === release.payload_id) return cached;
  return null;
}
