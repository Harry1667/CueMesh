import { usePreferences } from '../lib/preferences';
import {
  ArrowUpRight,
  Check,
  Code2,
  FileText,
  MousePointer2,
  Search,
  ShieldCheck,
  Box,
} from 'lucide-react';
import { demoModelRouting, modelLabel } from '../data/modelRouting';

export function MeshScene({ phase = 0, hero = false }: { phase?: number; hero?: boolean }) {
  const { t } = usePreferences();

  return (
    <div
      className={`mesh-scene ${hero ? 'mesh-scene--hero' : ''}`}
      data-phase={phase}
      role="img"
      aria-label={`${t('Example routing')}. ${t('Research')}: ${modelLabel(demoModelRouting.research.primary)}. ${t('Coding')}: ${modelLabel(demoModelRouting.coding.primary)}. ${hero ? '3D' : t('Review')}: ${modelLabel(demoModelRouting[hero ? '3d' : 'review'].primary)}.`}
    >
      <div className="scene-grid" />
      <div className="scene-coordinate scene-coordinate--top">{t('CONTEXT / INTENT / ACTION')}</div>
      <svg className="scene-wires" viewBox="0 0 680 500" fill="none" aria-hidden="true">
        <path d="M160 230C240 230 230 250 316 250M364 250C430 250 410 120 510 120M364 250H510M364 250C430 250 410 380 510 380" />
        <circle cx="316" cy="250" r="4" />
        <circle cx="364" cy="250" r="4" />
      </svg>
      <div className="context-fragment">
        <div className="fragment-top">
          <FileText size={13} />
          <span>{t('Selected context')}</span>
          <span>01</span>
        </div>
        <div className="fragment-line" />
        <p>{t('Build a materials explorer.')}</p>
        <span className="selection-cursor">
          <MousePointer2 size={16} fill="currentColor" />
          {t('Your cue')}
        </span>
      </div>
      <div className="scene-core">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <strong>CueMesh</strong>
        <span>{t('One shared brief')}</span>
      </div>
      <div className="scene-agent scene-agent--research">
        <span>
          <Search size={17} />
        </span>
        <div>
          <small>{t('RESEARCH')}</small>
          <strong>{modelLabel(demoModelRouting.research.primary)}</strong>
        </div>
        <i />
      </div>
      <div className="scene-agent scene-agent--code">
        <span>
          <Code2 size={17} />
        </span>
        <div>
          <small>{t('CODING')}</small>
          <strong>{modelLabel(demoModelRouting.coding.primary)}</strong>
        </div>
        <i />
      </div>
      <div className="scene-agent scene-agent--review">
        <span>{hero ? <Box size={17} /> : <ShieldCheck size={17} />}</span>
        <div>
          <small>{hero ? '3D' : t('REVIEW')}</small>
          <strong>{modelLabel(demoModelRouting[hero ? '3d' : 'review'].primary)}</strong>
        </div>
        <i />
      </div>
      <div className="scene-result">
        <span className="scene-result-check">
          <Check size={18} />
        </span>
        <div>
          <small>{t('ONE COORDINATED RESULT')}</small>
          <strong>{t('A clearer path from idea to done.')}</strong>
          <span>
            {t('Output + sources + handoffs')}
            <ArrowUpRight size={13} />
          </span>
        </div>
      </div>
      <div className="scene-coordinate scene-coordinate--bottom">
        {t('CUE → MESH → RESULT')}
        <span>{t('CONCEPT ILLUSTRATION')}</span>
      </div>
    </div>
  );
}
