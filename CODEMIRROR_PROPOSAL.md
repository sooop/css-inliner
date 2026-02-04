# CodeMirror 6 통합 제안서

## 현재 상황

### 현재 편집기
- HTML 입력: `<textarea>` 사용
- CSS 입력: `<textarea>` 사용 (모달 내부)
- 기능: 기본 텍스트 입력만 가능
- 부족한 기능:
  - 문법 강조 없음
  - 자동완성 없음
  - 괄호 매칭 없음
  - 오류 검사 없음
  - 코드 폴딩 없음

## CodeMirror 6 통합 제안

### 선택 이유

#### 1. CodeMirror 6의 장점
- **가벼운 번들 크기**: 약 100-150KB (gzip 압축 시)
- **모듈식 아키텍처**: 필요한 기능만 선택적으로 임포트 가능
- **ESM 지원**: Vite와 완벽한 통합
- **HTML/CSS 언어 지원**: 공식 언어 패키지 제공
- **현대적인 API**: React/Vue 등과 쉽게 통합
- **접근성**: ARIA 지원, 스크린 리더 호환

#### 2. 다른 옵션과의 비교

| 편집기 | 번들 크기 | ESM 지원 | 학습 곡선 | 추천도 |
|--------|-----------|----------|-----------|--------|
| CodeMirror 6 | 100-150KB | ✓ | 낮음 | ⭐⭐⭐⭐⭐ |
| Monaco Editor | 3-5MB | △ | 높음 | ⭐⭐ (너무 무거움) |
| Ace Editor | 200-400KB | △ | 중간 | ⭐⭐⭐ (구식) |

### 제공될 기능

#### 즉시 사용 가능한 기능
1. **문법 강조**
   - HTML 태그, 속성 강조
   - CSS 선택자, 속성, 값 강조
   - 키워드 강조

2. **기본 편집 기능**
   - 괄호 자동 완성 및 매칭
   - 자동 들여쓰기
   - 블록 주석/주석 해제
   - 여러 줄 편집
   - 실행 취소/다시 실행

3. **편의 기능**
   - 줄 번호 표시
   - 현재 줄 강조
   - 선택 영역 강조
   - 검색 및 바꾸기 (Ctrl+F)

#### 추가 구현 가능한 기능 (선택사항)
1. **간단한 자동완성**
   - HTML 태그 자동완성
   - CSS 속성 자동완성
   - 닫는 태그 자동 생성

2. **Emmet 지원**
   - `div.container>ul>li*3` → 자동 확장
   - CSS 약어 지원

3. **코드 폴딩**
   - HTML 요소 접기/펼치기
   - CSS 규칙 접기/펼치기

## 구현 계획

### Phase 1: 기본 통합 (2-3시간)

#### 1.1 의존성 설치
```bash
npm install @codemirror/state @codemirror/view @codemirror/commands
npm install @codemirror/lang-html @codemirror/lang-css
npm install @codemirror/basic-setup
```

#### 1.2 편집기 매니저 생성
**파일**: `src/modules/editor-manager.js`

```javascript
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

export function createHTMLEditor(element, initialValue = '') {
  return new EditorView({
    doc: initialValue,
    extensions: [basicSetup, html()],
    parent: element
  });
}

export function createCSSEditor(element, initialValue = '') {
  return new EditorView({
    doc: initialValue,
    extensions: [basicSetup, css()],
    parent: element
  });
}
```

#### 1.3 HTML 수정
기존 textarea를 편집기 컨테이너로 교체:

```html
<!-- Before -->
<textarea id="htmlInput" placeholder="HTML 코드를 입력하세요..."></textarea>

<!-- After -->
<div id="htmlEditor" class="editor-container"></div>
```

#### 1.4 CSS 스타일 추가
```css
.editor-container {
  flex: 1;
  overflow: auto;
}

/* CodeMirror 테마 커스터마이징 */
.cm-editor {
  height: 100%;
  font-size: 13px;
}

.cm-gutters {
  background: var(--bg-muted);
  border-right: 1px solid var(--border);
}

.cm-activeLineGutter {
  background: var(--accent-muted);
}
```

#### 1.5 main.js 업데이트
```javascript
import { createHTMLEditor, createCSSEditor } from './modules/editor-manager.js';

// textarea 대신 CodeMirror 편집기 생성
const htmlEditor = createHTMLEditor(
  document.getElementById('htmlEditor'),
  localStorage.getItem('html-input-content') || ''
);

const cssEditor = createCSSEditor(
  document.getElementById('cssEditor'),
  localStorage.getItem('css-input-content') || ''
);

// 변환 버튼 클릭 시 값 읽기
document.getElementById('convertBtn').addEventListener('click', () => {
  const htmlInput = htmlEditor.state.doc.toString();
  const cssInput = cssEditor.state.doc.toString();
  // ...
});
```

### Phase 2: 다크 모드 통합 (30분)

