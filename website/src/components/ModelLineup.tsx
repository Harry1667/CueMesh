import { demoModelRouting, modelLabel } from '../data/modelRouting';
import { usePreferences } from '../lib/preferences';

export function ModelLineup() {
  const { t } = usePreferences();
  return (
    <details className="model-lineup">
      <summary>
        {t('Model lineup')}
        <span>{t('Example routing')}</span>
      </summary>
      <div className="model-lineup-scroll">
        <table>
          <caption className="sr-only">{t('Example routing')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('Task')}</th>
              <th scope="col">{t('Primary')}</th>
              <th scope="col">{t('Fallback')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(demoModelRouting).map(([role, route]) => (
              <tr key={role}>
                <th scope="row">{t(route.label)}</th>
                <td>{modelLabel(route.primary)}</td>
                <td>
                  {route.fallbacks.map((id) => (
                    <span key={id}>{modelLabel(id)}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
