#!/usr/bin/env python3
"""
TracX Logis Markdown Parser

TracX Logis 마크업을 HTML로 변환하는 파서입니다.
외부 의존성 없이 Python 표준 라이브러리만 사용합니다.
"""

import re
import html as html_module
import argparse
import sys
from typing import List, Tuple, Optional


# 정규식 패턴 상수
CALLOUT_TYPES = '정보|경고|강조'
CALLOUT_START_PATTERN = rf'^\[({CALLOUT_TYPES})(?::\s*([^\]]*))?\]'
CALLOUT_SIMPLE_PATTERN = rf'^\[({CALLOUT_TYPES})(?::|])'

# HTML 템플릿 및 CSS 클래스 상수
CSS_TABLE_HORIZONTAL = "table-horizontal"
CSS_TABLE_VERTICAL = "table-vertical"
CSS_CALLOUT = "callout"
CSS_CALLOUT_INFO = "callout-info"
CSS_CALLOUT_WARN = "callout-warn"
CSS_CALLOUT_ACCENT = "callout-accent"
CSS_BTN = "btn"
CSS_BTN_PRIMARY = "btn-primary"
CSS_BTN_SECONDARY = "btn-secondary"
CSS_BTN_WARN = "btn-warn"
CSS_BTN_OUTLINE = "btn-outline"
CSS_BTN_GROUP = "btn-group"

# HTML 템플릿
HTML_BLOCKQUOTE_OPEN = "<blockquote><p>"
HTML_BLOCKQUOTE_CLOSE = "</p></blockquote>"
HTML_BR = "<br>"
HTML_BR_SELF = "<br/>"
HTML_HR = "<hr>"
HTML_MAIN_OPEN = "<main>"
HTML_MAIN_CLOSE = "</main>"
HTML_PARA_OPEN = "<p>"
HTML_PARA_CLOSE = "</p>"
HTML_STRONG_OPEN = "<strong>"
HTML_STRONG_CLOSE = "</strong>"
HTML_EM_OPEN = "<em>"
HTML_EM_CLOSE = "</em>"


class VariableProcessor:
    """변수 형식 정규화 처리"""
    
    @staticmethod
    def normalize_variables(text: str) -> str:
        """
        {변수명} → |!#-변수명| 변환

        Args:
            text: 입력 텍스트

        Returns:
            변수가 정규화된 텍스트
        """
        # {변수명} 패턴을 |!#-변수명|으로 변환 (하이픈, 점 포함)
        pattern = r'\{([a-zA-Z0-9_가-힣.\-]+)\}'
        return re.sub(pattern, r'|!#-\1|', text)


