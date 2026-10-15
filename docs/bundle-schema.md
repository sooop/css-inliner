# tx-mail-bundle 명세 (version 1)

다국어 이메일 템플릿 스튜디오가 내보내는 **JSON 1파일** 번들의 명세다. 백오피스(import)·메일 서버·메일 처리 워커 개발자가 읽는다.
기계 검증용 스키마는 [`bundle.schema.json`](./bundle.schema.json)(JSON Schema draft 2020-12), 전체 예시는 [`example-bundle.json`](./example-bundle.json), 동적 표 연동 명세 예시는 [`example-handoff.md`](./example-handoff.md).

> 백오피스 쪽 import 구현은 별도 저장소다. 이 저장소는 번들 생성·검증과 이 문서만 담당한다.

## 1. 최상위 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `schema` | `"tx-mail-bundle"` | O | 고정값. 다른 값이면 거부 |
| `version` | `1` | O | 스키마 버전. 모르는 버전이면 거부 |
| `templateCode` | string | 선택 | 백오피스 템플릿 코드. **없어도 내보내기·import 가능**(없으면 import 시 입력받는다) |
| `name` | string | O | 템플릿 이름(사람용) |
| `generatedAt` | string(date-time) | O | 생성 시각(RFC 3339) |
| `baseLang` | string | O | 기준 언어(원문). 예 `ko` |
| `langs` | string[] | O | 포함 언어 목록(중복 없음). `locales`·`rowTemplates` 의 키와 같아야 한다 |
| `variables` | `{name,description,sample}[]` | O | 공통 치환자 `\|!#-name\|` 목록. 행 변수(`{{name}}`)는 여기 넣지 않고 `dynamicTables[].vars` 에 둔다 |
| `locales` | `{ [lang]: { subject, html } }` | O | 언어별 제목·본문 |
| `dynamicTables` | object[] | O | 서버(워커)가 행을 생성하는 표. 없으면 `[]` |
| `source` | object | O | 프로젝트 원본(재편집용). 백오피스는 해석하지 않고 보관만 해도 된다 |
| `checksum` | string | O | `sha256:<64자 hex>`. 계산법은 4절 |

### `variables[]` / `dynamicTables[].vars[]`

| 필드 | 설명 |
|---|---|
| `name` | 영문·숫자·`_`·`-`·`.`·한글. 치환자는 `\|!#-name\|`, 행 변수는 `{{name}}` 로 쓰인다 |
| `description` | 설명(사람용) |
| `sample` | 샘플값(미리보기·행당 바이트 추정용) |

### `locales[lang]`

- `subject`: 제목. 치환자 `|!#-name|` 를 포함할 수 있다.
- `html`: **`<body>` 안 전체**(래퍼 표 + 로고 헤더 + 본문 + 푸터). 인라인 스타일 적용 완료, `data-t`/`data-rows` 속성 제거됨. 로고 `<img>` 는 기본적으로 `data:` base64 를 그대로 포함한다(프로젝트 `settings.logoUrl` 이 설정되어 있으면 그 URL 로 대체되어 나간다).

## 2. 검증 규칙 (import 측이 권장하는 검사)

번들을 받으면 다음을 순서대로 확인한다(이 저장소의 `verifyBundle` 이 같은 규칙을 구현한다).

1. `bundle.schema.json` 으로 JSON Schema 검증.
2. `baseLang ∈ langs`, `keys(locales) = langs`.
3. 모든 동적 표: `marker == "|!#-rows_" + id + "|"`, `id` 중복 없음, `keys(rowTemplates) = langs`.
4. 모든 동적 표·언어: 행 템플릿에서 추출한 `{{var}}` 집합 = `vars[].name` 집합.
5. 모든 동적 표·언어: `locales[lang].html` 에 `marker` 가 **정확히 1회** 있다.
6. `locales[*].html` 에 `data-t=`/`data-rows=` 가 남아 있지 않다.
7. **링크 새 창 규칙**: `locales[*].html` 과 `dynamicTables[].rowTemplates[*]` 의 모든 `<a href>` 는 `target="_blank"` 와 `rel` 에 `noopener noreferrer` 를 가진다(아래 제외 대상 제외). 앱이 합성 단계에서 자동으로 붙이므로 import 측은 값을 신뢰해도 되고, `verifyBundle` 은 빠진 링크가 있으면 오류로 본다.
8. `checksum` 재계산 값과 일치.

