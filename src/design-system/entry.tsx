/**
 * GitBaro Design System 아트팩트의 `components/bundle.js`를 만드는 라이브러리 진입점.
 * `pnpm ds:bundle`(vite.ds.config.ts)이 이 파일과 그 의존성(실제 GitBaro 컴포넌트, React)을
 * 하나의 classic IIFE 스크립트로 묶어 `window.GitBaro`에 매단다 — 아트팩트 미리보기는 그 카드마다
 * 진짜 컴포넌트를 실제 props로 마운트한다(손으로 베낀 정적 HTML이 아니다).
 */
import "@/styles/globals.css";
import * as React from "react";
import { createElement, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import * as ReactDOM from "react-dom/client";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { GitBranch, Inbox } from "lucide-react";

import i18n from "@/i18n/config";
import { avatarColor } from "@/lib/avatar-color";
import { computeGraphLanes } from "@/lib/graph-lanes";
import { graphColumnWidth, laneColor } from "@/components/graph/graph-model";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Count, StatusChip, RefLabel as RefLabelMark, RepoTile, Dot, Code, FileStatusLetter } from "@/components/ui/marks";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { DialogFrame } from "@/components/ui/DialogFrame";
import { Segmented, type SegmentedOption } from "@/components/ui/Segmented";
import { TextInput, Textarea, SearchInput } from "@/components/ui/TextInput";
import { ContextMenu, type ContextMenuSection } from "@/components/ui/ContextMenu";
import { TabGroup, Tab } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";
import { SectionLabel, PanelHeader, PanelSearch } from "@/components/ui/PanelHeader";
import { Spinner, BusyIcon } from "@/components/ui/Spinner";
import { LoadingState } from "@/components/ui/LoadingState";
import { Select, type SelectOption } from "@/components/ui/Select";
import { BranchCombobox } from "@/components/ui/BranchCombobox";
import { Switch } from "@/components/settings/ui/Switch";
import { FocusFlash } from "@/components/ui/FocusFlash";
import { ErrorToast } from "@/components/error/ErrorToast";
import { useToastStore } from "@/stores/toast";
import { RowSignals } from "@/components/sidebar/RowSignals";
import { GraphRow } from "@/components/graph/GraphRow";
import { FileTouchesList } from "@/components/review/FileTouchesList";
import type { FileTouchRow } from "@/components/review/file-touches-model";

import { DEMO_BRANCHES, DEMO_COMMITS, DEMO_GROUPED_FILE_TOUCHES, DEMO_ROW_SIGNALS } from "./demo-data";

/* ── 부트스트랩: i18n은 ko 고정, 테마는 아트팩트의 data-theme을 앱의 .dark 클래스로 옮긴다 ── */

i18n.changeLanguage("ko");

function syncTheme(): void {
  const isDark = document.documentElement.dataset.theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
}
syncTheme();
if (typeof MutationObserver !== "undefined") {
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/* ── mount: 미리보기 문서가 부를 단 하나의 진입점 ── */

const roots = new WeakMap<Element, Root>();

function mount(el: Element, node: ReactNode): () => void {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  root.render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
  return () => {
    root?.unmount();
    roots.delete(el);
  };
}

/* ── 값이 여럿인 카드를 한 화면에 늘어놓는 작은 틀 ── */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <p className="text-[11.5px] text-muted-foreground mb-2">{label}</p>
      <div className="flex items-center gap-2.5 flex-wrap">{children}</div>
    </div>
  );
}

/* ── Button ── */

function ButtonGallery() {
  return (
    <div>
      <Row label="변형 — primary / secondary / ghost / danger(확인 창 전용)">
        <Button variant="primary">커밋</Button>
        <Button variant="secondary">비교</Button>
        <Button variant="ghost">취소</Button>
        <Button variant="danger">삭제</Button>
        <Button variant="secondary" tone="danger">
          삭제
        </Button>
      </Row>
      <Row label="크기 — sm 24 / md 28 / lg 36">
        <Button size="sm" variant="secondary">
          다시 시도
        </Button>
        <Button size="md" variant="secondary">
          다시 시도
        </Button>
        <Button size="lg" variant="primary">
          시작하기
        </Button>
      </Row>
      <Row label="상태 — busy / 꺼짐(마우스는 받아 title 풍선말) / iconOnly">
        <Button variant="primary" busy>
          commit 중
        </Button>
        <Button variant="primary" disabled title="변경한 파일이 없어요">
          커밋
        </Button>
        <Button variant="ghost" iconOnly aria-label="닫기" title="닫기">
          <GitBranch className="w-3.5 h-3.5" />
        </Button>
      </Row>
    </div>
  );
}

