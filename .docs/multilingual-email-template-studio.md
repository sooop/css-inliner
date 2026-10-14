# 다국어 이메일 템플릿 스튜디오 — 구현 계획

**Date**: 2026-10-14  
**Target Route**: D:\Projects\css-inliner (프로젝트 루트 — `src/app` 라우트 구조 없음)  
**Status**: Draft  

## Overview

템플릿 하나를 **공통 구조 + 언어별 문자열(ko 기준, en/ja)** 로 관리하는 다국어 이메일 템플릿 스튜디오로 css-inliner를 재구성하는 구현 계획이다. 언어별 렌더 → 인라인 → 미리보기, 언어별 제목·본문·치환자를 담은 JSON 번들 내보내기, Milkdown 기반 초안 작성 도구, UI·메일 디자인 시안 선정을 다룬다.

---

작성일: 2026-10-14 · 대상: `D:\Projects\css-inliner`

## 1. 목표

1. 템플릿 하나를 **공통 구조 + 언어별 문자열(ko 기준, en/ja)** 로 관리해, 구조·스타일 수정은 한 번에 모든 언어에 반영되고 번역만 언어별로 고친다.
2. 언어별로 렌더 → 인라인 → 미리보기한다.
3. **언어별 제목 + 언어별 본문 HTML + 공통 치환자 목록**을 하나의 JSON 번들로 만들어 백오피스에 업로드/붙여넣기한다 (백오피스 측 import 구현은 별도 저장소, 이 프로젝트는 스키마 문서와 내보내기만 담당).
4. Milkdown 기반 초안 작성 도구(ko) → HTML 생성.
5. 앱 UI와 메일 템플릿 디자인을 프로토타입 시안으로 결정한 뒤 반영.

## 2. 확정된 결정 사항

| 항목 | 결정 | 의미 |
|---|---|---|
| 원본 모델 | 공통 구조 + 언어별 문자열 | 블록마다 ID(`data-t`)를 붙인 구조 HTML 1개와, ID→{ko,en,ja} 문자열 표. 언어마다 문단 구성을 다르게 하는 기능은 두지 않는다 |
| 언어 | ko(기준)/en/ja, 설정으로 확장 | 데이터 구조는 N개 언어. zh는 나중에 언어 목록에 추가만 하면 됨 |
| 초안 → HTML | 단방향 | 초안을 다시 변환하면 새 버전으로 취급. 블록 ID가 같으면 기존 번역을 이어받고, ko 원문이 바뀐 블록은 "번역 오래됨" 표시 |
| HTML 편집 | 미리보기 클릭 편집 + 문자열 그리드 | 미리보기에서 요소 클릭 → 그 ID의 ko/en/ja를 한 번에 편집. 블록 추가·삭제·이동·표 행 추가는 구조 조작 버튼으로 모든 언어에 동시 반영 |
| 문자열 단위 | 블록 단위 + 제한된 인라인 태그 | p/li/td/th/h*/버튼 레이블/콜아웃 제목이 각각 1문자열. 안에 `strong/em/a/br`과 치환자를 포함할 수 있어 언어별 어순 자유. 허용 외 태그는 제거하고 경고 |
| 번들 | JSON 1파일 (파일 저장 + 클립보드 텍스트 동일 내용) | 본문은 **`<body>` 안 전체**(래퍼 표 + 로고 헤더 + 본문 + 푸터). 푸터 문구도 번역 대상 |
| 블록 ID | 발송 HTML에서는 제거 | 재편집은 번들에 동봉된 프로젝트 원본과 IndexedDB 로컬 보관으로 |
| 치환자 | 템플릿별 목록 (전역 사전 없음) | 템플릿에서 추출한 목록에 설명·샘플값을 붙임. 언어 간 일치·형식만 검사 |
| 검사 | 내보내기 시 경고 목록 + 강제 진행 가능 | 7절 |
| 번역 | 앱 내 수동 입력 + 스킬 개정(다국어 출력) | CSV/XLSX 교환은 범위 외 |
| 메일 호환 | 로고는 호스팅 URL(설정값), 언어별 시스템 폰트 스택 | `data:` 이미지·Google Fonts `@import` 제거 |
| 기존 기능 | 프로젝트 흐름으로 흡수 | 임의 HTML+CSS 단발 변환 화면은 없어짐. 사용자 CSS·출력 대상(이메일/웹)은 프로젝트 설정으로 |
| 스택 | Vite + Svelte 5 + TypeScript | SvelteKit 미사용 |
| 배포 | `npm run dev` 개발 서버 + `npm run build` → 독립 실행 단일 HTML | |
| 추가 기능 | 블록 스니펫 라이브러리(복사형) | 원본 갱신 시 사용처 일괄 반영은 하지 않음 |
| 기존 언어별 HTML 이관 | 범위 외 | 신규 작성만 |

