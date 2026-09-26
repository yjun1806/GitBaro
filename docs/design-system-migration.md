# 디자인 시스템 적용 목록

완료 (2026-09-26) — 모든 항목 적용됨. 남은 예외: SplitHandle grip, diff viewer internals text sizes, avatar initials 9px, toolbar/tab count pills per D35, WorkSwitcher는 Segmented 사용, CommitGraph ViewingNote는 손그림으로 중복 역할 회피.

`docs/design-system.md`의 규칙대로 코드를 맞추는 작업 목록이다. 줄 번호는 2026-09-26 작업 트리 기준이다(다른 작업이 겹치면 줄이 밀릴 수 있으니 내용으로 찾는다). 규칙 번호(`D1` …)는 `design-system.md` 4장, 절 번호(`3.1` …)는 3장을 가리킨다.

세 사람이 파일을 겹치지 않게 나눈다. 1번이 먼저 `src/components/ui/`에 공용 부품을 만들고, 2·3번은 그동안 부품이 필요 없는 항목(글자 크기, 토큰, 채움)부터 하다가 부품이 들어오면 갈아 끼운다.

| 담당 | 폴더 |
|---|---|
| 1 기초·껍데기 | `ui/`, `layout/`, `toolbar/`, `settings/`, `account/`, `repository/`, `welcome/`, `error/`, `lib/file-status.tsx` |
| 2 git 화면 | `graph/`, `history/`, `branch/`, `worktree/`, `commit/`, `stash/` |
| 3 리뷰 화면 | `review/`, `live/`, `diff/`, `pr/`, `actions/`, `conflict/`, `sidebar/` |

불러오는 중 표시(`Spinner`·`LoadingState`·`BusyIcon`)와 움직임 클래스는 다른 작업이 옮기는 중이라 여기에 없다(`docs/loading-design.md`). 왼쪽 세로 막대(사이드바 선택 막대, 설정 탐색 막대, 그래프 WIP 막대, diff 새 줄 안쪽 막대)와 바탕 하나로 합치기(`--frame` = `--canvas`)는 이미 코드에 들어갔다(D33·D34). 새로 만드는 부품(`Notice`, `EmptyState`, `DialogFrame`, `Button`)에 왼쪽 막대를 넣지 않는다.

## 0. 새 공용 부품 (담당 1, 가장 먼저)

모두 `src/components/ui/`에 둔다. 아래는 props 초안이다. 기존 원형이 있으면 그 코드를 옮겨 와서 시작한다.

### `Button.tsx` (3.1)

```ts
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;   // 기본 secondary
  size?: ButtonSize;         // 기본 md
  tone?: "danger";           // secondary·ghost의 빨간 글자(목록 줄의 삭제)
  icon?: ReactNode;          // 앞 아이콘. busy면 BusyIcon으로 바뀐다
  busy?: boolean;            // disabled + aria-busy + BusyIcon
  iconOnly?: boolean;        // 정사각. aria-label 필수
}
export function Button(props: ButtonProps): JSX.Element;
export function buttonClass(opts: Pick<ButtonProps, "variant" | "size" | "tone" | "iconOnly">): string; // <a>·<label>에 같은 모양
```

- 크기표: `sm` `h-6 px-2.5 text-[11.5px] font-semibold` 아이콘 `w-3 h-3` / `md` `h-7 px-3 text-[12.5px]`(primary·secondary는 `font-semibold`, ghost는 `font-medium`) 아이콘 `w-3.5 h-3.5` / `lg` `h-9 px-4 text-[13px] font-semibold` 아이콘 `w-4 h-4`. 모두 `rounded-(--radius-chip)`, `disabled:opacity-45`, `focus-visible:ring-2 focus-visible:ring-ring/40`.
- 원형: `branch/BranchPanelRow.tsx:33`(`CHIP_BUTTON`, sm secondary), `settings/ui/styles.ts:4`(`SETTINGS_BUTTON`, md), `review/GitStatusLine.tsx:51`(`CHIP`, sm primary).

### `marks.tsx` (3.2, 3.3)

```ts
export function Count({ value, prefix, tone }: { value: number; prefix?: "●" | "↑" | "↓" | ""; tone: "live" | "sync" | "muted"; label?: string });
export function StatusChip({ tone, icon, children }: { tone: "neutral" | "success" | "danger" | "warning" | "info" | "live"; icon?: ReactNode; children: ReactNode });
export function RefLabel({ name, kind, laneColor, className }: { name: string; kind: "local" | "remote" | "head" | "tag" | "tag-local" | "worktree"; laneColor?: string | null; className?: string });
export function RepoTile({ name, color, size }: { name: string; color: AvatarColor; size: "sm" | "md" | "lg" | "xl" });
export function Dot({ on, live, breathe, label }: { on: boolean; live?: boolean; breathe?: boolean; label?: string });
export function Code({ block, children }: { block?: boolean; children: ReactNode });
export function FileStatusLetter({ status }: { status: FileStatus });   // lib/file-status.tsx에서 옮긴다
```

- 원형: `Count` ← `sidebar/RowSignals.tsx:33-72`; `StatusChip` ← `pr/PrBits.tsx:10`(`CHIP`); `RefLabel` ← `history/CommitItem.tsx:25-73` + `graph/lane-style.ts`(`LANE_LABEL_CLASS`, `laneLabelStyle`); `RepoTile` ← `sidebar/row-style.ts:13`(`LEADING_TILE`) + `settings/repo/RepoAvatarBadge.tsx`; `Dot` ← `RowSignals.tsx:46-53`; `FileStatusLetter` ← 원형이던 `review/FilesByRepo.tsx`는 없앴다. 모양은 `design-system.md`의 파일 상태 글자를 따른다.

### `Card.tsx`, `EmptyState.tsx`, `Notice.tsx`, `DialogFrame.tsx`

```ts
export function Card({ children, className }): JSX.Element;                      // layout/ContentArea.tsx:150에서 옮긴다. ContentArea는 재수출
export function EmptyState({ icon, title, description, action, layout = "panel" }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode; layout?: "panel" | "row" });
export function Notice({ tone, icon, title, children, actions, banner, role }: { tone: "info" | "warning" | "danger" | "success" | "neutral"; icon?: LucideIcon; title?: string; children?: ReactNode; actions?: ReactNode; banner?: boolean; role?: "status" | "alert" });
export function DialogFrame({ title, titleId, onClose, size = "md", dismissible, footer, footerStart, children }: { title: string; titleId?: string; onClose?: () => void; size?: "sm" | "md" | "lg" | "xl"; dismissible?: boolean; footer?: ReactNode; footerStart?: ReactNode; children: ReactNode });
```

