<script lang="ts">
  import { tick } from 'svelte';
  import { insertAt, wrapLink, wrapSelection, type TextEdit } from '../state/inline-edit';
  import {
    BUTTON_STYLES,
    BUTTON_STYLE_LABEL,
    CALLOUT_KINDS,
    CALLOUT_KIND_LABEL,
    describeIds,
    getBlockAttr,
    getButtonGroupInfo,
    getButtonStyle,
    getCalloutKind,
    getHeadingLevel,
    getListType,
    groupButtonWithNext,
    ID_KIND_LABEL,
    setButtonStyle,
    setCalloutKind,
    setHeadingLevel,
    setListType,
    ungroupButtons,
    type ButtonStyle,
    type CalloutKind,
    type HeadingLevel,
  } from '../state/ops';
  import { cellState, SUBJECT_ID, textOf } from '../state/strings';
  import { studio } from '../state/studio.svelte';

  const p = $derived(studio.project);
  const id = $derived(studio.selectedId);
  const isSubject = $derived(id === SUBJECT_ID);
  const exists = $derived(!!id && (isSubject || !!p.strings[id]));
  const row = $derived(id ? studio.stringRows.find((r) => r.id === id) : undefined);
  const kindLabel = $derived(isSubject ? '메일 제목' : row ? row.kind : '');
  const table = $derived(row?.scope.startsWith('row:') ? p.dynamicTables.find((t) => t.id === row.scope.slice(4)) : undefined);
  const isButton = $derived(!!id && !isSubject && describeIds(p.structure).get(id) === 'button');
  const href = $derived(isButton && id ? (getBlockAttr(p.structure, id, 'href') ?? '') : '');

  // 블록 속성(구조만 바뀌며 번역은 그대로)
  const real = $derived(!!id && !isSubject && exists);
  const calloutKind = $derived(real && id ? getCalloutKind(p.structure, id) : undefined);
  const headingLevel = $derived(real && id ? getHeadingLevel(p.structure, id) : undefined);
  const listType = $derived(real && id ? getListType(p.structure, id) : undefined);
  const buttonStyle = $derived(real && id ? getButtonStyle(p.structure, id) : undefined);
  const group = $derived(real && id ? getButtonGroupInfo(p.structure, id) : undefined);
  const hasBlockProps = $derived(calloutKind !== undefined || headingLevel !== undefined || listType !== undefined || buttonStyle !== undefined);

  // 마지막으로 포커스한 입력 칸(서식·치환자 버튼이 들어갈 곳)
  let last: { el: HTMLTextAreaElement | HTMLInputElement; lang: string } | null = null;

  async function apply(fn: (t: string, s: number, e: number) => TextEdit) {
    if (!last || !id) return studio.toast('먼저 입력 칸을 선택하세요.');
    const { el, lang } = last;
    const r = fn(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
    el.value = r.text;
    studio.setText(id, lang, r.text);
    await tick();
    el.focus();
    el.setSelectionRange(r.selStart, r.selEnd);
  }
  const insert = (s: string) => apply((t, a, b) => insertAt(t, a, b, s));
</script>

{#if !id || !exists}
  <div class="hint">미리보기의 문구나 그리드의 행을 클릭하면, 그 ID 의 ko/en/ja 를 여기서 한 번에 편집합니다.</div>
{:else}
  <div class="drow" style="margin-bottom:10px">
    <b>{kindLabel}</b><span class="idc">{isSubject ? 'subject' : id}</span>
    {#if table}<span class="badge b-n">동적 표 {table.id}</span>{/if}
  </div>

  {#each p.langs as l (l)}
    {@const s = cellState(p, id, l, studio.stale)}
    <div class="fld">
      <label for="ta-{l}">
        <span lang={l}>{l}</span>
        {#if l === p.baseLang}<span class="badge b-n">기준</span>{/if}
        {#if s === 'miss'}<span class="badge b-err">미번역</span>{/if}
        {#if s === 'stale'}<span class="badge b-warn">오래됨</span><button type="button" class="btn sm" onclick={() => studio.ack(id, l)}>최신 확인</button>{/if}
      </label>
      {#if isSubject}
        <input id="ta-{l}" type="text" lang={l} value={textOf(p, id, l)} onfocus={(e) => (last = { el: e.currentTarget, lang: l })} oninput={(e) => studio.setText(id, l, e.currentTarget.value)} />
      {:else}
        <textarea id="ta-{l}" lang={l} value={textOf(p, id, l)} onfocus={(e) => (last = { el: e.currentTarget, lang: l })} oninput={(e) => studio.setText(id, l, e.currentTarget.value)}></textarea>
      {/if}
    </div>
  {/each}

  {#if !isSubject}
    <div class="fld">
      <span class="lbl">서식 <span class="note">(선택 영역에 적용)</span></span>
      <div class="fmt" role="group" aria-label="인라인 서식">
        <button type="button" title="굵게" aria-label="굵게" onclick={() => apply((t, a, b) => wrapSelection(t, a, b, 'strong'))}><b>B</b></button>
        <button type="button" title="기울임" aria-label="기울임" onclick={() => apply((t, a, b) => wrapSelection(t, a, b, 'em'))}><i>I</i></button>
        <button type="button" title="취소선" aria-label="취소선" onclick={() => apply((t, a, b) => wrapSelection(t, a, b, 'del'))}><s>S</s></button>
        <button type="button" title="링크" aria-label="링크" onclick={() => apply((t, a, b) => wrapLink(t, a, b))}>링크</button>
        <button type="button" title="줄바꿈" aria-label="줄바꿈" onclick={() => insert('<br>')}>↵</button>
      </div>
    </div>
  {/if}

  {#if !studio.isNotice}
  <div class="fld">
    <span class="lbl">치환자 삽입 <span class="note">(마지막으로 쓴 칸에 들어갑니다)</span></span>
    <div class="phs">
      {#each p.variables as v (v.name)}
        <button type="button" title={v.description} onclick={() => insert(`|!#-${v.name}|`)}>|!#-{v.name}|</button>
      {:else}
        <span class="note">등록된 치환자가 없습니다. <code>|!#-이름|</code> 을 직접 입력하면 목록에 추가됩니다.</span>
      {/each}
    </div>
    {#if table}
      <div class="phs" style="margin-top:6px">
        {#each table.vars as v (v.name)}
          <button type="button" title={v.description} onclick={() => insert(`{{${v.name}}}`)}>{`{{${v.name}}}`}</button>
        {/each}
      </div>
    {/if}
  </div>
  {/if}

  {#if isButton}
    <div class="fld">
      <label for="btn-href">버튼 링크 (모든 언어 공통)</label>
      <input id="btn-href" type="text" value={href} placeholder="https://… 또는 |!#-치환자|" oninput={(e) => studio.setBlockHref(id, e.currentTarget.value)} />
    </div>
  {/if}

  {#if hasBlockProps && id}
    <div class="fld" role="group" aria-label="블록 속성" data-testid="block-props">
      <span class="lbl">블록 속성 <span class="note">(모든 언어 공통 · 번역은 바뀌지 않음)</span></span>
      {#if calloutKind !== undefined}
        <label class="prow" for="bp-callout">콜아웃 종류
          <select id="bp-callout" value={calloutKind} onchange={(e) => studio.applyBlockOp((q) => setCalloutKind(q, id, e.currentTarget.value as CalloutKind))}>
            {#if !(CALLOUT_KINDS as readonly string[]).includes(calloutKind)}<option value={calloutKind}>(기타: {calloutKind || '없음'})</option>{/if}
            {#each CALLOUT_KINDS as k}<option value={k}>{CALLOUT_KIND_LABEL[k]} ({k})</option>{/each}
          </select>
        </label>
      {/if}
      {#if headingLevel !== undefined}
        <label class="prow" for="bp-heading">제목 레벨
          <select id="bp-heading" value={String(headingLevel)} onchange={(e) => studio.applyBlockOp((q) => setHeadingLevel(q, id, Number(e.currentTarget.value) as HeadingLevel))}>
            {#if headingLevel > 3}<option value={String(headingLevel)}>H{headingLevel}</option>{/if}
            {#each [1, 2, 3] as n}<option value={String(n)}>H{n}</option>{/each}
          </select>
        </label>
      {/if}
      {#if listType !== undefined}
        <label class="prow" for="bp-list">목록 종류
          <select id="bp-list" value={listType} onchange={(e) => studio.applyBlockOp((q) => setListType(q, id, e.currentTarget.value as 'ul' | 'ol'))}>
            <option value="ul">글머리 기호 (ul)</option>
            <option value="ol">번호 (ol)</option>
          </select>
        </label>
      {/if}
      {#if buttonStyle !== undefined}
        <label class="prow" for="bp-btn">버튼 스타일
          <select id="bp-btn" value={buttonStyle} onchange={(e) => studio.applyBlockOp((q) => setButtonStyle(q, id, e.currentTarget.value as ButtonStyle))}>
            {#if !(BUTTON_STYLES as readonly string[]).includes(buttonStyle)}<option value={buttonStyle}>(기타: {buttonStyle || '없음'})</option>{/if}
            {#each BUTTON_STYLES as k}<option value={k}>{BUTTON_STYLE_LABEL[k]}</option>{/each}
          </select>
        </label>
        {#if group}
          <div class="drow">
            {#if group.grouped}
              <button type="button" class="btn sm" onclick={() => studio.applyBlockOp((q) => ungroupButtons(q, id))}>버튼 그룹 풀기 ({group.count}개 → 각각)</button>
            {/if}
            {#if group.canGroupWithNext}
              <button type="button" class="btn sm" onclick={() => studio.applyBlockOp((q) => groupButtonWithNext(q, id))}>다음 버튼과 그룹으로 묶기</button>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  {#if !isSubject}
    <p class="note">종류: {ID_KIND_LABEL[describeIds(p.structure).get(id) ?? 'other']}. 허용 인라인 태그: strong · em · del · a · br (그 외는 내보낼 때 제거되고 경고됩니다).</p>
  {/if}
{/if}