CodeMirror 테마를 앱 테마와 동기화:

```javascript
import { oneDark } from '@codemirror/theme-one-dark';

function updateEditorTheme(editor, isDark) {
  editor.dispatch({
    effects: [
      isDark
        ? StateEffect.appendConfig.of(oneDark)
        : StateEffect.appendConfig.of([])
    ]
  });
}
```

### Phase 3: 자동 저장 통합 (30분)

편집기 변경 감지 및 localStorage 저장:

```javascript
import { EditorView } from '@codemirror/view';

const htmlEditor = new EditorView({
  doc: initialValue,
  extensions: [
    basicSetup,
    html(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        debounce(() => {
          localStorage.setItem('html-input-content', update.state.doc.toString());
        }, 500)();
      }
    })
  ],
  parent: element
});
```

## 예상 영향 분석

### 번들 크기 영향

| 구성 요소 | 크기 (gzip) |
|-----------|-------------|
| 현재 전체 번들 | ~50KB |
| CodeMirror 6 core | ~60KB |
| HTML 언어 지원 | ~20KB |
| CSS 언어 지원 | ~15KB |
| basicSetup | ~15KB |
| **예상 총 크기** | **~160KB** |

증가율: 약 3배 (50KB → 160KB)
- 여전히 단일 HTML 파일로 빌드 가능
- 대부분의 사용자에게 허용 가능한 크기

### 성능 영향
- **초기 로딩**: +50-100ms (번들 파싱)
- **편집 성능**: 개선 (가상 스크롤, 증분 파싱)
- **대용량 파일**: 기존 textarea보다 우수한 성능

### 사용자 경험 개선
1. **시각적 피드백**
   - 문법 오류 즉시 확인
   - 태그 매칭 강조
   - 들여쓰기 자동 정렬

2. **생산성 향상**
   - 빠른 코드 작성 (자동완성)
   - 오류 감소 (괄호 매칭)
   - 검색/바꾸기 기능

3. **전문성**
   - VSCode와 유사한 경험
   - 개발자 친화적

## LSP (Language Server Protocol) 관련

### 현실적 제약
- **브라우저에서 LSP 서버 실행 불가능**: Node.js 의존성
- **WASM 컴파일**: vscode-html-languageservice를 WASM으로 컴파일하는 것은 비현실적
- **온라인 LSP**: 프라이버시 문제, 네트워크 의존성

### 대안
1. **CodeMirror 기본 자동완성**
   - 정적 태그/속성 목록 제공
   - 컨텍스트 기반 제안

2. **간단한 커스텀 자동완성**
   ```javascript
   const htmlCompletions = [
     { label: 'div', type: 'keyword' },
     { label: 'span', type: 'keyword' },
     // ...
   ];
   ```

3. **향후 고려사항**
   - WebAssembly 기반 경량 파서
   - Tree-sitter 통합 (구문 분석)

## 구현 우선순위

### 즉시 구현 (권장)
- ✅ Phase 1: 기본 통합
- ✅ Phase 2: 다크 모드 통합
- ✅ Phase 3: 자동 저장 통합

### 나중에 추가 (선택사항)
- ⏳ Emmet 지원
- ⏳ 고급 자동완성
- ⏳ 코드 폴딩
- ⏳ Linting (HTML/CSS 검증)

## 위험 및 완화 방안

### 위험 1: 번들 크기 증가
- **완화**: 코드 스플리팅, lazy loading
- **대안**: 핵심 기능만 포함 (basicSetup 대신 minimal setup)

### 위험 2: 기존 기능 호환성
- **완화**: textarea fallback 제공
- **테스트**: 자동 저장, 이력 복원 기능 철저히 검증

### 위험 3: 모바일 경험
- **완화**: CodeMirror는 터치 지원
- **테스트**: 다양한 디바이스에서 테스트 필요

## 결론 및 권장사항

### 권장 사항: ✅ CodeMirror 6 통합 추진

**이유:**
1. 번들 크기 증가가 합리적 (50KB → 160KB)
2. 사용자 경험 크게 개선
3. 구현 복잡도 낮음 (2-3시간)
4. 단일 HTML 파일 목표 유지 가능
5. 프로젝트의 전문성 향상

### 구현 순서
1. Phase 1 먼저 구현하여 검증
2. 사용자 피드백 수집
3. Phase 2, 3 단계적 추가
4. 선택 기능은 필요 시 추가

### 대안 (CodeMirror 통합하지 않는 경우)
- 현재 textarea 유지
- 간단한 문법 강조만 추가 (Prism.js 등)
- 번들 크기: +10KB
- 개선 효과: 제한적

## 참고 자료

- CodeMirror 6 공식 문서: https://codemirror.net/
- HTML 언어 패키지: https://github.com/codemirror/lang-html
- CSS 언어 패키지: https://github.com/codemirror/lang-css
- Examples: https://codemirror.net/examples/