- `DialogFrame`은 `Dialog`를 감싼다. 판 클래스 `cn(FLOATING_SURFACE, "rounded-(--radius-panel) w-full mx-4", SIZE[size])`, 크기 `sm max-w-[360px]` / `md max-w-[440px]` / `lg max-w-[620px]` / `xl w-[94vw] h-[88vh]`. 머리 `px-4 py-3 border-b border-(--line)` + `h2 text-[14px] font-semibold` + 닫기 `<Button iconOnly size="md" variant="ghost">`. 몸 `px-4 py-4`. 발 `px-4 py-3 border-t border-(--line) flex items-center gap-2`(`footerStart`는 왼쪽, `footer`는 오른쪽).

### `Segmented.tsx`, `TextInput.tsx`

- `settings/ui/Segmented.tsx`를 `ui/`로 옮기고 `size?: "md" | "sm"`(조각 `h-6 text-[12.5px]` / `h-5 text-[11.5px]`)을 더한다. `settings/ui/row-context`의 `useSettingsRowIds`는 옵션으로 남긴다. `settings/ui/Segmented.tsx`는 재수출.
- `settings/ui/controls.tsx`의 `FIELD`를 `ui/TextInput.tsx`로 옮긴다: `TextInput`(`md h-7` / `sm h-6`), `SearchInput`(`bg-(--chip)` 테두리 없음, 앞 `Search` 12px, `surface?: "panel" | "frame"` — 층 0에서는 `bg-card border border-(--line2)`), `Textarea`(같은 테두리·모서리, `leading-[18px]`). `controls.tsx`의 `SettingsTextInput`·`SettingsSelect`는 이것을 쓰도록 바꾼다.

### 기존 부품 고치기

| 파일:줄 | 바꿀 것 | 규칙 |
|---|---|---|
| `ui/PanelHeader.tsx:43` | 제목 `text-sm` → `text-[14px] font-semibold`; `:45` 부제 `text-(--faint)` → `text-muted-foreground` | 3.5, D18 |
| `ui/PanelHeader.tsx:51` | 주요 버튼 `h-[26px] … text-xs font-bold` → `<Button variant="primary" size="md">` | D8 |
| `ui/PanelHeader.tsx:60` | 닫기 → `<Button iconOnly size="md" variant="ghost">` | 3.1 |
| `ui/PanelHeader.tsx:80` | `PanelSearch` → `SearchInput size="md"`로 구현(`h-[30px]`·`text-[12.5px]` 제거) | D25 |
| `ui/PanelHeader.tsx:97-131` | `PanelSectionHeader` → `SectionLabel`로 이름을 바꾸고(옛 이름 재수출) 글자 `text-[11px] font-bold` → `text-[11.5px] font-semibold`; 접은 수는 `<Count tone="muted">` | D16, D1 |
| `ui/PanelHeader.tsx:138` | `PanelEmptyState` → `EmptyState layout="row"` 재수출 | D15 |
| `ui/ContextMenu.tsx:102-116` | 메뉴 `rounded-lg py-1` → `rounded-(--radius-item) p-1`; 항목 `px-3 py-1.5 text-sm` → `h-7 px-2.5 rounded-(--radius-chip) text-[12.5px]`; `anchored?: { anchorRef; align }` prop을 더해 드롭다운도 이걸로 | D14 |
| `ui/Tabs.tsx:13-34` | `TabColor` `info`·`success`와 `badge` 클래스 삭제 | D26 |
| `ui/Tabs.tsx:36-39` | `md` `text-sm` → `text-[12.5px]`, `sm` `text-xs` → `text-[11.5px]` | 2.2 |
| `ui/Tooltip.tsx:56` | `rounded-md px-2 py-1 text-xs` → `rounded-(--radius-chip) px-2 py-1 text-[11.5px]` | 3.10 |
| `ui/Select.tsx:59-66,87-96` | 트리거 `px-3 py-2 text-sm rounded-lg` → `h-7 px-2.5 text-[12.5px] rounded-(--radius-item)`; 옵션 `py-2 text-sm` → `h-7 text-[12.5px]`; 목록 `rounded-lg` → `rounded-(--radius-item) p-1` | D25, D14 |
| `ui/BranchCombobox.tsx:77-84,116-172` | 위와 같음; 옵션 둘째 줄 `text-[11px]` → `text-[11.5px]`; 빈 결과 `:135` → `EmptyState layout="row"` | D25, D15 |
| `ui/ConfirmCommandDialog.tsx:31-97` | `DialogFrame size="md"`로; 명령 `:52` → `<Code block>`; 경고 `:58-66` → `<Notice tone="warning">`; 발 버튼 → `Button md ghost` / `primary`·`danger` | D13, D23 |
| `ui/layers.ts` | 그대로. `Card`가 `PANEL_SURFACE`를 쓴다 | |

## 1. 담당 1 — 기초·껍데기

