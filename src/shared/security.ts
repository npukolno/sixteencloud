const SOUND_CLOUD_HOST = 'soundcloud.com';

function isHostOrSubdomain(hostname: string, base: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === base || host.endsWith(`.${base}`);
}

export function isTrustedSoundCloudUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && isHostOrSubdomain(url.hostname, SOUND_CLOUD_HOST);
  } catch {
    return false;
  }
}

export function isTrustedOAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const hosts = [
      'accounts.google.com',
      'appleid.apple.com',
      'www.facebook.com',
      'www.instagram.com',
      'api.soundcloud.com',
      'secure.soundcloud.com',
      SOUND_CLOUD_HOST,
    ];
    return hosts.some((host) => isHostOrSubdomain(url.hostname, host));
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isAllowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    // Streaming CDN hosts observed in API responses:
    //  - *.sndcdn.com                        (artwork, legacy progressive)
    //  - *.soundcloud.com                    (API + legacy media)
    //  - *.soundcloud.cloud                  (current HLS: playback.media-streaming.soundcloud.cloud)
    return (
      isHostOrSubdomain(url.hostname, 'sndcdn.com') ||
      isHostOrSubdomain(url.hostname, SOUND_CLOUD_HOST) ||
      isHostOrSubdomain(url.hostname, 'soundcloud.cloud')
    );
  } catch {
    return false;
  }
}
