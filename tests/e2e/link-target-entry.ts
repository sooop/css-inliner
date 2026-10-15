import { convertToInline } from '../../src/engine/css-converter';
import { exportBundle, verifyBundle } from '../../src/project';
import { createSampleProject } from '../../src/ui/state/sample';
import { createProjectFromDraft } from '../../src/ui/state/draft';

(window as any).__lt = { convertToInline, exportBundle, verifyBundle, createSampleProject, createProjectFromDraft };