class BaseMarkdownParser:
    """표준 마크다운 문법 처리"""

    def escape_html(self, text: str) -> str:
        """HTML 특수문자 이스케이프 (변수는 제외)"""
        # 변수 패턴 임시 치환 (하이픈, 점 포함)
        var_pattern = r'\|!#-[a-zA-Z0-9_가-힣.\-]+\|'
        variables = re.findall(var_pattern, text)
        
        # 임시 플레이스홀더로 치환
        temp_text = text
        for i, var in enumerate(variables):
            temp_text = temp_text.replace(var, f'___VAR_{i}___', 1)
        
        # HTML 이스케이프
        escaped = html_module.escape(temp_text)
        
        # 변수 복원
        for i, var in enumerate(variables):
            escaped = escaped.replace(f'___VAR_{i}___', var, 1)
        
        return escaped
    
    def parse_inline(self, text: str) -> str:
        """인라인 요소 파싱 (굵게, 기울임, 링크 등)"""
        text = self.escape_html(text)

        # ***굵은 기울임*** (3개 우선 처리)
        text = re.sub(r'\*\*\*(.+?)\*\*\*', rf'{HTML_STRONG_OPEN}{HTML_EM_OPEN}\1{HTML_EM_CLOSE}{HTML_STRONG_CLOSE}', text)
        text = re.sub(r'___(.+?)___', rf'{HTML_STRONG_OPEN}{HTML_EM_OPEN}\1{HTML_EM_CLOSE}{HTML_STRONG_CLOSE}', text)

        # **굵게** 또는 __굵게__
        text = re.sub(r'\*\*(.+?)\*\*', rf'{HTML_STRONG_OPEN}\1{HTML_STRONG_CLOSE}', text)
        text = re.sub(r'__(.+?)__', rf'{HTML_STRONG_OPEN}\1{HTML_STRONG_CLOSE}', text)

        # *기울임* 또는 _기울임_
        text = re.sub(r'\*(.+?)\*', rf'{HTML_EM_OPEN}\1{HTML_EM_CLOSE}', text)
        text = re.sub(r'_(.+?)_', rf'{HTML_EM_OPEN}\1{HTML_EM_CLOSE}', text)

        # [링크](URL)
        text = re.sub(r'\[([^\]]+)\]\(([^\)]+)\)', r'<a href="\2">\1</a>', text)

        return text
    
    def parse_heading(self, line: str) -> Optional[str]:
        """제목 파싱"""
        match = re.match(r'^(#{1,3})\s+(.+)$', line)
        if match:
            level = len(match.group(1))
            content = self.parse_inline(match.group(2))
            return f'<h{level}>{content}</h{level}>'
        return None
    
    def parse_blockquote(self, lines: List[str], start_idx: int) -> Tuple[str, int]:
        """인용문 파싱"""
        quote_lines = []
        idx = start_idx
        
        while idx < len(lines) and lines[idx].startswith('>'):
            content = lines[idx][1:].strip()
            if content:
                quote_lines.append(content)
            idx += 1
        
        if quote_lines:
            content = HTML_BR.join([self.parse_inline(line) for line in quote_lines])
            return f'{HTML_BLOCKQUOTE_OPEN}{content}{HTML_BLOCKQUOTE_CLOSE}', idx - start_idx
        
        return '', 0
    
    def parse_list(self, lines: List[str], start_idx: int) -> Tuple[str, int]:
        """목록 파싱 (순서 없음, 순서 있음, 중첩 지원)"""
        items = []
        idx = start_idx
        first_line = lines[start_idx]
        
        # 순서 있는 목록인지 확인
        is_ordered = bool(re.match(r'^\d+\.\s+', first_line))
        list_tag = 'ol' if is_ordered else 'ul'
        
        # 현재 레벨의 들여쓰기 확인
        indent_match = re.match(r'^(\s*)', first_line)
        base_indent = len(indent_match.group(1)) if indent_match else 0
        
        while idx < len(lines):
            line = lines[idx]
            
            # 빈 줄이면 목록 종료
            if not line.strip():
                break
            
            # 현재 줄의 들여쓰기
            current_indent_match = re.match(r'^(\s*)', line)
            current_indent = len(current_indent_match.group(1)) if current_indent_match else 0
            
            # 들여쓰기가 base_indent보다 작으면 목록 종료
            if current_indent < base_indent:
                break
            
            # 들여쓰기가 같은 레벨의 항목인지 확인
            if current_indent == base_indent:
                # 목록 항목 패턴 매칭
                if is_ordered:
                    match = re.match(r'^\s*\d+\.\s+(.+)$', line)
                else:
                    match = re.match(r'^\s*[-*]\s+(.+)$', line)
                
                if match:
                    content = self.parse_inline(match.group(1))
                    items.append(f'<li>{content}</li>')
                    idx += 1
                else:
                    break
            else:
                # 들여쓰기가 더 깊으면 중첩 목록 (재귀 처리)
                nested_html, consumed = self.parse_list(lines, idx)
                if items:
                    # 마지막 항목에 중첩 목록 추가
                    items[-1] = items[-1].replace('</li>', f'{nested_html}</li>')
                idx += consumed

        html = f'<{list_tag}>\n' + '\n'.join(items) + f'\n</{list_tag}>'
        return html, idx - start_idx