/* ── 작은 표시(marks.tsx) — 카드마다 하나씩 ── */

function CountDemo() {
  return (
    <Row label="점 곁의 수 / 받을·올릴 커밋">
      <Count value={3} tone="live" />
      <Count value={2} prefix="↓" tone="sync" />
      <Count value={1} prefix="↑" tone="sync" />
    </Row>
  );
}

function StatusChipDemo() {
  return (
    <Row label="톤 여섯 가지">
      <StatusChip tone="neutral">초안</StatusChip>
      <StatusChip tone="success">성공</StatusChip>
      <StatusChip tone="danger">실패</StatusChip>
      <StatusChip tone="warning">충돌 예상</StatusChip>
      <StatusChip tone="info">보는 중</StatusChip>
      <StatusChip tone="live">지금 바뀌는 중</StatusChip>
    </Row>
  );
}

function RefLabelDemo() {
  return (
    <Row label="local / remote / head / tag / worktree">
      <RefLabelMark name="feat/agent-review-ux" kind="local" />
      <RefLabelMark name="origin/main" kind="remote" />
      <RefLabelMark name="main" kind="head" />
      <RefLabelMark name="v2.0.0" kind="tag" />
      <RefLabelMark name="review-worktree" kind="worktree" />
    </Row>
  );
}

function RepoTileDemo() {
  const color = avatarColor("gitbaro");
  return (
    <Row label="sm / md / lg / xl">
      <RepoTile name="gitbaro" color={color} size="sm" />
      <RepoTile name="gitbaro" color={color} size="md" />
      <RepoTile name="gitbaro" color={color} size="lg" />
      <RepoTile name="gitbaro" color={color} size="xl" />
    </Row>
  );
}

function DotDemo() {
  return (
    <Row label="꺼짐 / 켜짐 / live(테 퍼짐) / breathe(숨쉬기)">
      <Dot on={false} />
      <Dot on />
      <Dot on live />
      <Dot on breathe />
    </Row>
  );
}

function CodeDemo() {
  return (
    <div>
      <Row label="줄 안 조각">
        <Code>git push --force-with-lease</Code>
      </Row>
      <Row label="덩어리">
        <Code block>git rebase --onto main HEAD~3</Code>
      </Row>
    </div>
  );
}

function FileStatusLetterDemo() {
  return (
    <Row label="M A D R C U !">
      <FileStatusLetter status="modified" />
      <FileStatusLetter status="added" />
      <FileStatusLetter status="deleted" />
      <FileStatusLetter status="renamed" />
      <FileStatusLetter status="copied" />
      <FileStatusLetter status="untracked" />
      <FileStatusLetter status="ignored" />
    </Row>
  );
}

/* ── Card ── */

function CardDemo() {
  return (
    <Card className="w-[320px] h-[130px]">
      <div className="h-8 shrink-0 flex items-center px-3 border-b border-(--line) text-[12.5px] font-bold">
        변경된 파일
      </div>
      <div className="flex-1 flex items-center justify-center text-[11.5px] text-muted-foreground">
        본문 칸의 모든 덩어리가 이 위에 놓인다
      </div>
    </Card>
  );
}

/* ── EmptyState ── */

function EmptyStateGallery() {
  return (
    <div className="flex gap-6">
      <Card className="w-[220px] h-[160px]">
        <EmptyState icon={Inbox} title="아직 커밋한 변경이 없어요" description="파일을 고쳐서 여기서 커밋해 보세요" />
      </Card>
      <Card className="w-[220px]">
        <EmptyState layout="row" title="일치하는 브랜치가 없어요" />
      </Card>
    </div>
  );
}

/* ── Notice ── */

