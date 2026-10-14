#!/usr/bin/env python3
"""
TracX Logis HTML Generator

TracX Logis 마크업 파일에서 완전한 HTML 문서를 생성하는 통합 스크립트입니다.
tx_markdown_parser.py와 tx_html_builder.py를 자동으로 실행합니다.
"""

import os
import sys
import argparse
import subprocess
import tempfile
import re
from typing import Dict, List


class HTMLGenerator:
    """전체 프로세스 오케스트레이션"""
    
    def __init__(self, scripts_dir: str = None):
        """
        Args:
            scripts_dir: 스크립트 디렉토리 경로 (None이면 현재 디렉토리)
        """
        if scripts_dir is None:
            scripts_dir = os.path.dirname(os.path.abspath(__file__))
        
        self.scripts_dir = scripts_dir
        self.parser_path = os.path.join(scripts_dir, 'tx_markdown_parser.py')
        self.builder_path = os.path.join(scripts_dir, 'tx_html_builder.py')
        
        # 스크립트 존재 확인
        if not os.path.exists(self.parser_path):
            raise FileNotFoundError(f"파서를 찾을 수 없습니다: {self.parser_path}")
        if not os.path.exists(self.builder_path):
            raise FileNotFoundError(f"빌더를 찾을 수 없습니다: {self.builder_path}")
    
    def _run_command(self, command: List[str]) -> subprocess.CompletedProcess:
        """
        명령어 실행
        
        Args:
            command: 실행할 명령어 리스트
            
        Returns:
            subprocess.CompletedProcess
            
        Raises:
            subprocess.CalledProcessError: 명령어 실행 실패 시
        """
        try:
            result = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True
            )
            return result
        except subprocess.CalledProcessError as e:
            print(f"명령어 실행 실패: {' '.join(command)}", file=sys.stderr)
            print(f"오류 출력: {e.stderr}", file=sys.stderr)
            raise
    
    def _collect_stats(self, html: str) -> Dict[str, int]:
        """
        생성된 HTML 통계 수집
        
        Args:
            html: HTML 문자열
            
        Returns:
            통계 딕셔너리
        """
        stats = {
            'tables': 0,
            'buttons': 0,
            'callouts': 0,
            'headings': 0,
            'lists': 0
        }
        
        # 테이블 수
        stats['tables'] = len(re.findall(r'<table', html))
        
        # 버튼 수
        stats['buttons'] = len(re.findall(r'<a[^>]*class="[^"]*btn[^"]*"', html))
        
        # 콜아웃 수
        stats['callouts'] = len(re.findall(r'<div[^>]*class="[^"]*callout[^"]*"', html))
        
        # 제목 수
        stats['headings'] = (
            len(re.findall(r'<h1>', html)) +
            len(re.findall(r'<h2>', html)) +
            len(re.findall(r'<h3>', html))
        )
        
        # 목록 수
        stats['lists'] = len(re.findall(r'<ul>', html)) + len(re.findall(r'<ol>', html))
        
        return stats
    
    def generate(self, 
                 markdown_file: str, 
                 output_file: str,
                 title: str = "TracX Logis",
                 template_dir: str = None,
                 verbose: bool = False) -> Dict:
        """
        전체 생성 프로세스 실행
        
        Args:
            markdown_file: 입력 마크업 파일
            output_file: 출력 HTML 파일
            title: 문서 제목
            template_dir: 템플릿 디렉토리 (None이면 기본값)
            verbose: 상세 출력 여부
            
        Returns:
            결과 딕셔너리:
            {
                'success': bool,
                'output_file': str,
                'stats': dict,
                'errors': list
            }
        """
        result = {
            'success': False,
            'output_file': output_file,
            'stats': {},
            'errors': []
        }
        
        # 임시 파일 생성 (파싱된 HTML 저장용)
        temp_html = None
        
        try:
            # Step 1: 입력 파일 확인
            if not os.path.exists(markdown_file):
                raise FileNotFoundError(f"입력 파일을 찾을 수 없습니다: {markdown_file}")
            
            if verbose:
                print(f"📄 입력 파일: {markdown_file}")
            
            # Step 2: 마크다운 파싱
            if verbose:
                print("🔄 마크업 파싱 중...")
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as f:
                temp_html = f.name
            
            parser_cmd = [sys.executable, self.parser_path, markdown_file, temp_html]
            if verbose:
                parser_cmd.append('--verbose')

            self._run_command(parser_cmd)
            
            if verbose:
                print("✅ 파싱 완료")
            
            # Step 3: 템플릿 빌드
            if verbose:
                print("🔄 템플릿 결합 중...")
            
            builder_cmd = [sys.executable, self.builder_path, temp_html, output_file, '--title', title]
            if template_dir:
                builder_cmd.extend(['--template-dir', template_dir])
            if verbose:
                builder_cmd.append('--verbose')

            self._run_command(builder_cmd)
            
            if verbose:
                print("✅ 템플릿 결합 완료")
            
            # Step 4: 통계 수집
            with open(output_file, 'r', encoding='utf-8') as f:
                final_html = f.read()
            
            result['stats'] = self._collect_stats(final_html)
            result['success'] = True
            
        except FileNotFoundError as e:
            result['errors'].append(str(e))
        except subprocess.CalledProcessError as e:
            result['errors'].append(f"스크립트 실행 오류: {str(e)}")
        except Exception as e:
            result['errors'].append(f"예상치 못한 오류: {str(e)}")
        finally:
            # 임시 파일 정리
            if temp_html and os.path.exists(temp_html):
                try:
                    os.unlink(temp_html)
                except OSError:
                    pass
        
        return result


