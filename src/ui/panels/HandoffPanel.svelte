<script lang="ts">
  import { maxRowsByLang } from '../../project';
  import { studio } from '../state/studio.svelte';

  const r = $derived(studio.analysis.rendered);
  const p = $derived(studio.project);
  const running = $derived(studio.analysis.status === 'running');
</script>

<p class="note" style="margin-bottom:8px">번들 JSON 과 함께 메일 처리 워커/서버 개발자에게 전달하는 동적 표 연동 명세(MD)입니다.</p>
<div class="ops" style="margin:0 0 10px">
  <button type="button" class="btn pri" disabled={running} onclick={() => studio.saveHandoffFile()}>handoff MD 저장</button>
  <button type="button" class="btn" disabled={running} onclick={() => studio.copyHandoff()}>MD 복사</button>
</div>

{#if p.dynamicTables.length === 0}
  <div class="hint">이 템플릿에는 동적 표가 없습니다. 서버는 <code>|!#-변수|</code> 치환자만 처리하면 됩니다.</div>
{:else if !r}
  <div class="hint">
    행 템플릿(언어별 인라인 결과)은 실제 엔진 변환이 필요합니다.
    <button type="button" class="btn sm" disabled={running} onclick={() => studio.runAnalysis()}>변환 검사 실행</button>
  </div>
{:else}
  {#if !studio.analysisFresh}<div class="banner ban-warn" style="margin-bottom:8px">이전 검사 결과입니다. 저장/복사 시에는 최신으로 다시 변환합니다.</div>{/if}
  <div class="col" style="gap:10px">
    {#each r.dynamicTables as t (t.id)}
      <div>
        <div class="drow"><b>{t.id}</b><span class="badge b-n">열 {t.columns}</span></div>
        <div class="idc" style="margin-top:6px">삽입 표식</div>
        <pre class="code">{`<tbody>\n  ${t.marker}\n</tbody>`}</pre>
        {#each p.langs as l}
          <div class="idc" style="margin-top:6px">행 템플릿 · {l}</div>
          <pre class="code">{t.rowTemplates[l] ?? ''}</pre>
        {/each}
        <div class="idc" style="margin-top:6px">행 수 상한 (Gmail 102KB, 다른 표 행 0 가정)</div>
        <div class="tw">
          <table class="g">
            <thead><tr><th scope="col">언어</th><th scope="col">본문 B</th><th scope="col">행당 B</th><th scope="col">최대 행</th></tr></thead>
            <tbody>
              {#each Object.entries(maxRowsByLang(r, t)) as [l, x]}
                <tr><td>{l}</td><td>{x.baseBytes}</td><td>{x.rowBytes}</td><td>{Number.isFinite(x.maxRows) ? x.maxRows : '제한 없음'}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/each}
  </div>
{/if}
