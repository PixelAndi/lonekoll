import qrcode from 'qrcode-generator';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { appAddress, canShareLink, shareAppLink } from '../share.ts';
import { Card, Icon, Modal } from './common.tsx';

// Passing the app on: a QR code of its address to scan from this phone's screen, the share sheet,
// or the address copied. Only the address – nothing the user has entered. The code is drawn here,
// on the phone; nothing is fetched.

/** The address as a QR code, dark squares on white (scans in dark mode too). */
function QrCode({ text }: { text: string }) {
  const { cells, size } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const out: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) out.push(`M${c} ${r}h1v1h-1z`);
    return { cells: out.join(''), size: n };
  }, [text]);
  const q = 4; // the quiet zone scanners need around the code
  return (
    <svg className="share-qr" viewBox={`${-q} ${-q} ${size + 2 * q} ${size + 2 * q}`} role="img" aria-label={text} shapeRendering="crispEdges">
      <rect x={-q} y={-q} width={size + 2 * q} height={size + 2 * q} fill="#fff" />
      <path d={cells} fill="#000" />
    </svg>
  );
}

export function ShareAppCard() {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="card issue-link share-app-link" onClick={() => setOpen(true)}>
        <span>
          <strong>{t('shareApp.title')}</strong>
          <span className="small muted"> · {t('shareApp.sub')}</span>
        </span>
        <Icon name="chevronRight" />
      </button>
      {open && <ShareAppSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareAppSheet({ onClose }: { onClose: () => void }) {
  const { t } = useApp();
  const address = appAddress();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal title={t('shareApp.title')} onClose={onClose}>
      <p className="share-hint">{t('shareApp.scan')}</p>
      <QrCode text={address} />
      <p className="share-address">{address}</p>
      <div className="button-row share-buttons">
        {canShareLink() && (
          <button type="button" className="button button-primary" onClick={() => void shareAppLink(t('app.title'), t('shareApp.message')).catch(() => undefined)}>
            {t('shareApp.share')}
          </button>
        )}
        <button type="button" className="button" onClick={() => void copy()}>
          {copied ? `✓ ${t('shareApp.copied')}` : t('shareApp.copy')}
        </button>
      </div>
      <Card>
        <p className="small">{t('shareApp.private')}</p>
        <p className="small muted">{t('shareApp.install')}</p>
      </Card>
    </Modal>
  );
}
