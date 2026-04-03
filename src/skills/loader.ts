import type { SkillManifest } from './types';

function skillApiBase(): string {
  const isDesktop = !!(typeof window !== 'undefined' && (window as any).rdkDesktop?.isDesktop);
  if (isDesktop) return 'http://localhost:8787';
  if ((import.meta as any).env?.DEV) {
    if (typeof window !== 'undefined' && window.location.protocol !== 'file:') {
      return '';
    }
    return 'http://localhost:8787';
  }
  return '';
}

let cachedSkills: SkillManifest[] | null = null;

export async function fetchSkills(): Promise<SkillManifest[]> {
  if (cachedSkills) return cachedSkills;
  try {
    const res = await fetch(`${skillApiBase()}/api/skills`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = await res.json();
    cachedSkills = data.skills ?? [];
    return cachedSkills!;
  } catch {
    return [];
  }
}

export async function fetchSkillMd(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${skillApiBase()}/api/skills/${encodeURIComponent(name)}/md`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function reloadSkills(): Promise<SkillManifest[]> {
  try {
    await fetch(`${skillApiBase()}/api/skills/reload`, { method: 'POST', credentials: 'include' });
    cachedSkills = null;
    return fetchSkills();
  } catch {
    return [];
  }
}

export function invalidateCache(): void {
  cachedSkills = null;
}
