# CSS Inline Converter

HTML에 CSS를 인라인 스타일로 적용하는 웹 애플리케이션입니다.

## 프로젝트 구조

```
css-inline-converter/
├── src/
│   ├── index.html              # 메인 HTML 템플릿
│   ├── main.js                 # 애플리케이션 진입점
│   ├── styles/
│   │   ├── app.css            # 앱 UI 스타일
│   │   └── template.css       # 템플릿 CSS
│   └── modules/
│       ├── ui-controller.js   # UI 제어 (탭, 패널, 이벤트)
│       ├── css-converter.js   # CSS 인라인 변환 엔진
│       ├── template-manager.js # 템플릿 관리
│       └── utils.js           # 유틸리티 함수
├── build-inline.js            # 단일 HTML 생성 스크립트
├── vite.config.js             # Vite 설정
└── dist/                      # 빌드 결과 (단일 HTML 파일)
```

## 개발

```bash
npm install
npm run dev     # 개발 서버 실행
```

## 빌드

```bash
npm run build   # dist/index.html 생성
```

최종 빌드는 단일 HTML 파일로 생성되며 모든 CSS와 JavaScript가 인라인으로 포함됩니다.

## 주요 기능

- CSS를 HTML 요소의 인라인 스타일로 변환
- 템플릿 CSS 제공
- 사용자 정의 CSS 지원
- Body 내용만 추출 옵션
- 공백 제거 옵션
- 실시간 미리보기
