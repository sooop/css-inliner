<script lang="ts">
  import { onMount, tick } from 'svelte';
  import DraftEditor from '../../editor/DraftEditor.svelte';
  import { useDraftCheck } from '../state/draft-check.svelte';
  import { studio } from '../state/studio.svelte';
  import DraftIssues from './DraftIssues.svelte';
  import DraftMetaFields from './DraftMetaFields.svelte';
  import DraftNameField from './DraftNameField.svelte';

  /**
   * 전체 화면 초안 화면: 워크스페이스 전체를 덮는 뷰(Shell 은 마운트된 채 inert — 돌아가면 미리보기를 다시 만들지 않는다).
   * 초안 작성은 항상 이 화면에서 한다(상태: studio.draftText·이름·코드).
   */
  const check = useDraftCheck();
  const blocked = $derived(studio.draftCreating || studio.draftText.trim() === '' || !!check.value.error);
  let root = $state<HTMLDivElement>();

  /**
   * 닫은 뒤 연 버튼으로 포커스 복귀. 컴포넌트 정리 시점에는 studio.draftOpen 이 아직 이전 값으로 보이고 앱 셸의 inert 도 풀리기 전이라,
   * 정리 코드가 아니라 닫는 동작에서 DOM 갱신이 끝난 뒤에 옮긴다.
   */
  function restoreFocus() {
    setTimeout(() => document.querySelector<HTMLElement>('[data-draft-opener]')?.focus(), 0);
  }
  function back() {
    studio.closeDraft();
    restoreFocus();
  }
  async function create() {
    if (await studio.createFromDraft()) restoreFocus();
  }

  function onkeydown(e: KeyboardEvent) {
    // 에디터 팝업·슬래시 메뉴는 자기 Esc 를 stopPropagation 으로 막아 여기까지 오지 않는다. defaultPrevented 로 거르면 안 된다(ProseMirror 는 Esc 를 항상 preventDefault).
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      back();
    }
  }

  onMount(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onkeydown);
    // 소스 보기로 열렸다면 입력창에 포커스(에디터 모드는 DraftEditor 가 로딩 뒤 직접 포커스한다)
    void tick().then(() => root?.querySelector<HTMLElement>('textarea#draft-ta')?.focus());
    return () => {
      document.removeEventListener('keydown', onkeydown);
      document.body.style.overflow = prevOverflow;
    };
  });
</script>

<div class="dscr" role="region" aria-label="초안 화면 — 새 프로젝트 만들기" bind:this={root}>
  <header class="dscr-bar">
    <button type="button" class="btn sm" data-draft-back onclick={back} title="돌아가기 (Esc) — 작성 중인 초안은 유지됩니다">← 돌아가기</button>
    <DraftNameField compact />
    <span class="sp"></span>
    <button type="button" class="btn pri" data-create onclick={create} disabled={blocked}>프로젝트 만들기</button>
  </header>
  <div class="dscr-body">
    <section class="dscr-main" aria-label=".txmd 초안 편집">
      <DraftEditor bind:value={studio.draftText} langs={['en', 'ja']} variables={studio.project.variables} />
    </section>
    <aside class="dscr-side" aria-label="새 프로젝트 정보와 점검">
      <h3 class="rh">새 프로젝트 정보</h3>
      <DraftMetaFields stacked />
      <h3 class="rh" style="margin-top:6px">초안 점검</h3>
      <DraftIssues check={check.value} />
      <p class="note">
        초안으로 <b>새 프로젝트</b>를 만들고 그 프로젝트로 전환합니다. 지금 열린 프로젝트({studio.project.name})는 그대로 목록에 남습니다. 작성 중인 초안은 돌아가도, 새로고침해도 유지됩니다(만들기에 성공하면 비워집니다).
      </p>
    </aside>
  </div>
</div>

<style>
  .dscr {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
  }
  .dscr-bar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    padding: 8px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .dscr-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
  }
  .dscr-main {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .dscr-side {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 12px 14px;
    background: var(--surface);
    border-left: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dscr-side h3 {
    margin: 0;
  }
  @media (max-width: 900px) {
    .dscr-body {
      display: block;
      overflow: auto;
    }
    .dscr-main {
      min-height: 70dvh;
    }
    .dscr-side {
      border-left: 0;
      border-top: 1px solid var(--line);
      overflow: visible;
    }
  }
  @media (max-width: 600px) {
    .dscr-bar :global(.dn.compact) {
      flex-basis: 100%;
      max-width: none;
    }
  }
</style>
