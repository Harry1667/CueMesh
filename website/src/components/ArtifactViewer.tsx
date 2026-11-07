import { usePreferences } from '../lib/preferences';
import { useEffect, useMemo, useState } from 'react';
import { Code2, Download, Eye, FileText } from 'lucide-react';
import type { Artifact } from '../lib/contracts';
import { artifactPreview } from '../lib/artifactPreview';

export function ArtifactViewer({ artifacts }: { artifacts: Artifact[] }) {
  const { t } = usePreferences();

  const [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const selected = artifacts.find((item) => item.id === selectedId) ?? artifacts[0];
  const source = useMemo(
    () => (selected?.kind === 'html' ? artifactPreview(selected.content) : ''),
    [selected],
  );
  const [downloadUrl, setDownloadUrl] = useState('');
  useEffect(() => {
    if (!selected) {
      setDownloadUrl('');
      return;
    }
    const url = URL.createObjectURL(
      new Blob([selected.content], { type: 'text/plain;charset=utf-8' }),
    );
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);
  if (!selected)
    return (
      <div className="empty-state">
        <FileText />
        <h3>{t('No artifacts yet.')}</h3>
      </div>
    );
  return (
    <div className="artifact-viewer">
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            className={selected.id === artifact.id ? 'selected' : ''}
            onClick={() => setSelectedId(artifact.id)}
          >
            <FileText size={16} />
            <span>
              {artifact.name}
              <small>
                {artifact.kind} · {artifact.createdBy}
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="artifact-stage">
        <div className="artifact-toolbar">
          <strong>{selected.name}</strong>
          <div>
            {selected.kind === 'html' ? (
              <>
                <button
                  aria-label={t('Preview artifact')}
                  aria-pressed={view === 'preview'}
                  onClick={() => setView('preview')}
                >
                  <Eye size={15} />
                </button>
                <button
                  aria-label={t('View artifact source')}
                  aria-pressed={view === 'source'}
                  onClick={() => setView('source')}
                >
                  <Code2 size={15} />
                </button>
              </>
            ) : null}
            <a
              href={downloadUrl || undefined}
              download={selected.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}
              aria-label={t('Download {name}', { name: selected.name })}
            >
              <Download size={15} />
            </a>
          </div>
        </div>
        {selected.kind === 'html' && view === 'preview' ? (
          <iframe
            title={t('Static preview of {name}', { name: selected.name })}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={source}
          />
        ) : (
          <pre className="artifact-code">{selected.content}</pre>
        )}
        <p className="artifact-caption">
          {t(
            'HTML is displayed in an isolated preview. Scripts, forms, and external requests are blocked.',
          )}
        </p>
      </div>
    </div>
  );
}