### 링크 새 창 규칙 (`target="_blank"`)

- 대상: 버튼(`a.btn`)·본문 인라인 링크·로고 링크·행 템플릿 안 링크 전부. 앱이 `composeLang`(미리보기·발송용·행 템플릿 합성 공통 경로)에서 보장하고, 인라인 변환 뒤 한 번 더 확인한다(엔진이 속성을 바꾸면 복구하고 경고 `link-target-restored`). 구조·문자열 원본은 바꾸지 않는다.
- 없으면 추가하고, `target` 이 다른 값이면 `_blank` 로 바꾸며, `rel` 이 있으면 `noopener noreferrer` 가 포함되도록 병합한다. 여러 번 적용해도 결과가 같다.
- **제외(붙이지 않음)**: `mailto:` `tel:` `sms:`(메일·전화 앱을 여는 동작이라 새 창이 무의미) 와 페이지 내 앵커 `#…`(같은 문서 안 이동). `href` 가 없는 `<a>` 도 건드리지 않는다.
- 치환자 href(`|!#-url|`)·행 변수 href(`{{url}}`)·상대 경로·`http(s)://` 는 외부 링크로 보고 붙인다. 따라서 서버가 값을 채운 뒤 `mailto:` 가 되는 치환자 링크에도 target 이 붙어 있을 수 있다(무해).

### 내보내기(생성) 전 검사 — 앱이 수행

| 검사 | 등급 |
|---|---|
| 언어 간 `\|!#-x\|` 치환자 집합 불일치(본문·제목 각각) | 오류 |
| `\|!#-` 형식 깨짐(닫는 `\|` 누락, 허용 외 문자, 대소문자만 다른 이름 중복) | 오류 |
| 미번역(빈 문자열, 제목 포함) | 오류 |
| 행 템플릿 `{{var}}` ↔ `vars` 불일치(선언했으나 미사용 / 미선언 사용) | 오류 |
| 언어 간 `{{var}}` 집합 불일치 | 오류 |
| 표식·행 변수 이름 충돌(행 변수가 본문 치환자와 같은 이름, 본문에 `\|!#-rows_<id>\|` 직접 사용, 표 id 중복·형식 오류) | 오류 |
| 기준 언어 원문이 바뀐 뒤 갱신되지 않은 번역 | 경고 |
| 허용 외 인라인 태그 제거(허용: `strong` `em` `a` `br`) | 경고 |
| 인라인 변환 경고(엔진 `warnings` 중 info 제외) | 경고 |
| Gmail 102KB(104,448B) 초과 위험: 언어별 본문 바이트 + 행당 바이트 × 예상 행 수 | 경고 |

오류가 있어도 사용자가 확인하면 강제(`force`) 내보내기가 가능하다. 번들에는 검사 결과가 들어가지 않는다.

## 3. 동적 테이블 연동

일부 표는 **서버(메일 처리 워커)가 `<tbody>` 행을 생성**한다(주문 상품 목록 등). 번들은 표 구조·행 템플릿·변수만 제공하고 행 데이터는 담지 않는다.

### 3.1 `dynamicTables[]` 항목

