#!/usr/bin/env python3
"""
TracX Logis HTML Builder

파싱된 HTML 본문을 템플릿에 결합하여 완전한 HTML 문서를 생성합니다.
"""

import os
import sys
import argparse
import base64
from typing import Optional


class TemplateBuilder:
    """템플릿 결합 및 최종 HTML 생성"""
    
    def __init__(self, template_dir: str):
        """
        Args:
            template_dir: 템플릿 디렉토리 경로
        """
        self.template_dir = template_dir
        self.template = None
        self.css = None
        self.logo_base64 = None
        self.header = None

        # 파일 경로
        self.template_path = os.path.join(template_dir, 'template_base.html')
        self.css_path = os.path.join(template_dir, 'template.css')
        self.logo_path = os.path.join(template_dir, 'logo_tx.png')
        self.header_path = os.path.join(template_dir, 'header.html')
    
    def load_template(self) -> None:
        """template_base.html 로드"""
        if not os.path.exists(self.template_path):
            raise FileNotFoundError(f"템플릿 파일을 찾을 수 없습니다: {self.template_path}")
        
        with open(self.template_path, 'r', encoding='utf-8') as f:
            self.template = f.read()
    
    def load_css(self) -> None:
        """template.css 로드"""
        if not os.path.exists(self.css_path):
            raise FileNotFoundError(f"CSS 파일을 찾을 수 없습니다: {self.css_path}")
        
        with open(self.css_path, 'r', encoding='utf-8') as f:
            self.css = f.read()
    
    def load_logo(self) -> None:
        """
        logo.png를 Base64로 인코딩

        로고 파일이 없으면 경고만 출력하고 빈 문자열 사용
        """
        if not os.path.exists(self.logo_path):
            print(f"경고: 로고 파일을 찾을 수 없습니다: {self.logo_path}", file=sys.stderr)
            print("빈 로고로 진행합니다.", file=sys.stderr)
            self.logo_base64 = ""
            return

        try:
            with open(self.logo_path, 'rb') as f:
                image_data = f.read()
            self.logo_base64 = base64.b64encode(image_data).decode('utf-8')
        except Exception as e:
            print(f"경고: 로고 인코딩 실패: {str(e)}", file=sys.stderr)
            self.logo_base64 = ""

    def load_header(self) -> None:
        """header.html 로드"""
        if not os.path.exists(self.header_path):
            print(f"경고: 헤더 파일을 찾을 수 없습니다: {self.header_path}", file=sys.stderr)
            self.header = ""
            return

        with open(self.header_path, 'r', encoding='utf-8') as f:
            self.header = f.read()
    
    def build(self, content_html: str, title: str = "TracX Logis") -> str:
        """
        최종 HTML 생성

        Args:
            content_html: 파싱된 HTML 본문
            title: 문서 제목

        Returns:
            완전한 HTML 문서
        """
        if self.template is None:
            raise ValueError("템플릿이 로드되지 않았습니다. load_template()을 먼저 호출하세요.")
        if self.css is None:
            raise ValueError("CSS가 로드되지 않았습니다. load_css()를 먼저 호출하세요.")
        if self.logo_base64 is None:
            raise ValueError("로고가 로드되지 않았습니다. load_logo()를 먼저 호출하세요.")

        # 헤더 플레이스홀더 처리
        has_header = False
        if '<!--HEADER_PLACEHOLDER-->' in content_html:
            has_header = True
            # 헤더 로드 (아직 로드되지 않았으면)
            if self.header is None:
                self.load_header()
            # 로고 치환 (헤더 템플릿의 로고 플레이스홀더)
            header_with_logo = self.header.replace('{{logo_base64}}', self.logo_base64)
            content_html = content_html.replace('<!--HEADER_PLACEHOLDER-->\n', header_with_logo + '\n')

        # <main> 래핑 (헤더가 있으면 본문만이므로 래핑 필요)
        if has_header:
            content_html = f'<main>\n{content_html}\n</main>'

        # 템플릿 치환
        html = self.template
        html = html.replace('{{title}}', title)
        html = html.replace('{{styles}}', self.css)
        html = html.replace('{{logo_base64}}', self.logo_base64)
        html = html.replace('{{content}}', self._indent_content(content_html, 8))

        return html
    
    def _indent_content(self, content: str, spaces: int) -> str:
        """
        콘텐츠에 들여쓰기 추가

        Args:
            content: HTML 콘텐츠
            spaces: 들여쓰기 공백 수

        Returns:
            들여쓰기가 적용된 콘텐츠
        """
        indent = ' ' * spaces
        lines = content.split('\n')
        indented_lines = [indent + line if line.strip() else line for line in lines]
        return '\n'.join(indented_lines)


def encode_image_to_base64(image_path: str) -> str:
    """
    이미지를 Base64로 인코딩
    
    Args:
        image_path: 이미지 파일 경로
        
    Returns:
        Base64 인코딩된 문자열
    """
    with open(image_path, 'rb') as f:
        image_data = f.read()
    return base64.b64encode(image_data).decode('utf-8')


def main():
    """CLI 진입점"""
    parser = argparse.ArgumentParser(
        description='TracX Logis HTML 빌더 - 파싱된 HTML을 템플릿에 결합합니다.'
    )
    
    parser.add_argument('input', help='입력 HTML 본문 파일 (파싱된 결과)')
    parser.add_argument('output', help='출력 완전한 HTML 파일')
    parser.add_argument('--title', default='TracX Logis', help='문서 제목 (기본값: TracX Logis)')
    parser.add_argument(
        '--template-dir',
        default='/mnt/project/',
        help='템플릿 디렉토리 (기본값: /mnt/project/)'
    )
    parser.add_argument('-v', '--verbose', action='store_true', help='상세 출력')
    
    args = parser.parse_args()
    
    try:
        # 입력 파일 읽기
        if not os.path.exists(args.input):
            raise FileNotFoundError(f"입력 파일을 찾을 수 없습니다: {args.input}")
        
        with open(args.input, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if args.verbose:
            print(f"📄 입력 파일: {args.input}")
            print(f"📝 {len(content)} 문자 읽음")
        
        # 빌더 초기화 및 템플릿 로드
        builder = TemplateBuilder(args.template_dir)
        
        if args.verbose:
            print(f"📁 템플릿 디렉토리: {args.template_dir}")
        
        builder.load_template()
        if args.verbose:
            print("✅ 템플릿 로드 완료")
        
        builder.load_css()
        if args.verbose:
            print("✅ CSS 로드 완료")
        
        builder.load_logo()
        if args.verbose:
            print("✅ 로고 로드 완료")
        
        # 최종 HTML 생성
        final_html = builder.build(content, args.title)
        
        if args.verbose:
            print(f"✅ HTML 생성 완료")
            print(f"📊 {len(final_html)} 문자 생성")
        
        # 출력 파일 쓰기
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(final_html)
        
        print(f"✅ 완전한 HTML 문서 생성 완료: {args.output}")
        
    except FileNotFoundError as e:
        print(f"❌ 오류: {str(e)}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ 오류: {str(e)}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