class CustomComponentParser:
    """TracX Logis 전용 커스텀 컴포넌트 처리"""

    def __init__(self, base_parser: BaseMarkdownParser):
        self.base_parser = base_parser

    def _format_paragraph(self, lines: List[str]) -> str:
        """
        여러 줄을 하나의 문단으로 포맷팅

        Args:
            lines: 문단을 구성하는 텍스트 라인들

        Returns:
            HTML <p> 태그로 감싼 문단
        """
        if not lines:
            return ''
        parsed_lines = [self.base_parser.parse_inline(line) for line in lines]
        return f'{HTML_PARA_OPEN}{HTML_BR_SELF.join(parsed_lines)}{HTML_PARA_CLOSE}'

    def parse_table_horizontal(self, lines: List[str], start_idx: int) -> Tuple[str, int]:
        """
        가로형 테이블 파싱

        형식:
        {헤더1| 헤더2| ...}
        - 값1| 값2| ...

        Returns:
            (HTML, 소비한 라인 수)
        """
        idx = start_idx

        # 헤더 파싱 - {헤더1| 헤더2| ...}
        header_line = lines[idx].strip()
        if not (header_line.startswith('{') and header_line.endswith('}')):
            return '', 0

        headers = [h.strip() for h in header_line[1:-1].split('|')]
        idx += 1

        # 데이터 행 파싱 - 각 행은 '-'로 시작
        rows = []
        while idx < len(lines):
            line = lines[idx].strip()

            # 종료 태그 발견
            if line == '[/표]':
                idx += 1
                break

            # h1/h2 제목을 만나면 자동 종료 (종료 태그 누락으로 간주)
            if re.match(r'^#{1,2}\s+', line):
                print(f"경고: 가로형 테이블의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line {idx + 1})", file=sys.stderr)
                break

            if line.startswith('-'):
                row_data = [cell.strip() for cell in line[1:].strip().split('|')]
                rows.append(row_data)
                idx += 1
            else:
                idx += 1

        # 파일 끝까지 종료 태그를 찾지 못한 경우
        if idx == len(lines):
            last_line = lines[-1].strip() if lines else ''
            if last_line != '[/표]':
                print(f"경고: 가로형 테이블의 종료 태그 '[/표]'가 파일 끝까지 없습니다", file=sys.stderr)

        # 빈 테이블 경고
        if not rows:
            print(f"경고: 빈 가로형 테이블이 생성됩니다", file=sys.stderr)

        # HTML 생성
        html = f'<table class="{CSS_TABLE_HORIZONTAL}">\n'
        html += '<thead>\n<tr>\n'
        for header in headers:
            html += f'<th>{self.base_parser.parse_inline(header)}</th>\n'
        html += '</tr>\n</thead>\n'

        html += '<tbody>\n'
        for row in rows:
            # 칼럼 수 자동 보정
            if len(row) != len(headers):
                print(f"경고: 칼럼 수 불일치 (헤더: {len(headers)}, 데이터: {len(row)}) - 자동 보정됨", file=sys.stderr)
                # 부족한 칼럼은 빈 값으로 채움
                while len(row) < len(headers):
                    row.append('')
                # 초과한 칼럼은 무시
                if len(row) > len(headers):
                    row = row[:len(headers)]

            html += '<tr>\n'
            for cell in row:
                html += f'<td>{self.base_parser.parse_inline(cell)}</td>\n'
            html += '</tr>\n'
        html += '</tbody>\n'
        html += '</table>'

        return html, idx - start_idx
    
    def parse_table_vertical(self, lines: List[str], start_idx: int) -> Tuple[str, int]:
        """
        세로형 테이블 파싱

        형식: - 헤더: 값 (콜론 권장) 또는 - 헤더| 값 (파이프 지원)

        Returns:
            (HTML, 소비한 라인 수)
        """
        idx = start_idx
        rows = []

        while idx < len(lines):
            line = lines[idx].strip()

            # 종료 태그 발견
            if line == '[/표]':
                idx += 1
                break

            # h1/h2 제목을 만나면 자동 종료 (종료 태그 누락으로 간주)
            if re.match(r'^#{1,2}\s+', line):
                print(f"경고: 세로형 테이블의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line {idx + 1})", file=sys.stderr)
                break

            # 빈 줄은 건너뛰기
            if not line:
                idx += 1
                continue

            # - 헤더: 값 또는 - 헤더| 값 형식 파싱
            if line.startswith('-'):
                # 맨 앞의 '-' 제거
                content = line[1:].strip()

                # 가장 먼저 나타나는 구분자를 사용 (명시적 파이프가 콜론보다 우선)
                colon_pos = content.find(':')
                pipe_pos = content.find('|')

                # 둘 다 없으면 헤더만
                if colon_pos == -1 and pipe_pos == -1:
                    parts = [content.strip(), '']
                # 파이프만 있거나 파이프가 먼저 나타나면 파이프 사용
                elif pipe_pos != -1 and (colon_pos == -1 or pipe_pos < colon_pos):
                    parts = [p.strip() for p in content.split('|', 1)]  # 최대 1번만 분리
                # 콜론만 있거나 콜론이 먼저 나타나면 콜론 사용
                else:
                    parts = [p.strip() for p in content.split(':', 1)]  # 최대 1번만 분리

                if len(parts) >= 1:
                    header = parts[0]
                    value = parts[1] if len(parts) > 1 else ''
                    rows.append((header, value))
                idx += 1
            else:
                # 테이블이 아닌 라인을 만나면 중단하지 않고 건너뛰기
                idx += 1

        # 파일 끝까지 종료 태그를 찾지 못한 경우
        if idx == len(lines):
            last_line = lines[-1].strip() if lines else ''
            if last_line != '[/표]':
                print(f"경고: 세로형 테이블의 종료 태그 '[/표]'가 파일 끝까지 없습니다", file=sys.stderr)

        # 빈 테이블 경고
        if not rows:
            print(f"경고: 빈 세로형 테이블이 생성됩니다", file=sys.stderr)

        # HTML 생성
        html = f'<table class="{CSS_TABLE_VERTICAL}">\n'
        for header, value in rows:
            html += '<tr>\n'
            html += f'<th>{self.base_parser.parse_inline(header)}</th>\n'
            html += f'<td>{self.base_parser.parse_inline(value)}</td>\n'
            html += '</tr>\n'
        html += '</table>'

        return html, idx - start_idx
    
    def parse_table(self, lines: List[str], start_idx: int) -> Tuple[str, int]:
        """
        테이블 파싱 (가로형/세로형 자동 판별)
        
        Returns:
            (HTML, 소비한 라인 수)
        """
        # [표: 가로형] 또는 [표: 세로형]
        match = re.match(r'^\[표:\s*(가로형|세로형)\]', lines[start_idx])
        if not match:
            return '', 0
        
        table_type = match.group(1)
        
        if table_type == '가로형':
            html, consumed = self.parse_table_horizontal(lines, start_idx + 1)
            # start_idx 라인(테이블 시작 태그) + consumed 반환
            return html, consumed + 1
        else:  # 세로형
            html, consumed = self.parse_table_vertical(lines, start_idx + 1)
            # start_idx 라인(테이블 시작 태그) + consumed 반환
            return html, consumed + 1
    
    def detect_button_style(self, label: str) -> str:
        """
        버튼 레이블에서 스타일 자동 결정

        Args:
            label: 버튼 레이블

        Returns:
            버튼 스타일 (primary, secondary, warn, outline)
        """
        label_lower = label.lower()

        # Primary 키워드
        primary_keywords = ['신청', '등록', '확인', '구매', '결제', '시작', '추적', '완료']
        if any(keyword in label_lower for keyword in primary_keywords):
            return CSS_BTN_PRIMARY.replace('btn-', '')

        # Warn 키워드
        warn_keywords = ['취소', '삭제', '중단', '거부', '해지', '차단']
        if any(keyword in label_lower for keyword in warn_keywords):
            return CSS_BTN_WARN.replace('btn-', '')

        # Outline 키워드
        outline_keywords = ['나중에', '건너뛰기', '선택', '건너뛰']
        if any(keyword in label_lower for keyword in outline_keywords):
            return CSS_BTN_OUTLINE.replace('btn-', '')

        # 기본값은 secondary
        return CSS_BTN_SECONDARY.replace('btn-', '')
    
    def _parse_csv_like(self, text: str) -> List[str]:
        """
        CSV 스타일 파싱: 콤마로 구분, 큰따옴표로 감싸면 내부 콤마 허용

        예: a, "b, c", d → ["a", "b, c", "d"]

        Args:
            text: 파싱할 텍스트

        Returns:
            파싱된 파라미터 리스트
        """
        params = []
        current = []
        inside_quotes = False
        escaped = False

        for char in text:
            if escaped:
                current.append(char)
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                inside_quotes = not inside_quotes
            elif char == ',' and not inside_quotes:
                # 콤마를 만났고 인용 부호 밖이면 파라미터 구분
                params.append(''.join(current).strip())
                current = []
            else:
                current.append(char)

        # 마지막 파라미터 추가
        if current or params:  # 빈 문자열도 허용 (마지막이 콤마인 경우)
            params.append(''.join(current).strip())

        return params

    def parse_button(self, line: str) -> Optional[str]:
        """
        버튼 파싱

        형식: [버튼, 레이블, URL, 스타일]
        큰따옴표로 감싸면 콤마 포함 가능: [버튼, "레이블, 콤마", URL]

        Returns:
            HTML 버튼 또는 None
        """
        line = line.strip()

        # [버튼, ...] 형식 확인
        if not line.startswith('[버튼,') or not line.endswith(']'):
            return None

        # [버튼, 와 ] 제거
        content = line[5:-1].strip()  # "[버튼," 제거하고 "]" 제거

        # CSV 스타일 파싱 (큰따옴표 지원)
        params = self._parse_csv_like(content)

        if not params:
            return None

        # 파라미터 추출
        label = params[0] if len(params) > 0 else ''
        url = params[1] if len(params) > 1 else '#'
        style = params[2] if len(params) > 2 else None

        # 빈 레이블 체크
        if not label:
            return None

        # 스타일 자동 결정
        if not style or not style.strip():
            style = self.detect_button_style(label)
        else:
            style = style.strip()

        return f'<a href="{url}" class="{CSS_BTN} btn-{style}">{self.base_parser.parse_inline(label)}</a>'
    
    def parse_callout(self, lines: List[str], start_idx: int, in_callout: bool = False) -> Tuple[str, int]:
        """
        콜아웃 파싱

        형식:
        [정보: 제목]          또는 [정보]
        내용                  내용
        [/정보]              [/정보]

        Args:
            lines: 전체 라인 리스트
            start_idx: 시작 인덱스
            in_callout: 이미 콜아웃 내부인지 여부

        Returns:
            (HTML, 소비한 라인 수)
        """
        first_line = lines[start_idx].strip()

        # [정보/경고/강조: 제목] 또는 [정보/경고/강조] (제목 없음)
        match = re.match(CALLOUT_START_PATTERN, first_line)
        if not match:
            return '', 0

        callout_type = match.group(1)
        title = match.group(2).strip() if match.group(2) else None

        # 이미 콜아웃 내부면 인용으로 처리
        if in_callout:
            # 중첩된 콜아웃을 인용으로 처리
            idx = start_idx + 1
            blockquote_lines = []

            while idx < len(lines):
                line = lines[idx]

                if line.strip() == f'[/{callout_type}]':
                    idx += 1
                    break

                # 중첩된 콜아웃의 제목 라인은 무시
                if not re.match(r'^\[/(정보|경고|강조)\]', line.strip()):
                    blockquote_lines.append(line)

                idx += 1

            if blockquote_lines:
                content = HTML_BR.join([self.base_parser.parse_inline(line.strip()) for line in blockquote_lines if line.strip()])
                return f'{HTML_BLOCKQUOTE_OPEN}{content}{HTML_BLOCKQUOTE_CLOSE}', idx - start_idx

            return '', idx - start_idx

        # CSS 클래스 매핑
        type_map = {
            '정보': CSS_CALLOUT_INFO.replace('callout-', ''),
            '경고': CSS_CALLOUT_WARN.replace('callout-', ''),
            '강조': CSS_CALLOUT_ACCENT.replace('callout-', '')
        }
        css_type = type_map[callout_type]

        # 내용 수집
        idx = start_idx + 1
        content_lines = []

        while idx < len(lines):
            line = lines[idx]

            # 종료 태그 발견
            if line.strip() == f'[/{callout_type}]':
                idx += 1
                break

            # h1/h2 제목을 만나면 자동 종료 (종료 태그 누락으로 간주)
            if re.match(r'^#{1,2}\s+', line.strip()):
                print(f"경고: 콜아웃 '{callout_type}'의 종료 태그가 없어 제목에서 자동 종료되었습니다 (line {idx + 1})", file=sys.stderr)
                break

            content_lines.append(line)
            idx += 1

        # 파일 끝까지 종료 태그를 찾지 못한 경우
        if idx == len(lines):
            last_line = lines[-1].strip() if lines else ''
            if last_line != f'[/{callout_type}]':
                print(f"경고: 콜아웃 '{callout_type}'의 종료 태그가 파일 끝까지 없습니다", file=sys.stderr)

        # 내용 파싱 (콜아웃 내부 플래그 설정)
        # 콜아웃 내부 파싱 시 중첩 방지
        content_html = self._parse_content_in_callout('\n'.join(content_lines))

        # 빈 콜아웃 경고
        if not content_lines or not ''.join(content_lines).strip():
            print(f"경고: 빈 콜아웃 '{callout_type}'이 생성됩니다", file=sys.stderr)

        # HTML 생성
        html = f'<div class="{CSS_CALLOUT} callout-{css_type}">\n'

        # 제목이 있으면 포함
        if title:
            html += f'<h3>{self.base_parser.parse_inline(title)}</h3>\n'

        # 내용 추가
        html += content_html

        html += '\n</div>'

        return html, idx - start_idx

    def _parse_content_in_callout(self, content_text: str) -> str:
        """
        콜아웃 내부 콘텐츠 파싱 (중첩 콜아웃을 인용으로 처리)

        Args:
            content_text: 콜아웃 내부 콘텐츠 텍스트

        Returns:
            파싱된 HTML
        """
        lines = content_text.split('\n')
        html_blocks = []
        idx = 0

        while idx < len(lines):
            line = lines[idx].strip()

            # 빈 줄
            if not line:
                idx += 1
                continue

            # 중첩된 콜아웃 (인용으로 처리)
            if re.match(CALLOUT_SIMPLE_PATTERN, line):
                html, consumed = self.parse_callout(lines, idx, in_callout=True)
                if html:
                    html_blocks.append(html)
                    idx += consumed
                    continue

            # 제목
            heading_html = self.base_parser.parse_heading(line)
            if heading_html:
                html_blocks.append(heading_html)
                idx += 1
                continue

            # 일반 문단
            paragraph_lines = []
            while idx < len(lines) and lines[idx].strip():
                stripped = lines[idx].strip()
                if re.match(CALLOUT_SIMPLE_PATTERN, stripped):
                    break
                paragraph_lines.append(stripped)
                idx += 1

            if paragraph_lines:
                html = self._format_paragraph(paragraph_lines)
                html_blocks.append(html)
                continue

            idx += 1

        html = '\n'.join(html_blocks)
        return html


