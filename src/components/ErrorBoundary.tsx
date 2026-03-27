import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { translate } from '../i18n/translate';

function uiIsEn(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('rdk-ui-locale') === 'en';
}

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const isEn = uiIsEn();
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
          <h2 style={{ color: '#ef4444', marginBottom: 12 }}>
            {translate(isEn, 'errorBoundary.title', '页面出现异常')}
          </h2>
          <p style={{ fontSize: 14, marginBottom: 16 }}>{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '8px 20px', borderRadius: 8, border: '1px solid #e2e8f0',
              background: '#fff', cursor: 'pointer', fontSize: 14,
            }}
          >
            {translate(isEn, 'errorBoundary.retry', '重试')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
