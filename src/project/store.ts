import Dexie, { type EntityTable } from 'dexie';
import { projectKind, type Project, type ProjectKind } from './model';

/** 기존 `CSSInlinerHistory` DB 와 별개의 새 DB. */
export const PROJECT_DB_NAME = 'TxMailStudio';

export interface ProjectSummary {
  id: string;
  name: string;
  templateCode?: string;
  kind: ProjectKind;
  langs: string[];
  updatedAt: number;
}

class StudioDB extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ projects: 'id, updatedAt, name' });
  }
}

export class ProjectStore {
  private db: StudioDB;
  constructor(dbName: string = PROJECT_DB_NAME) {
    this.db = new StudioDB(dbName);
  }

  /** 저장(없으면 생성, 있으면 덮어쓰기). 기본은 updatedAt 을 지금으로 갱신하고, 저장된 객체를 반환한다. */
  async save(project: Project, opts: { touch?: boolean } = {}): Promise<Project> {
    const next = opts.touch === false ? project : { ...project, updatedAt: Date.now() };
    await this.db.projects.put(next);
    return next;
  }

  async get(id: string): Promise<Project | undefined> {
    return this.db.projects.get(id);
  }

  /** 최근 수정 순(updatedAt 내림차순) 전체 프로젝트 */
  async list(): Promise<Project[]> {
    return this.db.projects.orderBy('updatedAt').reverse().toArray();
  }

  async listSummaries(): Promise<ProjectSummary[]> {
    return (await this.list()).map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.templateCode !== undefined ? { templateCode: p.templateCode } : {}),
      kind: projectKind(p),
      langs: p.langs,
      updatedAt: p.updatedAt,
    }));
  }

  async delete(id: string): Promise<void> {
    await this.db.projects.delete(id);
  }

  async count(): Promise<number> {
    return this.db.projects.count();
  }

  close(): void {
    this.db.close();
  }
}