function NoticeGallery() {
  return (
    <div className="flex flex-col gap-2.5 w-[420px]">
      <Notice tone="info" title="보는 중">
        체크아웃하지 않고 이 브랜치를 보고 있어요.
      </Notice>
      <Notice tone="warning" title="충돌 예상">
        병합하면 3개 파일이 충돌할 수 있어요.
      </Notice>
      <Notice tone="danger" role="alert">
        push에 실패했습니다: 인증이 만료됐어요.
      </Notice>
      <Notice tone="success" banner>
        3개 저장소를 fetch했습니다.
      </Notice>
    </div>
  );
}

/* ── DialogFrame ── */

function DialogFrameDemo() {
  return (
    <DialogFrame
      title="브랜치 삭제"
      size="sm"
      footerStart={<span className="text-[11.5px] text-muted-foreground">되돌릴 수 없어요</span>}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost">취소</Button>
          <Button variant="danger">삭제</Button>
        </div>
      }
    >
      <p className="text-[12.5px] text-foreground">fix/graph-redesign 브랜치를 삭제할까요?</p>
    </DialogFrame>
  );
}

/* ── Segmented ── */

const SEGMENTED_OPTIONS: SegmentedOption<string>[] = [
  { value: "changes", label: "변경" },
  { value: "history", label: "히스토리" },
];

function SegmentedDemo() {
  const [value, setValue] = useState("changes");
  return <Segmented value={value} options={SEGMENTED_OPTIONS} onChange={setValue} ariaLabel="작업 전환" />;
}

/* ── TextInput / Textarea / SearchInput ── */

function TextInputGallery() {
  const [name, setName] = useState("feat/agent-review-ux");
  const [message, setMessage] = useState("에이전트가 바꾼 diff를 검토하는 화면 정리");
  const [query, setQuery] = useState("graph");
  return (
    <div className="flex flex-col gap-3 w-[320px]">
      <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="브랜치 이름" />
      <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} aria-label="커밋 메시지" />
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        placeholder="파일 찾기"
        aria-label="파일 찾기"
      />
    </div>
  );
}

/* ── ContextMenu ── */

function ContextMenuDemo() {
  const sections: ContextMenuSection[] = useMemo(
    () => [
      {
        items: [
          { label: "보통으로 push", onClick: () => {}, checked: true },
          { label: "force-with-lease로 push", onClick: () => {} },
        ],
      },
      {
        items: [
          {
            label: "강제 push",
            description: "원격의 다른 커밋을 덮어씁니다",
            variant: "danger" as const,
            onClick: () => {},
          },
        ],
      },
    ],
    [],
  );
  return (
    <div className="relative h-[200px]">
      <ContextMenu sections={sections} position={{ x: 24, y: 24 }} onClose={() => {}} ariaLabel="push 옵션" />
    </div>
  );
}

/* ── Tabs ── */

function TabsDemo() {
  const [active, setActive] = useState(0);
  return (
    <TabGroup aria-label="리뷰 탭" className="w-[360px]">
      <Tab active={active === 0} onClick={() => setActive(0)} count={5}>
        변경
      </Tab>
      <Tab active={active === 1} onClick={() => setActive(1)}>
        히스토리
      </Tab>
      <Tab active={active === 2} onClick={() => setActive(2)} disabled>
        PR
      </Tab>
    </TabGroup>
  );
}

/* ── Tooltip ── */

function TooltipGallery() {
  return (
    <div className="flex items-center gap-4">
      <p className="text-[11.5px] text-muted-foreground">마우스를 올리면 풍선말이 보여요 →</p>
      <Tooltip label="force-with-lease로 push">
        <Button variant="ghost" size="sm">
          push
        </Button>
      </Tooltip>
    </div>
  );
}

/* ── SectionLabel / PanelHeader ── */

function SectionLabelGallery() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex flex-col gap-2 w-[280px]">
      <SectionLabel title="여러 커밋이 건드림" />
      <SectionLabel
        title="커밋 하나만"
        collapsed={collapsed}
        count={4}
        onToggle={() => setCollapsed((c) => !c)}
        expandLabel="펼치기"
        collapseLabel="접기"
      />
      <SectionLabel title="gitbaro" banner />
    </div>
  );
}

