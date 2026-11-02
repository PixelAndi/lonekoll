import { useEffect, useState } from 'react';
import { useApp } from '../app-context.ts';
import { todayLocal } from '../domain/time.ts';
import { navigate } from '../router.ts';
import { askSlipScan, openClock } from './actions.ts';
import { Icon } from './common.tsx';

// One button for everything that adds something – the clock, a timecard, a
// pay slip, a day typed by hand – floating above the tabs on the main pages.

export function AddButton() {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <>
      {open && <button type="button" className="add-backdrop" aria-label={t('common.close')} onClick={() => setOpen(false)} />}
      {open && (
        <div className="add-menu" role="menu">
          <button type="button" role="menuitem" onClick={pick(() => openClock('scan'))}>
            <Icon name="camera" /> {t('add.clock')}
          </button>
          <button type="button" role="menuitem" onClick={pick(() => navigate({ name: 'timecard' }))}>
            <Icon name="days" /> {t('add.timecard')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pick(() => {
              askSlipScan();
              navigate({ name: 'slips' });
            })}
          >
            <Icon name="slips" /> {t('add.slip')}
          </button>
          <button type="button" role="menuitem" onClick={pick(() => navigate({ name: 'day', date: todayLocal() }))}>
            <Icon name="plus" /> {t('add.day')}
          </button>
          <button type="button" role="menuitem" onClick={pick(() => openClock('pick'))}>
            <Icon name="month" /> {t('add.photos')}
          </button>
        </div>
      )}
      <button type="button" className={`add-button ${open ? 'add-button-open' : ''}`} aria-label={t('add.title')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="plus" />
      </button>
    </>
  );
}
