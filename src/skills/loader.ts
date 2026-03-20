import type { SkillManifest } from './types';

const API_BASE = (() => {
  const isDesktop = !!(window as any).rdkDesktop?.isDesktop;
  if (isDesktop) return 'http://localhost:8787';
  if ((import.meta as any).env?.DEV) return 'http://localhost:8787';
  return '';
})();

let cachedSkills: SkillManifest[] | null = null;

export async function fetchSkills(): Promise<SkillManifest[]> {
  if (cachedSkills) return cachedSkills;
  try {
    const res = await fetch(`${API_BASE}/api/skills`);
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
    const res = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(name)}/md`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function reloadSkills(): Promise<SkillManifest[]> {
  try {
    await fetch(`${API_BASE}/api/skills/reload`, { method: 'POST' });
    cachedSkills = null;
    return fetchSkills();
  } catch {
    return [];
  }
}

export function invalidateCache(): void {
  cachedSkills = null;
}
