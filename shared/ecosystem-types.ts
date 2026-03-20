/**
 * Ecosystem Types — Unified type definitions for the Ecosystem Bridge layer.
 *
 * The Ecosystem Bridge connects external resources (NodeHub, ModelZoo, TROS,
 * OpenClaw Skills, Community templates) with RDK boards. RDK Studio sits in
 * the middle: it ingests resources, transforms them into device-aware skills,
 * and lets AI Dock orchestrate them.
 *
 * Key design decisions:
 *   - Every external resource becomes an `EcoSkill` — the atomic unit AI Dock can invoke.
 *   - Skills are device-aware: `platforms` + `preconditions` determine compatibility.
 *   - Board status is tracked per-device so multi-device setups work correctly.
 */

// ─── RDK Platform ───

export type RdkPlatform = 'rdk-x3' | 'rdk-x5' | 'rdk-ultra' | 'rdk-s100';

export const ALL_PLATFORMS: RdkPlatform[] = ['rdk-x3', 'rdk-x5', 'rdk-ultra', 'rdk-s100'];

// ─── Ecosystem Source ───

export type EcoSource =
  | 'nodehub'
  | 'modelzoo'
  | 'tros'
  | 'openclaw_skill'
  | 'community'
  | 'custom';

// ─── Precondition ───

export interface Precondition {
  type: 'package' | 'binary' | 'service' | 'file' | 'hardware' | 'network';
  /** Shell command to check (exit 0 = ok). Runs on the target device. */
  check: string;
  /** Optional auto-fix command. */
  fix?: string;
  /** Human-readable failure message shown to user. */
  message: string;
}

// ─── Board Status (per-device snapshot) ───

export interface BoardStatus {
  installed: boolean;
  running: boolean;
  installedVersion?: string;
  lastSyncAt: string;
}

// ─── EcoSkill — The Core Abstraction ───

export interface EcoSkill {
  /** Globally unique id. Convention: `<source>.<category>.<name>` */
  id: string;

  /** Where this skill comes from */
  source: EcoSource;

  /** Human-readable name */
  name: string;

  /** What this skill does (used by AI for context) */
  description: string;

  /** Coarse category for grouping / filtering */
  category: string;

  /** Fine-grained tags for AI intent matching */
  tags: string[];

  /** Which RDK boards this skill supports */
  platforms: RdkPlatform[];

  /** Upstream version (from NodeHub/ModelZoo/TROS) */
  version?: string;

  /** Author or maintainer */
  author?: string;

  /** Source code / documentation URL */
  repo?: string;

  /** External portal URL (e.g. NodeHub detail page) */
  externalUrl?: string;

  // ─── Execution Commands ───

  /** Command(s) to install this skill on the board */
  installCmd: string;

  /** Command(s) to run / activate this skill */
  runCmd: string;

  /** Command(s) to stop this skill (optional) */
  stopCmd?: string;

  /** Command(s) to uninstall / remove this skill */
  uninstallCmd?: string;

  /** Checks that must pass before install/run */
  preconditions: Precondition[];

  // ─── AI Routing ───

  /** Keywords that should route to this skill (used by intent matcher) */
  routingKeywords: string[];

  /** Scenario description for AI context ("适合巡检、安防场景") */
  scenario?: string;

  // ─── Runtime ───

  /**
   * Per-device board status. Keyed by deviceId.
   * Populated by board-sync, not by providers.
   */
  boardStatusByDevice: Record<string, BoardStatus>;

  /** When this skill definition was last refreshed from its source */
  lastRefreshedAt?: string;
}

// ─── Source-Specific Extensions ───

export interface NodeHubSkill extends EcoSkill {
  source: 'nodehub';
  /** APT package name, e.g. `tros-hobot-body-det` */
  pkgName: string;
  /** Process pattern for `ps -ef` matching */
  processKey: string;
  /** ROS2 launch file path (if applicable) */
  launchFile?: string;
  /** Dependencies (other package names) */
  dependencies: string[];
}

export interface ModelZooSkill extends EcoSkill {
  source: 'modelzoo';
  /** Model file format */
  format: 'BIN' | 'ONNX' | 'PyTorch' | 'other';
  /** Approximate file size */
  size: string;
  /** Inference FPS (if benchmarked) */
  fps?: string;
  /** Inference latency (if benchmarked) */
  latency?: string;
  /** Path to model file on board */
  modelPath: string;
  /** Path to sample script on board */
  samplePath: string;
  /** Process pattern for `ps -ef` matching */
  processKey: string;
}

export interface TrosSkill extends EcoSkill {
  source: 'tros';
  /** APT package name */
  pkgName: string;
  /** Provides these ROS2 nodes */
  rosNodes: string[];
  /** Publishes these ROS2 topics */
  rosTopics: string[];
}

export interface OpenClawSkillDef extends EcoSkill {
  source: 'openclaw_skill';
  /** Raw SKILL.md content (for provisioning to board) */
  skillMdContent: string;
  /** Required binaries on board */
  requiredBins: string[];
}

export interface CommunitySkill extends EcoSkill {
  source: 'community';
  /** What kind of template */
  templateType: 'app' | 'workflow' | 'pipeline' | 'config';
  /** Pre-defined execution steps */
  steps: Array<{ title: string; skillId: string; param?: string }>;
  /** Popularity / star count */
  popularity: number;
  /** Original template this was forked from */
  forkedFrom?: string;
}

// ─── Provider Interface ───

export interface EcoProvider {
  /** Which source this provider handles */
  source: EcoSource;

  /** Fetch all skills from this source. Called during refresh. */
  fetchAll(platforms?: RdkPlatform[]): Promise<EcoSkill[]>;
}

// ─── Search / Query ───

export interface EcoSearchQuery {
  keyword?: string;
  source?: EcoSource;
  category?: string;
  platform?: RdkPlatform;
  tags?: string[];
  /** Only return skills installed on this device */
  installedOnDevice?: string;
  /** Only return skills currently running on this device */
  runningOnDevice?: string;
  limit?: number;
  offset?: number;
}

export interface EcoSearchResult {
  skills: EcoSkill[];
  total: number;
}

// ─── Board Sync ───

export interface BoardSyncResult {
  deviceId: string;
  syncedAt: string;
  installedPackages: string[];
  runningProcesses: string[];
  rosNodes: string[];
  openclawSkills: string[];
  modelFiles: string[];
  skillsUpdated: number;
}

// ─── Skill Provision (push skill to board as OpenClaw skill) ───

export interface ProvisionRequest {
  skillId: string;
  deviceId: string;
  /** Override install path on board (default: /opt/openclaw/skills/<id>/) */
  targetPath?: string;
}

export interface ProvisionResult {
  success: boolean;
  skillId: string;
  deviceId: string;
  message: string;
}
