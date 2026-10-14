# HANDOFF — 다국어 이메일 템플릿 스튜디오

최종 갱신: 2026-10-14 · 다음 세션은 이 문서 → `multilingual-email-template-studio.md`(계획) 순으로 읽는다.

## 현재 상태

- **요구사항 인터뷰 완료, 계획 작성 완료, 사용자 승인 대기.** 코드 변경은 아직 없음.
- 계획: `.docs/multilingual-email-template-studio.md` (결정 사항 표·데이터 모델·번들 스키마 초안·Phase P0~P9·회귀 대응)
- 스킬 원본: `sample/skills/tx-html-generator/` (Python 파서 `scripts/tx_markdown_parser.py` 933줄이 JS 포팅 대상), 결과 예시 `sample/sample.html`

## 승인 전에 사용자에게 받아야 할 답 (계획 10절)

1. **번들 스키마**: 백오피스가 받는 실제 필드명, `templateCode` 필요 여부, 치환자에 `description/sample` 외 필드(필수 여부 등)
2. **스킬 출력 형식**: 블록 아래 `@en …` / `@ja …` 줄로 번역을 붙이는 다국어 마크업(.txmd) 제안 — 수용 여부
3. **로고 호스팅 URL** (현재 data: base64 → Gmail 차단)
4. 추천 기능 중 **언어별 프리헤더**, **Gmail 102KB 잘림 경고**를 범위에 넣을지

## 확정된 핵심 결정 (요약 — 상세는 계획 2절)

- 원본 = 블록 ID(`data-t`)를 가진 공통 구조 HTML + `ID → {ko,en,ja}` 문자열 표. 언어별 구조 차이 허용 안 함
- 언어: ko 기준, en/ja (설정으로 확장, zh는 나중)
- Milkdown은 **ko 초안 작성 도구**, 초안 → HTML은 **단방향**. 이후 편집은 미리보기 클릭 편집 + 문자열 그리드 + 구조 조작
- 문자열 단위: 블록 단위, 안에 `strong/em/a/br`·치환자 허용
- 번들: JSON 1파일(파일/클립보드 동일), 본문은 `<body>` 안 전체(헤더·푸터 포함), 언어별 제목, 공통 치환자 목록. 발송 HTML에서 블록 ID 제거, 프로젝트 원본은 번들에 동봉 + IndexedDB 보관
- 치환자: 템플릿별 목록(전역 사전 없음). 내보내기 시 검사 → 경고 목록 + 강제 진행 가능
- 번역: 앱 내 수동 입력 + 스킬 개정(다국어 출력). CSV 교환·기존 언어별 HTML 이관은 범위 외
- 기존 단발 변환·이력은 프로젝트 흐름으로 흡수, 웹 프로파일은 프로젝트 설정으로 유지
- 스택: **Vite + Svelte 5 + TypeScript** (SvelteKit 아님). `npm run dev` 개발 서버 + `npm run build` → 독립 실행 단일 HTML
- 추가 기능: 블록 스니펫 라이브러리(복사형)만 선택
- 디자인: 앱 UI 2~3안 + 메일 템플릿 2~3안을 **아티팩트 시안(P0)** 으로 먼저 보여주고 확정

## 승인 후 첫 작업

1. P0 시안(아티팩트) 착수 — 동시에 시안과 무관한 P1(Svelte 골격·엔진 이식·단일 HTML 빌드), P2(파서 포팅 + vitest 골든 비교)를 서브 에이전트로 병렬 진행
2. 시안 확정 후 P4(UI)·P7(template.css)

## 주의 사항

- 엔진(`src/modules/css-converter.js`, `utils.js`)은 동작 변경 없이 이식. 설계 근거는 루트 `CLAUDE.md` 참고
- `sample/sample.html`은 `<main>`이 3중 중첩된 버그가 있음(포팅 시 수정)
- 메일 호환: `data:` 이미지·Google Fonts `@import` 제거, ja용 시스템 폰트 스택 필요
- 개발 서버는 사용자가 직접 관리 — 임의 실행 금지(전역 지침)
