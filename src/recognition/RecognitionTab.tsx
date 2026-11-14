import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBox, Spinner } from '../components/ui';
import { useClub } from '../club/ClubProvider';
import type { UseMatch } from '../matches/useMatch';
import { ReceptionPanel } from './ReceptionPanel';
import { ScoresheetPanel } from './ScoresheetPanel';
import { SystemsPanel } from './SystemsPanel';
import { useRecognition } from './useRecognition';

type Section = 'systems' | 'reception' | 'sheet';

// Pestanya "Anàlisi assistida" del partit (reconeixement de jugades, fase 0.1):
// dades prèvies per a l'anàlisi i verificació amb l'acta oficial.
export function RecognitionTab({ m }: { m: UseMatch }) {
  const { t } = useTranslation();
  const { canEdit } = useClub();
  const r = useRecognition(m);
  const [section, setSection] = useState<Section>('systems');

  if (r.loading) return <Spinner />;
  if (r.missingMigration) return <div className="notice">{t('recognition.missingMigration')}</div>;

  return (
    <div className="stack rec-tab">
      {r.error && <ErrorBox message={r.error} />}
      <div className="segmented" role="tablist">
        {(['systems', 'reception', 'sheet'] as Section[]).map((s) => (
          <button key={s} role="tab" aria-selected={section === s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>
            {t(`recognition.sections.${s}`)}
          </button>
        ))}
      </div>
      {section === 'systems' && <SystemsPanel m={m} r={r} canEdit={m.canCode} />}
      {section === 'reception' && <ReceptionPanel m={m} r={r} canEdit={canEdit} />}
      {section === 'sheet' && <ScoresheetPanel m={m} r={r} canEdit={m.canCode} />}
    </div>
  );
}