```jsonc
{
  "id": "orders",                      // 표 id. 영문·숫자·_·-
  "marker": "|!#-rows_orders|",        // 발송 HTML tbody 에 들어 있는 표식(고정 형식 |!#-rows_<id>|)
  "columns": 2,                        // 행 1개의 셀(td/th) 수. 언어 공통
  "vars": [{ "name": "qty", "description": "수량", "sample": "2" }],
  "sampleRows": [{ "name": "무선 이어폰", "qty": "2" }],   // 예시 행(문서·미리보기용, 발송에는 쓰이지 않음)
  "rowTemplates": {                    // 언어별 행 템플릿
    "ko": "<tr style=\"…\"><td style=\"…\">{{name}}</td><td style=\"…\">{{qty}}개</td></tr>",
    "en": "<tr …>…{{qty}} pcs…</tr>"
  }
}
```

- 발송 HTML(`locales[lang].html`)의 해당 `<tbody>` 안에는 `marker` 하나만 있다. 예: `<tbody>|!#-rows_orders|</tbody>`.
- `rowTemplates[lang]` 은 **인라인 스타일이 적용된 `<tr>…</tr>` 한 줄**이다. 행 안 고정 문구(단위·상태 라벨)가 번역되므로 언어별로 다르다. 표당 템플릿은 1종뿐이다(줄무늬·합계·빈 목록 변형 없음).
- `{{name}}` 은 `vars[].name` 중 하나다. 본문 치환자(`|!#-name|`)와 이름 공간이 겹치지 않도록 앱이 검사한다.

### 3.2 서버·워커가 따를 규칙

이 절의 규약은 **표식 위치, 행 템플릿 형식(`<tr>…</tr>`), `{{var}}` 변수 목록, 행 수 상한 계산법**만 정한다. 표식 교체와 행 생성은 **별도 메일 처리 워커 담당**이며, 워커 내부 구현(치환 규칙 세부·순서)은 워커 담당 부서가 정한다.

