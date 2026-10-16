# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

HTML에 CSS를 인라인 스타일로 적용하는 웹 애플리케이션입니다. 최종 빌드는 단일 HTML 파일로 생성되며 모든 CSS와 JavaScript가 인라인으로 포함됩니다.

## 개발 명령어

```bash
# 개발 서버 실행 (http://localhost:5173)
npm run dev

# 프로덕션 빌드 (dist/index.html 생성)
npm run build

# 빌드 결과 미리보기
npm run preview
```

## 빌드 프로세스

프로젝트는 2단계 빌드를 사용합니다:

1. **Vite 빌드**: `vite build src` → `src/dist/index.html` 생성 (CSS/JS가 별도 파일로 분리됨)
2. **인라인화**: `node build-inline.js` → assets 폴더의 모든 CSS/JS를 읽어 HTML에 인라인으로 삽입 → `dist/index.html` 생성

최종 결과는 완전히 자립적인 단일 HTML 파일입니다.

## 아키텍처

### 핵심 변환 로직 (`src/modules/css-converter.js`)

**convertToInline(html, css, options)**: CSS를 인라인 스타일로 변환하는 핵심 함수 (async)

계산된 스타일을 통째로 덤프하지 않고 **원본 CSS가 실제로 "선언한" 속성만** 옮긴다.
값이 계산을 필요로 할 때(`var()`, `calc()`, `rem`/`em`, 전역 키워드)에만 `getComputedStyle`을 참조한다.
덕분에 `width: 100%`가 px로 박제되거나 원본에 없던 속성이 끼어들지 않는다.

1. 화면 밖에 **실제 폭(`renderWidth`)을 가진** iframe을 만들어 렌더링
   (`display: none`이면 뷰포트 폭이 0이라 `@media (max-width: …)`가 항상 참이 된다)
2. 웹폰트·이미지·외부 스타일시트 로딩을 기다린 뒤 측정 (`@import`는 같은 URL을 `link`로도 걸어 대기)
3. `styleSheets`를 훑어 규칙을 모으고, 셀렉터별로 매칭 요소에 선언을 누적 (명시도 → `!important` → 소스 순서로 cascade)
4. **1패스**로 필요한 계산값을 문자열로 복사 → **2패스**에서 style 기록
   (`getComputedStyle` 결과는 살아 있는 객체라, 부모에 먼저 쓰면 자식의 상속값이 부모의 절대값으로 오염된다)
5. body에 걸린 스타일은 버리지 않고 래퍼로 승격 (이메일은 `table > td > div`, 웹은 `div`)
6. 메일 호환성 위험을 `warnings` 배열로 반환

**주요 파라미터:**
- `options.bodyOnly`: true 시 body 내용만 반환 (기본값: false)
- `options.profile`: `'email'`(기본) | `'web'`
- `options.renderWidth`: 콘텐츠 폭 (기본 600). 렌더 iframe·미리보기는 여기에 좌우 고정 여백(`PREVIEW_GUTTER`)을 더한 폭이며, 미리보기에서만 래퍼 폭을 이 값으로 덮어쓴다(결과 HTML은 불변)
- `options.newTabLinks`: `target`이 없는 `a[href]`에 `target="_blank"` 추가 (기본 true, `#`·mailto·tel·javascript 제외)
- `options.wrapBody`: body 스타일을 래퍼로 보존 (기본 true)
- `options.mailSafeLayout`: flex/grid를 block 기반으로 낮춤 (기본 false)

**반환값:** `{ html, warnings, stats }`

### 값 선택 규칙 (`resolveValue`)

원본 CSS가 쓴 값을 그대로 유지하되 아래에 해당할 때만 계산값으로 대체한다.

- `var()`/`calc()`/`clamp()` 등 함수, `rem`·`em` 같은 상대 단위, `inherit`/`initial` 같은 전역 키워드
- 이메일 프로파일의 단위 없는 `line-height` (Outlook이 제대로 처리하지 못함 → px로 고정)
- 백분율이지만 폭·높이 기준이 아닌 속성 (`PERCENT_SAFE_PROPS`에 없는 것)

### shorthand 처리

`CSSStyleDeclaration`을 그대로 순회하면 브라우저가 shorthand를 모두 풀어버린다
(`border` 하나가 `border-image-*` 5개까지 늘고, `white-space`는 `white-space-collapse`/`text-wrap-mode`로,
`border-spacing`은 `-webkit-*`로 바뀐다). 메일 클라이언트가 모르는 이름이 섞이므로
`utils.js`의 `parseDeclarations()`로 **cssText를 직접 읽어** 저자가 쓴 속성명과 순서를 보존한다.
브라우저가 이미 풀어 놓은 border longhand는 `normalizeBorders()`가 면 단위로 다시 묶는다.