| 파일:줄 | 바꿀 것 | 규칙 |
|---|---|---|
| `lib/file-status.tsx:26-32` | `statusTextColors.renamed`·`copied` `text-primary` → `text-info` | 3.3 |
| `lib/file-status.tsx:56-79` | `FileStatusBadge` 삭제, `FileStatusLetter`(`ui/marks.tsx`)로 대체. 쓰는 곳: `commit/FileEntry.tsx:87`, `history/CommitDetail.tsx:426`, `live/FollowPanel.tsx:313`, `stash/StashDetailView.tsx:37`(담당 2·3이 갈아 끼운다) | D5 |
| `layout/ContentArea.tsx:40-50` | `EmptyState`를 `ui/EmptyState.tsx`로 옮기고 원 64px·아이콘 32px 삭제 | D15 |
| `layout/ContentArea.tsx:71` | 오류 글 → `<Notice tone="danger">` | 3.7 |
| `layout/ContentArea.tsx:150-157` | `Card` → `ui/Card.tsx`로 옮기고 재수출 | D27 |
| `layout/MainColumn.tsx:26` | 머리 `h-10` → `h-8`; `:33` 닫기 → `Button iconOnly md ghost` | 3.5 |
| `layout/ActivityLogPanel.tsx:29,41,55-73` | `text-xs` → 행 `text-[12.5px]`(명령) / 메타 `text-[11.5px]`; 행 `py-1.5` → `h-7` | 3.4 |
| `layout/ActivityLogPanel.tsx:85,93` | `pre … bg-muted rounded` → `<Code block>` | 3.2 |
| `layout/ActivityLogPanel.tsx:120-137` | 제목 `text-xs font-semibold` → `text-[12.5px] font-bold`; `(N)` → `<Count tone="muted">`; `p-1 rounded` 버튼 둘 → `Button iconOnly sm ghost` | 3.5, D1 |
| `layout/ActivityLogPanel.tsx:144,154` | 빈 글 → `EmptyState layout="row"`; 더 보기 → `Button sm ghost` | D15 |
| `layout/MaximizedFileList.tsx:27,39` | 머리 `h-[36px] text-[11px] … text-(--faint)`와 그룹 `text-[10.5px]` → `SectionLabel` | D16 |
| `layout/MaximizedFileList.tsx:68-76` | 이름 `text-[12px]` → `text-[12.5px]`; 폴더·줄 수 `text-[10.5px]` → `text-[11.5px]`; `text-(--faint)` → `text-muted-foreground` | 2.2, D20 |
| `layout/ListDiffSplit.tsx:35` | `CARD` 상수 → `Card` | D27 |
| `toolbar/ActionButton.tsx:134-167` | `ActionMenu` → `ContextMenu anchored`(설명 줄은 항목의 `description`) | D14 |
| `toolbar/WorktreeZone.tsx:90` | 워크트리 수 알약 → `<Count tone="muted">` | D29 |
| `toolbar/AccountDropdown.tsx:26-78` | → `ContextMenu anchored`; `:36` 버튼 → `Button sm primary` | D14 |
| `toolbar/AutoSyncHint.tsx:67,86` | `text-[10px]` → `text-[10.5px]`; `:87` 투명도 → 글자 단계 | 2.2, D18 |
| `toolbar/RepoCrumb.tsx:37` | 타일 → `<RepoTile size="lg">`; `:45,54` `text-(--faint)` → `text-muted-foreground` | D6, D18 |
| `settings/ui/styles.ts:4-12` | `SETTINGS_BUTTON` → `buttonClass({ size: "md" })`(테두리 삭제), `SETTINGS_BUTTON_DANGER` → `tone: "danger"`, `SETTINGS_ICON_BUTTON` → `buttonClass({ iconOnly: true, size: "sm", variant: "ghost" })` | D9 |
| `settings/ui/SettingsShell.tsx:56` | `font-bold` → `font-semibold`; `:75` 닫기 → `Button iconOnly md ghost` | D11 |
| `settings/ui/SettingsNav.tsx:50` | `h-8 … text-[13px]` → `h-7 text-[12.5px]` | 3.4 |
| `settings/ui/SettingsRow.tsx:33,38` | 이름 `text-[13px]` → `text-[12.5px]`; 설명 `text-[12px] leading-[17px]` → `text-[11.5px]` | 2.2 |
| `settings/ui/SettingsSection.tsx:24,28` | 제목 → `SectionLabel`(카드 밖 변형); 설명 `text-[12px]` → `text-[11.5px]` | D16 |
| `settings/ui/Segmented.tsx` | `ui/Segmented.tsx`로 옮기고 재수출; 조각 `text-[12px]` → `text-[12.5px]` | D24 |
| `settings/ui/controls.tsx` | `FIELD` → `ui/TextInput.tsx`; `SettingsSelect`·`SettingsTextInput`은 그것을 감싼다 | D25 |
| `settings/AccountSettings.tsx:63-99` | `SETTINGS_BUTTON` → `Button`; `:88` `text-[13px]` → `text-[12.5px]`; `:89,150-162` `text-[12px]` → `text-[11.5px]` | 2.2 |
| `settings/AccountSettings.tsx:114-134` | 로그아웃 확인 → `DialogFrame size="sm"` + 발 `Button md ghost`/`danger` | D13 |
| `settings/NotificationSettings.tsx:75` | → `Button` | 3.1 |
| `settings/app/GeneralSection.tsx:85,90,95` | 경로 → `<Code>`; 버튼 → `Button` | 3.2 |
| `settings/app/ToolsSection.tsx:62` | 선택 줄 `text-[13px]` → `text-[12.5px]`; `:69` 체크 `text-primary` → `text-foreground` | 2.2, 원칙 2 |
| `settings/app/AboutSection.tsx:21,29,82,89` | 경로 → `<Code>`; 버튼 → `Button` | 3.2 |
| `settings/app/app-icons.tsx:59-82` | 타일 `w-7 h-7 rounded-md` → `rounded-(--radius-item)`(28px 유지) | 2.4 |
| `settings/repo/RepoAvatarBadge.tsx` | 삭제 → `RepoTile size="xl"`; `RepoSettingsDialog.tsx:51` 갈아 끼움 | D6 |
| `settings/repo/NameSection.tsx:125` | 색 견본 `rounded-[7px]` → `rounded-(--radius-item)`; `:64` → `Button` | 2.4 |
| `settings/repo/InfoSection.tsx:15-22,41-64,88-106` | `MONO` 코드 → `<Code>`; 버튼 → `Button md secondary` / `iconOnly sm` | 3.2 |
| `settings/repo/DangerSection.tsx:33` | → `<Button variant="secondary" tone="danger">` | 3.1 |
| `account/GhLoginDialog.tsx:125` | 판 → `DialogFrame size="sm"`(제목 없는 흐름이면 `ariaLabel`만); `:146-255` 버튼 → `Button lg primary` / `md ghost`; `text-sm` → `text-[12.5px]` | D10, 2.2 |
| `account/GhSetupGuard.tsx:52-65,88-93` | 명령 → `<Code block>`; 버튼 → `Button lg primary`; 링크 `text-primary hover:underline` 유지 | 3.2 |
| `account/AccountSelectDialog.tsx:30-97` | → `DialogFrame size="sm"`; 계정 줄 `:59` → 두 줄 행 `min-h-11 rounded-(--radius-item)`; `:77` 체크 `text-primary` → `text-foreground`; 발 → `Button md` | D13, 3.4 |
| `account/GhAccountDetectedDialog.tsx:47-131` | → `DialogFrame size="md"`; `:51` 브랜드 틴트 원 삭제(아이콘 24px `text-muted-foreground`); `:82-91` 손으로 만든 체크 → 네이티브 `checkbox accent-primary`; `:125,131` → `Button md primary` / `secondary` | 원칙 2, 3.8 |
| `account/AccountAvatar.tsx:46` | 대체 글자 `bg-primary/10 text-primary` → `bg-(--chip) text-(--fg2)` | 원칙 2 |
| `repository/CloneDialog.tsx:140-391` | → `DialogFrame size="lg"`; `:197-243` 계정 드롭다운 → `Select`; `:256-266` → `SearchInput md`; `:331,348` → `TextInput md`; `:353` → `Button md secondary`; `:363` 오류 → `Notice danger`; `:374,382` → `Button md ghost`/`primary` | D13, D25 |
| `repository/AddRepoDialog.tsx:24-26,49-59` | → `DialogFrame size="sm"`; 선택 카드 `hover:border-primary hover:bg-primary/10` → `hover:bg-accent`, `rounded-xl` → `rounded-(--radius-item)` | 원칙 2 |
| `repository/RepoListView.tsx:409` (먼저) | 그룹 안 목록의 왼쪽 안내선 `ml-3 pl-3 border-l border-border/50` → 선 없이 `pl-3` 들여쓰기만. 왼쪽 세로 선은 남기지 않는다 | D33 |
| `repository/RepoListView.tsx:61-130,342-356` | 두 드롭다운 → `ContextMenu anchored` | D14 |
| `repository/RepoListView.tsx:63,400` | `uppercase tracking-wider` 머리 → `SectionLabel`; `:403` 수 → `<Count tone="muted">` | D16, D1 |
| `repository/RepoListView.tsx:322-339` | 검색 → `SearchInput md`; 추가 버튼 → `Button iconOnly md ghost` | D25 |
| `repository/RepoListView.tsx:366-368` | 빈 결과 → `EmptyState`(원·`opacity-40` 삭제) | D15 |
| `repository/RepoListView.tsx:447-460` | 저장소 줄 `py-2 text-sm` → `min-h-11 text-[12.5px]`; 선택 `bg-primary/10` → `bg-(--acc-sel)`; `:457` 타일 → `<RepoTile size="xl">` | D19, D6 |
| `repository/RepoListView.tsx:496-553,581` | `text-muted-foreground/60` 등 투명도 → 글자 단계; `text-xs` 메타 → `text-[11.5px]` | D18 |
| `repository/RepoSyncIndicator.tsx:33` | 점 → `<Dot>`; `:40-52` 화살표 아이콘 + `text-primary`/`text-danger` → `<Count prefix="↑" tone="sync">`·`↓` | D7, D1 |
| `welcome/WelcomeScreen.tsx:35,73` | `transition-all duration-150`·`transition-opacity duration-300` → `transition-colors` | D31 |
| `welcome/WelcomeScreen.tsx:77` | `shadow-lg shadow-primary/20` → `shadow-(--shadow)`; `:119` `/50` → `text-muted-foreground` | 2.5, D18 |
| `welcome/WelcomeScreen.tsx:34-58` | 선택 카드 → `Button lg`(primary 하나, 나머지 secondary) 또는 카드 안 `buttonClass` | 3.1 |
| `error/ErrorToast.tsx:6-33,58-70` | 톤 채움 삭제 → `FLOATING_SURFACE rounded-(--radius-item) px-3 py-2.5`, 아이콘만 톤 색(`text-danger` …), 글 `text-[12.5px] text-foreground`; 닫기 → `Button iconOnly sm ghost` | D22 |
| `error/ErrorBoundary.tsx:47-48,62` | 원 삭제, 아이콘 `w-6 h-6 text-danger`; 버튼 → `Button md primary` | D15 |

