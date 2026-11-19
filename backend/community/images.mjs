import rule from './image-route.json' with { type: 'json' };

// Valve serves the same UGC paths on this legacy image origin, already covered
// by Steam++'s image rule. Keep the original URL whenever acceleration is off.
export function steamImageUrl(raw, enabled, method = 'GET') {
  const url = new URL(raw);
  if (enabled && ['GET', 'HEAD'].includes(String(method).toUpperCase()) &&
    url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    url.hostname === rule.source && url.pathname.startsWith(rule.pathPrefix)) {
    url.hostname = rule.target;
  }
  return url.href;
}
