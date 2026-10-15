# handwritten 골든 (수기 기대값)

파이썬 원본 파서는 콜아웃 안 표·목록·버튼과 `~~취소선~~` 을 지원하지 않아 `__golden__/expected` (원본 출력, 회귀 기준·불변) 로는 확장 문법을 검증할 수 없다.
이 폴더의 `*.expected.html` 은 **`sample/sample.html` 의 해당 구조를 그대로 발췌**해 만든 기대값이다(들여쓰기만 제거).

- `callout-nested.expected.html` = sample.html 693~754행 (콜아웃 안 순서 목록·서식·링크 / 가로형 표 / 세로형 표+버튼). 입력은 `callout-nested.md`.
- `inline-del.expected.html` = sample.html 531행 (굵게·기울임·취소선·링크·변수). 입력은 `inline-del.md`.
- sample.html 의 `<main>` 3중 중첩·헤더 placeholder 버그는 따르지 않는다(발췌 범위에 없음).
