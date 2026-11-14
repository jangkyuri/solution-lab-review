import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import koKR from '@astryxdesign/core/locales/ko-KR.generated.js';
import { Theme } from '@astryxdesign/core/theme';
import { stoneTheme } from '@astryxdesign/theme-stone/built';
import { App } from './App';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-stone/theme.css';
import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/forms.css';
import './styles/document.css';
import './styles/astryx-work.css';

if (import.meta.env.DEV && import.meta.env['VITE_DISABLE_REACT_DEVTOOLS'] !== '1') {
  void import('react-grab');
  void import('react-scan');
}

const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing.');
createRoot(element).render(<StrictMode>
  <InternationalizationProvider locale="ko-KR" messages={{ 'ko-KR': koKR }}>
    <Theme theme={stoneTheme} mode="light"><App /></Theme>
  </InternationalizationProvider>
</StrictMode>);
