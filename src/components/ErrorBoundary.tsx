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
      const err = this.state.error;
      return (
        <div className="error-boundary">
          <h2 className="error-boundary-title">
            {translate(isEn, 'errorBoundary.title', '页面出现异常')}
          </h2>
          <p className="error-boundary-lead">
            {translate(
              isEn,
              'errorBoundary.lead',
              '当前区域渲染失败。可点击下方重试；若多次出现，请把「技术详情」一并反馈。',
            )}
          </p>
          <details className="error-boundary-details">
            <summary className="error-boundary-summary">
              {translate(isEn, 'errorBoundary.details', '技术详情')}
            </summary>
            <pre className="error-boundary-pre">{err.message}</pre>
          </details>
          <button
            type="button"
            className="btn btn-primary error-boundary-retry"
            onClick={() => this.setState({ error: null })}
          >
            {translate(isEn, 'errorBoundary.retry', '重试')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
