import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./i18n/config";
import "./styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: true,
    },
  },
});

// Tauri 윈도우 포커스 이벤트를 React Query에 연동.
// focusManager만 갱신하면 refetchOnWindowFocus가 stale된 쿼리만 선택적으로
// refetch한다. 전역 invalidateQueries()는 staleTime을 무력화해 아바타·워크플로우
// 실행 등 비용이 큰 네트워크 쿼리까지 포커스마다 재실행시키므로 사용하지 않는다.
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  focusManager.setFocused(focused);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
