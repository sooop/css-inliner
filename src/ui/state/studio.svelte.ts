/**
 * 스튜디오 상태(Svelte 5 runes). 현재 프로젝트는 `$state.raw` 로 두고 모든 변경을 순수 함수(ops/strings/dyn/draft)의
 * 결과로 통째로 교체한다 — 프록시가 없어 Dexie(structured clone)·번들 직렬화에 그대로 넘길 수 있다.
 * 변경 → 디바운스 자동 저장(ProjectStore/Dexie). 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 메모리에서만 동작하고 상태에 표시한다.
 */
import {
  ARCHIVE_EXT,
  ProjectStore,
  buildArchive,
  parseArchive,
  serializeArchive,
  summarizeProjects,
  buildBundle,
  buildHandoffMd,
  hasErrors,
  buildNoticeHtml,
  newProjectId,
  noticeFilename,
  noticeZoneContent,
  noticeZoneTitle,
  projectKind,
  renderNotice,
  renderProject,
  restoreProject,
  validateProject,
  verifyBundle,
  type Issue,
  type Project,
  type ProjectKind,
  type RenderedProject,
} from '../../project';
import { createProjectFromDraft, createProjectFromTxmdFile, draftTitle, planDraft, type DraftPlan } from './draft';
import { addSampleRow, removeSampleRow, removeTableVar, setSampleCell, updateTableVar } from './dyn';
import { copyText, downloadText, safeFilename } from './files';
import { cssFor, inlineFn } from './inline';
import {
  addTableRow,
  blockIndexOfId,
  canRemoveTableRow,
  insertBlock,
  listTopBlocks,
  moveBlock,
  removeBlock,
  removeTableRow,
  setBlockAttr,
  type AddKind,
  type TopBlock,
} from './ops';
import { createBlankProject, createSampleProject } from './sample';
import type { SnippetDef } from './snippets';
import { ackStale, listStringRows, removeVariable, setText, staleSet, SUBJECT_ID, updateVariable } from './strings';

export type LeftTab = 'blocks' | 'strings' | 'snippets' | 'projects';
export type AccKey = 'edit' | 'check' | 'vars' | 'dyn' | 'export' | 'handoff';
export type Theme = 'system' | 'light' | 'dark';
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface Analysis {
  status: 'idle' | 'running' | 'done' | 'error';
  rendered?: RenderedProject;
  /** 이 결과를 만든 시점의 프로젝트 버전 */
  version: number;
  at?: number;
  error?: string;
}