## 3. 전체 흐름

```
[초안] Milkdown(ko, 커스텀 블록) ──직렬화──▶ TX 마크업
[스킬] Claude가 다국어 마크업(.txmd) 출력 ─────┘
                                              ▼
                              JS 마크업 파서(파이썬 포팅) + 블록 ID 부여
                                              ▼
              프로젝트 = 구조 HTML(data-t) + 문자열표{id:{ko,en,ja}} + 제목{ko,en,ja}
                         + 치환자[{name, desc, sample}] + 설정(CSS, 대상, 로고 URL…)
                                              ▼
           [편집] 미리보기 클릭 편집 · 문자열 그리드 · 구조 조작 · 스니펫 삽입
                                              ▼
           언어별 합성 HTML ──convertToInline()──▶ 언어별 인라인 HTML → 미리보기 탭(ko/en/ja)
                                              ▼
                       검사(경고 목록) → 번들 JSON 저장/복사 (+ IndexedDB 보관)
```

## 4. 데이터 모델 (TypeScript, 초안)

```ts
type Lang = string;                       // 'ko' | 'en' | 'ja' …
interface Project {
  id: string; name: string; templateCode: string;
  langs: Lang[]; baseLang: Lang;          // ['ko','en','ja'], 'ko'
  structure: string;                      // data-t 키를 가진 구조 HTML (텍스트 없음)
  strings: Record<string, Record<Lang, string>>;   // 블록 ID → 언어별 인라인 HTML
  sourceHash: Record<string, Record<Lang, string>>; // 번역 당시 ko 원문 해시 → '오래됨' 판정
  subject: Record<Lang, string>;
  variables: { name: string; description: string; sample: string }[];
  settings: { profile: 'email'|'web'; customCss?: string; logoUrl: string; renderWidth: number; mailSafeLayout: boolean };
  draftMarkup?: string;                   // 마지막 초안(참고용, 원본 아님)
  updatedAt: number;
}
```

블록 ID: 생성 시 `b001`… 순번(안정 ID). 사람이 의미 있는 이름으로 바꿀 수 있게 하되 필수는 아님.

## 5. 번들 스키마 (백오피스 연동, 초안 — **확인 필요**)

```json
{
  "schema": "tx-mail-bundle", "version": 1,
  "templateCode": "SHIP_START", "name": "배송 시작 안내",
  "generatedAt": "2026-10-14T09:00:00+09:00",
  "variables": [{ "name": "cust_nm", "description": "고객명", "sample": "홍길동" }],
  "locales": {
    "ko": { "subject": "…", "html": "<table …>…</table>" },
    "en": { "subject": "…", "html": "…" },
    "ja": { "subject": "…", "html": "…" }
  },
  "checksum": "sha256:…",
  "source": { "...": "Project 원본 (재편집용)" }
}
```

산출물: `docs/bundle-schema.md`(필드 설명·백오피스 import 시 검증 규칙) + `bundle.schema.json`(JSON Schema).

## 6. 디렉터리 구조 (안)

```
src/
  engine/        css-converter.ts, utils.ts (기존 로직 이식, 동작 동일)
  markup/        parser.ts (tx_markdown_parser.py 포팅), ids.ts, compose.ts(구조+문자열→언어별 HTML)
  project/       model.ts, store.ts(Dexie), validate.ts, bundle.ts
  editor/        milkdown/ (커스텀 노드: 콜아웃·세로/가로 표·버튼·치환자)
  ui/            Svelte 컴포넌트 (시안 확정 후)
  styles/        template.css (리디자인), app.css
sample/skills/tx-html-generator/   스킬 개정
```

## 7. 내보내기 전 검사

| 검사 | 등급 |
|---|---|
| 언어 간 치환자 집합 불일치 (제목 포함) | 오류 |
| `|!#-` 형식 깨짐 (닫는 `|` 누락, 허용 외 문자, 대소문자만 다른 중복) | 오류 |
| 미번역 (빈 문자열) | 오류 |
| ko 원문이 바뀐 뒤 갱신 안 된 번역 | 경고 |
| 허용 외 인라인 태그 제거됨 | 경고 |
| 인라인 변환 경고(기존 `warnings`) | 경고 |

오류가 있어도 확인 후 강제 내보내기 가능. 별도 대시보드 화면은 없음.

