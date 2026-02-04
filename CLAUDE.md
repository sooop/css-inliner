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

**convertToInline(html, css, options)**: CSS를 인라인 스타일로 변환하는 핵심 함수

1. 숨겨진 iframe을 생성하여 HTML과 CSS를 렌더링
2. `getComputedStyle()`을 사용해 각 요소의 최종 계산된 스타일을 추출
3. 정의된 속성 목록(PROPERTIES_TO_INLINE)에 따라 인라인 스타일 적용
4. `options.bodyOnly`가 true이거나 입력이 부분 HTML인 경우 body.innerHTML만 반환
5. 그 외에는 전체 문서 반환

**주요 파라미터:**
- `options.bodyOnly`: true 시 body 내용만 반환 (기본값: false)
- 입력에 `<html` 태그가 없으면 자동으로 body 내용만 반환

### 모듈 구조

- **main.js**: 애플리케이션 진입점, 이벤트 바인딩
- **ui-controller.js**: UI 상태 관리 (탭 전환, 패널 토글, 미리보기 업데이트)
- **css-converter.js**: CSS 인라인 변환 엔진
- **template-manager.js**: 템플릿 CSS 가져오기/다운로드/복사 (Vite의 `?inline` 임포트 사용)
- **utils.js**: 유틸리티 함수 (공백 제거, body 추출, 속성 필터링)

### CSS 속성 필터링 로직

`utils.js`의 `shouldIncludeProperty()` 함수가 어떤 CSS 속성을 인라인에 포함할지 결정합니다:

- **항상 포함**: `text-decoration: none`, `border: none` 등 명시적 의미가 있는 값
- **조건부 포함**: display, position 등 레이아웃 속성 (기본값 제외)
- **제외**: `border-width: 0px`, `border-spacing: 0px 0px` 등 명백한 기본값

### Vite 설정 특이사항

- **root**: `src` 폴더를 루트로 설정
- **viteSingleFile 플러그인**: Vite 빌드 시 단일 HTML 생성 시도 (완전하지 않아 build-inline.js로 후처리)
- **assetsInlineLimit**: 100MB (모든 에셋 인라인화 시도)

## 주요 동작 흐름

1. 사용자가 HTML 입력, CSS 입력 (또는 템플릿 CSS 사용)
2. "변환" 버튼 클릭 → `main.js`에서 처리
3. **스타일 미리보기**: `createPreview()`로 외부 CSS 적용 HTML 생성 → previewFrame에 표시
4. **인라인 변환**: `convertToInline()`로 인라인 스타일 적용
5. 옵션 적용: Body Only 체크, 공백 제거
6. **인라인 미리보기**: 변환된 결과를 inlinePreviewFrame에 표시
7. **코드 표시**: 최종 HTML을 코드 탭에 표시

## 템플릿 CSS 처리

`template-manager.js`는 Vite의 `?inline` 접미사를 사용하여 `src/styles/template.css`를 문자열로 임포트합니다. 이는 빌드 시 번들에 포함됩니다.