class TracXMarkdownParser:
    """메인 파서 - 모든 컴포넌트 통합"""

    def __init__(self):
        self.base_parser = BaseMarkdownParser()
        self.custom_parser = CustomComponentParser(self.base_parser)
        self.variable_processor = VariableProcessor()
        self.include_header = False  # [헤더] 마크업 포함 여부
    
    def wrap_consecutive_buttons(self, html: str) -> str:
        """
        연속된 버튼을 <p class="btn-group">으로 래핑

        Args:
            html: 입력 HTML

        Returns:
            버튼이 래핑된 HTML
        """
        # 1. 마커로 표시된 버튼 그룹을 btn-group으로 래핑
        group_pattern = r'<!--BTN_GROUP_START-->(.*?)<!--BTN_GROUP_END-->'
        html = re.sub(group_pattern, lambda m: f'{HTML_PARA_OPEN.replace("<p>", f"<p class=\"{CSS_BTN_GROUP}\">")}{m.group(1)}{HTML_PARA_CLOSE}', html, flags=re.DOTALL)

        # 2. 단일 버튼을 일반 p로 래핑 (이미 p로 래핑되지 않은 것만)
        # <a> 태그가 <p> 안에 없는 경우만 래핑
        single_button_pattern = r'(?<!<p>)(?<!<p class="btn-group">)(<a\s+href="[^"]*"\s+class="btn[^"]*">[^<]*</a>)(?!</p>)'
        html = re.sub(single_button_pattern, lambda m: f'{HTML_PARA_OPEN}{m.group(1)}{HTML_PARA_CLOSE}', html)

        return html
    
    def parse_paragraph_block(self, lines: List[str], start_idx: int) -> Tuple[str, int]:
        """
        문단 블록 파싱 - 빈 줄까지 하나의 문단으로 처리

        Args:
            lines: 전체 라인 리스트
            start_idx: 시작 인덱스

        Returns:
            (HTML, 소비한 라인 수)
        """
        paragraph_lines = []
        idx = start_idx

        while idx < len(lines):
            line = lines[idx]
            stripped = line.strip()

            # 빈 줄을 만나면 문단 종료
            if not stripped:
                break

            # 특수 블록 시작을 만나면 문단 종료
            if (stripped.startswith('#') or
                stripped.startswith('[표:') or
                stripped.startswith('[버튼,') or
                re.match(CALLOUT_SIMPLE_PATTERN, stripped) or
                stripped.startswith('>') or
                re.match(r'^(\s*)[-*]\s+', stripped) or
                re.match(r'^(\s*)\d+\.\s+', stripped) or
                stripped in ['---', '***', '___']):
                break

            paragraph_lines.append(stripped)
            idx += 1

        if paragraph_lines:
            html = self.custom_parser._format_paragraph(paragraph_lines)
            return html, idx - start_idx

        return '', 0
    
    def parse(self, markdown_text: str) -> str:
        """
        전체 파싱 프로세스

        Args:
            markdown_text: TracX Logis 마크업 텍스트

        Returns:
            HTML 문자열
        """
        # 1. 변수 정규화
        text = self.variable_processor.normalize_variables(markdown_text)

        # 2. [헤더] 마크업 감지
        if '[헤더]' in text:
            self.include_header = True
            text = text.replace('[헤더]\n', '')  # [헤더] 라인 제거

        # 3. 줄 단위로 분리
        lines = text.split('\n')
        
        # 3. 블록 단위 파싱
        html_blocks = []
        idx = 0
        
        while idx < len(lines):
            line = lines[idx].strip()
            
            # 빈 줄
            if not line:
                idx += 1
                continue
            
            # 수평선
            if line in ['---', '***', '___']:
                html_blocks.append(HTML_HR)
                idx += 1
                continue
            
            # 테이블
            if line.startswith('[표:'):
                html, consumed = self.custom_parser.parse_table(lines, idx)
                if html:
                    html_blocks.append(html)
                    idx += consumed
                    continue
            
            # 콜아웃
            if re.match(CALLOUT_SIMPLE_PATTERN, line):
                html, consumed = self.custom_parser.parse_callout(lines, idx)
                if html:
                    html_blocks.append(html)
                    idx += consumed
                    continue
            
            # 버튼 (연속된 버튼을 그룹으로 처리)
            if line.startswith('[버튼,'):
                button_group = []
                btn_idx = idx

                # 빈 줄 없이 연속된 버튼들을 수집
                while btn_idx < len(lines):
                    btn_line = lines[btn_idx].strip()

                    # 빈 줄을 만나면 버튼 그룹 종료
                    if not btn_line:
                        break

                    # 버튼이 아닌 다른 요소를 만나면 종료
                    if not btn_line.startswith('[버튼,'):
                        break

                    # 버튼 파싱
                    btn_html = self.custom_parser.parse_button(btn_line)
                    if btn_html:
                        button_group.append(btn_html)

                    btn_idx += 1

                # 버튼 그룹을 하나의 블록으로 추가 (여러 버튼이면 btn-group 마커 추가)
                if button_group:
                    if len(button_group) > 1:
                        # 여러 버튼: btn-group으로 마킹 (실제 래핑은 wrap_consecutive_buttons에서)
                        grouped_html = f'<!--BTN_GROUP_START-->{"".join(button_group)}<!--BTN_GROUP_END-->'
                        html_blocks.append(grouped_html)
                    else:
                        # 단일 버튼: 그대로 추가
                        html_blocks.append(button_group[0])

                    idx = btn_idx
                    continue
            
            # 인용문
            if line.startswith('>'):
                html, consumed = self.base_parser.parse_blockquote(lines, idx)
                if html:
                    html_blocks.append(html)
                    idx += consumed
                    continue
            
            # 목록
            if re.match(r'^(\s*)[-*]\s+', line) or re.match(r'^(\s*)\d+\.\s+', line):
                html, consumed = self.base_parser.parse_list(lines, idx)
                if html:
                    html_blocks.append(html)
                    idx += consumed
                    continue
            
            # 제목
            heading_html = self.base_parser.parse_heading(line)
            if heading_html:
                html_blocks.append(heading_html)
                idx += 1
                continue
            
            # 일반 문단 (빈 줄까지 하나의 문단으로)
            paragraph_html, consumed = self.parse_paragraph_block(lines, idx)
            if paragraph_html:
                html_blocks.append(paragraph_html)
                idx += consumed
                continue
            
            # 처리되지 않은 라인
            idx += 1

        # 4. HTML 조립
        html = '\n'.join(html_blocks)

        # 5. 연속된 버튼 래핑
        html = self.wrap_consecutive_buttons(html)

        # 6. <main> 래핑
        html = f'{HTML_MAIN_OPEN}\n{html}\n{HTML_MAIN_CLOSE}'

        # 7. 헤더 플레이스홀더 추가 (필요한 경우)
        if self.include_header:
            html = f'<!--HEADER_PLACEHOLDER-->{html}'

        return html


def main():
    """CLI 진입점"""
    parser = argparse.ArgumentParser(
        description='TracX Logis 마크업을 HTML로 변환합니다.'
    )
    parser.add_argument('input', help='입력 마크업 파일')
    parser.add_argument('output', help='출력 HTML 파일')
    parser.add_argument('-v', '--verbose', action='store_true', help='상세 출력')
    
    args = parser.parse_args()
    
    try:
        # 입력 파일 읽기
        with open(args.input, 'r', encoding='utf-8') as f:
            markdown = f.read()
        
        if args.verbose:
            print(f"[입력] 파일: {args.input}")
            print(f"[읽음] {len(markdown)} 문자")
        
        # 파싱
        parser_instance = TracXMarkdownParser()
        html = parser_instance.parse(markdown)
        
        if args.verbose:
            print(f"[완료] 파싱 완료")
            print(f"[생성] {len(html)} 문자")
        
        # 출력 파일 쓰기
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(html)
        
        if args.verbose:
            print(f"[저장] 출력 파일: {args.output}")

        print(f"[완료] HTML 변환 완료: {args.output}")
        
    except FileNotFoundError:
        print(f"[오류] 파일을 찾을 수 없습니다 - {args.input}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[오류] {str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
