import { useEffect, useState } from "react";
import type { DocDiffModel } from "./types";
import type { DocDiffRequest, DocDiffResponse } from "./worker";

/**
 * Worker 한 대를 앱 전체가 공유한다. 문서 diff는 사용자가 파일을 고를 때 한 번씩 나므로
 * 동시 요청이 거의 없고, Worker 인스턴스를 화면마다 만들면 markdown-it 번들을 그만큼
 * 다시 파싱한다.
 *
 * **브라우저 하한**: module worker(`type: "module"`)는 Safari 15+다. 문서 diff는 그보다
 * 낮은 WebKit에서 동작하지 않는다. `Intl.Segmenter`(Safari 14.1+)에는 폴백이 있으므로
 * (`spans.ts`) 실질 하한은 여기서 결정된다. CSS Custom Highlight API(Safari 17.2+)를
 * 피한 것과 같은 이유로 정한 선이며, `tauri.conf.json`의 `minimumSystemVersion: "10.15"`
 * 보다는 높다 — 둘을 맞출지는 별도 판단이 필요하다.
 */
let worker: Worker | null = null;
let nextId = 1;

function spawn(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/**
 * 계산이 이 시간을 넘으면 Worker를 죽인다.
 *
 * **Worker로 옮겼다고 무한정 기다려도 되는 건 아니다.** 병리적인 문서 하나가 Worker를 물고
 * 늘어지면 그 뒤의 모든 문서 diff가 큐 뒤에서 굶는다. 끊고 폴백을 보여주는 쪽이 정직하다.
 */
const TIMEOUT_MS = 8000;

export type DocDiffState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; model: DocDiffModel }
  | { status: "error"; error: string };

/** 옛/새 마크다운 원문에서 문서 diff 모델을 만든다. */
export function useDocDiff(oldSrc: string, newSrc: string): DocDiffState {
  const [state, setState] = useState<DocDiffState>({ status: "idle" });

  useEffect(() => {
    const id = nextId++;
    let done = false;
    setState({ status: "loading" });

    const w = spawn();

    const onMessage = (e: MessageEvent<DocDiffResponse>) => {
      // 취소된 요청의 뒤늦은 응답 — 화면을 되돌리면 안 된다.
      if (e.data.id !== id || done) return;
      done = true;
      cleanup();
      if (e.data.ok) setState({ status: "ready", model: e.data.model });
      else setState({ status: "error", error: e.data.error });
    };

    const onError = (e: ErrorEvent) => {
      if (done) return;
      done = true;
      cleanup();
      setState({ status: "error", error: e.message });
    };

    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      // 물고 늘어지는 Worker는 죽인다 — 다음 요청은 새 Worker에서 시작한다.
      w.terminate();
      if (worker === w) worker = null;
      setState({ status: "error", error: "timeout" });
    }, TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    const req: DocDiffRequest = { id, oldSrc, newSrc };
    w.postMessage(req);

    return () => {
      done = true; // 언마운트 후 도착하는 응답을 무시한다
      cleanup();
    };
  }, [oldSrc, newSrc]);

  return state;
}