## 2. 담당 2 — git 화면

| 파일:줄 | 바꿀 것 | 규칙 |
|---|---|---|
| `graph/GraphRow.tsx:218,240` | 작성자 `text-[12px]` → `text-[12.5px]`; 시각 `text-[12px]` → `text-[11.5px]`; `:243,248` `text-(--faint)` → `text-muted-foreground` | 2.2, D18 |
| `graph/GraphRow.tsx:374-391` | WIP 행 브랜치·워크트리 이름표 → `<RefLabel kind="worktree" laneColor>`(색 없으면 `kind="local"`) | D4 |
| `graph/GraphRow.tsx:393` | `text-[11px]` → `text-[11.5px]` | 2.2 |
| `graph/GraphRow.tsx:459-465` | 구분선 이름표 → `<StatusChip tone="neutral">`; 시각 `text-[12px]` → `text-[11.5px]` | D2 |
| `graph/CommitGraph.tsx:419,763` | 열 머리 `text-[11px] … text-(--faint)` → `text-[11.5px] … text-muted-foreground` | D16 |
| `graph/CommitGraph.tsx:446,776` | 빈 글 → `EmptyState layout="row"` | D15 |
| `graph/CommitGraph.tsx:515` | 「보는 중이라 WIP를 숨김」 안내 줄(`ViewingNote`) → `<Notice tone="neutral" banner>` | 3.7 |
| `graph/CommitGraph.tsx:703,895` | 저장소 레인 이름표·구분선 이름표 → `RefLabel`/`StatusChip neutral` | D4 |
| `graph/CommitGraph.tsx:901` | `text-[12px]` → `text-[11.5px]` | 2.2 |
| `graph/GraphPanel.tsx:161` | 카드 클래스 → `Card` | D27 |
| `graph/ViewBranchPicker.tsx:47,55,56,63` | 항목 `h-8` → `h-7`; mono `text-xs` → `text-[11.5px]`; 힌트 `text-[11px] text-(--faint)` → `text-[11.5px] text-muted-foreground`; 그룹 제목 → `SectionLabel` | 3.4, D16 |
| `graph/ViewBranchPicker.tsx:107` | 트리거 → `Button sm ghost`(`viewing`이면 `text-info` 아이콘 유지) | 3.1 |
| `graph/ViewBranchPicker.tsx:124` | 판 `shadow-[0_24px_60px…] ring-1` → `FLOATING_SURFACE rounded-(--radius-panel)`; `:178` → `EmptyState layout="row"` | D12 |
| `graph/CompareChip.tsx:26` | `bg-(--acc-sel)` → `bg-info/10 text-foreground`(선택이 아니라 상태); `:37` 닫기 `rounded-[4px]` → `rounded-(--radius-chip)` | 원칙 2 |
| `history/CommitItem.tsx:25-73` | 이름표 구현 삭제 → `<RefLabel kind=…>`(`isHead`→`head`, `isRemote`→`remote`, 태그→`tag`/`tag-local`, 레인 색→`worktree`) | D4 |
| `history/CommitDetail.tsx:295` | 본문 `text-xs` → `text-[11.5px]`; `:147,352,367` `text-(--faint)` → `text-muted-foreground` | D18 |
| `history/CommitDetail.tsx:398` | 파일 목록 머리 → `SectionLabel` | D16 |
| `history/CommitDetail.tsx:417-437` | 파일 줄 `py-1.5` → `h-7`; `FileStatusBadge` → `FileStatusLetter`; 이름 `text-xs` → `text-[12.5px]`; 폴더 둘째 줄(`text-[10px] …/50`) → 이름 뒤 `text-[11.5px] text-muted-foreground`; `ring-1` → `ring-1 ring-inset` | D5, D21, 3.4 |
| `history/MergeActionPanel.tsx:93,139` | `text-xs` → `text-[11.5px]` | 2.2 |
| `history/MergeActionPanel.tsx:107-111,148-199` | 브랜치 쌍·사전 점검·주의 상자(`/8`·`/15`) → `<Notice tone=…>`; `:177` 링크 버튼 → `Button sm ghost`; `:186` `text-[10px]` → `text-[11.5px]` | D23 |
| `history/MergeActionPanel.tsx:116-135` | 전략 고르기(테두리 묶음, `py-2.5 text-[11px]`) → `<Segmented size="md">` | D24 |
| `history/MergeActionPanel.tsx:208-216` | 병합 버튼 → `Button md primary`(`w-full` 유지) | 3.1 |
| `history/ConflictPreviewModal.tsx:242-262` | → `DialogFrame size="xl"`; 제목 `text-sm` → 14px; `:251` 파일 수 알약 → `<Count tone="muted">`; 닫기 → `Button iconOnly md ghost` | D13, D1 |
| `history/ConflictPreviewModal.tsx:266-290,321-333` | 범례·머리 `text-[11px]`/`text-[10px]` → `text-[11.5px]` | 2.2 |
| `history/ConflictPreviewModal.tsx:295-315` | 파일 줄 → `h-7 text-[12.5px]`, 둘째 줄 폴더 → 같은 줄 `text-[11.5px]`; `:303` `bg-primary/10` → `bg-(--acc-sel)` | 3.4, D19 |
| `history/ConflictPreviewModal.tsx:132,136,145` | `text-muted-foreground/50` → `text-muted-foreground` | D18 |
| `history/ConflictPreviewModal.tsx:342-362` | 오류 → `Notice danger`; 빈 상태 → `EmptyState` | 3.6, 3.7 |
| `history/ResetCommitDialog.tsx:29-96` | → `DialogFrame size="md"`; 라디오 목록 설명 `text-[13px]` → `text-[11.5px] text-muted-foreground`; `:75` → `Notice warning`; 발 → `Button md ghost`/`danger` | D13, D10 |
| `history/CommitBranchDialog.tsx:38-88` | → `DialogFrame size="md"`; 라벨 `text-xs` → `text-[11.5px] font-semibold text-(--fg2)`; 입력 `:57-72` → `TextInput md`; 오류 `text-destructive` → `text-danger`; 발 → `Button md` | D13, D25 |
| `branch/BranchPanel.tsx:189-213` | 손으로 만든 구역 머리 → `SectionLabel`(접기·수·오른쪽 `trailing`); 정렬 버튼 `h-5 … text-[10.5px]` → `Button sm ghost` | D16, D8 |
| `branch/BranchPanel.tsx:253` | 판 그림자·ring → `FLOATING_SURFACE rounded-(--radius-panel)` | D12 |
| `branch/BranchPanelRow.tsx:33,162-175` | `CHIP_BUTTON` → `Button sm secondary` | D8 |
| `branch/BranchPanelRow.tsx:120` | 브랜치 mono `text-xs` → `text-[11.5px]`; `:126-131` 워크트리 칩 → `<RefLabel kind="worktree">`; `:135,145` `text-[11px] text-(--faint)` → `text-[11.5px] text-muted-foreground` | 2.2, D4, D18 |
| `branch/BranchStatusBadge.tsx` | 구현 → `<StatusChip tone="success">`/`warning` | D2 |
| `branch/CreateBranchDialog.tsx:63-198` | → `DialogFrame size="md"`; 라벨·입력·라디오 목록·발은 `CommitBranchDialog`와 같은 규칙(`text-[13px]` 설명 → `text-[11.5px]`) | D13, D10 |
| `branch/DeleteBranchDialog.tsx:26-70` | → `DialogFrame size="sm"`; `:50` → `Notice warning`; 발 → `Button md ghost`/`danger` | D13 |
| `branch/RenameBranchDialog.tsx:58-118` | → `DialogFrame size="md"`; 입력 → `TextInput md`; 발 → `Button md` | D13 |
| `branch/SwitchBranchDialog.tsx:30-121` | → `DialogFrame size="md"`; 라디오 목록; 발 → `Button md` | D13 |
| `branch/BranchMergeDialog.tsx:34-52` | → `DialogFrame size="md"`(`bg-popover … rounded-xl shadow-2xl` 삭제); 오류 → `Notice danger` | D12 |
| `branch/BranchRangeGraph.tsx:78` | 범위 → `<Code>`; `:93,112` → `Button iconOnly sm ghost`; `:102` → `Button sm secondary`; `:119` 열 머리 → `text-[11.5px] text-muted-foreground`; `:134-136` → `Notice danger` / `EmptyState layout="row"` | 3.2, 3.1 |
| `worktree/WorktreePanel.tsx:144` | 판 → `FLOATING_SURFACE rounded-(--radius-panel)` | D12 |
| `worktree/WorktreePanel.tsx:197-215` | 안쪽 삭제 확인 상자 → `ConfirmCommandDialog confirmVariant="destructive"` | 3.7, 3.9 |
| `worktree/WorktreePanelRow.tsx:11,89-102` | `CHIP_BUTTON` → `Button sm secondary`(삭제는 `tone="danger"`) | D8 |
| `worktree/WorktreePanelRow.tsx:65,74,79-83` | mono `text-xs` → `text-[11.5px]`; 「정리 가능」 → `<StatusChip tone="warning">`; `text-[11px] text-(--faint)` → `text-[11.5px] text-muted-foreground` | D2, D18 |
| `worktree/CreateWorktreeDialog.tsx:135-300` | → `DialogFrame size="md"`; 라디오 목록; `:219` 입력 `rounded-md focus:ring-1` → `TextInput md`; `:251` 「추정」 알약(`bg-muted`) → `text-[11.5px] text-muted-foreground` 글자; `:259-277` 경로 입력 + 찾기 → `TextInput md` + `Button md secondary`; 발 → `Button md` | D13, D25, D1 |
| `worktree/OverlapBadge.tsx:110` | `text-[11px]` → `text-[10.5px]`; `:125-129` 워크트리 이름표 → `<RefLabel kind="worktree" laneColor>` | D4 |
| `worktree/OverlapBadge.tsx:179-192` | 띠(`bg-danger/8 border-danger/25`) → `<Notice tone="danger" banner>` + `Button sm secondary` | D23 |
| `worktree/WorktreeBaseLabel.tsx:35,44-55,62` | `text-xs` → `text-[11.5px]`; `↑`·`↓` + `opacity-70` → `<Count prefix tone="sync">`; 「?」 `bg-muted` 알약 → 글자 | D1 |
| `worktree/SideBySideDiff.tsx:39,41-43` | 카드 → `Card`; 머리 `h-9` → `h-8`, `text-[11px] text-(--faint)` → `text-[11.5px] text-muted-foreground` | D27, 3.5 |
| `worktree/SideBySideDiff.tsx:74-108` | 판 → `FLOATING_SURFACE rounded-(--radius-panel)`; 제목 `text-[13px] font-bold` → `text-[14px] font-semibold`; `:85-93` 고르기 → `<Segmented size="sm">`; 닫기 → `Button iconOnly md ghost` | D12, D24 |
| `worktree/WorktreeChips.tsx:81-93` | 칩 `h-[30px] … text-[12px] border` → `buttonClass({ size: "sm", variant: "secondary" })` + `aria-pressed`, 꺼짐은 `border border-dashed border-(--line2) bg-transparent opacity-60`; 지금 워크트리는 `ring-1 ring-(--acc)` | 3.11 |
| `worktree/WorktreeChips.tsx:104-126` | 안 글자 `text-[11px] text-(--faint)` → `text-[10.5px] text-muted-foreground`; 커밋 안 한 수 → `<Dot on live={false}>` + `<Count prefix="" tone="live">` | D1, D7 |
| `worktree/WorktreeChips.tsx:131-144` | 「N개 더」·「지금만」 → `Button sm ghost` | 3.1 |
| `commit/FileEntry.tsx:70-76` | 줄 `py-1.5` → `h-7`; 선택 `bg-primary/10 text-primary font-semibold` → `bg-(--acc-sel)`; `ring-1` → `ring-1 ring-inset` | D19 |
| `commit/FileEntry.tsx:87,90,97-105` | `FileStatusBadge` → `FileStatusLetter`; 이름 `text-xs` → `text-[12.5px]`; `+N`·`-N` `text-xs text-success/danger` → `font-mono text-[11.5px] text-diff-add-fg/text-diff-del-fg`, `-` → `−`; 시각 → `text-[11.5px]` | D5, D20 |
| `commit/FileEntry.tsx:116` | 되돌리기 → `Button iconOnly sm ghost tone="danger"`(hover에만 보임 유지) | 3.4 |
| `commit/ChangesView.tsx:54-58,279-292` | 빈 상태 셋 → `EmptyState`(+ `Button sm secondary`) | D15 |
| `commit/ChangesView.tsx:298-309,361-376` | 스테이지·언스테이지 머리 `bg-muted … uppercase tracking-wider` + 알약 → `SectionLabel`(띠 변형) + `<Count tone="muted">`; 체크박스는 그대로 | D16, D1 |
| `commit/ChangesView.tsx:321-331,388-398` | 폴더 그룹 줄 `py-1 … text-[11px]` → `h-7 text-[11.5px]`; 수 `text-[10px] …/70` → `<Count tone="muted">` | 3.4, D18 |
| `commit/WorkSwitcher.tsx:29-88` | → `<Segmented size="md">`(조각 26px·11.5px 삭제) | D24 |
| `commit/CommitComposer.tsx:71,102` | 제목 `h-8` → `TextInput md`(28px); 본문 → `Textarea` | D25 |
| `commit/CommitComposer.tsx:112,127` | 「+」 → `Button sm ghost`; 커밋 → `Button md primary`(`text-[12px]` → 12.5) | 3.1 |
| `commit/WorkingChangesButton.tsx:17` | `h-[22px] … text-[11px]` → `Button sm secondary` | D8 |
| `commit/CommitErrorDialog.tsx:19-45` | → `DialogFrame size="md"`; `:37` → `<Code block>`; `:45` → `Button md primary` | D13 |
| `commit/useWorkingFileMenu.tsx:155-202` | 두 확인 상자(`rounded-xl shadow-xl p-5`, `px-3 py-1.5 text-xs` 버튼) → `ConfirmCommandDialog`(되돌리기는 `destructive`) 또는 `DialogFrame size="sm"` + `Button md` | D13, D10 |
| `stash/StashItem.tsx:37-90` | 줄 `py-2.5` → `min-h-11`; 선택 `bg-primary/10 text-primary font-semibold` → `bg-(--acc-sel)`(글자 변형 `text-primary/70` 등 모두 삭제); `stash@{n}` 알약 → `text-[11.5px] text-muted-foreground` 글자; 브랜치 → `<RefLabel kind="local">`; 첫 줄 `text-xs` → `text-[12.5px] font-semibold` | D19, D32 |
| `stash/StashList.tsx:55-61` | → `EmptyState`; `:101-116` 삭제 확인 → `ConfirmCommandDialog confirmVariant="destructive"` | D15, D13 |
| `stash/StashDetailView.tsx:37` | 상태 알약 → `FileStatusLetter`; `:64-90` 줄 `py-1.5 text-xs` → `h-7 text-[12.5px]`, 수 → `font-mono text-[11.5px]` diff 색 | D5, D20 |
| `stash/StashDetailView.tsx:171-206` | 제목 `text-sm` → `text-[13px] font-bold`; 메타 `text-xs` → `text-[11.5px]`; 버튼 셋 → `Button sm secondary` / `primary` / `secondary tone="danger"` | 2.2, 3.1 |
| `stash/StashDetailView.tsx:231,235,258-260` | 머리 → `SectionLabel`; 빈 글 → `EmptyState layout="row"` / `panel` | D16, D15 |
| `stash/StashSaveDialog.tsx:88-192` | → `DialogFrame size="md"`; `:109` → `Textarea`; `:116-126` → `<Segmented size="md">`; `:156-171` 파일 줄 → `h-7`, 손으로 만든 체크 → 네이티브 `checkbox accent-primary`, `text-[10px]` → `text-[11.5px]`; 발 → `Button md` | D13, D24 |
| `stash/StashView.tsx:71-77` | 머리 `py-2 text-xs` → `h-8 text-[12.5px] font-bold`; 버튼 → `Button sm ghost` | 3.5 |

