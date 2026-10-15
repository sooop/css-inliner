<script lang="ts">
  import { studio } from '../state/studio.svelte';
  import { completion } from '../state/strings';
  import { projectKind } from '../../project';
  import ConfirmButton from '../shell/ConfirmButton.svelte';

  let renaming = $state<string | null>(null);
  let nameDraft = $state('');
  let fileInput = $state<HTMLInputElement>();
  let archiveInput = $state<HTMLInputElement>();
  let txmdInput = $state<HTMLInputElement>();

  function fmt(t: number): string {
    return new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function startRename(id: string, name: string) {
    renaming = id;
    nameDraft = name;
  }
  async function commitRename() {
    if (renaming) await studio.renameProject(renaming, nameDraft);
    renaming = null;
  }
  async function pickFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) await studio.importBundle(await f.text());
  }
  async function pickArchive(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) await studio.importArchive(await f.text());
  }
  async function pickTxmd(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) await studio.importTxmdFile(await f.text());
  }
</script>

<div class="drow" style="margin-bottom:8px">
  <h3 class="rh" style="margin:0">프로젝트 ({studio.projects.length})</h3>
  <span class="sp"></span>
  <button type="button" class="btn sm" onclick={() => studio.newProject()}>+ 새 프로젝트</button>
</div>
<div class="drow" style="margin-bottom:10px">
  <button type="button" class="btn sm" onclick={() => studio.addSampleProject()}>샘플 추가</button>
  <button type="button" class="btn sm" title="번들은 메일 전용입니다 — 항상 메일 프로젝트로 복원됩니다" onclick={() => fileInput?.click()}>번들(.json) 불러오기</button>
  <input bind:this={fileInput} type="file" accept="application/json,.json" class="sr-only" tabindex="-1" aria-label="번들 JSON 파일 선택" onchange={pickFile} />
</div>
<div class="drow" style="margin-bottom:10px">
  <button type="button" class="btn sm" title="저장된 모든 프로젝트(메일·공지)를 파일 1개로 저장합니다" onclick={() => studio.exportArchive()}>전체 내보내기</button>
  <button type="button" class="btn sm" title="프로젝트 보관 파일(.txproj.json)을 새 사본으로 추가합니다" onclick={() => archiveInput?.click()}>보관 파일 가져오기</button>
  <input bind:this={archiveInput} type="file" accept="application/json,.json" class="sr-only" tabindex="-1" aria-label="프로젝트 보관 파일 선택" onchange={pickArchive} />
  <button type="button" class="btn sm" title="머리말이 있는 .txmd 파일로 새 프로젝트(메일·공지)를 만듭니다" onclick={() => txmdInput?.click()}>.txmd 불러오기</button>
  <input bind:this={txmdInput} type="file" accept=".txmd,.md,text/plain" class="sr-only" tabindex="-1" aria-label=".txmd 파일 선택" onchange={pickTxmd} />
</div>

<div class="col" style="gap:8px">
  {#each studio.projects as pr (pr.id)}
    {@const cur = pr.id === studio.project.id}
    <div class="proj" class:cur>
      {#if renaming === pr.id}
        <form
          class="drow"
          onsubmit={(e) => {
            e.preventDefault();
            void commitRename();
          }}
        >
          <label class="sr-only" for="rn-{pr.id}">프로젝트 이름</label>
          <!-- svelte-ignore a11y_autofocus -->
          <input id="rn-{pr.id}" type="text" bind:value={nameDraft} autofocus onkeydown={(e) => e.key === 'Escape' && (renaming = null)} />
          <button type="submit" class="btn sm pri">저장</button>
          <button type="button" class="btn sm" onclick={() => (renaming = null)}>취소</button>
        </form>
      {:else}
        <button type="button" class="open" aria-current={cur} onclick={() => studio.openProject(pr.id)}>
          <span class="drow"><b>{pr.name}</b><span class="badge {projectKind(pr) === 'notice' ? 'b-warn' : 'b-n'}" data-kind-badge={projectKind(pr)}>{projectKind(pr) === 'notice' ? '공지' : '메일'}</span>{#if pr.templateCode}<span class="idc">{pr.templateCode}</span>{/if}<span class="sp"></span><span class="note">{fmt(pr.updatedAt)}</span></span>
          <span class="drow">
            {#each pr.langs as l}
              {@const c = completion(pr, l)}
              <span class="badge {c === 100 ? 'b-ok' : 'b-warn'}">{l} {c}%</span>
            {/each}
          </span>
        </button>
        <div class="drow">
          <button type="button" class="btn sm" onclick={() => startRename(pr.id, pr.name)}>이름 변경</button>
          <button type="button" class="btn sm" onclick={() => studio.exportArchive(pr.id)}>내보내기</button>
          <ConfirmButton label="삭제" onconfirm={() => studio.deleteProject(pr.id)} />
        </div>
      {/if}
    </div>
  {/each}
</div>
