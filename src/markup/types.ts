/** 마크업 모듈이 쓰는 최소 모델. 계획서 4절 Project 중 구조/문자열/동적 표에 해당하는 부분만 정의한다. */

export type Lang = string;

/** 블록 ID -> 언어별 인라인 HTML(허용 태그: strong/em/del/a/br + 치환자) */
export type Strings = Record<string, Record<Lang, string>>;

/** 블록 ID -> 언어별 '번역 당시 기준 언어 원문 해시'. 현재 기준 원문 해시와 다르면 번역이 오래된 것 */
export type SourceHash = Record<string, Record<Lang, string>>;

export interface VariableDef {
  name: string;
  description: string;
  sample: string;
}

/**
 * 서버가 tbody 행을 생성하는 동적 표.
 *
 * 설계(결정 사유는 TXMD.md '동적 표' 절):
 * - 본문 structure 의 표는 `<tbody data-rows="<id>"></tbody>` 로 자리만 잡는다.
 * - 행 템플릿은 구조(`rowStructure`, data-t 키 보유)와 문자열(프로젝트 `strings` 표에 같은 ID 체계로 합류)로
 *   분해한다. 행 안 고정 문구(단위·상태 라벨)가 언어별로 달라야 하므로, 문자열 그리드·오래됨 판정·ID 이어받기를
 *   본문과 같은 방식으로 재사용하기 위함이다.
 * - 행 변수는 `{{name}}` (본문 치환자 `|!#-name|` 과 별개 체계, 이름 공간도 겹치면 안 됨).
 * - 발송 HTML 의 tbody 에는 표식 치환자 `|!#-rows_<id>|` 하나만 남는다. sampleRows 는 모델에만 있다.
 */
export interface DynamicTable {
  id: string;
  rowStructure: string;
  vars: VariableDef[];
  sampleRows: Record<string, string>[];
}

export interface Project {
  id: string;
  name: string;
  templateCode: string;
  langs: Lang[];
  baseLang: Lang;
  structure: string;
  strings: Strings;
  sourceHash: SourceHash;
  dynamicTables: DynamicTable[];
  subject: Record<Lang, string>;
  variables: VariableDef[];
  settings: {
    profile: 'email' | 'web';
    customCss?: string;
    logoUrl: string;
    renderWidth: number;
    mailSafeLayout: boolean;
  };
  draftMarkup?: string;
  updatedAt: number;
}

/** 합성에 필요한 최소 입력 */
export type ComposeSource = Pick<Project, 'structure' | 'strings'> & { dynamicTables?: DynamicTable[] };

export interface MarkupWarning {
  code: string;
  message: string;
  id?: string;
  lang?: Lang;
}