## 8. 단계 (Phase)

| # | 내용 | 산출물 | 병렬 |
|---|---|---|---|
| P0 | **시안**: 앱 UI 2~3안(단계형 / 워크스페이스형 등), 메일 템플릿 2~3안(같은 샘플 콘텐츠, ko/en/ja 전환) | 아티팩트 링크 → 사용자 선택 | P1·P2와 병렬 |
| P1 | Vite+Svelte5+TS 골격, 엔진 이식, dev/단일 HTML 빌드 | `npm run dev`, `npm run build` → `dist/index.html` | P2와 병렬 |
| P2 | JS 마크업 파서 포팅 + 블록 ID + 구조/문자열 분해·합성 | vitest: 파이썬 출력과 골든 비교 | P1과 병렬 |
| P3 | 프로젝트 모델·Dexie 저장·검사·번들 + 스키마 문서 | `docs/bundle-schema.md` | P2 이후 |
| P4 | UI 구현(P0 확정안): 프로젝트 목록, 편집(클릭 편집·그리드·구조 조작), 언어별 미리보기, 내보내기 | | P3 이후 |
| P5 | Milkdown 초안 에디터(커스텀 블록 ↔ 마크업 직렬화) | | P2 이후, P4와 병렬 |
| P6 | 스니펫 라이브러리 | | P4 이후 |
| P7 | template.css 리디자인 반영(P0 확정안), 로고 URL·언어별 폰트, 헤더/푸터 표 기반 | | P0 이후 |
| P8 | 스킬 개정: 다국어 마크업(.txmd) 출력, 앱 가져오기 | | P2 이후 |
| P9 | CLAUDE.md·README 갱신 | | 마지막 |

## 9. 예상 회귀와 대응

| 회귀 | 원인 | 대응 |
|---|---|---|
| 임의 HTML+CSS 단발 변환 화면 사라짐 | 프로젝트 흐름으로 흡수 | "HTML 가져오기"로 단일 언어 프로젝트를 만들어 변환 가능하게 유지(문자열 분해 없이 구조 그대로) |
| 기존 변환 이력(IndexedDB `CSSInlinerHistory`) 접근 불가 | 새 DB 스키마 | 기본은 이관하지 않음. 필요 시 1회성 "이전 이력을 프로젝트로 가져오기" 추가 가능 |
| `build-inline.js` 후처리 제거 | vite-plugin-singlefile로 완결 | 빌드 산출물에 외부 참조가 없는지 빌드 후 검사 스크립트로 확인 |
| 로고가 이미지 차단 클라이언트에서 안 보임 | data: → URL 전환 후에도 이미지 차단은 존재 | `alt="TRACXLOGIS"` + 텍스트 스타일 지정 |
| 스킬(Python)과 앱(JS) 파서 분기 | 같은 문법을 두 곳에서 해석 | 스킬은 HTML 생성을 그만두고 마크업만 출력 → 해석은 앱의 JS 파서 하나로 일원화 |
| `sample.html`의 `<main>` 3중 중첩 | 템플릿과 콘텐츠가 각각 `<main>` 삽입 | 포팅 시 수정 |

## 10. 확인이 필요한 항목 (승인 전)

1. **번들 스키마 5절** — 백오피스가 받는 필드명·`templateCode` 필요 여부·치환자 `description/sample` 외 필드(필수 여부 등).
2. **스킬 출력 형식** — 한 파일에 블록마다 언어별 변형을 붙이는 다국어 마크업 예:
   ```
   # 배송 시작 안내
   @en Your shipment is on its way
   @ja 発送開始のお知らせ
   ```
   이 형식을 앱이 가져와 ko 구조 + en/ja 문자열로 채움.
3. **로고 호스팅 URL** 실제 주소.

## 11. 추가 추천 기능 (미선택, 참고)

- **언어별 프리헤더(preheader)**: 받은편지함에서 제목 옆에 보이는 미리보기 문구. 번들에 `preheader` 추가 비용이 작음.
- **Gmail 102KB 잘림 경고**: 인라인 결과가 102KB를 넘으면 Gmail이 본문을 잘라 "메시지 전체 보기"로 숨김.
- **plain-text 대체본 자동 생성**: 백오피스가 multipart를 지원하면 스팸 점수·접근성에 유리.
- **치환자 샘플값 미리보기 토글**: 미리보기에서 `|!#-cust_nm|` 대신 "홍길동" 표시 (모델에 sample이 있어 비용 작음).
- **다크 모드 메일 시뮬레이션**: Gmail/Outlook 다크 모드에서 색 반전 확인.