## 3. 담당 3 — 리뷰 화면

| 파일:줄 | 바꿀 것 | 규칙 |
|---|---|---|
| `review/ReviewFilesPanel.tsx:65,121` | 오류 → `Notice danger`; PR 버튼 → `Button sm secondary` | 3.7, 3.1 |
| `review/WorkspaceReview.tsx:120` | 카드 → `Card`; `:139` → `Count`(Tabs가 처리); `:152` → `Button sm ghost` | D27, D1 |
| `review/WorkspaceReview.tsx:236-250` | 저장소 범례 칩(`h-[22px] rounded-[6px] text-[11px] font-bold` + 인라인 색) → `<RepoTile size="sm">` + 이름 `text-[11.5px]` + `<RefLabel kind="worktree" laneColor>` | D4, D6 |
| `review/WorkspaceTitle.tsx:26` | `text-[14px] font-bold` → `font-semibold`; `:22` 타일 `rounded-lg` → `rounded-(--radius-item)` | D11, 2.4 |
| `review/MultiRepoRemoteDialog.tsx:56-73` | → `DialogFrame size="lg"`; 제목 `text-[15px] font-bold` → 14px semibold; 설명 그대로(12.5) | D11, D13 |
| `review/MultiRepoRemoteDialog.tsx:87,95,121-123,136-149` | 오류 → `Notice danger`; 표 머리 `text-[11px] text-(--faint)` → `SectionLabel` 띠; 메모 `text-[12px] text-foreground/80` → `text-[11.5px] text-muted-foreground`; 발 왼쪽 글 `text-[12px]` → `text-[11.5px]` | D16, D18 |
| `review/MultiRepoRemoteDialog.tsx:159-178` | 버튼 `h-8 … text-[13px] font-bold` → `Button md primary` / `secondary` | D8 |
| `review/MultiRepoRemoteDialog.tsx:223-247,272` | 타일 → `<RepoTile size="md">`; 명령 `code` → `<Code>`; `text-[12px] font-bold` → `text-[12.5px] font-semibold`; `text-(--faint)` → `text-muted-foreground` | D6, 3.2 |
| `review/GitStatusLine.tsx:51,113-121,152` | `CHIP` → `Button sm primary` / `secondary`; upstream 버튼 → `Button sm ghost`(`tabular-nums` 유지) | 3.1 |
| `review/StatusActivity.tsx:47-52` | 버튼 → `Button sm ghost`(`aria-pressed` 유지) | 3.1 |
| `live/FollowPanel.tsx:63-69` | 「따라가는 중」 `rounded-full h-5` → `<StatusChip tone="live" icon={<Dot …/>}>` | D2 |
| `live/FollowPanel.tsx:243-257` | 보기 방식 → `<Segmented size="sm">` | D24 |
| `live/FollowPanel.tsx:313,318-339` | `FileStatusBadge` → `FileStatusLetter`; `text-[11px]`·`text-[10.5px]` `text-(--faint)` → `text-[11.5px] text-muted-foreground`(방금 바뀐 시각의 `text-(--live) font-bold`는 유지); `+N −N` `text-success/danger` → `text-diff-add-fg/text-diff-del-fg`, `text-[11px]` → `text-[11.5px]` | D5, D18, D20 |
| `live/FollowPanel.tsx:492-506` | 정렬 줄 `text-[11px] … text-(--faint)` → `SectionLabel` + `Button sm ghost` 둘 | D16 |
| `live/FollowPanel.tsx:513,517,542-560` | 오류 → `Notice danger`; 빈 목록 → `EmptyState layout="row"`; 가운데 빈 상태 둘 → `EmptyState`(+ `Button sm secondary`) | 3.6, 3.7 |
| `live/FollowPanel.tsx:609-616` | 「멈춤」 떠 있는 띠(`bg-foreground text-background`) → `FLOATING_SURFACE rounded-(--radius-item)` + `<Dot>` + 글 `text-[12.5px]` + `Button sm secondary` | 3.7 |
| `live/FollowPanel.tsx:661,740-757` | `FOOTER_BUTTON` → `Button sm secondary` | D8 |
| `diff/DiffHeader.tsx:61-80` | 머리 `h-[36px]` → `h-8`; 폴더 `text-xs` → `text-[11.5px]`, 이름 `text-sm font-medium` → `text-[12.5px] font-semibold`; `+N −N` `text-xs` → `font-mono text-[11.5px]` | 3.5, D20 |
| `diff/DiffHeader.tsx:85-100` | 보기 방식 테두리 묶음 → `<Segmented size="sm">` | D24 |
| `diff/DiffHeader.tsx:122` | `ICON_BUTTON` → `buttonClass({ iconOnly: true, size: "sm", variant: "ghost" })` | 3.1 |
| `diff/DiffFindBar.tsx:25,81,94` | 아이콘 버튼 → 위와 같음; 입력 → `SearchInput size="sm"`; 대소문자 아이콘 `w-4` → `w-3.5` | D25, 2.6 |
| `diff/DiffViewer.tsx:242-249,276-281,357-361` | 빈 상태 셋 → `EmptyState`(원 삭제, 버튼은 `Button sm secondary`) | D15 |
| `diff/DiffViewer.tsx:311-319` | 「줄이 많아 구문 강조를 껐음」 줄(`text-xs bg-surface`) → `<Notice tone="neutral" banner>` + `Button sm ghost` | 3.7 |
| `diff/BinaryDiffViewer.tsx:23-47` | → `EmptyState` | D15 |
| `diff/ImageDiff.tsx:50-54` + `diff/diff-theme.css:133-176` | 모드 바 → `<Segmented size="sm">`; CSS 삭제 | D24 |
| `pr/PrBits.tsx:10,64-78,84-101,105-107` | `CHIP`·`PrStateBadge`·`DraftChip`·`ReviewDecisionChip`·`CiChip` → `<StatusChip>`(`PrStateBadge`는 `PrStateIcon`을 `icon`으로) | D2 |
| `pr/PrBits.tsx:160-170` | 브랜치 쌍 `text-[10.5px]` → `text-[11.5px]`; `text-(--faint)` → `text-muted-foreground` | 2.2 |
| `pr/PrStates.tsx:9-31` | `PrPlaceholder` → `EmptyState`(원 48px 삭제); 쓰는 9곳 갈아 끼움 | D15 |
| `pr/PrStates.tsx:38-58` | `PrError` → `<Notice tone="danger" actions={<Button sm secondary>다시 시도</Button>}>` | 3.7 |
| `pr/PrListView.tsx:81-96` | 필터 → `<Segmented size="sm">` | D24 |
| `pr/PrListView.tsx:106,116` | `w-6 h-6 rounded-(--radius-item)` → `Button iconOnly sm ghost` | 3.1 |
| `pr/PrListView.tsx:187-220` | 줄 `py-2` → `min-h-11`; `#번호` `text-[11px] text-(--faint)` → `text-[11.5px] text-muted-foreground`; `:198` 초안 칩(`bg-primary/15 text-primary`) → `<StatusChip tone="neutral">`; 둘째 줄 `text-[11px]` → `text-[11.5px]`; `:217` 댓글 수 → `<Count tone="muted">` + 아이콘 | D3, D1, 3.4 |
| `pr/PrDetailPane.tsx:204,226` | `text-[11px]` → `text-[11.5px]`, `text-(--faint)` → `text-muted-foreground` | 2.2 |
| `pr/PrDetailPane.tsx:211,220` | → `Button iconOnly sm ghost` | 3.1 |
| `pr/PrDetailPane.tsx:236` | 충돌 칩 → `<StatusChip tone="danger">` | D2 |
| `pr/PrDetailPane.tsx:249-258` | 개요 줄 → `h-7 text-[12.5px]`; 댓글 수 → `<Count tone="muted">` | 3.4, D1 |
| `pr/PrDetailPane.tsx:264-267` | 파일 머리 `text-[11px] … text-(--faint)` → `SectionLabel` + `+N −N` `font-mono text-[11.5px]` | D16, D20 |
| `pr/PrDetailPane.tsx:288-313` | 파일 줄 → `h-7`; 이름 `text-xs` → `text-[12.5px]`; 폴더 둘째 줄(`text-[10px] …/50`) → 같은 줄 `text-[11.5px] text-muted-foreground`; 수 `text-[10px]` → `text-[11.5px]`; 열린 스레드 수 → `<Count tone="muted">`(경고 색은 `text-warning` 유지) | D21, D18, D20 |
| `pr/PrDetailPane.tsx:322` | 「더 보기」 → `Button sm ghost` | 3.1 |
| `pr/PrOverview.tsx:13-17` | 구역 제목 → `SectionLabel` + `<Count tone="muted">` | D16, D1 |
| `pr/PrOverview.tsx:57-59,111,130-133,148,157-166` | `text-[11px]` → `text-[11.5px]`; `text-(--faint)` → `text-muted-foreground` | 2.2 |
| `pr/PrOverview.tsx:82-85` | GitHub 라벨 알약(`rounded-(--radius-pill)`) → `<StatusChip tone="neutral" icon={색 점}>` | 2.4 |
| `pr/PrOverview.tsx:97,143,178` | 빈 글 → `EmptyState layout="row"` | D15 |
| `pr/PrOverview.tsx:107,128,157` | 줄 `py-1 rounded text-[12px]` → `h-7 rounded-(--radius-chip) text-[12.5px]` | 3.4 |
| `pr/PrThread.tsx:10,32-39,156` | `CHIP`(16px/10px) → `<StatusChip>` | D2 |
| `pr/PrThread.tsx:61-65,127-139` | `text-[11px]` → `text-[11.5px]`; `:72` 링크 아이콘 → `Button iconOnly sm ghost`; `:89` `pre` → `<Code block>` | 2.2, 3.2 |
| `pr/PrFileView.tsx:66,128` | → `Button sm secondary` / `ghost`; `:83` `text-[10.5px] text-(--faint)` → `text-[11.5px] text-muted-foreground`; `:104` 스레드 토글 `h-8` → `h-7` | 3.1 |
| `actions/ActionsList.tsx:41-47` | → `EmptyState` | D15 |
| `actions/ActionsRunItem.tsx:51-57` | 줄 `py-2.5` → `min-h-11`; 선택 `bg-primary/10 text-primary font-semibold` → `bg-(--acc-sel)` | D19 |
| `actions/ActionsRunItem.tsx:62-100` | 이름 `text-xs` → `text-[12.5px] font-semibold`; 브랜치 알약 → `<RefLabel kind="local">`; 메타 `text-xs`와 `text-primary/50·70` 변형 → `text-[11.5px] text-muted-foreground` | D32, D18 |
| `actions/ActionsDetailView.tsx:55-68,86` | 작업 줄 `py-2.5 text-xs` → `h-7 text-[12.5px]`; `text-[10px]`·`text-[11px]` → `text-[11.5px]` | 3.4 |
| `actions/ActionsDetailView.tsx:117-127` | 제목 `text-sm` → `text-[13px] font-bold`; 메타 → `text-[11.5px]`; 열기 버튼(테두리) → `Button sm secondary` | 2.2, D9 |
| `actions/ActionsDetailView.tsx:140` | 빈 글 → `EmptyState layout="row"` | D15 |
| `actions/ActionsView.tsx:29-30` | 머리 `py-2 text-xs` → `h-8 text-[12.5px] font-bold`; `:35-50` → `EmptyState` | 3.5, D15 |
| `conflict/MergeConflictBanner.tsx:66-93` | 전체 → `<Notice tone="danger" title={opLabel} actions={…}>`; 버튼 → `Button sm primary`(계속) / `Button sm secondary tone="danger"`(중단, 확인 창은 그대로) | D23 |
| `sidebar/RowSignals.tsx:46-53` | 점 `w-[7px] h-[7px]` → `<Dot on live={live} label>`; 수 → `<Count>`(파일은 `● N` live, 받을·올릴은 `↓N`·`↑N` sync). 파일은 `RowSignals`가 이 둘을 조합하는 자리로 남긴다 | D7, D1 |
| `sidebar/AccountHeader.tsx:133,137` | 계정 이름 `font-bold` → `font-semibold`; 저장소 수 → `<Count tone="muted">` | D16, D1 |
| `sidebar/RepoCard.tsx:82` | `LEADING_TILE` + `text-[9.5px]` → `<RepoTile size="md">`; `:298` `text-[var(--faint)]` → `text-muted-foreground` | D6 |
| `sidebar/row-style.ts:13-19` | `LEADING_TILE` 삭제(`RepoTile`), `NEUTRAL_TILE`은 `RepoTile`과 같은 크기표를 쓰게 정리 | D6 |
| `sidebar/RepoTree.tsx:240-248` | 검색 → `<SearchInput size="md" surface="frame">`; `:254` 접기 버튼은 `SIDEBAR_ICON_BUTTON` 유지; `:335-337` 빈 글 → `EmptyState layout="row"` | D25, D15 |
| `sidebar/QuietReposRow.tsx:34` | `text-[var(--faint)]` → `text-muted-foreground` | D18 |
| `sidebar/SidebarHoverCard.tsx:108,135` | `rounded-[10px]` → `rounded-(--radius-item)`; mono `text-[11px]` → `text-[11.5px]` | 2.4 |
| `sidebar/SortMenu.tsx:132-154` | 손으로 만든 메뉴 → `ContextMenu anchored`(체크는 항목의 `checked`) | D14 |
| `sidebar/AddRepoButton.tsx:39` | `h-[30px] text-xs` → `toolbarButtonClass()` + 아이콘(층 0 버튼) | D8 |
| `sidebar/WorkspaceSuggestion.tsx:60-79` | 닫기 → `Button iconOnly sm ghost`; 글 `text-[11px]` → `text-[11.5px]`; 버튼 둘 `h-6 rounded-md text-[11px]` → `Button sm primary` / `ghost` | D8 |
| `sidebar/WorkspaceDialogs.tsx:8-30,71-107,137-156` | `PANEL`·`DialogHeader` 삭제 → `DialogFrame size="sm"`; 입력 → `TextInput md`; 발 → `Button md ghost` / `primary`·`danger` | D13 |

