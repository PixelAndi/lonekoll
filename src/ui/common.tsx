import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../app-context.ts';
import type { RowStatus } from '../domain/compare.ts';
import { db } from '../db.ts';

export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="page">
      <header className="page-header">
        <h1>{title}</h1>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2 className="card-title">{title}</h2>}
      {children}
    </section>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export function StatusBadge({ status }: { status: RowStatus }) {
  const { t } = useApp();
  return <span className={`badge badge-${status}`}>{t(`status.${status}`)}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose?: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <header className="modal-header">
          <h2>{title}</h2>
          {onClose && (
            <button type="button" className="icon-button" onClick={onClose} aria-label="×">
              ×
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </div>
  );
}

/** Object URL for a stored photo, revoked when the component unmounts. */
export function usePhotoUrl(id: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let objectUrl: string | undefined;
    void db.photos.get(id).then((p) => {
      if (!alive || !p) return;
      objectUrl = URL.createObjectURL(p.blob);
      setUrl(objectUrl);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url;
}

export function PhotoThumb({ id, onClick }: { id: string; onClick?: () => void }) {
  const url = usePhotoUrl(id);
  if (!url) return <div className="thumb thumb-empty" />;
  return (
    <button type="button" className="thumb" onClick={onClick}>
      <img src={url} alt="" />
    </button>
  );
}

const icons = {
  days: 'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm-2 8h14v10H5V10Zm2 2v2h2v-2H7Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Z',
  month: 'M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z',
  slips: 'M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM8 12v2h8v-2H8Zm0 4v2h8v-2H8Z',
  settings:
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.4 4.6.1-1.1-.1-1.1 2.1-1.6-2-3.5-2.5 1a8 8 0 0 0-1.9-1.1L15.7 3h-4l-.4 2.7a8 8 0 0 0-1.9 1.1l-2.5-1-2 3.5 2.1 1.6-.1 1.1.1 1.1-2.1 1.6 2 3.5 2.5-1a8 8 0 0 0 1.9 1.1l.4 2.7h4l.4-2.7a8 8 0 0 0 1.9-1.1l2.5 1 2-3.5-2.1-1.6Z',
  camera: 'M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
  chevronLeft: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12l4.6-4.6Z',
  chevronRight: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6Z',
} as const;

export function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={icons[name]} />
    </svg>
  );
}
