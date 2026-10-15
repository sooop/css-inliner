import { projectKind, type Project } from './model';
import { sha256Hex } from './sha256';

/**
 * 프로젝트 보관 파일(앱 재편집용 원본 백업). 발송용 `tx-mail-bundle` 과 별개 형식이다.
 * 메일·공지 모두, 검사 오류가 있는 작성 중 프로젝트도 그대로 담는다(렌더·검사 없음).
 */
export const ARCHIVE_SCHEMA = 'tx-studio-projects';
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_EXT = '.txproj.json';

export interface Archive {
  schema: typeof ARCHIVE_SCHEMA;
  version: typeof ARCHIVE_VERSION;
  exportedAt: string;
  projects: Project[];
  checksum: string;
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}

/** `checksum` 을 뺀 나머지를 키 정렬 JSON 으로 만들어 sha256. */
export function archiveChecksum(a: Omit<Archive, 'checksum'> | Archive): string {
  const { checksum: _c, ...rest } = a as Archive;
  return 'sha256:' + sha256Hex(JSON.stringify(canonical(rest)));
}

/** 프로젝트 목록을 보관 파일 객체로 만든다(깊은 복사). */
export function buildArchive(projects: Project[], now: Date = new Date()): Archive {
  const body: Omit<Archive, 'checksum'> = {
    schema: ARCHIVE_SCHEMA,
    version: ARCHIVE_VERSION,
    exportedAt: now.toISOString(),
    projects: JSON.parse(JSON.stringify(projects)) as Project[],
  };
  return { ...body, checksum: archiveChecksum(body) };
}

export function serializeArchive(a: Archive): string {
  return JSON.stringify(a, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 프로젝트 1개의 최소 구조 검사. 문제가 있으면 이유를 돌려준다. */
function projectProblem(p: unknown): string | null {
  if (!isObj(p)) return '프로젝트가 객체가 아닙니다';
  if (typeof p.id !== 'string' || !p.id) return 'id 가 없습니다';
  if (typeof p.name !== 'string') return 'name 이 문자열이 아닙니다';
  if (!Array.isArray(p.langs) || p.langs.length === 0 || !p.langs.every((l) => typeof l === 'string')) return 'langs 가 올바르지 않습니다';
  if (typeof p.baseLang !== 'string' || !p.langs.includes(p.baseLang)) return 'baseLang 이 langs 에 없습니다';
  if (typeof p.structure !== 'string') return 'structure 가 문자열이 아닙니다';
  if (!isObj(p.strings)) return 'strings 가 객체가 아닙니다';
  if (!isObj(p.subject)) return 'subject 가 객체가 아닙니다';
  if (!isObj(p.sourceHash)) return 'sourceHash 가 객체가 아닙니다';
  if (!Array.isArray(p.dynamicTables)) return 'dynamicTables 가 배열이 아닙니다';
  if (!Array.isArray(p.variables)) return 'variables 가 배열이 아닙니다';
  if (!isObj(p.settings)) return 'settings 가 객체가 아닙니다';
  return null;
}

export type ParseArchiveResult = { ok: true; projects: Project[] } | { ok: false; errors: string[] };

/** 텍스트 → 보관 파일 검증(JSON·schema·version·프로젝트 구조·체크섬). 통과하면 프로젝트 목록을 돌려준다. */
export function parseArchive(text: string): ParseArchiveResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSON 으로 읽을 수 없습니다'] };
  }
  if (!isObj(json)) return { ok: false, errors: ['최상위가 객체가 아닙니다'] };
  if (json.schema === 'tx-mail-bundle') return { ok: false, errors: ['발송용 번들 파일입니다. [번들(.json) 불러오기]를 사용하세요'] };
  if (json.schema !== ARCHIVE_SCHEMA) return { ok: false, errors: [`schema 가 ${ARCHIVE_SCHEMA} 가 아닙니다`] };
  if (json.version !== ARCHIVE_VERSION) return { ok: false, errors: [`지원하지 않는 version 입니다: ${String(json.version)}`] };
  if (!Array.isArray(json.projects)) return { ok: false, errors: ['projects 가 배열이 아닙니다'] };
  const errors: string[] = [];
  json.projects.forEach((p, i) => {
    const why = projectProblem(p);
    if (why) errors.push(`projects[${i}]: ${why}`);
  });
  if (errors.length) return { ok: false, errors };
  const a = json as unknown as Archive;
  if (archiveChecksum(a) !== a.checksum) return { ok: false, errors: ['checksum 불일치(내용이 변경되었거나 손상됨)'] };
  return { ok: true, projects: a.projects };
}

/** 가져올 프로젝트의 (유형별) 개수 요약 — 알림 문구용 */
export function summarizeProjects(projects: Project[]): { mail: number; notice: number } {
  let notice = 0;
  for (const p of projects) if (projectKind(p) === 'notice') notice++;
  return { mail: projects.length - notice, notice };
}
