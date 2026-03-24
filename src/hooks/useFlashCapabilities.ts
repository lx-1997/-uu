import { useEffect, useState } from 'react';
import { isDesktop } from '../utils/env';

const EMPTY_CAPS: FlashCapabilities = {
  supportsDriveScan: false,
  supportsDirectWrite: false,
  supportsBackup: false,
  supportsAutoDecompressXz: false,
  supportsVerifyAfterWrite: false,
  supportsLaunchThirdPartyTool: false,
};

let cachedCaps: FlashCapabilities | null = null;

export function useFlashCapabilities(): { caps: FlashCapabilities; loading: boolean } {
  const [caps, setCaps] = useState<FlashCapabilities>(cachedCaps ?? EMPTY_CAPS);
  const [loading, setLoading] = useState(!cachedCaps);

  useEffect(() => {
    if (cachedCaps) return;
    if (!isDesktop() || !window.rdkDesktop?.flashGetCapabilities) {
      cachedCaps = EMPTY_CAPS;
      setCaps(EMPTY_CAPS);
      setLoading(false);
      return;
    }
    let cancelled = false;
    window.rdkDesktop.flashGetCapabilities().then((result) => {
      if (cancelled) return;
      cachedCaps = result;
      setCaps(result);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      cachedCaps = EMPTY_CAPS;
      setCaps(EMPTY_CAPS);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { caps, loading };
}
