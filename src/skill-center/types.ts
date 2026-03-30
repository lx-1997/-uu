export type SkillCenterCategory = { id: string; label: string };
export type SkillCenterItem = { folder: string; category: string; title: string };
export type SkillCenterManifest = {
  version: number;
  categories: SkillCenterCategory[];
  items: SkillCenterItem[];
};
