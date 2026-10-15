import { convertToInline } from '../../src/engine/css-converter';
import { exportBundle, verifyBundle, renderProject } from '../../src/project';
import { makeProject } from '../../src/project/__tests__/fixture';

(window as any).__e2e = { convertToInline, exportBundle, verifyBundle, renderProject, makeProject };
