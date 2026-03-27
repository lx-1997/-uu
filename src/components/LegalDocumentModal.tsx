import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  PRIVACY_POLICY_EN,
  PRIVACY_POLICY_ZH,
  TERMS_OF_SERVICE_EN,
  TERMS_OF_SERVICE_ZH,
  type LegalSection,
} from '../legal/documents';
import { useI18n } from '../i18n/use-i18n';

export type LegalDocKind = 'terms' | 'privacy';

function renderSections(sections: LegalSection[]) {
  return sections.map((s) => (
    <section key={s.heading} className="legal-doc-section">
      <h3 className="legal-doc-h3">{s.heading}</h3>
      {s.paragraphs.map((p, i) => (
        <p key={i} className="legal-doc-p">
          {p}
        </p>
      ))}
    </section>
  ));
}

export default function LegalDocumentModal({
  kind,
  onClose,
  elevated,
}: {
  kind: LegalDocKind;
  onClose: () => void;
  /** 叠在「关于」弹窗之上时使用（同 z-index 层内提高顺序） */
  elevated?: boolean;
}) {
  const { isEn } = useI18n();
  const doc = useMemo(() => {
    if (kind === 'terms') return isEn ? TERMS_OF_SERVICE_EN : TERMS_OF_SERVICE_ZH;
    return isEn ? PRIVACY_POLICY_EN : PRIVACY_POLICY_ZH;
  }, [kind, isEn]);

  const node = (
    <div
      className={elevated ? 'modal-overlay modal-overlay--stack-elevated' : 'modal-overlay modal-overlay--stack'}
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-doc-title"
      onClick={onClose}
    >
      <div className="modal-content legal-doc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="legal-doc-title" className="modal-title" style={{ margin: 0 }}>
            {doc.title}
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body legal-doc-modal-body">
          <p className="legal-doc-intro">{doc.intro}</p>
          {renderSections(doc.sections)}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            {isEn ? 'OK' : '知道了'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
