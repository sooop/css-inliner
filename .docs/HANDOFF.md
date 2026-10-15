# HANDOFF — 다국어 이메일 템플릿 스튜디오

최종 갱신: 2026-10-14 · 다음 세션은 이 문서 → `multilingual-email-template-studio.md`(계획) 순으로 읽는다.

## 현재 상태

- 계획 승인 완료. **P0~P5·P7 완료(1차)**: 시안, 골격·엔진 이식, 파서 포팅(+문법 확장), 모델·검사·번들(P3), UI(P4, 시안 ②), Milkdown 초안 에디터(P5), template.css·셸(P7). 남은 단계: P6(스니펫 라이브러리), P8(스킬 개정), P9(문서). 검증: tsc·svelte-check 0 오류, vitest 343, e2e 70(시스템 Edge, `npm run test:e2e`; `bundle-styles.spec.ts` 의 '닫는 | 누락' 케이스는 전체 실행 시 가끔 타이밍으로 실패, 단독 실행은 통과).
- 아직 **커밋하지 않음**(작업 트리에 P1~P7 변경이 모두 있음). 사용자와 합의: 커밋 전에 변경 목록과 파서 골든 대조 결과를 먼저 보여주고 진행.
- 사용자가 직접 써 보고 알려줄 것: 시안(이제 구현물) 개선 항목.
- **구현 완료**: (1) 모든 링크·버튼에 `target="_blank"`+`rel="noopener noreferrer"` 보장(`src/markup/links.ts`, compose 단계 본체 + render 후처리 + `verifyBundle` 검사; mailto/tel/sms/#앵커·href 없는 a 제외; 파서 골든은 불변). (2) **공지 유형**: 프로젝트 속성 `kind: 'mail'|'notice'`, `+ 초안` 전체 화면에서 만들 때 선택(기본 메일, 유형 변경 미지원). 메일은 필드를 쓰지 않고 공지만 `kind:'notice'` 저장(`projectKind()` 가 없으면 메일). 공지는 셸 없이 본문 조각만, web 프로파일(`renderWidth` 800) 인라인, 치환자는 검사 오류(`notice-placeholder`), 동적 표는 만들기 단계 오류, 번들 JSON·handoff·102KB 숨김, 재편집 원본은 앱 저장만(번들 불러오기는 항상 메일로 복원). 출력은 단일 HTML 하나, 언어별 `<!-- tx:lang ko --> … <!-- /tx:lang ko -->` 구역 + 구역 첫 줄 `<!-- tx:title 제목 -->`(주석 안전 이스케이프: `-` 뒤 `-` 는 `&#45;`, `&<>` 엔티티). 앱: 공지 HTML 저장(`notice_<이름>.html`)·전체 복사·언어별 '구역 복사'(본문만, 주석 제외)·제목 복사. 렌더 중에만 임시 래퍼 `<div class="notice">`+`NOTICE_CSS` 를 쓰고 인라인 후 벗김(template.css 는 불변). 문서: `docs/notice-format.md`, `src/markup/TXMD.md` §4-D. 공지 시스템에서 `style=`·`<table>`·`border-radius` 가 허용되는지는 미확인.
- 계획: `.docs/multilingual-email-template-studio.md`
- 스킬 원본: `sample/skills/tx-html-generator/`, 결과 예시 `sample/sample.html`

## 시안(P0) 결과 — 확정 방향

비공개 아티팩트(이 세션 외에서는 `Artifact` 도구의 list/read 로 찾는다).
- 앱 UI 시안: https://claude.ai/artifact/CwFhoK9j851ixp62RVDG74 — **②워크스페이스형 선택**(좌: 블록/문자열/스니펫/프로젝트, 중앙: ko/en/ja 미리보기, 우: 접이식 패널). 세 열 독립 스크롤, 상단 툴바는 풀폭 불투명 고정 바(둥근 섬/반투명 금지), 상단 바 `+ 초안` 버튼 → **초안으로 '새 프로젝트'를 만든다**(기존 프로젝트를 재변환하지 않음). **항상 전체 화면**(모달·표시 방식 전환 UI 제거, 사용자 결정). 편집 컬럼은 최대 800px(안쪽 여백 40, 좁은 폭 16)·가운데 정렬(`DraftEditor.svelte` 의 `--tx-col`·`--tx-pad`). 초안 편집은 Milkdown(소스 보기 토글, 실패 시 textarea 폴백). 저장 키: `localStorage txms.draft`(작성 중 초안), `sessionStorage txms.draft.open`(전체 화면 복원).
- 메일 시안: https://claude.ai/artifact/Che8CUSNuwLhiHSHUD4z4D — **A안(프로스트) + 코발트 블루 팔레트** 선택(포인트 `#1D6FE0`, 네이비 `#0F2A52`, 연한 면 `#EAF2FF`). 표 셀 글자 13px(본문 14px), 표·콜아웃·버튼 반지름 약 6px, 콜아웃 안 표는 회색 배경 금지(콜아웃 틴트), 푸른 회색 중립색(붉은 기 도는 회색 금지), 팔레트별 경고 콜아웃 색 별도.
- 사용자는 "시안을 좀 더 집중해서 개선"하길 원함 — 개선 항목은 사용자가 지정한다. 구현(P4·P7)은 개선 후 착수.

## 확정된 핵심 결정 (계획 2절 + 이후 추가)

- 원본 = 블록 ID(`data-t`)를 가진 공통 구조 HTML + `ID → {ko,en,ja}` 문자열 표. 언어별 구조 차이 없음.
- Milkdown 은 ko 초안 도구, 초안 → HTML 단방향. 이후 편집은 미리보기 클릭 편집 + 문자열 그리드 + 구조 조작. 재변환 시 ID 이어받기·'오래됨' 판정.
- 번들 JSON 1파일, 본문은 `<body>` 안 전체, 언어별 제목, 공통 치환자. 발송 HTML 에서 블록 ID 제거, 프로젝트 원본(`source`)은 번들에 동봉 + IndexedDB 보관.
- **로고: 번들에도 base64 포함**(링크는 추후 제공). `logoUrl` 설정값으로 바꿀 수 있는 구조는 유지. 로고 때문에 Gmail 102KB 경고가 자주 뜰 수 있음.
- **범위 포함**: Gmail 102KB 잘림 경고. (언어별 프리헤더는 미선택)
- **스킬 출력(P8)**: `.txmd` 가 주 산출물 + 미리보기 HTML 동봉. 앱 가져오기는 `.txmd` 로만.
- 스택: Vite + Svelte 5 + TypeScript. `npm run dev`(사용자가 직접 관리) + `npm run build` → 독립 단일 HTML.

### 동적 테이블 (서버가 tbody 행을 생성하는 표, 추가 요구)

- 발송 HTML 의 `<tbody>` 에는 표식 **`|!#-rows_<표id>|`** 하나만 둔다(현재 형식 그대로).
- 서버는 `|!#-x|` 치환자만 처리하고, 표 내용은 **별도 메일 처리 워커**가 생성한다. 행 변수 `{{name}}` 형식의 행 템플릿은 워커 담당자에게 별도 요청으로 전달한다(handoff JSON + 개발자용 MD).
- 행 템플릿은 표당 1종(줄무늬·합계·빈 목록 변형 없음), 행 안 고정 문구는 번역 대상 → 언어별 행 템플릿. 행 템플릿 문자열은 **본문과 같은 `strings` 표에 합류**(블록 ID 부여, 오래됨 판정·검사 재사용). 예시 행 데이터는 모델에만 보관(미리보기용).
- 열 수는 언어 공통(구조 공통 원칙).
- 번들 `dynamicTables[]`: `{ id, marker, columns, vars:[{name,description,sample}], sampleRows, rowTemplates:{ko,en,ja} }` — rowTemplates 는 인라인 스타일 적용 완료된 `<tr>…</tr>` 한 줄(`{{var}}` 포함). `templateCode` 는 **선택 필드**.
- **미확정(handoff MD 에 '확인 필요' 로 명시)**: 서버가 값 없는 치환자 `|!#-rows_x|` 를 지우거나 오류 처리하는지(`rows_` 접두 치환자는 통과시켜야 함), 행 값의 HTML 이스케이프(`& < > "`)는 워커 책임으로 명시할 것, 워커의 `{{ }}` 치환 규칙.
- 검사 추가: 행 템플릿 `{{var}}` ↔ 변수 목록 일치, 언어 간 `{{var}}` 집합 일치, 표식·행 변수 이름 충돌. 행당 바이트로 Gmail 102KB 이내 최대 행 수를 handoff MD 에 기재.

### 마크업 문법 확장 (진행 중)

- 사용자 결정: `.txmd`/파서를 확장해 **콜아웃 안 표·목록·버튼(및 인용·구분선)** 과 **취소선 `~~`(→ `<del>`)** 지원. Python 원본·기존 TS 포팅은 콜아웃 본문을 제목·문단만 처리. 기존 골든 4건은 변경 금지(회귀 기준), 새 기능은 sample.html 구조를 기준으로 수기 골든. 스킬 개정(P8)은 `src/markup/TXMD.md` 의 '스킬 개정용 요약'을 따른다.

## 진행 상황

| 단계 | 상태 | 비고 |
|---|---|---|
| P0 시안 | 완료(개선 단계) | 위 확정 방향 |
| P1 골격·엔진 이식 | 완료 | 엔진 동작 변경 없음. 기존 UI 는 `src/legacy/`, `tsconfig` strict:false, `convertToInline` 은 jsdom 한계로 자동 테스트 없음(브라우저 테스트 필요 시 Playwright) |
| P2 파서 포팅 | 완료(문법 확장 포함) | `src/markup/` 98 테스트·골든 4건. `.txmd`(`@en`/`@ja` 줄), `[표: 가로형, 동적: id]`, `@var`, `@sample`, 콜아웃 안 표·목록·버튼·인용·구분선, `~~취소선~~`. 콜아웃 안 동적 표는 미지원(경고) |
| P3 모델·저장·검사·번들·스키마 문서 | 완료 | `src/project/`(Dexie `TxMailStudio`, 검사, 번들, handoff MD 생성), `docs/bundle-schema.md`·`bundle.schema.json`·예시. 132 테스트. 실제 `convertToInline` 으로 행 템플릿 추출은 미검증 — P4 전에 Playwright 등 브라우저 검증 필요 |
| P4 UI(②) | 완료(1차) | `src/ui/`. 블록 속성 편집(콜아웃 종류·제목 레벨·목록 종류·버튼 스타일, 구조만 변경해 번역 오래됨 없음). 표 구조 전환·동적 표 전환은 미구현. `+ 초안`은 새 프로젝트 생성(모달/전체 화면 전환) |
| P5 Milkdown 초안 에디터 | 완료 | `src/editor/`. `.txmd`↔문서 왕복 보존(골든 전부 + fuzz 99.9%, 실패 시 소스 보기 폴백), 번역 줄 불투명 보존 노드, +448KB. 실제 IME 직접 입력은 미확인 |
| P7 template.css·셸 | 완료 | A안+코발트, `src/markup/shell.ts`(표 기반 셸, `lang` 속성 폰트 전환), 컨테이너 `align="center"`. Outlook·Gmail 실제 렌더 미검증 |
| P6 스니펫 라이브러리(사용자 정의) | 대기 | 현재 내장 3종만 |
| P8 스킬 개정 | 대기 | `src/markup/TXMD.md` 5절 '스킬 개정용 요약' 따름 |
| P9 문서(CLAUDE.md·README) | 대기 | 루트 CLAUDE.md 의 빌드·`src/` 구조 설명이 실제와 다름 |

## 주의 사항

- 엔진(`src/engine/*`)은 동작 변경 없이 이식. 설계 근거는 루트 `CLAUDE.md` 참고(P9 에서 갱신 — 현재 빌드·`src/` 구조 설명이 실제와 다름).
- `sample/sample.html` 의 `<main>` 3중 중첩은 파서·빌더·템플릿이 각각 감싸서 생긴 버그(포팅 시 수정됨).
- 메일 호환: `data:` 이미지(로고 base64 는 예외 결정)·Google Fonts `@import` 제거, ja 용 시스템 폰트 스택 필요. `border-radius` 는 Outlook(Windows)에서 무시됨(깨지진 않음).
- 개발 서버는 사용자가 직접 관리 — 임의 실행 금지(전역 지침). 검증은 `npx tsc --noEmit`, `npm test`.
- 패키지 제약: `@sveltejs/vite-plugin-svelte` ^6(7.x 는 vite 8 요구), `typescript` ~6(svelte-check 호환). 테스트 파일에 `@types/node` 가 필요하면 추가 필요.
- 새 UI 시안 작업은 아티팩트 `scratchpad`(세션 임시 폴더)의 `mail-designs.html`·`studio-ui.html` 이 원본이므로, 세션이 끊기면 아티팩트에서 `read` 로 복원한다.