1. **표식 교체**: 표식 `|!#-rows_<id>|` 를 **`<tr>…</tr>` 연속 문자열**로 교체한다. 행 하나 = 행 템플릿 1회 치환 결과, 행들을 구분자 없이 이어 붙인다. 행이 0개면 빈 문자열(표 머리만 남는다).
2. **행 변수**: 행 템플릿의 변수는 `{{vars[].name}}` 형식(공백 없음)만 쓰이며, 값 치환은 워커 담당이다.
3. **언어 선택**: 수신자 언어의 `locales[lang].html` 과 같은 언어의 `rowTemplates[lang]` 을 쓴다. 열 수(`columns`)는 언어 공통이다.
4. **행 수 상한**: Gmail 은 메시지가 약 102KB(= 102×1024 = 104,448 바이트)를 넘으면 본문을 잘라 "메시지 전체 보기" 뒤로 숨긴다.

   ```
   최대 행 수 = floor( (104448 − 본문 바이트) ÷ 행당 바이트 )
   본문 바이트 = locales[lang].html 의 UTF-8 바이트(표식 포함, 치환 후 길이 차이는 무시 가능)
   행당 바이트 = 행 템플릿에 값을 채운 <tr>…</tr> 의 UTF-8 바이트(값 길이에 따라 달라지므로 실제 평균으로 재추정 권장)
   ```

   표가 여러 개면 한 표의 상한은 나머지 표의 행 바이트를 본문에 더해 계산한다. 이 저장소는 `maxRowsWithin(baseBytes, rowBytes)` 로, 앱은 [개발자용 MD](#4-개발자용-md-생성) 의 표로 같은 값을 제공한다.

### 3.3 서버 확정 사항 및 워커 담당 범위

- **확정: 서버는 `rows_` 접두 치환자(`|!#-rows_<id>|`)를 지우거나 오류로 처리하지 않고 그대로 통과시킨다.** 표식은 서버를 거쳐 워커까지 남는다.
- **참고(권장) 처리 순서**: 서버가 본문 전체의 `|!#-x|` 치환(수신자 변수)을 먼저 하고, 그 뒤에 표식 `|!#-rows_<id>|` 를 행 문자열로 교체하면 행 값에 `|!#-` 문자열이 있어도 재치환되지 않는다. 이는 권장일 뿐 강제 규약이 아니며, 실제 순서·치환 규칙 세부는 워커 담당 부서가 정한다.
- **워커 담당 영역(이 문서 범위 밖)**: 표식 교체와 행 생성의 내부 구현, `{{ }}` 치환 세부 규칙(없는 변수 처리, 중괄호 처리, 공백 허용 여부 등). 번들은 `{{name}}`(공백 없음, 이름은 `vars[].name`) 형식의 행 템플릿만 생성한다.

## 4. 체크섬

`checksum = "sha256:" + hex( SHA-256( UTF-8( canonicalJson ) ) )`

- `canonicalJson` = 번들에서 **`checksum` 필드를 제거**하고, 모든 객체의 키를 **재귀적으로 사전순(UTF-16 코드 유닛 순)** 정렬한 뒤 공백 없이 직렬화한 JSON(`JSON.stringify`).
- `undefined` 값 키는 없는 것으로 본다. 배열 순서는 유지한다.
- 변조·손상 감지용이며 인증(서명)은 아니다.

## 5. 개발자용 MD 생성

`buildHandoffMd(project, rendered)` 는 번들 내용에서 워커 담당자용 MD 를 만든다(표별 삽입 표식, 언어별 행 템플릿, 변수 목록(설명·샘플), 예시 행, 앱 참조 렌더 결과 예시, 공통 규칙, Gmail 최대 행 수).

> 예시 렌더의 `&lt;` `&amp;` 등은 앱 미리보기가 샘플 값을 안전하게 보여주기 위한 표시일 뿐이며, 이 규약은 값 이스케이프를 요구하지 않는다(워커 담당 영역). 출력 예: [`example-handoff.md`](./example-handoff.md).

## 6. 예시 번들 (요약)

전체: [`example-bundle.json`](./example-bundle.json). 아래는 `source` 를 생략하고 `html` 을 줄인 요약이다.

```jsonc
{
  "schema": "tx-mail-bundle",
  "version": 1,
  "templateCode": "SHIP_START",
  "name": "배송 시작 안내",
  "generatedAt": "2026-10-14T09:00:00.000Z",
  "baseLang": "ko",
  "langs": ["ko", "en", "ja"],
  "variables": [
    { "name": "cust_nm", "description": "고객명", "sample": "홍길동" },
    { "name": "order_no", "description": "주문번호", "sample": "A-1001" }
  ],
  "locales": {
    "en": {
      "subject": "[TRACXLOGIS] Shipped (|!#-order_no|)",
      "html": "<table class=\"wrap\">…<h1>Your shipment is on its way</h1><p>Hello, <strong>|!#-cust_nm|</strong>.</p>…<tbody>|!#-rows_orders|</tbody></table>…"
    }
    // ko, ja 생략
  },
  "dynamicTables": [
    {
      "id": "orders",
      "marker": "|!#-rows_orders|",
      "columns": 2,
      "vars": [
        { "name": "name", "description": "상품명", "sample": "무선 이어폰" },
        { "name": "qty", "description": "수량", "sample": "2" }
      ],
      "sampleRows": [{ "name": "무선 이어폰", "qty": "2" }],
      "rowTemplates": {
        "en": "<tr style=\"height: 20px;\"><td style=\"padding: 4px;\">{{name}}</td><td style=\"padding: 4px;\">{{qty}} pcs</td></tr>"
      }
    }
  ],
  "source": { "…": "Project 원본(재편집용)" },
  "checksum": "sha256:…"
}
```

예시의 인라인 스타일(`height: 20px` 등)은 테스트용 가짜 변환기가 만든 값이며 실제 번들에서는 템플릿 CSS 가 인라인된 값이 들어간다.

## 7. 앱 측 API 요약 (참고)

`src/project/` — `exportBundle(project, { inline, css, expectedRows, force })`(렌더 → 검사 → 번들), `verifyBundle(json)`, `restoreProject(bundle)`, `buildHandoffMd(project, rendered)`, `validateProject(project, { rendered, expectedRows })`, `maxRowsWithin(baseBytes, rowBytes)`.
