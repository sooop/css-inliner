<script lang="ts">
  /**
   * 초안 작성기: Milkdown(ProseMirror) 에디터 ⇄ .txmd 원문(소스 보기). 두 모드는 같은 문자열(`value`)을 공유한다.
   * - 모드 전환·로딩 시 왕복 검사를 통과하지 못하면 원문 textarea 로 폴백하고 이유를 보여 준다(원문은 그대로).
   * - 편집하지 않았다면 `value` 는 원문 그대로다(에디터가 정규화한 글로 덮지 않는다).
   * - 조합(IME) 중에는 키 처리에 개입하지 않는다.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import { toggleMark, setBlockType, wrapIn, lift } from '@milkdown/kit/prose/commands';
  import { redo, undo } from '@milkdown/kit/prose/history';
  import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list';
  import { Selection } from '@milkdown/kit/prose/state';
  import type { EditorView } from '@milkdown/kit/prose/view';
  import {
    addTableColumn,
    addTableRow,
    deleteTableColumn,
    deleteTableRow,
    insertBlock,
    insertInlineAtom,
    makeButtonGroup,
    makeCallout,
    makeDynamicTable,
    makeHorizontalTable,
    makeHr,
    makeQuote,
    makeVerticalTable,
    findAncestor,
    nextDynId,
    selectedOrAncestor,
    setNodeAttrs,
  } from './commands';
  import { createTxmdEditor, type EditorHandle } from './create';
  import { verifyDocStable, verifyRoundTrip } from './roundtrip';
  import { docToTxmd } from './serialize';
  import { BLOCK_ITEMS, SLASH_ITEMS, computeUi, filterItems, slashAt, type MenuItem, type SlashState, type UiState } from './ui-state';
  import { BUTTON_STYLES, CALLOUT_KINDS } from './schema';

  interface Props {
    value: string;
    /** 번역 줄로 인식할 비기준 언어 코드 */
    langs?: string[];
    /** 치환자 후보(프로젝트 변수) */
    variables?: { name: string; description?: string }[];
    /** 소스 모드 textarea 의 id */
    id?: string;
    /** 열릴 때 입력창에 포커스를 줄지 */
    autofocus?: boolean;
  }
  let { value = $bindable(), langs = ['en', 'ja'], variables = [], id = 'draft-ta', autofocus = true }: Props = $props();

  type Mode = 'wysiwyg' | 'source';
  const G = globalThis as { __txEditorMode?: Mode };

  let mode = $state<Mode>(G.__txEditorMode ?? 'wysiwyg');
  let notice = $state<{ kind: 'warn' | 'err'; text: string } | null>(null);
  let stableWarn = $state<string | null>(null);
  let ready = $state(false);
  let host = $state<HTMLDivElement>();
  let srcEl = $state<HTMLTextAreaElement>();
  let ui = $state.raw<UiState | null>(null);

  let handle: EditorHandle | null = null;
  let view: EditorView | null = null;
  let generation = 0;
  let touched = false;
  /** 에디터를 연 시점의 정규화된 글(편집 여부 판정용) */
  let baseline = '';
  let original = '';
  let verifyTimer: ReturnType<typeof setTimeout> | undefined;

  /* ---- 열기 · 닫기 · 모드 전환 */

  function fallback(reason: string, kind: 'warn' | 'err' = 'warn') {
    notice = { kind, text: `에디터로 열지 못해 .txmd 원문(소스 보기)으로 표시합니다 — ${reason}` };
    mode = 'source';
  }

  async function openEditor(focus: boolean): Promise<void> {
    await tick();
    if (!host) return;
    const gen = ++generation;
    original = value;
    try {
      const h = await createTxmdEditor({ root: host, txmd: value, load: { langs }, onDoc, onState, onKeyDown });
      if (gen !== generation) {
        await h.destroy();
        return;
      }
      const check = verifyRoundTrip(value, h.view.state.schema, { langs });
      if (!check.ok) {
        await h.destroy();
        if (host) host.textContent = '';
        fallback(check.reason ?? '왕복 검사 실패');
        return;
      }
      handle = h;
      view = h.view;
      (h.view.dom as HTMLElement & { __txView?: EditorView }).__txView = h.view; // e2e·디버깅용 참조
      baseline = check.out;
      ready = true;
      ui = computeUi(h.view.state);
      if (focus) h.view.focus();
    } catch (e) {
      if (host) host.textContent = '';
      fallback(e instanceof Error ? e.message : String(e), 'err');
    }
  }

  async function closeEditor() {
    generation++;
    clearTimeout(verifyTimer);
    ready = false;
    const h = handle;
    handle = null;
    view = null;
    ui = null;
    slash = null;
    closePops();
    if (h) {
      try {
        await h.destroy();
      } catch {
        /* 이미 정리됨 */
      }
    }
  }

  async function toSource() {
    // value 는 편집할 때마다 이미 갱신돼 있다
    await closeEditor();
    notice = null;
    mode = 'source';
    G.__txEditorMode = 'source';
    await tick();
    srcEl?.focus();
  }

  async function toWysiwyg() {
    notice = null;
    stableWarn = null;
    mode = 'wysiwyg';
    G.__txEditorMode = 'wysiwyg';
    await openEditor(true);
    if ((mode as Mode) === "source") G.__txEditorMode = "source"; // 폴백: 다음에도 원문으로 열린다
  }

  onMount(() => {
    if (mode === 'wysiwyg') {
      // 초안 화면이 열릴 때 첫 포커스 가능 요소(돌아가기 버튼 등)를 잡을 수 있으므로, 에디터가 준비되면 입력창으로 옮긴다
      void openEditor(false).then(() => {
        // 사용자가 아직 이 컴포넌트를 건드리지 않았다면 입력창으로
        if (autofocus && view && !touched) view.focus();
      });
    }
  });

  onDestroy(() => {
    generation++;
    clearTimeout(verifyTimer);
    void handle?.destroy();
  });

  /* ---- 에디터 → value */

  function onDoc(doc: Parameters<typeof docToTxmd>[0], v: EditorView) {
    if (!ready) return;
    try {
      const out = docToTxmd(doc);
      // 편집이 없는 정규화(자동 보정 등)로는 원문을 바꾸지 않는다. 편집했다가 되돌리면 원문으로 복원된다.
      value = out === baseline ? original : out;
      clearTimeout(verifyTimer);
      verifyTimer = setTimeout(() => {
        if (!view) return;
        const r = verifyDocStable(view.state.doc, view.state.schema, { langs });
        stableWarn = r.ok ? null : r.reason ?? null;
      }, 350);
    } catch (e) {
      // 직렬화 실패: 마지막 정상 글(value)을 그대로 두고 원문 모드로
      void closeEditor().then(() => fallback('직렬화 중 오류 — 마지막 정상 내용으로 복구했습니다: ' + (e instanceof Error ? e.message : String(e)), 'err'));
    }
  }

  function onState(v: EditorView) {
    ui = computeUi(v.state);
    updateSlash(v);
  }

  /* ---- 슬래시 메뉴 */

  let slash = $state.raw<(SlashState & { left: number; top: number }) | null>(null);
  let slashIdx = $state(0);
  let wrapEl = $state<HTMLDivElement>();
  const slashItems = $derived(slash ? filterItems(SLASH_ITEMS, slash.query) : []);

  function updateSlash(v: EditorView) {
    const s = v.hasFocus() ? slashAt(v.state) : null;
    if (!s || !filterItems(SLASH_ITEMS, s.query).length) {
      slash = null;
      return;
    }
    const c = v.coordsAtPos(s.to);
    const w = wrapEl?.getBoundingClientRect();
    const prev = slash;
    slash = { ...s, left: c.left - (w?.left ?? 0), top: c.bottom - (w?.top ?? 0) + 4 };
    if (!prev || prev.query !== s.query) slashIdx = 0;
  }

  function onKeyDown(v: EditorView, e: KeyboardEvent): boolean {
    if (!slash) return false;
    const items = slashItems;
    if (e.key === 'ArrowDown') {
      slashIdx = (slashIdx + 1) % items.length;
      return true;
    }
    if (e.key === 'ArrowUp') {
      slashIdx = (slashIdx - 1 + items.length) % items.length;
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const it = items[slashIdx];
      if (!it) return false;
      pickSlash(it);
      return true;
    }
    if (e.key === 'Escape') {
      slash = null;
      e.stopPropagation(); // 메뉴만 닫는다(초안 화면은 닫지 않는다)
      return true;
    }
    return false;
  }

  function pickSlash(it: MenuItem) {
    if (!view || !slash) return;
    const { from, to } = slash;
    slash = null;
    view.dispatch(view.state.tr.delete(from, to));
    runItem(it.id);
  }

  /* ---- 명령 실행 */

  const S = () => view!.state.schema;

  function exec(cmd: (state: any, dispatch?: any, v?: any) => boolean) {
    if (!view) return;
    cmd(view.state, view.dispatch.bind(view), view);
    view.focus();
  }

  function runItem(itemId: string) {
    if (!view) return;
    const v = view;
    const s = v.state.schema;
    const [kind, arg] = itemId.split(':');
    const dispatch = v.dispatch.bind(v);
    switch (kind) {
      case 'callout':
        insertBlock(v.state, dispatch, makeCallout(s, arg));
        break;
      case 'table-v':
        insertBlock(v.state, dispatch, makeVerticalTable(s));
        break;
      case 'table-h':
        insertBlock(v.state, dispatch, makeHorizontalTable(s));
        break;
      case 'table-dyn': {
        // 동적 표는 콜아웃 안에서 지원되지 않는다(파서가 정적 표로 낮춘다) — 콜아웃 안이면 콜아웃 뒤에 넣는다
        const outer = findAncestor(v.state, 'callout');
        if (outer) {
          const tr = v.state.tr;
          tr.setSelection(Selection.near(tr.doc.resolve(outer.pos + outer.node.nodeSize), 1));
          dispatch(tr);
        }
        insertBlock(v.state, dispatch, makeDynamicTable(s, nextDynId(v.state.doc)));
        break;
      }
      case 'button':
        insertBlock(v.state, dispatch, makeButtonGroup(s));
        break;
      case 'quote':
        insertBlock(v.state, dispatch, makeQuote(s));
        break;
      case 'hr':
        insertBlock(v.state, dispatch, makeHr(s), 'after');
        break;
      case 'h1':
      case 'h2':
      case 'h3':
        setBlockType(s.nodes.heading, { level: Number(kind[1]) })(v.state, dispatch);
        break;
      case 'bullet':
        wrapInList(s.nodes.bullet_list)(v.state, dispatch);
        break;
      case 'ordered':
        wrapInList(s.nodes.ordered_list)(v.state, dispatch);
        break;
    }
    v.focus();
  }

  function setHeading(level: 1 | 2 | 3) {
    if (!view) return;
    const s = S();
    if (ui?.block === `h${level}`) setBlockType(s.nodes.paragraph)(view.state, view.dispatch.bind(view));
    else setBlockType(s.nodes.heading, { level })(view.state, view.dispatch.bind(view));
    view.focus();
  }

  function toggleList(kind: 'bullet' | 'ordered') {
    if (!view) return;
    const s = S();
    if (ui?.inList === kind) liftListItem(s.nodes.list_item)(view.state, view.dispatch.bind(view));
    else wrapInList(kind === 'bullet' ? s.nodes.bullet_list : s.nodes.ordered_list)(view.state, view.dispatch.bind(view));
    view.focus();
  }

  function toggleQuote() {
    if (!view) return;
    if (ui?.inQuote) lift(view.state, view.dispatch.bind(view));
    else wrapIn(S().nodes.blockquote)(view.state, view.dispatch.bind(view));
    view.focus();
  }

  const mark = (name: string) => exec(toggleMark(S().marks[name]));

  function removeSelectedBlock(names: string[]) {
    if (!view) return;
    const f = selectedOrAncestor(view.state, names);
    if (!f) return;
    view.dispatch(view.state.tr.delete(f.pos, f.pos + f.node.nodeSize).scrollIntoView());
    view.focus();
  }

  /* ---- 팝오버(삽입 메뉴 · 치환자 · 행 변수 · 링크) */

  let pop = $state<'insert' | 'ph' | 'rv' | 'link' | null>(null);
  let phQuery = $state('');
  let linkHref = $state('');
  let insertBtn = $state<HTMLButtonElement>();
  let phBtn = $state<HTMLButtonElement>();
  let rvBtn = $state<HTMLButtonElement>();
  let linkBtn = $state<HTMLButtonElement>();

  function closePops(refocus = false) {
    const was = pop;
    pop = null;
    if (refocus && view) view.focus();
    return was;
  }

  async function openPop(which: 'insert' | 'ph' | 'rv' | 'link') {
    if (pop === which) {
      closePops(true);
      return;
    }
    pop = which;
    phQuery = '';
    if (which === 'link') linkHref = ui?.link ?? '';
    await tick();
    const first = document.querySelector<HTMLElement>(`[data-pop="${which}"] [data-first]`);
    first?.focus();
  }

  function onPopKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePops(true);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const root = e.currentTarget as HTMLElement;
      const items = [...root.querySelectorAll<HTMLElement>('[data-item]')];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next < 0 ? 0 : next].focus();
    }
  }

  function pickInsert(it: MenuItem) {
    pop = null;
    runItem(it.id);
  }

  const VALID_NAME = /^[a-zA-Z0-9_가-힣.\-]+$/;

  const docVars = $derived.by(() => {
    const names = new Map<string, string>();
    for (const v of variables) names.set(v.name, v.description ?? '');
    return names;
  });
  const phList = $derived.by(() => {
    const q = phQuery.trim().toLowerCase();
    const all = [...docVars.entries()].map(([name, description]) => ({ name, description }));
    return q ? all.filter((v) => (v.name + ' ' + v.description).toLowerCase().includes(q)) : all;
  });
  const phExact = $derived(phQuery.trim() !== '' && VALID_NAME.test(phQuery.trim()) && !docVars.has(phQuery.trim()));

  function insertPh(name: string) {
    if (!view) return;
    pop = null;
    insertInlineAtom('placeholder', name)(view.state, view.dispatch.bind(view));
    view.focus();
  }

  let rvName = $state('');
  function insertRv(name: string) {
    if (!view || !VALID_NAME.test(name)) return;
    pop = null;
    insertInlineAtom('rowvar', name)(view.state, view.dispatch.bind(view));
    rvName = '';
    view.focus();
  }

  /** 동적 표 안에서 이미 쓰인 행 변수 이름과 @var 로 선언된 이름 */
  const rvNames = $derived.by(() => {
    if (!view || pop !== 'rv') return [] as string[];
    const names = new Set<string>();
    view.state.doc.descendants((n) => {
      if (n.type.name === 'rowvar') names.add(String(n.attrs.name));
      if (n.type.name === 'txmd_raw') for (const m of n.textContent.matchAll(/^@var[ \t]+(\S+)/gm)) names.add(m[1]);
    });
    return [...names];
  });

  function applyLink(href: string) {
    if (!view) return;
    const type = S().marks.link;
    const { from, to, empty } = view.state.selection;
    pop = null;
    let tr = view.state.tr;
    if (empty) {
      // 커서 아래 링크 전체를 대상으로
      const rp = view.state.doc.resolve(from);
      const m = type.isInSet(rp.marks());
      if (m) {
        let a = from;
        let b = from;
        const par = rp.parent;
        const start = rp.start();
        par.forEach((child, off) => {
          if (type.isInSet(child.marks) && start + off <= from && from <= start + off + child.nodeSize) {
            a = start + off;
            b = start + off + child.nodeSize;
          }
        });
        tr = tr.removeMark(a, b, type);
        if (href.trim()) tr = tr.addMark(a, b, type.create({ href: href.trim() }));
      }
    } else {
      tr = tr.removeMark(from, to, type);
      if (href.trim()) tr = tr.addMark(from, to, type.create({ href: href.trim() }));
    }
    view.dispatch(tr);
    view.focus();
  }

  /* ---- 툴바 로빙 탭인덱스 */

  let toolbarEl = $state<HTMLDivElement>();
  let rovingEl: HTMLElement | null = null;

  function toolbarButtons(): HTMLElement[] {
    return toolbarEl ? [...toolbarEl.querySelectorAll<HTMLElement>('[data-tb]')].filter((b) => !(b as HTMLButtonElement).disabled) : [];
  }

  function onToolbarKey(e: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const btns = toolbarButtons();
    if (!btns.length) return;
    const cur = btns.indexOf(document.activeElement as HTMLElement);
    if (cur < 0) return;
    e.preventDefault();
    let next = cur;
    if (e.key === 'ArrowRight') next = (cur + 1) % btns.length;
    else if (e.key === 'ArrowLeft') next = (cur - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') next = 0;
    else next = btns.length - 1;
    btns[next].focus();
  }

  /** 툴바는 탭 정지점이 하나(마지막으로 포커스한 버튼). 방향키로 버튼 사이를 이동한다 */
  function syncRoving() {
    const btns = toolbarButtons();
    for (const b of toolbarEl?.querySelectorAll<HTMLElement>('[data-tb]') ?? []) b.tabIndex = -1;
    const pick = rovingEl && btns.includes(rovingEl) ? rovingEl : btns[0];
    if (pick) pick.tabIndex = 0;
  }
  function onToolbarFocusIn(e: FocusEvent) {
    const t = e.target as HTMLElement;
    if (t.hasAttribute('data-tb')) {
      rovingEl = t;
      syncRoving();
    }
  }
  $effect(() => {
    void ready;
    void ui;
    void mode;
    void pop;
    void tick().then(syncRoving);
  });

  $effect(() => {
    // 슬래시 메뉴가 열려 있는 동안 스크린 리더가 선택 항목을 읽도록
    const dom = view?.dom;
    if (!dom) return;
    const cur = slash && slashItems[slashIdx];
    if (cur) {
      dom.setAttribute('aria-activedescendant', 'tx-slash-' + cur.id);
      dom.setAttribute('aria-expanded', 'true');
    } else {
      dom.removeAttribute('aria-activedescendant');
      dom.removeAttribute('aria-expanded');
    }
  });

  // 스크롤바 폭을 실측해 도구줄·글 컬럼의 좌우 위치를 맞춘다(scrollbar-gutter: stable 이라 내용 길이와 무관하게 일정)
  $effect(() => {
    const el = mode === 'source' ? srcEl : host;
    if (!el || !wrapEl) return;
    wrapEl.style.setProperty('--tx-sbw', el.offsetWidth - el.clientWidth + 'px');
  });

  const noFocusSteal = (e: MouseEvent) => e.preventDefault();
  const dis = $derived(!ready);

  const MOD = typeof navigator !== 'undefined' && /Mac|iPhone/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const STYLE_LABEL: Record<string, string> = { '': '자동', primary: 'primary (주요)', secondary: 'secondary (보조)', outline: 'outline (윤곽)', warn: 'warn (경고)' };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tx-ed" data-mode={mode} bind:this={wrapEl} onpointerdowncapture={() => (touched = true)} onkeydowncapture={() => (touched = true)}>
  <div class="tx-bar" role="toolbar" aria-label="초안 서식 도구" tabindex="-1" bind:this={toolbarEl} onkeydown={onToolbarKey} onfocusin={onToolbarFocusIn}>
    {#if mode === 'wysiwyg'}
      <div class="tx-grp" role="group" aria-label="문단">
        <button type="button" data-tb aria-label="제목 1" title="제목 1 ({MOD}+Alt+1) — 콜아웃 안에서는 제목 3 만" aria-pressed={ui?.block === 'h1'} disabled={dis || !!ui?.callout} onmousedown={noFocusSteal} onclick={() => setHeading(1)}>H1</button>
        <button type="button" data-tb aria-label="제목 2" title="제목 2 ({MOD}+Alt+2) — 콜아웃 안에서는 제목 3 만" aria-pressed={ui?.block === 'h2'} disabled={dis || !!ui?.callout} onmousedown={noFocusSteal} onclick={() => setHeading(2)}>H2</button>
        <button type="button" data-tb aria-label="제목 3" title="제목 3 ({MOD}+Alt+3)" aria-pressed={ui?.block === 'h3'} disabled={dis} onmousedown={noFocusSteal} onclick={() => setHeading(3)}>H3</button>
      </div>
      <div class="tx-grp" role="group" aria-label="글자 서식">
        <button type="button" data-tb aria-label="굵게" title="굵게 ({MOD}+B)" aria-pressed={ui?.bold} disabled={dis} onmousedown={noFocusSteal} onclick={() => mark('strong')}><b>B</b></button>
        <button type="button" data-tb aria-label="기울임" title="기울임 ({MOD}+I)" aria-pressed={ui?.italic} disabled={dis} onmousedown={noFocusSteal} onclick={() => mark('emphasis')}><i>I</i></button>
        <button type="button" data-tb aria-label="취소선" title="취소선 ({MOD}+Shift+X)" aria-pressed={ui?.strike} disabled={dis} onmousedown={noFocusSteal} onclick={() => mark('strike_through')}><s>S</s></button>
        <button type="button" data-tb aria-label="링크" title="링크 설정" aria-pressed={!!ui?.link} aria-haspopup="dialog" aria-expanded={pop === 'link'} disabled={dis || (!!ui?.selEmpty && ui?.link === null)} bind:this={linkBtn} onmousedown={noFocusSteal} onclick={() => openPop('link')}>링크</button>
      </div>
      <div class="tx-grp" role="group" aria-label="목록·인용">
        <button type="button" data-tb aria-label="글머리 목록" title="글머리 목록 (Tab = 한 단계 들여쓰기)" aria-pressed={ui?.inList === 'bullet'} disabled={dis} onmousedown={noFocusSteal} onclick={() => toggleList('bullet')}>• 목록</button>
        <button type="button" data-tb aria-label="번호 목록" title="번호 목록" aria-pressed={ui?.inList === 'ordered'} disabled={dis} onmousedown={noFocusSteal} onclick={() => toggleList('ordered')}>1. 목록</button>
        <button type="button" data-tb aria-label="인용" title="인용" aria-pressed={ui?.inQuote} disabled={dis} onmousedown={noFocusSteal} onclick={toggleQuote}>인용</button>
      </div>
      <div class="tx-grp" role="group" aria-label="삽입">
        <div class="tx-popwrap">
          <button type="button" data-tb aria-label="블록 삽입" title="블록 삽입 (빈 줄에서 / 입력)" aria-haspopup="menu" aria-expanded={pop === 'insert'} disabled={dis} bind:this={insertBtn} onmousedown={noFocusSteal} onclick={() => openPop('insert')}>+ 삽입 ▾</button>
          {#if pop === 'insert'}
            <!-- svelte-ignore a11y_interactive_supports_focus -->
            <div class="tx-pop" role="menu" aria-label="블록 삽입" data-pop="insert" onkeydown={onPopKey}>
              {#each BLOCK_ITEMS as it, i (it.id)}
                <button type="button" role="menuitem" data-item data-first={i === 0 ? '' : undefined} onclick={() => pickInsert(it)}>
                  <span>{it.label}</span>{#if it.hint}<small>{it.hint}</small>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="tx-popwrap">
          <button type="button" data-tb aria-label="치환자 삽입" title="치환자 |!#-이름| 삽입" aria-haspopup="dialog" aria-expanded={pop === 'ph'} disabled={dis || !ui?.inline} bind:this={phBtn} onmousedown={noFocusSteal} onclick={() => openPop('ph')}>|!#-x| 치환자</button>
          {#if pop === 'ph'}
            <!-- svelte-ignore a11y_interactive_supports_focus -->
            <div class="tx-pop wide" role="dialog" aria-label="치환자 삽입" data-pop="ph" onkeydown={onPopKey}>
              <input type="text" data-first placeholder="치환자 검색 또는 새 이름" aria-label="치환자 검색" bind:value={phQuery} onkeydown={(e) => {
                if (e.key === 'Enter' && !e.isComposing) {
                  e.preventDefault();
                  if (phList[0]) insertPh(phList[0].name);
                  else if (phExact) insertPh(phQuery.trim());
                }
              }} />
              <div class="tx-list" role="group" aria-label="치환자 목록">
                {#each phList as v (v.name)}
                  <button type="button" data-item onclick={() => insertPh(v.name)}><code>|!#-{v.name}|</code>{#if v.description}<small>{v.description}</small>{/if}</button>
                {/each}
                {#if phExact}
                  <button type="button" data-item onclick={() => insertPh(phQuery.trim())}>새 치환자 <code>|!#-{phQuery.trim()}|</code> 로 입력</button>
                {/if}
                {#if !phList.length && !phExact}<p class="tx-empty">일치하는 치환자가 없습니다. 영문·숫자·_·한글로 이름을 입력하면 새로 넣을 수 있습니다.</p>{/if}
              </div>
            </div>
          {/if}
        </div>
        <div class="tx-popwrap">
          <button type="button" data-tb aria-label="행 변수 삽입" title="동적 표 행 변수 {'{{'}이름{'}}'} (동적 표 안에서만)" aria-haspopup="dialog" aria-expanded={pop === 'rv'} disabled={dis || !ui?.inDynamic} bind:this={rvBtn} onmousedown={noFocusSteal} onclick={() => openPop('rv')}>{'{{'}행 변수{'}}'}</button>
          {#if pop === 'rv'}
            <!-- svelte-ignore a11y_interactive_supports_focus -->
            <div class="tx-pop wide" role="dialog" aria-label="행 변수 삽입" data-pop="rv" onkeydown={onPopKey}>
              <input type="text" data-first placeholder="행 변수 이름" aria-label="행 변수 이름" bind:value={rvName} onkeydown={(e) => {
                if (e.key === 'Enter' && !e.isComposing) {
                  e.preventDefault();
                  insertRv(rvName.trim());
                }
              }} />
              <div class="tx-list" role="group" aria-label="행 변수 목록">
                {#each rvNames as n (n)}<button type="button" data-item onclick={() => insertRv(n)}><code>{'{{'}{n}{'}}'}</code></button>{/each}
                {#if rvName.trim() && VALID_NAME.test(rvName.trim())}<button type="button" data-item onclick={() => insertRv(rvName.trim())}>새 행 변수 <code>{'{{'}{rvName.trim()}{'}}'}</code></button>{/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
      <div class="tx-grp" role="group" aria-label="실행 취소">
        <button type="button" data-tb aria-label="실행 취소" title="실행 취소 ({MOD}+Z)" disabled={dis} onmousedown={noFocusSteal} onclick={() => exec(undo)}>↶</button>
        <button type="button" data-tb aria-label="다시 실행" title="다시 실행 ({MOD}+Y)" disabled={dis} onmousedown={noFocusSteal} onclick={() => exec(redo)}>↷</button>
      </div>
    {/if}
    <span class="tx-sp"></span>
    <button type="button" class="tx-src" data-tb aria-pressed={mode === 'source'} aria-label="소스 보기 (.txmd 직접 편집)" title="에디터 ⇄ .txmd 원문. 두 모드는 같은 내용을 공유합니다" onclick={() => (mode === 'source' ? toWysiwyg() : toSource())}>
      소스 보기
    </button>
  </div>

  {#if mode === 'wysiwyg' && ready && ui}
    {#if ui.callout || ui.table || ui.button || ui.link !== null}
      <div class="tx-ctx" role="group" aria-label="선택한 블록 설정">
        {#if ui.callout}
          <span class="tx-ctxg" role="group" aria-label="콜아웃 종류">
            <span class="tx-lbl">콜아웃 종류</span>
            {#each CALLOUT_KINDS as k}
              <button type="button" aria-pressed={ui.callout === k} onmousedown={noFocusSteal} onclick={() => exec(setNodeAttrs('callout', { kind: k }))}>{k}</button>
            {/each}
            <button type="button" class="tx-del" aria-label="콜아웃 삭제" onmousedown={noFocusSteal} onclick={() => removeSelectedBlock(['callout'])}>삭제</button>
          </span>
        {/if}
        {#if ui.table}
          <span class="tx-ctxg" role="group" aria-label="표 편집">
            <span class="tx-lbl">{ui.table.type === 'h' ? (ui.table.dyn ? '동적 표' : '가로형 표') : '세로형 표'}</span>
            <button type="button" disabled={!ui.table.canAddRow} onmousedown={noFocusSteal} onclick={() => exec(addTableRow)}>행 추가</button>
            <button type="button" disabled={!ui.table.canDeleteRow} onmousedown={noFocusSteal} onclick={() => exec(deleteTableRow)}>행 삭제</button>
            {#if ui.table.type === 'h'}
              <button type="button" disabled={!ui.table.canAddCol} onmousedown={noFocusSteal} onclick={() => exec(addTableColumn)}>열 추가</button>
              <button type="button" disabled={!ui.table.canDeleteCol} onmousedown={noFocusSteal} onclick={() => exec(deleteTableColumn)}>열 삭제</button>
              <label class="tx-field">동적 표 id
                <input type="text" value={ui.table.dyn ?? ''} placeholder="(정적 표)" aria-label="동적 표 id (비우면 정적 표)" maxlength="40"
                  onchange={(e) => exec(setNodeAttrs('table_h', { dyn: /^[A-Za-z0-9_-]+$/.test(e.currentTarget.value.trim()) ? e.currentTarget.value.trim() : null }))} />
              </label>
            {/if}
            <button type="button" class="tx-del" aria-label="표 삭제" onmousedown={noFocusSteal} onclick={() => removeSelectedBlock(['table_h', 'table_v'])}>표 삭제</button>
          </span>
        {/if}
        {#if ui.button}
          <span class="tx-ctxg" role="group" aria-label="버튼 설정">
            <span class="tx-lbl">버튼</span>
            <label class="tx-field">링크 URL
              <input type="text" value={ui.button.url} aria-label="버튼 링크 URL" onchange={(e) => exec(setNodeAttrs('button', { url: e.currentTarget.value.trim() }))} />
            </label>
            <label class="tx-field">스타일
              <select aria-label="버튼 스타일" value={ui.button.style} onchange={(e) => exec(setNodeAttrs('button', { style: e.currentTarget.value }))}>
                {#each ['', ...BUTTON_STYLES] as st}<option value={st}>{STYLE_LABEL[st]}</option>{/each}
              </select>
            </label>
          </span>
        {/if}
        {#if ui.link !== null}
          <span class="tx-ctxg" role="group" aria-label="링크">
            <span class="tx-lbl">링크</span>
            <code class="tx-url">{ui.link}</code>
            <button type="button" onmousedown={noFocusSteal} onclick={() => openPop('link')}>주소 바꾸기</button>
            <button type="button" onmousedown={noFocusSteal} onclick={() => applyLink('')}>링크 제거</button>
          </span>
        {/if}
      </div>
    {/if}
  {/if}

  {#if pop === 'link' && mode === 'wysiwyg'}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="tx-linkpop" role="dialog" aria-label="링크 주소" data-pop="link" onkeydown={onPopKey}>
      <label class="tx-field">링크 주소
        <input type="text" data-first bind:value={linkHref} placeholder="https://… 또는 |!#-url|" onkeydown={(e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            applyLink(linkHref);
          }
        }} />
      </label>
      <button type="button" class="tx-ok" onclick={() => applyLink(linkHref)}>적용</button>
      <button type="button" onclick={() => closePops(true)}>취소</button>
    </div>
  {/if}

  {#if mode === 'wysiwyg'}
    <div class="tx-host" bind:this={host} class:loading={!ready}></div>
    {#if !ready && !notice}<p class="tx-note" role="status">에디터를 불러오는 중…</p>{/if}
    {#if slash && slashItems.length}
      <div class="tx-slash" role="listbox" aria-label="블록 삽입 (슬래시 메뉴)" style:left="{slash.left}px" style:top="{slash.top}px">
        {#each slashItems as it, i (it.id)}
          <div role="option" tabindex="-1" id="tx-slash-{it.id}" aria-selected={i === slashIdx} class:on={i === slashIdx} onmousedown={(e) => { e.preventDefault(); pickSlash(it); }}>
            <span>{it.label}</span>{#if it.hint}<small>{it.hint}</small>{/if}
          </div>
        {/each}
      </div>
    {/if}
    <p class="tx-help">
      Enter = 새 문단 · Shift+Enter = 줄바꿈 · 빈 줄에서 <kbd>/</kbd> = 블록 삽입 · 표 안 Tab = 다음 칸(표 밖으로는 ↓ 방향키) · 번역 줄(@en/@ja)은 접힌 회색 줄로 보존됩니다
    </p>
  {:else}
    <textarea {id} class="draft" lang="ko" spellcheck="false" aria-label=".txmd 초안 원문" bind:value bind:this={srcEl}></textarea>
  {/if}

  {#if notice}<p class="banner {notice.kind === 'err' ? 'ban-err' : 'ban-warn'}" role="alert">{notice.text}</p>{/if}
  {#if mode === 'wysiwyg' && stableWarn}<p class="banner ban-warn" role="status">에디터 내용을 .txmd 로 바꾸면 다시 읽을 때 달라질 수 있습니다 — {stableWarn}</p>{/if}
</div>

<style>
  /*
   * 초안 화면 전체를 채우는 문서 편집기. 도구줄·문맥 막대는 영역 전체 폭의 고정 바(좌우 14px)이고, 본문·소스 보기는 스크롤 영역이
   * 전체 폭을 쓰되 글이 놓이는 컬럼만 최대 폭(--tx-col)으로 가운데 정렬하고 컬럼 안쪽 좌우에 여백(--tx-pad)을 둔다(스크롤바는 영역 가장자리).
   * (도구줄은 한 줄에 ~700px 가 필요해 글 컬럼 폭(720px)에 맞추면 두 줄로 접히므로 컬럼에 맞추지 않는다.)
   * --tx-gl  : 폭 W(스크롤바 포함) 컨테이너(소스 보기 textarea·도움말·배너)의 좌우 padding/margin 이 컬럼 글 가장자리를 만들도록 하는 값
   * --tx-gl-in: 스크롤 영역 안쪽(스크롤바 제외 폭) 컨테이너용 같은 값
   * --tx-sbw : 스크롤바 폭(마운트 때 실측; scrollbar-gutter: stable 이라 항상 같다)
   * 너비 40px 안쪽 여백 + 800px 컬럼 = 글 폭 720px(한글 14~15px 기준 한 줄 약 48~52자). 600px 이하에서는 안쪽 여백 16px.
   */
  .tx-ed {
    --tx-col: 800px;
    --tx-pad: 40px;
    --tx-sbw: 0px;
    --tx-gl: max(var(--tx-pad), calc((100% - var(--tx-sbw) - var(--tx-col)) / 2 + var(--tx-pad)));
    --tx-gl-in: max(var(--tx-pad), calc((100% - var(--tx-col)) / 2 + var(--tx-pad)));
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
  @media (max-width: 600px) {
    .tx-ed {
      --tx-pad: 16px;
    }
  }
  /* 문서 영역(.tx-pm)이 남는 높이를 끝까지 채워 빈 곳을 눌러도 입력창에 닿고 포커스 테두리가 전체를 두른다 */
  .tx-host {
    flex: 1 1 0;
    min-height: 260px;
    overflow: auto;
    scrollbar-gutter: stable;
    background: var(--surface);
    display: flex;
    flex-direction: column;
  }
  .tx-host :global(.milkdown) {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }
  .tx-host :global(.tx-pm) {
    flex: 1 0 auto;
  }
  textarea.draft {
    flex: 1 1 0;
    min-height: 260px;
    resize: none;
    border: 0;
    border-radius: 0;
    background: var(--surface);
    padding: 28px var(--tx-gl) 40px;
    scrollbar-gutter: stable;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.65;
    tab-size: 2;
  }
  textarea.draft:focus-visible {
    outline-offset: -2px;
  }
  .tx-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    padding: 5px 14px;
    background: var(--surface2);
    border-bottom: 1px solid var(--line);
  }
  .tx-grp {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding-right: 8px;
    border-right: 1px solid var(--line2);
  }
  .tx-sp {
    flex: 1;
  }
  .tx-bar button,
  .tx-ctx button,
  .tx-linkpop button {
    cursor: pointer;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 5px;
    padding: 3px 8px;
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--ink);
    white-space: nowrap;
  }
  .tx-bar button:hover:not([disabled]),
  .tx-ctx button:hover:not([disabled]),
  .tx-linkpop button:hover {
    background: var(--accent-soft);
    border-color: var(--line);
  }
  .tx-bar button[aria-pressed='true'],
  .tx-ctx button[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .tx-bar button[disabled],
  .tx-ctx button[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .tx-bar button:focus-visible,
  .tx-ctx button:focus-visible,
  .tx-linkpop button:focus-visible,
  .tx-pop button:focus-visible,
  .tx-bar input:focus-visible,
  .tx-ctx input:focus-visible,
  .tx-ctx select:focus-visible,
  .tx-linkpop input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .tx-src {
    margin-left: auto; /* 줄이 접혀 혼자 남아도 오른쪽 끝에 둔다 */
    border-color: var(--line) !important;
    background: var(--surface) !important;
  }
  .tx-src[aria-pressed='true'] {
    background: var(--accent) !important;
    color: var(--accent-ink) !important;
  }
  .tx-popwrap {
    position: relative;
  }
  .tx-pop {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 0;
    min-width: 230px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .tx-pop.wide {
    min-width: 300px;
    gap: 4px;
    padding: 8px;
  }
  .tx-pop > button,
  .tx-list > button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    text-align: left;
    width: 100%;
  }
  .tx-pop small,
  .tx-slash small,
  .tx-list small {
    color: var(--muted);
    font-size: 11px;
  }
  .tx-list {
    display: flex;
    flex-direction: column;
    max-height: 220px;
    overflow: auto;
  }
  .tx-empty {
    margin: 4px;
    color: var(--muted);
    font-size: 12px;
  }
  .tx-ctx {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    padding: 5px 14px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--line);
    font-size: 12.5px;
  }
  .tx-ctxg {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .tx-lbl {
    font-weight: 600;
    color: var(--ink);
    margin-right: 2px;
  }
  :global(:root[data-theme='dark']) .tx-lbl,
  :global(:root:not([data-theme='light'])) .tx-lbl {
    color: var(--ink);
  }
  .tx-ctx button {
    border-color: var(--line);
    background: var(--surface);
  }
  .tx-del {
    color: var(--err) !important;
  }
  .tx-field {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--muted);
  }
  .tx-field input,
  .tx-field select {
    width: auto;
    min-width: 120px;
    padding: 2px 6px;
    font-size: 12.5px;
  }
  .tx-url {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tx-linkpop {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--accent);
    background: var(--surface);
  }
  .tx-linkpop .tx-field {
    flex: 1;
  }
  .tx-linkpop .tx-field input {
    flex: 1;
  }
  .tx-linkpop button {
    border-color: var(--line);
  }
  .tx-linkpop .tx-ok {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .tx-host.loading {
    opacity: 0.5;
  }
  .tx-note,
  .tx-help {
    margin: 0;
    padding: 6px calc(var(--tx-gl) + var(--tx-sbw)) 6px var(--tx-gl);
    border-top: 1px solid var(--line);
    font-size: 11.5px;
    color: var(--muted);
  }
  .tx-ed > .banner {
    margin: 8px calc(var(--tx-gl) + var(--tx-sbw)) 8px var(--tx-gl);
  }
  .tx-slash {
    position: absolute;
    z-index: 40;
    min-width: 240px;
    max-height: 260px;
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    padding: 4px;
  }
  .tx-slash [role='option'] {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 4px 8px;
    border-radius: 5px;
    cursor: pointer;
  }
  .tx-slash [role='option'].on {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .tx-slash [role='option'].on small {
    color: inherit;
    opacity: 0.85;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 11px;
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 0 4px;
    background: var(--surface2);
  }

  /* ---------------------------------------------------------------- 문서 본문(ProseMirror) */
  .tx-host :global(.tx-pm) {
    outline: none;
    padding: 28px var(--tx-gl-in) 40px;
    font-size: 15px;
    line-height: 1.7;
    color: var(--ink);
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .tx-host :global(.tx-pm:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .tx-host :global(.tx-pm > *:first-child) {
    margin-top: 0;
  }
  .tx-host :global(.tx-pm p) {
    margin: 0 0 0.7em;
  }
  .tx-host :global(.tx-pm h1) {
    font-size: 1.5em;
    margin: 0.4em 0 0.4em;
    color: var(--ink);
  }
  .tx-host :global(.tx-pm h2) {
    font-size: 1.25em;
    margin: 0.4em 0;
  }
  .tx-host :global(.tx-pm h3) {
    font-size: 1.08em;
    margin: 0.4em 0;
  }
  :global(:root[data-theme='dark']) .tx-host :global(.tx-pm h1) {
    color: var(--ink);
  }
  .tx-host :global(.tx-pm ul),
  .tx-host :global(.tx-pm ol) {
    margin: 0 0 0.7em;
    padding-left: 1.6em;
  }
  .tx-host :global(.tx-pm li) {
    margin: 0.1em 0;
  }
  .tx-host :global(.tx-pm li > p) {
    margin: 0;
  }
  .tx-host :global(.tx-pm blockquote.tx-quote) {
    margin: 0 0 0.7em;
    padding: 10px 16px;
    color: var(--muted);
    background: var(--surface2);
    border-radius: 6px;
  }
  .tx-host :global(.tx-pm blockquote p) {
    margin: 0.2em 0;
    text-align: center;
  }
  .tx-host :global(.tx-pm hr) {
    border: none;
    border-top: 1px solid var(--line);
    margin: 0.9em 0;
  }
  .tx-host :global(.tx-pm a) {
    color: var(--accent);
    text-decoration: underline;
  }
  .tx-host :global(.tx-pm del) {
    text-decoration: line-through;
    opacity: 0.8;
  }
  .tx-host :global(.tx-pm .ProseMirror-selectednode) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .tx-host :global(.ProseMirror-gapcursor) {
    display: none;
    pointer-events: none;
    position: absolute;
  }
  .tx-host :global(.ProseMirror-gapcursor:after) {
    content: '';
    display: block;
    position: absolute;
    top: -2px;
    width: 20px;
    border-top: 1px solid var(--ink);
    animation: tx-blink 1.1s steps(2, start) infinite;
  }
  .tx-host :global(.ProseMirror-focused .ProseMirror-gapcursor) {
    display: block;
  }
  @keyframes tx-blink {
    to {
      visibility: hidden;
    }
  }

  /* 치환자 · 행 변수 칩 (편집 불가 토큰) */
  .tx-host :global(.tx-ph),
  .tx-host :global(.tx-rv) {
    display: inline-block;
    padding: 0 6px;
    margin: 0 1px;
    border-radius: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    user-select: all;
    cursor: default;
    border: 1px solid transparent;
  }
  .tx-host :global(.tx-ph) {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
  }
  .tx-host :global(.tx-rv) {
    background: var(--ok-bg);
    color: var(--ok);
    border-color: var(--ok);
  }

  /* 콜아웃 */
  .tx-host :global(.tx-callout) {
    margin: 0 0 0.9em;
    border-radius: 6px;
    border: 1px solid var(--line);
    border-left-width: 4px;
    padding: 6px 12px 6px;
    background: var(--surface2);
  }
  .tx-host :global(.tx-callout-info) {
    border-left-color: var(--accent);
    background: var(--accent-soft);
  }
  .tx-host :global(.tx-callout-warn) {
    border-left-color: var(--warn);
    background: var(--warn-bg);
  }
  .tx-host :global(.tx-callout-accent) {
    border-left-color: var(--navy, var(--accent));
    background: var(--surface2);
    border-color: var(--accent);
    border-left-width: 6px;
  }
  .tx-host :global(.tx-tag) {
    font-size: 10.5px;
    letter-spacing: 0.02em;
    color: var(--muted);
    user-select: none;
    margin-bottom: 2px;
  }
  .tx-host :global(.tx-callout-title) {
    font-weight: 700;
    margin-bottom: 4px;
    min-height: 1.5em;
  }
  .tx-host :global(.tx-callout-title:has(> br:only-child)::before),
  .tx-host :global(.tx-callout-title:empty::before) {
    content: attr(data-placeholder);
    color: var(--muted);
    font-weight: 400;
    pointer-events: none;
  }
  .tx-host :global(.tx-callout-body > *:last-child) {
    margin-bottom: 0.2em;
  }

  /* 표 */
  .tx-host :global(.tx-tablewrap) {
    margin: 0 0 0.9em;
  }
  .tx-host :global(.tx-table) {
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface);
  }
  .tx-host :global(.tx-row) {
    display: flex;
    border-top: 1px solid var(--line2);
  }
  .tx-host :global(.tx-row:first-child) {
    border-top: none;
  }
  .tx-host :global(.tx-cell) {
    flex: 1 1 0;
    min-width: 0;
    padding: 4px 8px;
    min-height: 1.9em;
    border-left: 1px solid var(--line2);
    overflow-wrap: anywhere;
  }
  .tx-host :global(.tx-cell:first-child) {
    border-left: none;
  }
  .tx-host :global(.tx-row[data-head]) {
    background: var(--accent-soft);
    font-weight: 600;
  }
  .tx-host :global(.tx-table-v .tx-row > .tx-cell:first-child) {
    flex: 0 0 32%;
    background: var(--accent-soft);
    font-weight: 600;
  }
  .tx-host :global(.tx-dyn .tx-table) {
    border-style: dashed;
    border-color: var(--ok);
  }
  .tx-host :global(.tx-table > :is(.tx-trans, .tx-raw)) {
    margin: 0;
    border-radius: 0;
  }

  /* 버튼 */
  .tx-host :global(.tx-btns) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 0.9em;
    align-items: flex-start;
  }
  .tx-host :global(.tx-btns > :is(.tx-trans, .tx-raw)) {
    flex: 1 0 100%;
  }
  .tx-host :global(.tx-btn) {
    display: inline-block;
    min-width: 3em;
    padding: 5px 16px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
    border: 1px solid var(--accent);
  }
  .tx-host :global(.tx-btn[data-style='secondary']) {
    background: var(--navy, var(--ink));
    border-color: var(--navy, var(--ink));
    color: #fff;
  }
  .tx-host :global(.tx-btn[data-style='outline']) {
    background: transparent;
    color: var(--accent);
  }
  .tx-host :global(.tx-btn[data-style='warn']) {
    background: var(--err);
    border-color: var(--err);
    color: #fff;
  }
  .tx-host :global(.tx-btn[data-style='auto']) {
    background: var(--accent);
  }

  /* 불투명 보존 노드 */
  .tx-host :global(.tx-raw) {
    position: relative;
    margin: 0 0 0.9em;
    padding: 18px 10px 6px;
    background: var(--surface2);
    border: 1px dashed var(--line);
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--muted);
    white-space: pre-wrap;
  }
  .tx-host :global(.tx-raw::before) {
    content: attr(data-label);
    position: absolute;
    top: 2px;
    left: 8px;
    font-family: var(--font-ui);
    font-size: 10.5px;
    color: var(--muted);
    user-select: none;
  }
  .tx-host :global(.tx-raw code) {
    font-size: inherit;
  }
  .tx-host :global(.tx-trans) {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: -0.35em 0 0.7em;
    padding: 2px 8px;
    background: var(--surface2);
    border: 1px dashed var(--line);
    border-radius: 6px;
    font-size: 11.5px;
    color: var(--muted);
  }
  .tx-host :global(.tx-trans[data-orphan='1']) {
    border-color: var(--warn);
  }
  .tx-host :global(.tx-trans details) {
    flex: 1;
    min-width: 0;
  }
  .tx-host :global(.tx-trans summary) {
    cursor: pointer;
    user-select: none;
  }
  .tx-host :global(.tx-trans pre) {
    margin: 4px 0 2px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .tx-host :global(.tx-trans-del) {
    cursor: pointer;
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 4px;
    font-size: 11px;
    padding: 0 6px;
    color: var(--err);
  }
  .tx-host :global(li > .tx-trans) {
    margin-left: -1.2em;
  }
</style>