def format_stats(stats: Dict[str, int]) -> str:
    """
    통계 정보를 보기 좋게 포맷팅
    
    Args:
        stats: 통계 딕셔너리
        
    Returns:
        포맷된 문자열
    """
    items = []
    
    if stats.get('headings', 0) > 0:
        items.append(f"제목 {stats['headings']}개")
    if stats.get('tables', 0) > 0:
        items.append(f"테이블 {stats['tables']}개")
    if stats.get('buttons', 0) > 0:
        items.append(f"버튼 {stats['buttons']}개")
    if stats.get('callouts', 0) > 0:
        items.append(f"콜아웃 {stats['callouts']}개")
    if stats.get('lists', 0) > 0:
        items.append(f"목록 {stats['lists']}개")
    
    return ', '.join(items) if items else '기본 콘텐츠'


def main():
    """CLI 진입점"""
    parser = argparse.ArgumentParser(
        description='TracX Logis HTML 문서 생성기',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예제:
  %(prog)s input.md output.html
  %(prog)s input.md output.html --title "배송 안내"
  %(prog)s input.md output.html --template-dir /path/to/templates --verbose
        """
    )
    
    parser.add_argument('input', help='입력 마크업 파일 (.md 또는 .txt)')
    parser.add_argument('output', help='출력 HTML 파일')
    parser.add_argument('--title', default='TracX Logis', help='문서 제목 (기본값: TracX Logis)')
    parser.add_argument('--scripts-dir', help='스크립트 디렉토리 (기본값: 현재 디렉토리)')
    parser.add_argument('--template-dir', help='템플릿 디렉토리 (기본값: /mnt/project/)')
    parser.add_argument('-v', '--verbose', action='store_true', help='상세 출력')
    
    args = parser.parse_args()
    
    try:
        # 생성기 초기화
        generator = HTMLGenerator(args.scripts_dir)
        
        # HTML 생성
        result = generator.generate(
            markdown_file=args.input,
            output_file=args.output,
            title=args.title,
            template_dir=args.template_dir,
            verbose=args.verbose
        )
        
        # 결과 출력
        if result['success']:
            print(f"\n✅ HTML 생성 완료: {result['output_file']}")
            if result['stats']:
                stats_str = format_stats(result['stats'])
                print(f"📊 생성된 콘텐츠: {stats_str}")
            sys.exit(0)
        else:
            print(f"\n❌ HTML 생성 실패", file=sys.stderr)
            for error in result['errors']:
                print(f"  - {error}", file=sys.stderr)
            sys.exit(1)
            
    except FileNotFoundError as e:
        print(f"❌ 오류: {str(e)}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ 예상치 못한 오류: {str(e)}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
