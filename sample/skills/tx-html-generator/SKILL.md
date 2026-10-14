---
name: tx-html-generator
description: TracX Logis 브랜드 테마가 적용된 HTML 공지사항 및 이메일 템플릿 자동 생성. 사용자가 "공지사항 HTML 작성", "메일 템플릿 생성", "이메일 만들어줘", "HTML 문서로 변환" 등을 요청하거나 TracX Logis 브랜드 가이드를 따르는 문서가 필요한 경우 사용.
---

# TracX Logis HTML Generator

TracX Logis 브랜드 테마가 적용된 HTML 문서를 자동으로 생성합니다.

## 출력 형식 결정

### 완전한 HTML 문서 (헤더/푸터 포함)

**트리거 키워드**: "완전한 HTML", "전체 HTML", "완전한 템플릿", "독립 실행 가능한"

**실행**:
```bash
cd /mnt/skills/user/tx-html-generator/scripts
python3 tx_generate.py input.md output.html --title "문서제목" --template-dir /mnt/skills/user/tx-html-generator/assets
```

### 콘텐츠만 생성 (기본값)

**실행**:
```bash
cd /mnt/skills/user/tx-html-generator/scripts
python3 tx_markdown_parser.py input.md output.html
```

## 실행 프로세스

### 1. 마크업 준비

**사용자가 이미 마크업 형식으로 제공**:
→ 문법 검증 후 바로 변환

**간단한 텍스트나 개요만 제공**:
→ 완전한 마크업 초안 작성
→ **초안을 사용자에게 보여주고 승인 받은 후 진행**
→ 승인 전 HTML 변환 금지

**마크업 작성 규칙**:
- 목록 형식(`- 항목: 값`)은 반드시 표(세로형)로 변환
- 버튼 타입 미지정 시 맥락에 따라 자동 결정

### 2. HTML 변환

입력 파일을 `/home/claude/`에 생성하고 스크립트 실행:

```bash
# 완전한 HTML
python3 tx_generate.py /home/claude/input.md /mnt/user-data/outputs/result.html \
  --title "제목" --template-dir /mnt/skills/user/tx-html-generator/assets

# 콘텐츠만
python3 tx_markdown_parser.py /home/claude/input.md /mnt/user-data/outputs/result.html
```

### 3. 결과 제공

```
[문서 다운로드](computer:///mnt/user-data/outputs/result.html)

테이블 2개, 버튼 3개 포함
```

## 마크업 문법 핵심

### 변수

`|!#-변수명|` (또는 `{변수명}` 자동 변환)

```
고객명: |!#-cust_nm|
주문번호: |!#-order_no|
```

### 테이블

**가로형** (파이프로 구분):
```
[표: 가로형]
{헤더1| 헤더2}
- 값1| 값2
[/표]
```

**세로형** (콜론 권장):
```
[표: 세로형]
- 헤더1: 값1
- 헤더2: 값2
[/표]
```

**파이프 구분자** (시간/URL 등 콜론 포함 값):
```
[표: 세로형]
- 배송시간| 14:30:00
- 사이트| https://example.com
[/표]
```

**콤마 포함 값도 자동 처리**

### 콜아웃

```
[정보: 제목]
내용
[/정보]

[경고: 제목]
내용
[/경고]

[강조: 제목]
내용
[/강조]
```

### 버튼

```
[버튼, 레이블, URL, 스타일]
[버튼, 레이블, URL]  # 스타일 자동 결정
```

**스타일**: `primary`, `secondary`, `warn`, `outline`

## 상세 문법

복잡한 경우 참조:
```python
with open('/mnt/skills/user/tx-html-generator/references/MARKUP_SYNTAX.md', 'r') as f:
    syntax_guide = f.read()
```

## 에러 처리

- 오류 메시지를 명확히 전달
- 마크업 문법 오류 시 수정 안내
- 필요시 MARKUP_SYNTAX.md 참조