function PanelHeaderDemo() {
  const [query, setQuery] = useState("");
  return (
    <Card className="w-[340px]">
      <PanelHeader
        titleId="ds-panel-title"
        title="브랜치"
        subtitle="gitbaro"
        primaryLabel="새로 만들기"
        onPrimary={() => {}}
        closeLabel="닫기"
        onClose={() => {}}
      />
      <PanelSearch value={query} onChange={setQuery} placeholder="브랜치 찾기" />
    </Card>
  );
}

/* ── Spinner / BusyIcon / LoadingState — 카드마다 하나씩 ── */

function SpinnerDemo() {
  return (
    <Row label="sm 12 / md 14 / lg 20">
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
    </Row>
  );
}

function BusyIconDemo() {
  return (
    <Row label="쉴 때 아이콘, 일할 때 회전 표시">
      <BusyIcon busy={false} icon={<GitBranch className="w-3.5 h-3.5" />} />
      <BusyIcon busy icon={<GitBranch className="w-3.5 h-3.5" />} />
    </Row>
  );
}

function LoadingStateDemo() {
  return (
    <div className="w-[300px]">
      <LoadingState label="저장소를 불러오는 중" />
    </div>
  );
}

/* ── Select ── */

const SELECT_OPTIONS: SelectOption[] = [
  { value: "unified", label: "한 화면" },
  { value: "split", label: "나눠 보기" },
];

function SelectDemo() {
  const [value, setValue] = useState("unified");
  return <Select value={value} options={SELECT_OPTIONS} onChange={setValue} className="w-[200px]" />;
}

/* ── BranchCombobox ── */

function BranchComboboxDemo() {
  const [value, setValue] = useState("feat/agent-review-ux");
  return (
    <div className="w-[260px]">
      <BranchCombobox value={value} branches={DEMO_BRANCHES} onChange={setValue} />
    </div>
  );
}

/* ── Switch ── */

function SwitchGallery() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <Switch checked={on} onChange={setOn} ariaLabel="알림 켜짐" />
      <Switch checked={off} onChange={setOff} ariaLabel="알림 꺼짐" />
      <Switch checked={true} onChange={() => {}} disabled ariaLabel="고정 켜짐(끔)" />
    </div>
  );
}

/* ── FocusFlash ── */

function FocusFlashDemo() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative isolate w-[220px] h-9 rounded-(--radius-item) bg-(--chip) flex items-center px-3 text-[12.5px]">
        <FocusFlash key={key} testId="ds-focus-flash" />
        방금 바뀐 줄
      </div>
      <Button size="sm" variant="secondary" onClick={() => setKey((k) => k + 1)}>
        다시 비추기
      </Button>
    </div>
  );
}

/* ── Toast(ErrorToast) ── */

function ToastDemo() {
  const seeded = useToastStore((s) => s.toasts.length > 0);
  const addToast = useToastStore((s) => s.addToast);
  useEffect(() => {
    // 카드가 처음 마운트될 때만 미리 채운다 — seeded가 true로 바뀐 뒤 다시 불려도 곧장 반환한다.
    if (seeded) return;
    addToast("push에 실패했습니다: 인증이 만료됐어요", "error");
    addToast("3개 저장소를 fetch했습니다", "success");
  }, [seeded, addToast]);
  return (
    <div className="relative h-[160px]">
      <ErrorToast />
    </div>
  );
}

/* ── SidebarRowSignals(패턴) ── */

function SidebarRowSignalsDemo() {
  const [now] = useState(() => Date.now());
  return (
    <Card className="w-[260px] p-1">
      {DEMO_ROW_SIGNALS.map(({ repo, values }) => {
        const color = avatarColor(repo);
        return (
          <div key={repo} className="flex items-center gap-1.5 h-7 px-2 rounded-(--radius-item) text-[12.5px]">
            <RepoTile name={repo} color={color} size="md" />
            <span className="flex-1 min-w-0 truncate">{repo}</span>
            <RowSignals values={values} now={now} />
          </div>
        );
      })}
    </Card>
  );
}

/* ── GraphRow(패턴) ── */

