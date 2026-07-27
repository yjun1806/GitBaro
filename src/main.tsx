// SPDX-License-Identifier: GPL-3.0-or-later
// 반드시 "./App"보다 위에 있어야 한다. App을 import하는 순간 zustand persist가
// hydrate하므로, 비대해진 레거시 활동 로그는 그 전에 걷어내야 한다.
// (import 순서는 storage-cleanup.test.ts가 검증한다)
import "./lib/storage-cleanup";
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

// 프로덕션 빌드에서 웹뷰 기본 우클릭 메뉴(Reload·뒤로 가기 등)를 숨긴다.
// 입력/텍스트영역/편집 가능 요소에서는 복사·붙여넣기용 네이티브 메뉴를 유지하고,
// 그 외 영역의 기본 메뉴만 막는다(앱 자체 컨텍스트 메뉴는 각 요소에서 별도 처리).
// dev에서는 우클릭 → 요소 검사(devtools)를 위해 그대로 둔다.
if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement | null;
    const editable = target?.closest("input, textarea, [contenteditable='true']");
    if (!editable) {
      e.preventDefault();
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
