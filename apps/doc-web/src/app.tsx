import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import { LoginPage } from './pages/login';
import { DocumentListPage } from './pages/document-list';
import { DocumentEditorPage } from './pages/document-editor';
import { KnowledgeBaseListPage } from './pages/knowledge-base-list';
import { KnowledgeBaseViewPage } from './pages/knowledge-base-view';
import { RequireAuth } from './pages/require-auth';
import { themeTokens } from './styles/tokens';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: themeTokens,
      }}
    >
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/documents" element={<DocumentListPage />} />
                <Route path="/documents/:id" element={<DocumentEditorPage />} />
                <Route path="/kb" element={<KnowledgeBaseListPage />} />
                <Route path="/kb/:kbId" element={<KnowledgeBaseViewPage />} />
                <Route path="/kb/:kbId/:nodeId" element={<KnowledgeBaseViewPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/kb" replace />} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