function GraphRowDemo() {
  const [selected, setSelected] = useState<string | null>("c4");
  const [hovered, setHovered] = useState<string | null>(null);
  const layouts = useMemo(() => {
    const rows = computeGraphLanes(DEMO_COMMITS.map((c) => ({ oid: c.id, parentIds: c.parentIds }))).rows;
    return new Map(rows.map((row) => [row.oid, row]));
  }, []);
  const width = useMemo(
    () => graphColumnWidth(Math.max(...Array.from(layouts.values()).map((l) => l.width))),
    [layouts],
  );
  const colorOf = useCallback((chain: number) => laneColor("gitbaro-demo", chain), []);

  return (
    <Card className="w-[560px]">
      {DEMO_COMMITS.map((commit) => {
        const layout = layouts.get(commit.id);
        if (!layout) return null;
        return (
          <GraphRow
            key={commit.id}
            commit={commit}
            layout={layout}
            graphWidth={width}
            colorOf={colorOf}
            remoteTags={null}
            isSelected={selected === commit.id}
            isHighlighted={hovered === commit.id}
            wipAbove={false}
            dot={commit.isUnpushed ? "unpushed" : "pushed"}
            onClick={() => setSelected(commit.id)}
            onMouseEnter={() => setHovered(commit.id)}
            onMouseLeave={() => setHovered(null)}
          />
        );
      })}
    </Card>
  );
}

/* ── FileTouchesRow(패턴, FileTouchesList) ── */

function FileTouchesRowDemo() {
  const [selectedKey, setSelectedKey] = useState<string | null>("graphrow");
  const [activeIndex, setActiveIndex] = useState(0);
  const repoLabel = useCallback(() => "gitbaro", []);
  const avatarColorOf = useCallback(() => avatarColor("gitbaro"), []);
  const onSelect = useCallback((row: FileTouchRow, index: number) => {
    setSelectedKey(row.key);
    setActiveIndex(index);
  }, []);
  const itemRef = useCallback(() => () => {}, []);
  const containerProps = useMemo(() => ({ tabIndex: 0, onKeyDown: () => {}, style: {} }), []);

  return (
    <Card className="w-[380px]">
      <FileTouchesList
        grouped={DEMO_GROUPED_FILE_TOUCHES}
        selectedKey={selectedKey}
        activeIndex={activeIndex}
        repoLabel={repoLabel}
        avatarColorOf={avatarColorOf}
        onSelect={onSelect}
        containerProps={containerProps}
        itemRef={itemRef}
      />
    </Card>
  );
}

/* ── window.GitBaro ── */

const GitBaro = {
  React,
  ReactDOM,
  h: createElement,
  mount,
  i18n,
  Button,
  Card,
  Count,
  StatusChip,
  RefLabel: RefLabelMark,
  RepoTile,
  Dot,
  Code,
  FileStatusLetter,
  EmptyState,
  Notice,
  DialogFrame,
  Segmented,
  TextInput,
  Textarea,
  SearchInput,
  ContextMenu,
  TabGroup,
  Tab,
  Tooltip,
  SectionLabel,
  PanelHeader,
  PanelSearch,
  Spinner,
  BusyIcon,
  LoadingState,
  Select,
  BranchCombobox,
  Switch,
  FocusFlash,
  ErrorToast,
  RowSignals,
  GraphRow,
  FileTouchesList,
  demo: {
    ButtonGallery,
    CountDemo,
    StatusChipDemo,
    RefLabelDemo,
    RepoTileDemo,
    DotDemo,
    CodeDemo,
    FileStatusLetterDemo,
    CardDemo,
    EmptyStateGallery,
    NoticeGallery,
    DialogFrameDemo,
    SegmentedDemo,
    TextInputGallery,
    ContextMenuDemo,
    TabsDemo,
    TooltipGallery,
    SectionLabelGallery,
    PanelHeaderDemo,
    SpinnerDemo,
    BusyIconDemo,
    LoadingStateDemo,
    SelectDemo,
    BranchComboboxDemo,
    SwitchGallery,
    FocusFlashDemo,
    ToastDemo,
    SidebarRowSignalsDemo,
    GraphRowDemo,
    FileTouchesRowDemo,
  },
};

export default GitBaro;
