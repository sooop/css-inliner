import type { DynamicTable, Lang, Project as MarkupProject, VariableDef } from '../markup/types';

export type { DynamicTable, Lang, VariableDef, SourceHash, Strings } from '../markup/types';

/** 프로젝트 유형: 메일(기본) / 공지(셸 없는 본문 조각 + 언어별 구역 HTML 하나). */
export type ProjectKind = 'mail' | 'notice';

/**
 * 계획서 4절 Project. markup 의 정의를 그대로 쓰되 `templateCode` 만 선택 필드로 낮춘다.
 * `kind` 는 선택 필드다 — 없으면 메일이다(기존 IndexedDB 레코드·번들 source 는 마이그레이션 없이 읽을 때 `projectKind()` 가 기본값을 준다).
 * 메일 프로젝트는 필드를 쓰지 않고, 공지만 `kind: 'notice'` 로 저장한다.
 */
export type Project = Omit<MarkupProject, 'templateCode'> & { templateCode?: string; kind?: ProjectKind };

/** 유형 읽기: 필드가 없거나 알 수 없는 값이면 'mail'. */
export function projectKind(p: { kind?: unknown }): ProjectKind {
  return p.kind === 'notice' ? 'notice' : 'mail';
}

export type ProjectSettings = Project['settings'];

/** 새 프로젝트 기본값(빈 구조). id 는 호출자가 주지 않으면 난수로 만든다. */
export function createProject(init: Partial<Project> & { name: string }): Project {
  return {
    id: init.id ?? newProjectId(),
    name: init.name,
    ...(init.templateCode !== undefined ? { templateCode: init.templateCode } : {}),
    ...(init.kind !== undefined ? { kind: init.kind } : {}),
    langs: init.langs ?? ['ko', 'en', 'ja'],
    baseLang: init.baseLang ?? 'ko',
    structure: init.structure ?? '',
    strings: init.strings ?? {},
    sourceHash: init.sourceHash ?? {},
    dynamicTables: init.dynamicTables ?? [],
    subject: init.subject ?? {},
    variables: init.variables ?? [],
    settings:
      init.settings ??
      (init.kind === 'notice'
        ? NOTICE_DEFAULT_SETTINGS()
        : { profile: 'email', logoUrl: '', renderWidth: 1000, mailSafeLayout: false }),
    ...(init.draftMarkup !== undefined ? { draftMarkup: init.draftMarkup } : {}),
    updatedAt: init.updatedAt ?? Date.now(),
  };
}

export function newProjectId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 공지 기본 설정: web 프로파일(호스트 페이지 폰트 상속), 로고 없음. 렌더 폭은 미리보기용(공지 템플릿에는 미디어쿼리가 없어 결과에 영향 없음). */
function NOTICE_DEFAULT_SETTINGS(): ProjectSettings {
  return { profile: 'web', logoUrl: '', renderWidth: 800, mailSafeLayout: false };
}