const LS = { theme: 'txms.theme', acc: 'txms.acc', last: 'txms.last', pending: 'txms.pending', draft: 'txms.draft', ignoreTr: 'txms.ignoreTranslation' };
/** 전체 화면 초안이 열려 있던 상태(새로고침 후 복원 — 탭 단위라 sessionStorage) */
const SS_DRAFT_OPEN = 'txms.draft.open';
const DRAFT_SAVE_MS = 300;
const AUTOSAVE_MS = 700;

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function ss(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

class Studio {
  private store: ProjectStore | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private rev = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private analysisJob: Promise<void> | null = null;

  ready = $state(false);
  project = $state.raw<Project>(createBlankProject('불러오는 중'));
  projects = $state.raw<Project[]>([]);
  /** 프로젝트 내용이 바뀔 때마다 1 증가(분석 결과의 최신 여부 판단) */
  version = $state(0);

  lang = $state('ko');
  useSamples = $state(true);
  showMarkers = $state(false);

  selectedId = $state<string | null>(null);
  selectedBlock = $state<number | null>(null);
  /** 외부(그리드·검사)에서 선택했을 때 미리보기를 그 요소로 스크롤하라는 신호 */
  reveal = $state<{ id: string; tick: number } | null>(null);

  leftTab = $state<LeftTab>('blocks');
  gridProblemsOnly = $state(false);
  acc = $state<Record<AccKey, boolean>>({ edit: true, check: true, vars: false, dyn: false, export: false, handoff: false });
  theme = $state<Theme>('system');

  saveState = $state<SaveState>('idle');
  savedAt = $state<number | null>(null);
  storeError = $state<string | null>(null);

  toastMsg = $state<{ text: string; tick: number } | null>(null);

  /* 초안(+ 초안 → 새 프로젝트). 작성 중인 내용은 닫아도 유지되고 localStorage 에 임시 백업된다(만들기에 성공하면 비운다). */
  draftOpen = $state(false);
  draftError = $state<string | null>(null);
  draftCreating = $state(false);
  private _draftText = $state('');
  /** null = 사용자가 건드리지 않음(초안 첫 제목을 기본값으로 쓴다) */
  private _draftName = $state<string | null>(null);
  private _draftCode = $state('');
  /** 새 프로젝트 유형(기본 메일). 만들 때만 고른다 — 만든 뒤 유형 변경은 지원하지 않는다 */
  private _draftKind = $state<ProjectKind>('mail');
  private draftTimer: ReturnType<typeof setTimeout> | undefined;

  analysis = $state.raw<Analysis>({ status: 'idle', version: -1 });
  expectedRows = $state<Record<string, number>>({});
  force = $state(false);

  /* ------------------------------------------------------------ 파생 */

  /** 현재 프로젝트 유형(kind 필드가 없으면 메일) */
  kind = $derived<ProjectKind>(projectKind(this.project));
  isNotice = $derived(this.kind === 'notice');
  blocks = $derived.by<TopBlock[]>(() => listTopBlocks(this.project.structure));
  stale = $derived.by(() => staleSet(this.project));
  stringRows = $derived.by(() => listStringRows(this.project));
  analysisFresh = $derived(this.analysis.status === 'done' && this.analysis.version === this.version);
  /** 번역 관련 경고(미번역·오래됨)를 검사 결과에서 숨긴다. 앱 설정이라 localStorage 에 둔다(프로젝트별 아님). */
  ignoreTranslation = $state(ls()?.getItem(LS.ignoreTr) === '1');
  issues = $derived.by<Issue[]>(() =>
    validateProject(this.project, {
      ignoreTranslation: this.ignoreTranslation,
      ...(this.analysisFresh && this.analysis.rendered ? { rendered: this.analysis.rendered, expectedRows: this.expectedRows } : {}),
    }),
  );
  errorCount = $derived(this.issues.filter((i) => i.level === 'error').length);
  warningCount = $derived(this.issues.filter((i) => i.level === 'warning').length);
  selectedBlockInfo = $derived(this.selectedBlock === null ? null : (this.blocks[this.selectedBlock] ?? null));

  /* ------------------------------------------------------------ 초기화 / 설정 */

  async init(): Promise<void> {
    this.loadPrefs();
    let list: Project[] = [];
    let recovered = false;
    try {
      this.store = new ProjectStore();
      list = await this.store.list();
      if (list.length === 0) {
        const sp = createSampleProject();
        await this.store.save(sp, { touch: false });
        list = [sp];
      }
      const rec = await this.recoverPending(list);
      list = rec.list;
      recovered = rec.recovered;
    } catch (e) {
      this.store = null;
      this.storeError = e instanceof Error ? e.message : String(e);
      this.saveState = 'error';
      list = [createSampleProject()];
    }
    const last = ls()?.getItem(LS.last);
    const open = list.find((p) => p.id === last) ?? list[0];
    this.projects = list;
    this.adopt(open);
    this.ready = true;
    if (recovered) this.toast('저장되기 전에 닫힌 편집 내용을 복구했습니다.');
    if (typeof window !== 'undefined') {
      // IndexedDB 쓰기는 비동기라 문서가 내려가는 중에는 끝나지 못할 수 있다.
      // 그래서 떠나는 순간 동기 API 인 localStorage 에 미저장 상태를 먼저 백업하고(다음 로드에서 복구), 저장도 함께 시도한다.
      const leave = () => {
        this.persistDraft();
        this.backupPending();
        void this.flush();
      };
      window.addEventListener('pagehide', leave);
      window.addEventListener('beforeunload', leave);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') leave();
      });
    }
  }

  /** 저장 대기·진행 중인 현재 프로젝트를 localStorage 에 동기 백업(용량 초과 등은 무시: 최선 노력) */
  private backupPending(): void {
    if (this.saveState !== 'dirty' && this.saveState !== 'saving') return;
    try {
      ls()?.setItem(LS.pending, JSON.stringify(this.project));
    } catch {
      /* 무시 */
    }
  }

  /** 이전 세션에서 저장 전에 닫혀 백업만 남은 편집을 IndexedDB 로 복구한다(그 사이 더 새 저장본이 있으면 버린다). */
  private async recoverPending(list: Project[]): Promise<{ list: Project[]; recovered: boolean }> {
    const s = ls();
    const raw = s?.getItem(LS.pending);
    if (!s || !raw || !this.store) return { list, recovered: false };
    try {
      const pend = JSON.parse(raw) as Project;
      if (!pend || typeof pend.id !== 'string' || typeof pend.structure !== 'string' || !pend.strings) {
        s.removeItem(LS.pending);
        return { list, recovered: false };
      }
      const cur = list.find((x) => x.id === pend.id);
      if (cur && cur.updatedAt > pend.updatedAt) {
        s.removeItem(LS.pending);
        return { list, recovered: false };
      }
      await this.store.save(pend);
      s.removeItem(LS.pending);
      return { list: await this.store.list(), recovered: true };
    } catch {
      return { list, recovered: false };
    }
  }

  private loadPrefs(): void {
    const s = ls();
    if (!s) return;
    const t = s.getItem(LS.theme);
    if (t === 'light' || t === 'dark' || t === 'system') this.theme = t;
    try {
      const a = JSON.parse(s.getItem(LS.acc) ?? 'null');
      if (a && typeof a === 'object') for (const k of Object.keys(this.acc) as AccKey[]) if (typeof a[k] === 'boolean') this.acc[k] = a[k];
    } catch {
      /* 무시 */
    }
    this.applyTheme();
    try {
      const d = JSON.parse(s.getItem(LS.draft) ?? 'null');
      if (d && typeof d === 'object') {
        if (typeof d.text === 'string') this._draftText = d.text;
        if (typeof d.name === 'string') this._draftName = d.name;
        if (typeof d.code === 'string') this._draftCode = d.code;
        if (d.kind === 'notice') this._draftKind = 'notice';
      }
    } catch {
      /* 무시 */
    }
    if (ss()?.getItem(SS_DRAFT_OPEN) === '1') this.draftOpen = true;
  }

  setTheme(t: Theme): void {
    this.theme = t;
    ls()?.setItem(LS.theme, t);
    this.applyTheme();
  }

  private applyTheme(): void {
    if (typeof document === 'undefined') return;
    if (this.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = this.theme;
  }

  setAcc(k: AccKey, open: boolean): void {
    this.acc[k] = open;
    ls()?.setItem(LS.acc, JSON.stringify(this.acc));
  }

  toggleAcc(k: AccKey): void {
    this.setAcc(k, !this.acc[k]);
  }

  toast(text: string): void {
    this.toastMsg = { text, tick: (this.toastMsg?.tick ?? 0) + 1 };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastMsg = null), 3200);
  }

  /* ------------------------------------------------------------ 프로젝트 열기/저장 */

  /** 프로젝트를 현재 프로젝트로 채택(저장하지 않음) */
  private adopt(p: Project): void {
    this.project = p;
    this.version++;
    this.selectedId = null;
    this.selectedBlock = null;
    this.reveal = null;
    this.lang = p.langs.includes(this.lang) ? this.lang : p.baseLang;
    this.analysis = { status: 'idle', version: -1 };
    this.expectedRows = {};
    this.force = false;
    this.saveState = this.storeError ? 'error' : 'saved';
    ls()?.setItem(LS.last, p.id);
  }

  private markDirty(): void {
    this.rev++;
    this.version++;
    if (!this.store) {
      this.saveState = 'error';
      return;
    }
    this.saveState = 'dirty';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
  }

  /** 대기 중인 자동 저장을 즉시 수행 */
  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (!this.store) return;
    if (this.saveState !== 'dirty') return;
    const snap = this.project;
    const rev = this.rev;
    this.saveState = 'saving';
    try {
      const saved = await this.store.save(snap);
      if (this.project === snap) this.project = { ...snap, updatedAt: saved.updatedAt };
      this.savedAt = saved.updatedAt;
      if (this.rev === rev) {
        this.saveState = 'saved';
        ls()?.removeItem(LS.pending);
      }
      await this.refreshList();
    } catch (e) {
      this.saveState = 'error';
      this.storeError = e instanceof Error ? e.message : String(e);
    }
  }

  async refreshList(): Promise<void> {
    if (!this.store) return;
    try {
      this.projects = await this.store.list();
    } catch {
      /* 목록은 보조 정보 */
    }
  }

  async openProject(id: string): Promise<void> {
    if (id === this.project.id) return;
    await this.flush();
    const p = this.projects.find((x) => x.id === id) ?? (await this.store?.get(id));
    if (!p) return;
    this.adopt(p);
  }

  private async persistNew(p: Project): Promise<void> {
    await this.flush();
    if (this.store) {
      try {
        await this.store.save(p, { touch: false });
        await this.refreshList();
      } catch (e) {
        this.storeError = e instanceof Error ? e.message : String(e);
        this.saveState = 'error';
      }
    } else this.projects = [p, ...this.projects];
    this.adopt(p);
  }

  async newProject(name?: string): Promise<void> {
    const n = name?.trim() || `새 프로젝트 ${this.projects.length + 1}`;
    await this.persistNew(createBlankProject(n));
    this.leftTab = 'blocks';
    this.toast('빈 프로젝트를 만들었습니다. [+ 블록 추가]로 채우거나, 상단 [+ 초안]으로 초안에서 새 프로젝트를 만드세요.');
  }

  setIgnoreTranslation(v: boolean): void {
    this.ignoreTranslation = v;
    try {
      ls()?.setItem(LS.ignoreTr, v ? '1' : '0');
    } catch {
      /* 저장 실패해도 이번 세션엔 적용 */
    }
  }

  /** 보관 파일로 저장. id 를 주면 그 프로젝트 1개, 없으면 전체. 편집 중인 현재 프로젝트는 저장 전 상태도 반영한다. */
  async exportArchive(id?: string): Promise<void> {
    await this.flush();
    const all = this.projects.some((p) => p.id === this.project.id)
      ? this.projects.map((p) => (p.id === this.project.id ? this.project : p))
      : [this.project, ...this.projects];
    const list = id ? all.filter((p) => p.id === id) : all;
    if (list.length === 0) return;
    const base = id ? safeFilename(list[0].name) : 'all';
    const name = `tx-studio_${base}${ARCHIVE_EXT}`;
    downloadText(name, serializeArchive(buildArchive(list)), 'application/json');
    this.toast(`${name} 저장 (프로젝트 ${list.length}개)`);
  }

  /** 보관 파일을 읽어 항상 새 id·"(가져옴)" 이름의 사본으로 추가한다. 첫 프로젝트를 연다. */
  async importArchive(text: string): Promise<void> {
    const r = parseArchive(text);
    if ('errors' in r) {
      this.toast(`가져오기 실패: ${r.errors[0] ?? ''}`);
      return;
    }
    if (r.projects.length === 0) {
      this.toast('파일에 프로젝트가 없습니다.');
      return;
    }
    const now = Date.now();
    const copies = r.projects.map((p, i) => ({ ...p, id: newProjectId(), name: `${p.name} (가져옴)`, updatedAt: now - i }));
    await this.flush();
    if (this.store) {
      try {
        for (const c of copies) await this.store.save(c, { touch: false });
        await this.refreshList();
      } catch (e) {
        this.storeError = e instanceof Error ? e.message : String(e);
        this.saveState = 'error';
      }
    } else this.projects = [...copies, ...this.projects];
    this.adopt(copies[0]);
    const n = summarizeProjects(copies);
    this.toast(`프로젝트 ${copies.length}개를 가져왔습니다 (메일 ${n.mail} · 공지 ${n.notice}).`);
  }

  async addSampleProject(): Promise<void> {
    await this.persistNew(createSampleProject());
    this.toast('샘플 프로젝트를 추가했습니다.');
  }

  async renameProject(id: string, name: string): Promise<void> {
    const n = name.trim();
    if (!n) return;
    if (id === this.project.id) {
      this.update((p) => (p.name === n ? null : { ...p, name: n }));
      return;
    }
    const p = this.projects.find((x) => x.id === id);
    if (!p || !this.store) return;
    await this.store.save({ ...p, name: n });
    await this.refreshList();
  }

  async deleteProject(id: string): Promise<void> {
    const wasCurrent = id === this.project.id;
    if (wasCurrent) {
      clearTimeout(this.saveTimer);
      this.saveState = 'saved';
    }
    try {
      await this.store?.delete(id);
    } catch (e) {
      this.toast('삭제하지 못했습니다: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (this.store) await this.refreshList();
    else this.projects = this.projects.filter((p) => p.id !== id);
    if (wasCurrent) {
      const next = this.projects[0];
      if (next) this.adopt(next);
      else await this.persistNew(createSampleProject());
    }
    this.toast('프로젝트를 삭제했습니다.');
  }

  /** 번들 JSON 을 새 프로젝트로 복원(source). 검증 실패 시 이유를 알린다. */
  async importBundle(text: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.toast('JSON 으로 읽을 수 없습니다.');
      return;
    }
    const v = verifyBundle(json);
    if (!v.ok) {
      this.toast(`번들 검증 실패: ${v.errors[0] ?? ''}`);
      return;
    }
    const p = restoreProject(json as Parameters<typeof restoreProject>[0]);
    await this.persistNew({ ...p, id: newProjectId(), name: `${p.name} (가져옴)`, updatedAt: Date.now() });
    this.toast('번들에서 프로젝트를 복원했습니다.');
  }

  /** 머리말이 붙은 .txmd 파일(스킬 산출물)로 새 프로젝트를 만든다. 실패하면 프로젝트를 만들지 않고 이유를 토스트로 알린다. */
  async importTxmdFile(text: string): Promise<boolean> {
    let made: ReturnType<typeof createProjectFromTxmdFile>;
    try {
      made = createProjectFromTxmdFile(text, `새 프로젝트 ${this.projects.length + 1}`);
    } catch (e) {
      this.toast(`.txmd 불러오기 실패: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    await this.persistNew(made.project);
    this.leftTab = 'blocks';
    const w = made.warnings;
    this.toast(`프로젝트 "${made.project.name}" 을(를) 만들었습니다.${w.length ? ` (경고 ${w.length}건: ${w[0]}${w.length > 1 ? ' 외' : ''})` : ''}`);
    return true;
  }

  /* ------------------------------------------------------------ 변경 적용 */

  /** 순수 변경 함수를 적용한다. null 이거나 같은 객체를 돌려주면 아무것도 하지 않는다. */
  update(fn: (p: Project) => Project | null): boolean {
    const next = fn(this.project);
    if (!next || next === this.project) return false;
    this.project = next;
    this.markDirty();
    return true;
  }

  setLang(l: string): void {
    this.lang = l;
  }

  setText(id: string, lang: string, text: string): void {
    this.update((p) => setText(p, id, lang, text));
  }

  ack(id: string, lang: string): void {
    this.update((p) => ackStale(p, id, lang));
  }

  select(id: string | null, opts: { reveal?: boolean; openEdit?: boolean } = {}): void {
    this.selectedId = id;
    const bi = id && id !== SUBJECT_ID ? blockIndexOfId(this.project.structure, id) : -1;
    this.selectedBlock = bi >= 0 ? bi : null;
    if (id && opts.reveal) this.reveal = { id, tick: (this.reveal?.tick ?? 0) + 1 };
    if (opts.openEdit !== false && id) this.setAcc('edit', true);
  }

  selectBlock(index: number): void {
    const b = this.blocks[index];
    if (!b) return;
    this.selectedBlock = index;
    this.selectedId = b.ids[0] ?? null;
    if (b.ids[0]) this.reveal = { id: b.ids[0], tick: (this.reveal?.tick ?? 0) + 1 };
    if (b.ids[0]) this.setAcc('edit', true);
  }

  /** 검사 목록 항목 → 해당 블록/표로 이동 */
  goToIssue(i: Issue): void {
    if (i.blockId) {
      this.select(i.blockId, { reveal: true });
      return;
    }
    if (i.tableId) {
      this.setAcc('dyn', true);
      return;
    }
    if (i.code === 'untranslated') this.select(SUBJECT_ID);
  }

  /* ------------------------------------------------------------ 구조 조작(모든 언어 동시) */

  moveSelectedBlock(dir: -1 | 1): void {
    const i = this.selectedBlock;
    if (i === null) return this.toast('먼저 블록을 선택하세요.');
    const r = moveBlock(this.project, i, dir);
    if (!r) return this.toast(dir < 0 ? '맨 위 블록입니다.' : '맨 아래 블록입니다.');
    this.update(() => r);
    this.selectedBlock = i + dir;
  }

  deleteSelectedBlock(): void {
    const i = this.selectedBlock;
    if (i === null) return this.toast('먼저 블록을 선택하세요.');
    const r = removeBlock(this.project, i);
    if (!r) return;
    this.update(() => r);
    this.selectedBlock = null;
    this.selectedId = null;
    this.toast('블록을 삭제했습니다(모든 언어).');
  }

  addBlock(kind: AddKind, texts?: Record<string, string[]>): void {
    const r = insertBlock(this.project, kind, this.selectedBlock, texts);
    this.update(() => r.project);
    this.selectedBlock = r.index;
    this.selectedId = r.ids[0] ?? null;
    if (r.ids[0]) {
      this.reveal = { id: r.ids[0], tick: (this.reveal?.tick ?? 0) + 1 };
      this.setAcc('edit', true);
    }
  }

  insertSnippet(s: SnippetDef): void {
    this.addBlock(s.kind, s.texts);
    this.toast(`"${s.name}"을(를) 삽입했습니다.`);
  }

  addRow(): void {
    const i = this.selectedBlock;
    const b = i === null ? null : this.blocks[i];
    if (!b || i === null) return this.toast('표 블록을 먼저 선택하세요.');
    if (b.kind === 'dynamic') return this.toast('동적 표의 행은 서버가 만듭니다. 예시 행은 [동적 표] 패널에서 추가하세요.');
    const r = addTableRow(this.project, i);
    if (!r) return this.toast('표 블록을 먼저 선택하세요.');
    this.update(() => r.project);
    this.selectedId = r.ids[0] ?? null;
    if (r.ids[0]) this.reveal = { id: r.ids[0], tick: (this.reveal?.tick ?? 0) + 1 };
  }

  canRemoveRow(): boolean {
    return !!this.selectedId && this.selectedId !== SUBJECT_ID && canRemoveTableRow(this.project, this.selectedId);
  }

  removeRow(): void {
    if (!this.selectedId) return;
    const r = removeTableRow(this.project, this.selectedId);
    if (!r) return this.toast('표에 행이 하나뿐이거나 표 행이 아닙니다.');
    this.update(() => r);
    this.selectedId = null;
    this.toast('표 행을 삭제했습니다(모든 언어).');
  }

  setBlockHref(id: string, href: string): void {
    this.update((p) => setBlockAttr(p, id, 'href', href));
  }

  /** 블록 속성(구조만 변경, 번역 불변) 적용. 버튼 그룹 풀기·합치기로 블록 번호가 바뀔 수 있어 선택 블록을 다시 맞춘다. */
  applyBlockOp(fn: (p: Project) => Project | null): boolean {
    const ok = this.update(fn);
    if (ok && this.selectedId && this.selectedId !== SUBJECT_ID) {
      const bi = blockIndexOfId(this.project.structure, this.selectedId);
      this.selectedBlock = bi >= 0 ? bi : null;
    }
    return ok;
  }

  /* ------------------------------------------------------------ 치환자 / 동적 표 */

  updateVariable(name: string, patch: { description?: string; sample?: string }): void {
    this.update((p) => updateVariable(p, name, patch));
  }
  removeVariable(name: string): void {
    this.update((p) => removeVariable(p, name));
  }
  updateTableVar(tableId: string, name: string, patch: { description?: string; sample?: string }): void {
    this.update((p) => updateTableVar(p, tableId, name, patch));
  }
  removeTableVar(tableId: string, name: string): void {
    this.update((p) => removeTableVar(p, tableId, name));
  }
  addSampleRow(tableId: string): void {
    this.update((p) => addSampleRow(p, tableId));
  }
  removeSampleRow(tableId: string, index: number): void {
    this.update((p) => removeSampleRow(p, tableId, index));
  }
  setSampleCell(tableId: string, index: number, name: string, value: string): void {
    this.update((p) => setSampleCell(p, tableId, index, name, value));
  }

  setSubject(lang: string, text: string): void {
    this.setText(SUBJECT_ID, lang, text);
  }

  /* ------------------------------------------------------------ 초안 → 새 프로젝트 */

  get draftText(): string {
    return this._draftText;
  }
  set draftText(v: string) {
    this._draftText = v;
    this.scheduleDraftPersist();
  }
  get draftName(): string | null {
    return this._draftName;
  }
  set draftName(v: string | null) {
    this._draftName = v;
    this.scheduleDraftPersist();
  }
  get draftKind(): ProjectKind {
    return this._draftKind;
  }
  set draftKind(v: ProjectKind) {
    this._draftKind = v === 'notice' ? 'notice' : 'mail';
    this.scheduleDraftPersist();
  }
  get draftCode(): string {
    return this._draftCode;
  }
  set draftCode(v: string) {
    this._draftCode = v;
    this.scheduleDraftPersist();
  }
  /** 입력창에 보이는 이름: 직접 쓴 값, 없으면 초안 첫 제목 */
  get draftNameShown(): string {
    return this._draftName ?? draftTitle(this._draftText);
  }

  private scheduleDraftPersist(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.persistDraft(), DRAFT_SAVE_MS);
  }

  /** 작성 중인 초안을 localStorage 에 즉시 백업(비어 있으면 키를 지운다). 새로고침·탭 닫기 직전에도 호출된다. */
  persistDraft(): void {
    clearTimeout(this.draftTimer);
    const s = ls();
    if (!s) return;
    try {
      if (this._draftText === '' && this._draftName === null && this._draftCode === '' && this._draftKind === 'mail') s.removeItem(LS.draft);
      else s.setItem(LS.draft, JSON.stringify({ text: this._draftText, name: this._draftName, code: this._draftCode, kind: this._draftKind }));
    } catch {
      /* 용량 초과 등은 무시: 최선 노력 */
    }
  }

  private persistDraftOpen(): void {
    try {
      if (this.draftOpen) ss()?.setItem(SS_DRAFT_OPEN, '1');
      else ss()?.removeItem(SS_DRAFT_OPEN);
    } catch {
      /* 무시 */
    }
  }

  openDraft(): void {
    this.draftError = null;
    this.draftOpen = true;
    this.persistDraftOpen();
  }

  /** 닫는다(작성 중인 초안은 그대로 유지) */
  closeDraft(): void {
    this.draftOpen = false;
    this.persistDraft();
    this.persistDraftOpen();
  }

  /**
   * 작성 중인 초안으로 새 프로젝트를 만들고 현재 프로젝트로 전환한다. 기존 프로젝트는 그대로 목록에 남는다.
   * 성공하면 작성 중이던 초안을 비운다(마지막 초안은 새 프로젝트의 draftMarkup 에만 남는다). 실패하면 이유를 draftError 로 남기고 초안은 보존한다.
   */
  async createFromDraft(): Promise<boolean> {
    if (this.draftCreating) return false;
    this.draftError = null;
    const name = this.draftNameShown.trim() || `새 프로젝트 ${this.projects.length + 1}`;
    let made: ReturnType<typeof createProjectFromDraft>;
    try {
      made = createProjectFromDraft(this._draftText, { name, templateCode: this._draftCode, kind: this._draftKind });
    } catch (e) {
      this.draftError = e instanceof Error ? e.message : String(e);
      return false;
    }
    this.draftCreating = true;
    try {
      await this.persistNew(made.project);
    } finally {
      this.draftCreating = false;
    }
    this._draftText = '';
    this._draftName = null;
    this._draftCode = '';
    this._draftKind = 'mail';
    this.persistDraft();
    this.draftOpen = false;
    this.persistDraftOpen();
    this.leftTab = 'blocks';
    const w = made.warnings.length;
    this.toast(`프로젝트 "${made.project.name}" 을(를) 만들었습니다.${w ? ` (초안 해석 경고 ${w}건)` : ''}`);
    return true;
  }

  /** 현재 UI 미사용 — 기존 프로젝트에 초안을 재적용하는 경로(변경 요약·ID 이어받기). 나중의 '초안 재적용' 기능용으로 보존. */
  planDraft(txmd: string): DraftPlan {
    return planDraft(this.project, txmd);
  }

  /** 현재 UI 미사용 — planDraft 결과를 현재 프로젝트에 적용(초안 재적용용으로 보존). */
  applyDraft(plan: DraftPlan): void {
    this.update(() => plan.next);
    this.selectedId = null;
    this.selectedBlock = null;
    const c = plan.counts;
    this.toast(`초안 적용: 새 블록 ${c.added} · 변경 ${c.changed}(번역 오래됨) · 삭제 ${c.removed}`);
  }

  /* ------------------------------------------------------------ 분석(변환 검사)·내보내기 */

  /** 모든 언어를 실제 엔진으로 인라인해 크기·변환 경고를 얻는다(느리다 — 필요할 때만). 같은 버전을 중복 실행하지 않는다. */
  runAnalysis(): Promise<void> {
    if (this.analysisFresh) return Promise.resolve();
    if (this.analysisJob) return this.analysisJob;
    const p = this.project;
    const version = this.version;
    this.analysis = { ...this.analysis, status: 'running' };
    this.analysisJob = (async () => {
      try {
        const render = projectKind(p) === 'notice' ? renderNotice : renderProject;
        const rendered = await render(p, { inline: inlineFn, css: cssFor(p) });
        this.analysis = { status: 'done', rendered, version, at: Date.now() };
      } catch (e) {
        this.analysis = { status: 'error', version, error: e instanceof Error ? e.message : String(e) };
      } finally {
        this.analysisJob = null;
      }
      // 실행 중 프로젝트가 바뀌었다면 호출자가 필요 시 다시 실행한다
    })();
    return this.analysisJob;
  }

  /** 최신 분석을 보장(필요하면 재실행) */
  async ensureAnalysis(): Promise<RenderedProject | null> {
    for (let i = 0; i < 3; i++) {
      await this.runAnalysis();
      if (this.analysis.status === 'error') return null;
      if (this.analysisFresh) return this.analysis.rendered ?? null;
    }
    return this.analysis.rendered ?? null;
  }

  get exportBlocked(): boolean {
    return this.errorCount > 0 && !this.force;
  }

  private fileBase(): string {
    return safeFilename(this.project.templateCode || this.project.name);
  }

  private async makeBundleJson(): Promise<string | null> {
    if (this.isNotice) return null; // 공지는 번들이 없다(UI 에서도 숨김)
    const rendered = await this.ensureAnalysis();
    if (!rendered) {
      this.toast('변환 중 오류가 발생해 번들을 만들지 못했습니다: ' + (this.analysis.error ?? ''));
      return null;
    }
    const issues = validateProject(this.project, { rendered, expectedRows: this.expectedRows, ignoreTranslation: this.ignoreTranslation });
    if (hasErrors(issues) && !this.force) {
      this.toast('오류가 있어 내보낼 수 없습니다. 해결하거나 [강제 내보내기]를 체크하세요.');
      return null;
    }
    return JSON.stringify(buildBundle(this.project, rendered), null, 2);
  }

  async saveBundleFile(): Promise<void> {
    const json = await this.makeBundleJson();
    if (json === null) return;
    const name = `tx-mail-bundle_${this.fileBase()}.json`;
    downloadText(name, json, 'application/json');
    this.toast(`${name} 저장`);
  }

  async copyBundle(): Promise<void> {
    const json = await this.makeBundleJson();
    if (json === null) return;
    this.toast((await copyText(json)) ? '번들 JSON 을 클립보드에 복사했습니다.' : '복사가 막혔습니다. [번들 저장]을 사용하세요.');
  }

  private async makeHandoffMd(): Promise<string | null> {
    if (this.isNotice) return null;
    const rendered = await this.ensureAnalysis();
    if (!rendered) {
      this.toast('변환 중 오류가 발생했습니다: ' + (this.analysis.error ?? ''));
      return null;
    }
    return buildHandoffMd(this.project, rendered);
  }

  async saveHandoffFile(): Promise<void> {
    const md = await this.makeHandoffMd();
    if (md === null) return;
    const name = `handoff_${this.fileBase()}.md`;
    downloadText(name, md, 'text/markdown');
    this.toast(`${name} 저장`);
  }

  async copyHandoff(): Promise<void> {
    const md = await this.makeHandoffMd();
    if (md === null) return;
    this.toast((await copyText(md)) ? 'handoff MD 를 복사했습니다.' : '복사가 막혔습니다. [MD 저장]을 사용하세요.');
  }

  /* ------------------------------------------------------------ 공지 내보내기(kind: notice) */

  /** 최신 렌더 + 검사 통과(또는 강제)일 때만 렌더 결과를 돌려준다. 막히면 안내 토스트. */
  private async noticeRendered(): Promise<RenderedProject | null> {
    if (!this.isNotice) return null;
    const rendered = await this.ensureAnalysis();
    if (!rendered) {
      this.toast('변환 중 오류가 발생해 공지를 만들지 못했습니다: ' + (this.analysis.error ?? ''));
      return null;
    }
    const issues = validateProject(this.project, { rendered, ignoreTranslation: this.ignoreTranslation });
    if (hasErrors(issues) && !this.force) {
      this.toast('오류가 있어 내보낼 수 없습니다. 해결하거나 [강제 내보내기]를 체크하세요.');
      return null;
    }
    return rendered;
  }

  async saveNoticeFile(): Promise<void> {
    const r = await this.noticeRendered();
    if (!r) return;
    const name = noticeFilename(this.fileBase());
    downloadText(name, buildNoticeHtml(this.project, r), 'text/html');
    this.toast(`${name} 저장`);
  }

  async copyNoticeAll(): Promise<void> {
    const r = await this.noticeRendered();
    if (!r) return;
    this.toast((await copyText(buildNoticeHtml(this.project, r))) ? '공지 HTML 전체를 클립보드에 복사했습니다.' : '복사가 막혔습니다. [공지 HTML 저장]을 사용하세요.');
  }

  /** 언어 하나의 구역 내용(공지 폼에 붙일 본문 HTML 만, 주석 제외) 복사 */
  async copyNoticeZone(lang: string): Promise<void> {
    const r = await this.noticeRendered();
    if (!r) return;
    this.toast((await copyText(noticeZoneContent(r, lang))) ? `${lang} 구역(본문 HTML)을 복사했습니다.` : '복사가 막혔습니다. [공지 HTML 저장]을 사용하세요.');
  }

  /** 언어 하나의 제목 텍스트 복사 */
  async copyNoticeTitle(lang: string): Promise<void> {
    const r = await this.noticeRendered();
    if (!r) return;
    this.toast((await copyText(noticeZoneTitle(r, lang))) ? `${lang} 제목을 복사했습니다.` : '복사가 막혔습니다.');
  }

  /** 현재 프로젝트에 있는 동적 표 id 목록 */
  get tableIds(): string[] {
    return (this.project.dynamicTables ?? []).map((t) => t.id);
  }
}

export const studio = new Studio();