## 4. 마친 뒤 확인

- `pnpm typecheck && pnpm lint && pnpm test`(`src/styles/__tests__/tokens.test.ts` 포함)가 그대로 통과해야 한다.
- 다음 grep이 비어야 한다(테스트 제외):
  - 왼쪽 막대(D33): `border-l-|border-l |shadow-\[inset|inset-shadow|before:|w-\[3px\]|SelectionBar|indicator-y` — `layout/SplitHandle.tsx:100`(분할선 손잡이)만 남는다
  - `rounded-full` 안에 글자가 있는 곳: `grep -rn "rounded-full" src/components | grep -v "w-1.5\|w-2 \|w-\[3px\]\|avatar\|Avatar\|Switch\|progress\|img"`
  - `text-\[9px\]|text-\[9.5px\]|text-\[10px\]|text-\[11px\]|text-\[12px\]|text-\[13px\] font-medium|text-xs|text-sm|text-base|text-lg` — 남는 곳은 diff 뷰어 내부와 환영·안내 화면뿐이어야 한다.
  - `text-(--faint)|text-\[var(--faint)\]|text-muted-foreground/[0-9]`
  - `bg-primary/1[05]|bg-primary/20|text-primary font-semibold`
  - `shadow-2xl|shadow-lg|shadow-xl|shadow-\[` — `layers.ts`와 `globals.css`만 남는다.
  - `uppercase|tracking-wider|duration-[0-9]|transition-all`
  - `px-4 py-2 text-sm` (옛 창 발 버튼)
- 바뀐 화면을 라이트·다크에서 한 번씩 캡처해 `docs/reviews/`에 둔다.