### 모듈 구조

- **main.js**: 애플리케이션 진입점, 이벤트 바인딩
- **ui-controller.js**: UI 상태 관리 (탭 전환, 패널 토글, 미리보기 업데이트)
- **css-converter.js**: CSS 인라인 변환 엔진
- **template-manager.js**: 템플릿 CSS 가져오기/다운로드/복사 (Vite의 `?inline` 임포트 사용)
- **utils.js**: 유틸리티 함수 (공백 제거, body 추출, 속성 필터링)

### CSS 속성 필터링 로직

`utils.js`의 `shouldIncludeProperty()`는 **선언된 속성에만** 호출됩니다.
따라서 값이 기본값처럼 보인다는 이유로 버리지 않습니다 — `text-transform: none`처럼
부모의 상속을 명시적으로 해제하는 선언이 사라지면 결과가 원본과 달라지기 때문입니다.
걸러내는 것은 인라인으로 옮길 수 없거나 대상 환경에서 무의미한 속성뿐입니다:

- **항상 제외**: 커스텀 프로퍼티(`--*`), `content`, `all`
- **이메일 프로파일 제외**: `transition`/`animation`/`transform`/`filter`/`cursor` 등 메일에서 무시되는 속성
- **웹 프로파일 제외**: `font-family` (호스트 폰트를 상속받게 함)

### 상속 속성 전파

Outlook·일부 웹메일은 표 안에서 폰트 상속을 잃습니다. 이메일 프로파일은 조상이 선언한
상속 속성(`INHERITED_TO_PROPAGATE`)을 자손마다 자기 계산값으로 다시 적습니다.
웹 프로파일은 조상과 값이 다른 요소에만 적어 호스트 스타일 상속을 최대한 살립니다.

### 인라인으로 옮길 수 없는 것

`::before`/`::after`의 `content`, `:hover` 등 상태 스타일, 미디어쿼리는 인라인 스타일에
담을 수 없습니다. 이런 항목은 조용히 사라지는 대신 `warnings`로 보고해 UI 배너에 표시됩니다.

### Vite 설정 특이사항

- **root**: `src` 폴더를 루트로 설정
- **viteSingleFile 플러그인**: Vite 빌드 시 단일 HTML 생성 시도 (완전하지 않아 build-inline.js로 후처리)
- **assetsInlineLimit**: 100MB (모든 에셋 인라인화 시도)

## 주요 동작 흐름

1. 사용자가 HTML 입력, CSS 입력 (또는 템플릿 CSS 사용)
2. "변환" 버튼 클릭 → `main.js`의 `runConversion()`에서 처리 (async)
3. **스타일 미리보기**: `createPreview()`로 외부 CSS 적용 HTML 생성 → previewFrame에 표시
4. **인라인 변환**: `await convertToInline()`로 인라인 스타일 적용
5. 옵션 적용: Body Only 체크, 공백 제거
6. **인라인 미리보기**: 변환된 결과를 inlinePreviewFrame에 표시
7. **경고 표시**: `renderWarnings()`가 호환성 경고를 배너에 표시
8. **코드 표시**: 최종 HTML을 코드 탭에 표시

두 미리보기 iframe은 모두 `renderWidth`로 폭을 고정하고 패널 크기에 맞춰 `transform: scale()`로
축소해 보여줍니다(`ui-controller.js`의 `applyPreviewScale`). 변환도 같은 폭에서 이뤄지므로
패널을 리사이즈해도 미리보기 레이아웃과 변환 결과가 어긋나지 않습니다.

## 템플릿 CSS 처리

`template-manager.js`는 Vite의 `?inline` 접미사를 사용하여 `src/styles/template.css`를 문자열로 임포트합니다. 이는 빌드 시 번들에 포함됩니다.

**`template.css`에는 미디어쿼리를 두지 않습니다.** 이 도구의 산출물은 항상 인라인 스타일이고
인라인에는 미디어쿼리를 담을 수 없어, 변환 시 렌더 폭에 따라 어느 한쪽 분기가 굳어버릴 뿐입니다.
표는 `width` 백분율과 `.table-responsive`(가로 스크롤)로 폭에 대응합니다.
현재 템플릿은 미디어쿼리가 없어 **어떤 `renderWidth`에서 변환해도 결과가 동일합니다.**
