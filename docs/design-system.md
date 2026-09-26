# GitBaro 디자인 시스템

앱의 모든 화면이 따르는 하나의 규칙집이다. 새 화면을 만들거나 고칠 때 여기서 컴포넌트를 고르고, 없는 것은 여기에 먼저 정한 뒤 `src/components/ui/`에 만든다. 코드로 옮기는 순서는 `docs/design-system-migration.md`에 있다.

- 색·간격·움직임의 실제 값: `src/styles/globals.css`
- 층 2·3의 겉모습: `src/components/ui/layers.ts`
- 불러오는 중 표시: `docs/loading-design.md`
- 원래 결정(2026-09-24·25): `plans/design/README.md`(로컬 전용)

## 1. 원칙

1. **리뷰가 먼저다.** 화면의 주인공은 diff·파일 목록·커밋 그래프다. 나머지 UI(버튼, 표시, 머리 줄)는 그것을 가리지 않게 작고 조용하다. 눈에 띄는 요소를 하나 더할 때는 그만큼 다른 것을 빼야 한다.
2. **강조 예산은 하나뿐이다.** 브랜드 색(라즈베리 `--acc`)은 「지금 고른 것」과 「이 화면의 주요 작업 하나」에만 쓴다. 상태는 상태 색(주황 `--live`, diff 초록·빨강, CI 초록·토마토 레드)으로, 나머지는 회색 단계로 말한다. 한 칸 안에 브랜드 색 요소는 둘을 넘지 않는다.
3. **숫자는 주인이 하나다.** 한 수(커밋 안 한 파일, 올릴 커밋 …)는 한 곳에서 계산하고, 한 단계에 한 번만 보인다: 사이드바 신호(찾아가기)와 그 수로 무언가 하는 자리(WIP 행, Push 버튼). 상태 줄·탭·머리 글은 수를 되풀이하지 않고 말로 상태를 적는다.
4. **모양은 뜻마다 하나다.** 같은 뜻은 앱 어디서나 같은 모양이다. 수는 글자, 상태는 `StatusChip`, 브랜치·태그·워크트리 이름은 `RefLabel`, 저장소는 `RepoTile`. 「여기만 배지로」는 없다. 모양이 둘이면 뜻도 둘이어야 한다.
5. **짧고 조용하게 움직인다.** 나타날 때만 120–220ms, 투명도와 transform만, 튕기지 않는다. 계속 움직이는 것은 「지금 바뀌는 중」 점과 회전 표시뿐이다.

**하지 않는 것.** 왼쪽 가장자리의 세로 막대로 선택이나 강조를 표시하지 않는다(사용자 규칙). 선택 막대, `border-l-*` 강조, 안쪽 `box-shadow` 막대, `before:` 가짜 요소 막대, 카드·안내·diff 줄의 왼쪽 띠 모두 금지다. 선택은 채움으로, 강조는 옅은 틴트로 말한다(2.9).

## 2. 기초

### 2.1 색

토큰만 쓴다. 헥사 값, Tailwind 팔레트 색(`gray-500`), `text-muted-foreground/50` 같은 투명도 섞기는 금지다. 흐리게 보이려면 한 단계 옅은 글자 단계를 쓴다.

| 역할 | 토큰 | Tailwind | 쓰는 곳 |
|---|---|---|---|
| 본문 글자 | `--fg` | `text-foreground` | 제목, 행 이름, 입력 글 |
| 보조 글자 | `--fg2` | `text-(--fg2)` | 행 안의 둘째 정보(작성자, 브랜치), 작은 버튼 글자 |
| 설명 글자 | `--muted` | `text-muted-foreground` | 설명, 시각, 해시, 구역 라벨, 빈 상태 |
| 브랜드 | `--acc` | `text-primary` `bg-primary` | 주요 버튼, 활성 탭 밑줄, 포커스 테, 링크, 선택 채움의 틴트 |
| 선택 바탕 | `--acc-sel` | `bg-(--acc-sel)` | 고른 행(카드 안) |
| 지금 바뀌는 중·커밋 안 함 | `--live` | `text-(--live)` `bg-(--live)` | 점, 커밋 안 한 파일 수, 「따라가는 중」, 방금 바뀐 diff 줄의 줄 번호 |
| 방금 바뀜(한 번 비춤) | `--live-soft` | `bg-(--live-soft)` | `FocusFlash`의 막, 점의 테 |
| 방금 바뀐 줄(남는 틴트) | `--live-faint` | `bg-(--live-faint)` | 따라가는 중 diff의 새 줄 바탕 |
| CI 성공·추가 | `--success` / `--diff-add-fg` | `text-success` / `text-diff-add-fg` | 상태 칩, `+N` |
| CI 실패·오류·삭제 | `--danger` / `--diff-del-fg` | `text-danger` / `text-diff-del-fg` | 상태 칩, 오류 글, `−N` |
| 주의 | `--warning` | `text-warning` | 진행 중 작업, 충돌 예고, 오래된 fetch |
| 안내 | `--info` | `text-info` | 「보는 중」, 병합됨 PR |
| 되돌릴 수 없는 버튼 | `--destructive` | `bg-destructive` | 삭제·중단 확인 버튼 |
| 칩 바탕 | `--chip` | `bg-(--chip)` / `bg-muted` | 보조 버튼, 코드, 분할 선택 틀 |
| hover 채움 | `--accent` | `bg-accent` | 카드(층 2) 위 행·버튼 hover |
| 바탕 위 hover·선택 | `--frame-hover` `--frame-sel` | | 바탕(층 0·1)에 바로 놓인 행·버튼: 툴바 버튼, 사이드바 계정 머리, 설정 탐색 |
| 카드 안 행 hover·선택 채움 | `--panel-hover` `--panel-sel` | | 사이드바 카드 안 행 |
| 선 | `--line` / `--line2` | `border-(--line)` / `border-border` | 행 구분선 / 입력칸·떠 있는 요소 테두리 |

- `--faint`는 `--muted`의 옛 이름이다. 새 코드에서 쓰지 않는다.
- 상태 색 채움은 두 농도뿐이다: 칩 `15%`(`bg-success/15`), 안내 띠 `10%` + 테두리 `20%`.
- 저장소 색(아바타 hue, `lib/avatar-color.ts`)과 그래프 레인 색은 인라인 스타일로 넣는다. 그 밖의 인라인 색은 없다.

### 2.2 글자

Pretendard(UI)와 D2Coding(코드·브랜치·해시·경로)이다. 크기는 아래 여섯 단계만 쓴다. `text-xs`·`text-sm`·`text-base`와 `text-[11px]`·`text-[12px]` 같은 반 단계는 쓰지 않는다.

| 이름 | 크기 | 굵기 | 쓰는 곳 |
|---|---|---|---|
| `caption` | 10.5px | semibold | 칩·이름표 안 글자, 수(`● 3`, `↑2`), 행 끝의 작은 메타 |
| `meta` | 11.5px | regular / semibold | 행의 보조 정보(시각, 해시, 폴더, `+12 −3`), 작은 버튼, 구역 라벨(semibold), 툴팁, 빈 상태 설명 |
| `body` | 12.5px | regular / medium | 행 이름, 본문, 보통 버튼, 입력칸, 메뉴 항목, 카드 머리 제목(bold) |
| `title` | 13px | bold | 내용의 제목(커밋 요약, PR 제목), 설정 줄 이름 |
| `heading` | 14px | semibold | 창·떠 있는 패널·설정 화면 제목, 워크스페이스 제목 |
| `display` | 20px+ | bold | 환영 화면·gh 안내 화면에서만 |

- 고정폭 글자는 같은 크기에서 한 단계 작게 보이므로 크기를 올리지 않는다. 브랜치 이름은 행에서 `meta` mono, 이름표 안에서는 `caption` mono다.
- 저장소 타일 안 첫 글자는 타일 크기에 따른다(2.4의 `RepoTile`).
- `uppercase`·`tracking-wider`는 쓰지 않는다. 구역 라벨은 semibold `--muted`로 충분하다.
- 수는 `tabular-nums`다.

### 2.3 간격·높이

| 값 | 토큰 | 쓰는 곳 |
|---|---|---|
| 8px | `--g` | 카드 사이, 카드 안쪽 바탕 여백 |
| 28px | `--row` | 한 줄 행(사이드바, 파일 목록, 메뉴 항목), 보통 버튼·입력칸 |
| 24px | | 작은 버튼, 행 안 아이콘 버튼, 작은 입력칸 |
| 18px | | 행 안 표시(칩, 이름표, 저장소 타일)의 높이 |
| 44px | | 두 줄 행(PR 목록, 스태시·Actions 목록, 설정 줄 `min-h-[52px]`은 예외) |
| 12px | | 행 좌우 여백(`px-3`); 사이드바 카드 안 행은 8px(`ROW_PAD_X`) |
| 8px | | 행 안 요소 사이(`gap-2`); 칩 안은 4px(`gap-1`) |

### 2.4 모서리

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `--radius-panel` | 14px | 카드(층 2), 창·떠 있는 패널(층 3) |
| `--radius-item` | 8px | 행, 메뉴, 입력칸, 정보 카드, 알림 |
| `--radius-chip` | 6px | 모든 버튼, 칩, 이름표, 코드, 툴팁, 분할 선택의 조각 |
| 5px | | 저장소 타일(≤20px) |
| `--radius-pill` | 끝까지 | **글자를 담지 않는다**: 사람 아바타, 점, 스위치, 진행 막대, 활성 탭 밑줄. **예외**: 툴바 버튼과 탭 count pills는 채운 알약으로 숫자를 표시한다(2026-09-26 D35) |

글자가 든 알약(`rounded-full` + 글자)은 앱에서 거의 없다. 예외는 위 참고.

### 2.5 층

창은 **바탕 하나** 위에 카드가 놓인 모양이다(2026-09-26 결정). 사이드바·머리 줄·본문이 같은 색이고, 영역은 바탕색 변화가 아니라 카드와 간격으로 구분한다.

| 층 | 바탕 | 겉모습 | 예 |
|---|---|---|---|
| 0·1 바탕 | `--canvas`(`--frame`은 같은 값의 별칭) | 없음 | 사이드바 바탕, 머리 줄, 본문 칸 바탕, 환영 화면 |
| 2 카드 | `--panel` | `PANEL_SURFACE`(흰색 + 옅은 그림자 + 14px) | 본문 카드, 사이드바 카드, 설정 묶음, 툴바 버튼 묶음(`TOOLBAR_GROUP`) |
| 3 떠 있는 것 | `--float` | `FLOATING_SURFACE`(흰색 + 진한 그림자 + 1px 테두리) | 메뉴, 팝오버 패널, 창, 툴팁, 정보 카드, 알림 |

- 영역 사이 구분: 카드가 이미 나누면 아무것도 두지 않는다. 카드가 없는 경계(사이드바 오른쪽 끝, 머리 줄 아래)에만 1px `--line` 실선 하나를 둔다. 바탕색을 바꾸거나 왼쪽 막대를 두지 않는다.
- 바탕에 바로 놓인 행·버튼(툴바, 사이드바 계정 머리, 설정 탐색)의 hover·선택은 `--frame-hover`·`--frame-sel`, 카드 안 행은 `--panel-hover`·`--panel-sel`이다. 두 벌은 바탕과 흰 카드 위에서 각각 보이도록 따로 맞춘 값이다(`TreeRowFrame`의 `surface` prop).
- 층 2·3 클래스는 직접 적지 않고 `layers.ts`의 상수나 그것을 쓰는 컴포넌트(`Card`, `DialogFrame`, `ContextMenu` …)를 쓴다.
- 그림자는 `--shadow`(층 2)·`--shadow-sm`(툴바 묶음)·`--shadow-float`(층 3) 셋이다. 임의의 `shadow-[…]`를 쓰지 않는다.

### 2.6 아이콘

lucide만 쓴다. 크기는 곁의 글자에 맞춘다.

| 크기 | 클래스 | 쓰는 곳 |
|---|---|---|
| 10px | `w-2.5 h-2.5` | 이름표·칩 안 |
| 12px | `w-3 h-3` | `meta` 글자 곁, 작은 버튼 안, 행 끝 표시 |
| 14px | `w-3.5 h-3.5` | 기본: 행 앞, 보통 버튼, 메뉴 항목, 툴바 |
| 16px | `w-4 h-4` | 창 머리의 닫기, 설정 탐색 |
| 24px | `w-6 h-6` | 빈 상태 |
| 40px | `w-10 h-10` | 환영 화면 |

- `size={N}` 대신 클래스를 쓴다.
- 뜻을 가진 아이콘만 남긴다. 장식 아이콘은 `aria-hidden`이고, 뜻이 있는데 글자가 없으면 `aria-label`을 준다.
- 체크 표시는 `strokeWidth={2.5}`, 나머지는 기본이다.

### 2.7 움직임

`globals.css`의 이름 붙은 움직임만 쓴다. 길이·곡선을 컴포넌트에서 따로 정하지 않는다(`duration-300`, `transition-all` 금지).

| 이름 | 어디에 |
|---|---|
| `animate-pop-in` | 메뉴, 드롭다운, 팝오버 패널, 안내 띠 |
| `animate-fade-in` | 툴팁, 정보 카드, 행 끝 신호 |
| `animate-dialog-in` + `animate-overlay-in` | 창과 그 뒤의 막(`Dialog`가 붙인다) |
| `animate-toast-in` / `animate-toast-out` | 알림 |
| `animate-reveal` | 펼친 트리 줄, 새로 생긴 카드 |
| `animate-content-in` | 커밋·파일·스태시를 골라 내용이 바뀔 때 |
| `animate-loading-in` | 불러오는 중 표시 |
| `animate-indicator-x` | 활성 탭 밑줄 |
| `animate-live-ring` / `animate-live-breathe` | 지금 바뀌는 중 점 / 따라가는 중 점 |
| `animate-focus-flash`(`FocusFlash`) | 따라가는 중 방금 바뀐 diff 줄·그래프 행·파일 행을 1.2초 한 번 비춤 |
| `transition-colors` | hover·선택 채움(기본 길이 `--motion-fast`) |

「동작 줄이기」는 `globals.css`가 한 번에 처리한다. 컴포넌트에 `motion-reduce:`를 붙이지 않는다(회전 표시는 예외 없이 돈다).

### 2.8 불러오는 중

`docs/loading-design.md`를 따른다. 요약: 칸 전체는 `LoadingState`, 목록 한 줄은 `LoadingState layout="row"`, 일하는 버튼은 `BusyIcon` + `disabled` + `aria-busy`, 줄 안 작은 표시는 `Spinner`(12/14/20px) + `useSteadyFlag`/`useSteadyValue`. 뼈대 줄, `animate-pulse`, 다른 아이콘 돌리기는 쓰지 않는다.

### 2.9 선택과 강조

세 가지 상태를 각각 다른 방법으로 보인다. 어느 것도 왼쪽 세로 막대를 쓰지 않는다.

| 상태 | 표현 | 구현 |
|---|---|---|
| 고른 것(선택) | 조용한 채움 + 이름 굵기 한 단계. 글자색은 바꾸지 않는다 | 카드 안 행 `bg-(--acc-sel)`(사이드바 카드 안은 `--panel-sel`), 바탕 위 행 `bg-(--frame-sel)`; 이름 `font-semibold`; `aria-selected`/`aria-current` |
| 키보드 초점 | 채움 + 안쪽 테 | `bg-accent ring-1 ring-inset ring-primary/30`(행), `focus-visible:ring-2 focus-visible:ring-ring/40`(버튼·입력칸) |
| 방금 바뀜(한 번) | 주황 막이 1.2초 동안 걷힌다 | `<FocusFlash />`(`--live-soft`, 부모는 `relative isolate`, 다시 비추려면 `key`를 바꾼다) |
| 새 줄(남는 표시) | 옅은 주황 바탕 + 주황 굵은 줄 번호 | diff 줄 `--live-faint` 바탕 + 줄 번호 `--live` 600(`VirtualizedDiffView`의 `FRESH_BG`·`FRESH_NUM`) |
| 안내·주의 | 옅은 톤 채움 + 톤 테두리 + 아이콘(3.7 `Notice`) | `bg-<tone>/10 border border-<tone>/20`. 왼쪽 띠 없음 |

- 「보는 중」처럼 칸 전체의 상태는 그 줄의 바탕 톤으로(3.13), 한 항목의 상태는 `StatusChip`으로 말한다.
- 강조 요소는 겹치지 않게 한다: 고른 행에 `FocusFlash`가 겹치면 막이 걷힌 뒤 선택 채움만 남는다.

## 3. 컴포넌트

각 항목은 「무엇 → 언제 → 쓰지 말 것 → 모양 → 글 → 접근성 → 지금 쓰는 곳」 순이다. 「새로 만든다」는 아직 `src/components/ui/`에 없는 것이다.

### 3.1 버튼 `Button` (새로 만든다)

**무엇.** 누르면 무언가 하는 것. 앱의 모든 버튼은 이 한 컴포넌트(또는 층 0 전용 `toolbarButtonClass`)다.

**변형.** 넷뿐이다.

| 변형 | 뜻 | 모양 |
|---|---|---|
| `primary` | 이 칸의 주요 작업 하나(커밋, 확인 창의 실행, 패널의 「새로 만들기」, 「이 브랜치로 체크아웃」) | `bg-primary text-primary-foreground hover:bg-primary-hover`, semibold |
| `secondary` | 그 밖의 작업(비교, 되돌리기, 다시 시도, 열기) | `bg-(--chip) text-(--fg2) hover:bg-accent`, semibold. 테두리 없음 |
| `ghost` | 취소, 접기, 「N개 더」, 아이콘만 있는 버튼 | 바탕 없음, `text-muted-foreground hover:bg-accent hover:text-foreground` |
| `danger` | 되돌릴 수 없는 일의 확인(삭제, 중단, 강제 push) | `bg-destructive text-destructive-foreground`. 확인 창 안에서만 |

- 한 칸(창의 발, 패널 머리, 배너)에 `primary`는 하나다. 둘 이상이면 하나를 `secondary`로 내린다.
- `danger`는 확인 창의 실행 버튼에만 쓴다. 목록 줄이나 설정 줄의 「삭제」는 `secondary` + `text-danger`(`tone="danger"`)로 두고, 누르면 확인 창이 뜬다.

**크기.**

| 크기 | 높이 | 글자 | 여백 | 아이콘 | 쓰는 곳 |
|---|---|---|---|---|---|
| `sm` | 24px | `meta` 11.5px semibold | `px-2.5` | 12px | 행 안, 패널 발, 상태 줄, 머리 줄의 작은 작업 |
| `md` | 28px | `body` 12.5px medium(secondary·primary는 semibold) | `px-3` | 14px | 창의 발, 설정, 커밋 버튼, 패널 머리, 툴바 |
| `lg` | 36px | 13px semibold | `px-4` | 16px | 환영 화면·gh 안내 화면에서만 |

- 모서리는 모두 `--radius-chip`(6px).
- `iconOnly`: 정사각(24 또는 28), `aria-label` 필수, `title`로 이름을 보인다.
- 꺼짐: `opacity-45`, hover 없음. 일하는 중: `BusyIcon` + `aria-busy`.
- 포커스: `focus-visible:ring-2 focus-visible:ring-ring/40`.

**층 0(툴바·사이드바 머리)**는 `toolbarButtonClass`를 그대로 쓴다. 같은 28px·12.5px·6px이고 hover 채움만 `--frame-hover`다. 사이드바의 24px 아이콘 버튼은 `SIDEBAR_ICON_BUTTON`이다.

**글.** 동사로 짧게(「비교」, 「병합」, 「다시 시도」). 진행형은 일하는 동안만(`commit.committing`).

**지금 쓰는 곳.** 창 발(20개 창), `CHIP_BUTTON`(브랜치·워크트리 행), `FOOTER_BUTTON`(따라가기 패널), `SETTINGS_BUTTON`, `PanelHeader` 주요 버튼, `MergeActionPanel`, `CommitComposer`, `GitStatusLineView`.

### 3.2 작은 표시

행 안에서 18px 높이로 놓이는 것들이다. 뜻마다 하나씩이고, 서로 바꿔 쓰지 않는다.

| 뜻 | 컴포넌트 | 모양 |
|---|---|---|
| 수 | `Count` | 글자만. 알약·바탕 없음 |
| 상태(한 단어) | `StatusChip` | 색 채운 칩 |
| 브랜치·태그·워크트리 이름 | `RefLabel` | 고정폭 글자 칩, 종류·위치로 모양이 갈린다 |
| 저장소 | `RepoTile` | 저장소 색 타일 + 첫 글자 |
| 지금 바뀌는 중 | `Dot` | 6px 점 |
| 명령·경로 | `Code` | 칩 바탕의 고정폭 글자 |

#### `Count` (`src/components/ui/marks.tsx`)

**무엇.** 사용자가 행동할 수를 보인다: 커밋 안 한 파일, 올릴·받을 커밋, 접은 구역 안의 항목 수.

**API.** `value: number`, `prefix?: "●" | "↑" | "↓" | ""`(기본 없음), `tone: "live" | "sync" | "muted"`, `label?: string`.

**모양.** `caption` 10.5px semibold `tabular-nums`, 기호 + 수(`● 3`, `↑2`, `↓1`, `12`). 색은 뜻에 따른다: 커밋 안 한 파일 `--live`, 올릴·받을 커밋 `--fg2`, 항목 수 `--muted`. 일반적으로 **바탕·알약·테두리가 없다.** 다만 **예외**: 툴바 버튼과 탭 count는 채운 알약(`rounded-full` + 배경색)으로 표시하며, 이는 단일 source of truth 원칙(원칙 3)의 허가된 변형이다(2026-09-26 D35).

**언제 아니다.** 상태를 말로 적는 자리(상태 줄, 탭 배지, 툴팁)에는 수를 넣지 않는다(원칙 3). `+12 −3` 줄 수는 `Count`가 아니라 `meta` mono 글자다(3.4 행 참고).

**지금 쓰는 곳.** `RowSignals`(기준 모양), `TOOLBAR_BADGE`, `WorktreeZone` 워크트리 수, `Tab count`, `ChangesView` 그룹 수, `PanelSectionHeader` 접은 수, `AccountHeader` 저장소 수, `WorktreeChips` 커밋 안 한 수.

#### `StatusChip` (`src/components/ui/marks.tsx`)

**무엇.** 한 단어로 된 상태: 열림·초안·병합·닫힘(PR), 성공·실패·실행 중(CI), 승인·변경 요청(리뷰), 병합됨·오래됨(브랜치), 정리 가능(워크트리), 해결됨·오래된 스레드, 충돌, 따라가는 중.

**API.** `tone: "neutral" | "success" | "danger" | "warning" | "info" | "live"`, `icon?: ReactNode`, `children: ReactNode`.

**모양.** 높이 18px, `px-1.5`, `--radius-chip`, `caption` 10.5px semibold, 앞에 12px 아이콘 선택. 톤 여섯: `neutral`(`bg-(--chip) text-(--fg2)`), `success`, `danger`, `warning`, `info`(각 `bg-<tone>/15 text-<tone>`), `live`(`bg-(--live-soft) text-(--live)`).

**언제 아니다.** 수를 넣지 않는다(→ `Count`). 이름을 넣지 않는다(→ `RefLabel`). 브랜드 색 톤은 없다 — 「초안」은 `neutral`이지 `primary`가 아니다. 상태가 그 줄 전체의 상태면(「보는 중」 상태 줄) 칩이 아니라 줄의 톤이다.

**접근성.** 글자가 이미 상태를 말하므로 아이콘은 `aria-hidden`.

**지금 쓰는 곳.** `PrStateBadge`·`CiChip`·`ReviewDecisionChip`·`DraftChip`, `PrThread` 칩, `BranchStatusBadge`, `WorktreePanelRow` 정리 가능, `PrDetailPane` 충돌, `FollowPanel` 따라가는 중, `PrListView` 초안.

#### `RefLabel` (`src/components/ui/marks.tsx`)

**무엇.** 브랜치·태그·워크트리·HEAD 같은 git 참조의 이름.

**API.** `name: string`, `kind: "local" | "remote" | "head" | "tag" | "tag-local" | "worktree"`, `laneColor?: string | null`, `className?: string`.

**모양.** 높이 18px, `px-1.5`, `--radius-chip`, `font-mono` `caption` 10.5px semibold, 앞에 10px 아이콘(브랜치·태그·워크트리), `max-w` + `truncate`, `title`에 전체 이름. 모양은 종류와 위치로 갈린다(`CommitItem`의 규칙을 그대로 둔다).

| 종류·위치 | 모양 |
|---|---|
| 로컬 브랜치 | 채움 `bg-(--chip) text-foreground`, 테두리 `--line2` |
| 원격 브랜치 | 바탕 없음, 테두리만 `border-border text-muted-foreground` |
| HEAD | 채움 + 테두리 `border-foreground/50` + bold |
| 태그(원격에 있음) | `bg-success/10 text-success border-success/45` |
| 태그(로컬만) | 바탕 없음 + 점선 테두리 초록 |
| 워크트리(레인 색이 있는 것) | `laneLabelStyle(color)`로 채움·글자색 |
| 워크트리(색 없음) | 흰 바탕 + 테두리 `--line2` |

**언제 아니다.** 켜고 끄는 칩(`WorktreeChips`)은 버튼이다(3.11). 저장소 이름은 `RepoTile` + 글자다.

**지금 쓰는 곳.** `CommitItem` 이름표, `GraphRow` WIP 행·구분선 이름표, `BranchPanelRow` 워크트리 칩, `OverlapBadge` 워크트리 이름표, `WorkspaceReview` 저장소 범례의 브랜치.

#### `RepoTile` (`src/components/ui/marks.tsx`)

**무엇.** 저장소 하나. 저장소 색(`avatarColor`) 바탕에 첫 글자.

**API.** `name: string`, `color: AvatarColor`, `size: "sm" | "md" | "lg" | "xl"`(크기별 16/18/20/28px).

**크기.** `sm` 16px/글자 9px(파일 목록의 저장소 머리), `md` 18px/9px(사이드바, 창 안 줄), `lg` 20px/10.5px(툴바 경로), `xl` 28px/12px(저장소 목록의 두 줄 행, 저장소 설정 머리, 색 고르기). 모서리 5px, `xl`은 `--radius-item`. 글자 extrabold, `aria-hidden`(이름은 옆 글자가 말한다).

**언제 아니다.** 저장소가 아닌 것(워크스페이스)은 회색 타일 + 아이콘(`NEUTRAL_TILE`). 사람은 둥근 아바타(`AccountAvatar`, `PrAvatar`).

#### `Dot` (`src/components/ui/marks.tsx`)

**무엇.** 「지금 바뀌는 중」·「따라가는 중」 같은 살아 있는 상태의 점.

**API.** `on: boolean`, `live?: boolean`, `breathe?: boolean`, `label?: string`.

**지금 쓰는 곳.** `RowSignals`, `WorktreeChips`, `FollowPanel` 두 곳, `RepoSyncIndicator` dot 변형.

#### `Code` (`src/components/ui/marks.tsx`)

**무엇.** git 명령, 경로, 비교 범위(`main..feat/x`) 같은 글자 그대로의 값.

**API.** `block?: boolean`, `children: ReactNode`.

**지금 쓰는 곳.** `BranchRangeGraph` 범위, 설정의 경로(`GeneralSection`·`AboutSection`·`InfoSection`), `ConfirmCommandDialog` 명령, `ActivityLogPanel` 출력, `GhSetupGuard` 명령, `MultiRepoRemoteDialog` 명령.

### 3.3 파일 상태

파일 한 줄의 맨 앞에 상태를 보인다. 모양은 하나다: **글자 하나**(`M A D R C U !`) mono `caption` 10.5px bold, 상태 색(`statusTextColors`), 폭 고정(`w-2.5`), `title`에 뜻. 색 칸에 아이콘을 넣는 `FileStatusBadge`(16px 타일)는 없앤다 — 행 앞에 색 칸이 줄마다 서면 목록이 시끄럽다.

색: 수정 `warning`, 추가·미추적 `success`, 삭제·충돌 `danger`, 이름 바꿈·복사 `info`, 무시 `muted`. 브랜드 색은 쓰지 않는다(`statusTextColors`의 `renamed: text-primary`를 `text-info`로).

### 3.4 행 `Row`

**무엇.** 목록·트리·그래프·메뉴의 한 줄. 누르면 고르거나 연다.

**모양.**

| 종류 | 높이 | 글자 | 좌우 | 예 |
|---|---|---|---|---|
| 한 줄 | 28px(`--row`) | 이름 `body` 12.5, 메타 `meta` 11.5 | 12px(카드 안 사이드바 행은 8px) | 파일 목록, 브랜치·워크트리 패널, 사이드바, 메뉴 항목 |
| 두 줄 | 44px(`min-h-11`) | 첫 줄 `body` semibold, 둘째 줄 `meta` | 12px | PR 목록, 스태시·Actions 목록, 저장소 목록 |
| 그래프 | `GRAPH_ROW_HEIGHT` | 제목 `body` medium, 작성자 `body` `--fg2`, 시각·해시 `meta` | | 커밋 그래프 |

- 상태 채움(2.9): hover `bg-accent`(카드 위), 선택 `bg-(--acc-sel)` + 이름 `font-semibold`, 키보드 활성 `bg-accent ring-1 ring-inset ring-primary/30`. 선택은 채움과 굵기만 바꾼다 — 글자색을 브랜드 색으로 바꾸지 않고, 왼쪽 막대를 두지 않는다. 사이드바 카드 안은 `--panel-hover`·`--panel-sel`, 바탕 위(계정 머리)는 `--frame-hover`·`--frame-sel`.
- 구분선 `border-b border-(--line)`. 사이드바 행은 선 대신 모서리(`--radius-item`)로 나뉜다.
- 행 끝 순서: 메타 → 수(`Count`) → 표시(`StatusChip`/`RefLabel`) → 행 안 버튼(`Button sm`, hover에만 보이면 `group-hover:opacity-100` + `group-focus-within`).
- `+N −N` 줄 수는 mono `meta` 11.5px, `text-diff-add-fg`·`text-diff-del-fg`, 부호는 `+`·`−`(U+2212). `Count`가 아니고 알약도 아니다.
- 폴더 경로는 이름 뒤에 `meta` `--muted`로 붙인다. 두 줄로 나누지 않는다(`CommitDetail`·`PrDetailPane`의 둘째 줄 폴더는 한 줄로 합친다).

**접근성.** 트리는 `treeitem`+`aria-level`(`TreeRowFrame`), 목록은 `option`/`listitem`, 고른 행은 `aria-selected` 또는 `aria-current`.

### 3.5 카드·패널·머리

- **카드(층 2)**: `Card` (`src/components/ui/Card.tsx`), `PANEL_SURFACE`. 본문 칸의 모든 덩어리(그래프 패널, 파일 목록, diff, 설정 묶음)가 카드다. 클래스를 손으로 베끼지 않는다. **API.** `children: ReactNode`, `className?: string`.
- **카드 머리**: 높이 32px(`h-8`), `px-3`, `border-b border-(--line)`. 제목 `body` 12.5px bold, 부제 `meta` `--muted`. 탭이 있으면 탭이 머리다(`GraphPanel`). 머리의 작업 버튼은 `Button sm ghost`·`iconOnly`.
- **떠 있는 패널 머리**(`PanelHeader`): 제목 `heading` 14px semibold, 부제 `meta`, 오른쪽에 `primary md` 하나 + 닫기 `iconOnly md`.
- **구역 라벨** `SectionLabel` (`ui/PanelHeader.tsx`): `meta` 11.5px semibold `--muted`, `px-3 pt-2 pb-1`, 접는 것이면 ▾ + `aria-expanded`, 접혔을 때만 `Count`. 띠 변형은 `bg-(--acc-faint) border-b`(패널 안 구역, 저장소별 그룹 머리). `uppercase` 없음.

### 3.6 빈 상태 `EmptyState` (`src/components/ui/EmptyState.tsx`)

**무엇.** 보일 것이 없거나 아직 고르지 않았을 때 그 칸에 놓는 것.

**API.** `icon?: LucideIcon`, `title: string`, `description?: string`, `action?: ReactNode`, `layout?: "panel" | "row"`(기본 panel).

**모양.** 두 가지뿐이다.

| 형 | 모양 | 쓰는 곳 |
|---|---|---|
| `panel` | 가운데, 아이콘 24px `--muted`, 제목 `body` 12.5 semibold `--fg2`, 설명 `meta` `--muted`, 선택으로 `Button sm secondary` 하나 | 칸·카드 전체가 빈 때(파일을 고르지 않음, PR 없음, 스태시 없음, diff 없음, 이진 파일) |
| `row` | 한 줄 글 `meta` `--muted`, `px-3 py-2`(가운데 정렬 없음) | 목록의 한 구역이 빈 때(검색 결과 없음, 이 저장소에 변경 없음) |

- 아이콘을 둥근 원에 넣지 않는다. 원(48·64px)은 모두 없앤다.
- 제목은 상황을, 설명은 다음 행동을 말한다(「파일을 고르세요」, 「에이전트가 파일을 바꾸면 여기에 보입니다」). 「데이터가 없습니다」 같은 빈 문장은 쓰지 않는다.
- 오류로 빈 것은 `EmptyState`가 아니라 `Notice tone="danger"`(3.7)다. 다시 시도 버튼이 있으면 그 안에 둔다.

**지금 쓰는 곳.** `EmptyState`(8곳), `PrPlaceholder`(9곳), `PanelEmptyState`(2곳), 손으로 만든 것(`StashList`, `ActionsList`, `ActionsView` 2, `DiffViewer` 2, `BinaryDiffViewer` 2, `ChangesView` 2, `FollowPanel` 3, `StashDetailView`, `RepoListView`, `ViewBranchPicker`, `RepoTree` 2).

### 3.7 알림

세 가지고, 서로 바꿔 쓰지 않는다.

| 종류 | 언제 | 컴포넌트 |
|---|---|---|
| 줄 안 안내 `Notice` | 그 칸의 내용과 함께 계속 보여야 하는 사실(병합 진행 중, 충돌 예고, 같은 파일을 다른 워크트리도 고침, fetch가 오래됨, gh 오류) | `src/components/ui/Notice.tsx` |
| 알림 `Toast` | 방금 끝난 일의 결과. 몇 초 뒤 사라진다 | `ErrorToast` |
| 확인 창 | 되돌릴 수 없는 일 전에 묻는다 | `ConfirmCommandDialog` |

**`Notice`** (`src/components/ui/Notice.tsx`): `px-3 py-2`, `--radius-item`, `bg-<tone>/10 border border-<tone>/20`, 14px 아이콘 + 글 `meta` 11.5px(제목이 있으면 `body` semibold + 설명 `meta`), 오른쪽에 `Button sm` 최대 둘. 톤 `info`·`warning`·`danger`·`success`·`neutral`(`bg-(--chip)`). 띠 변형(`banner`)은 모서리 없이 `border-b`만. **API.** `tone: "info" | "warning" | "danger" | "success" | "neutral"`, `icon?: LucideIcon`, `title?: string`, `children?: ReactNode`, `actions?: ReactNode`, `banner?: boolean`, `role?: "status" | "alert"`.

**`Toast`**: 층 3(`FLOATING_SURFACE`), `--radius-item`, `px-3 py-2.5`, 아이콘 16px은 톤 색, 글 `body` `--fg`, 닫기 `iconOnly sm ghost`. 바탕을 색으로 채우지 않는다(강조 예산). 오른쪽 아래, `max-w-sm`, 5초, `animate-toast-in/out`. 한 번에 셋까지.

### 3.8 창 `DialogFrame` (`src/components/ui/DialogFrame.tsx`)

**무엇.** 답을 받아야 하는 모달. 접근성(`role="dialog"`, 포커스 가두기, Escape)은 `Dialog`가 하고, `DialogFrame`은 모양을 정한다.

**API.** `title: string`, `titleId?: string`, `onClose?: () => void`, `size?: "sm" | "md" | "lg" | "xl"`(기본 md), `dismissible?: boolean`, `footer?: ReactNode`, `footerStart?: ReactNode`, `children: ReactNode`.

**모양.** `FLOATING_SURFACE` + `--radius-panel` 14px. 너비 `sm` 360 / `md` 440 / `lg` 620 / `xl`(충돌 미리보기, 나란히 보기: 화면 크기). 머리 `px-4 py-3 border-b`: 제목 `heading` 14px semibold + 닫기 `iconOnly md ghost`(닫을 수 있을 때만). 몸 `px-4 py-4`, 글 `body`, 라벨 `meta` semibold `--fg2`. 발 `px-4 py-3 border-t`, 오른쪽 정렬, `Button md`: 취소 `ghost` → 실행 `primary` 또는 `danger` 순. 발에 상태 글이 있으면 왼쪽.

- 선택지(브랜치 만들기의 「지금 브랜치에서 / …」)는 라디오 목록 한 덩어리: `border border-border --radius-item`, 줄마다 `px-3 py-2.5`, 이름 `body` medium, 설명 `meta` `--muted`. 라디오·체크는 네이티브 + `accent-primary`.
- 한 창에 `primary` 하나. 실행이 되돌릴 수 없으면 `danger`이고 제목·설명에 무엇이 사라지는지 적는다.
- 명령을 실행하는 창은 `Code`로 실행할 명령을 보인다(`ConfirmCommandDialog`, `MultiRepoRemoteDialog`).

**떠 있는 패널**(`AnchoredPanel`: 브랜치·워크트리 패널, 보기 브랜치 고르기)은 창이 아니라 팝오버다. `FLOATING_SURFACE` + `--radius-panel`, 너비 340–420, 머리는 `PanelHeader`, `animate-pop-in`.

### 3.9 메뉴

- 우클릭·▾ 메뉴는 `ContextMenu` 하나다. 손으로 만든 `role="menu"`(`SortMenu`, `ActionMenu`, `AccountDropdown`, `RepoListView`의 두 메뉴)는 `ContextMenu`나 그것의 `anchored` 변형으로 옮긴다.
- 모양: `FLOATING_SURFACE`, `--radius-item`, 안쪽 여백 4px, 항목 28px `px-2.5` `--radius-chip` `body` 12.5px, 아이콘 14px, hover `bg-accent`, 구분선 `my-1`. 설명이 있는 항목(강제 push)은 둘째 줄 `meta` `--muted`. 고른 항목은 앞 14px 자리에 체크.
- 되돌릴 수 없는 항목은 맨 끝, `variant: "danger"`, 누르면 확인 창.
- 열릴 때 `animate-pop-in`, 밖을 누르거나 휠·크기 바꿈·Escape로 닫힌다.

### 3.10 툴팁·정보 카드

- 기본은 네이티브 `title`이다. 아이콘만 있는 버튼, 잘린 글, 잘린 경로에 붙인다.
- `<Tooltip>`은 네이티브가 안 되는 곳(툴바 머리 줄의 드래그 영역, 바로 보여야 하는 곳)에만. 모양 `FLOATING_SURFACE` `--radius-chip` `px-2 py-1` `meta` 11.5px.
- 정보 카드(`SidebarHoverCard`): 마우스를 올리면 뜨는 자세한 정보. `FLOATING_SURFACE` `--radius-item` `px-3 py-2.5`, 글 `body`, 라벨 `meta` `--muted`, `animate-fade-in`, `pointer-events-none`.

### 3.11 탭·분할 선택·스위치·체크

- **탭** `Tab`: 밑줄 탭이다. 활성은 `--fg` + 브랜드 밑줄(`animate-indicator-x`), 비활성 `--muted`. `fill`(패널 폭을 나눠 가짐)과 `inline`(제 폭) 두 변형. 색 변형(`info`·`success`)은 없앤다. 탭 뒤의 수는 `Count`(알약 아님)이고 그 탭이 수의 주인일 때만 붙인다.
- **분할 선택** `Segmented` (`src/components/ui/Segmented.tsx`): 몇 개 안 되는 선택지 중 하나. 틀 `bg-(--chip)` `--radius-item` `p-0.5`, 조각 `--radius-chip`, 고른 조각 `bg-card shadow-(--shadow-sm) font-semibold`. **API.** `size?: "md" | "sm"`(조각 24px·20px), `disabled`·`title` per-option. `role="radiogroup"`, 화살표로 옮긴다.
- **켜고 끄는 칩**(`WorktreeChips`): 켜짐·꺼짐이 있는 버튼이다. `Button sm secondary` + `aria-pressed`, 꺼지면 점선 테두리 + `opacity-60`. 앞에 레인 색 견본 10px.
- **스위치** `Switch`: 켜면 브랜드 색. 설정에서만.
- **체크**: 스테이징 체크처럼 네이티브 `accent-primary`를 쓴다. 새 체크 칸도 이것을 따른다.

### 3.12 입력칸 `TextInput` (`src/components/ui/TextInput.tsx`)

- `md` 28px, `body` 12.5px, `px-2.5`, `border border-border bg-card`, `--radius-item`, hover 테두리 `--muted/40`, 포커스 `ring-2 ring-ring/40`. 라벨은 위에 `meta` semibold `--fg2`, 오류는 아래 `meta` `text-danger` `role="alert"`.
- `SearchInput` 변형: 테두리 없이 `bg-(--chip)`, 앞에 12px 돋보기, 지우기 `iconOnly sm`. `size?: "md" | "sm"`(28 또는 24), `wrapperClassName?: string`, `surface?: "panel" | "frame"`. `md` 28(패널 머리, 사이드바) / `sm` 24(찾기 줄).
- `Textarea`(여러 줄, 커밋 본문): 같은 모양, 줄 높이 18px.
- `Select`·`BranchCombobox`도 같은 높이·글자·모서리다.

### 3.13 상태 줄 `GitStatusLineView`

메인 카드 맨 위의 32px 줄. 수를 적지 않고 상태를 말한다. 톤이 바뀌면 줄 전체의 바탕이 바뀐다(`info/10` 보는 중, `warning/10` 진행 중·분리된 HEAD). 안의 버튼은 `Button sm`. 오른쪽 끝은 `StatusActivity`(도는 명령 + 작업 기록).

## 4. 결정 기록

살펴본 뒤 정한 규칙이다. 「전」은 2026-09-26 코드 기준이다.

| # | 발견 | 규칙 |
|---|---|---|
| D1 | 수가 다섯 모양: 사이드바는 글자 `↑2`, 툴바는 채운 알약(`TOOLBAR_BADGE`), 탭은 회색 알약, 변경 그룹은 브랜드 틴트 알약(`ChangesView:309`), 구역 라벨은 옅은 글자 | 수는 언제나 글자(`Count`). 알약 없음 |
| D2 | 상태 칩이 넷: PR 18px/10.5, 스레드 16px/10, 브랜치 `rounded`/10px/py-3px, 워크트리 정리 가능 `rounded`/10px | `StatusChip` 18px/10.5/6px 하나. 톤 여섯 |
| D3 | PR 초안 칩이 브랜드 틴트(`PrListView:198`) | 상태에 브랜드 색 없음. `neutral` |
| D4 | 이름표가 넷: 커밋 행 `rounded`/10px/medium, WIP 행 6px/10.5/bold, 워크트리 칩 흰 바탕 테두리, 겹침 띠 이름표 | `RefLabel` 18px/6px/10.5 semibold 하나. 종류·위치로 채움만 갈린다 |
| D5 | 파일 상태가 둘: 색 칸 아이콘(`FileStatusBadge`) vs 글자(없앤 `FilesByRepo`) | 글자 하나. 색 칸 없앰 |
| D6 | 저장소 타일이 다섯 크기·세 모서리(16/4px, 18/5px, 20/5px, 28/8px, 32/7px) | `RepoTile` 네 크기, 모서리 5px(≤20)·8px(32) |
| D7 | 점 크기 6·7·8px | 6px, 테 3px |
| D8 | 버튼 높이 20·22·24·26·28·30·32·36px, 글자 10–14px | `sm` 24/11.5, `md` 28/12.5, `lg` 36/13(환영·안내 화면만) |
| D9 | 보조 버튼이 둘: 칩 채움(패널) vs 테두리(설정) | 칩 채움 하나 |
| D10 | 창의 발 버튼이 `px-4 py-2 text-sm`(≈36px)로 앱의 다른 버튼보다 크다(20개 창) | `Button md` 28px |
| D11 | 창 제목이 15px semibold·14px semibold·15px bold·13px bold | 14px semibold |
| D12 | 창 모서리 12px(`rounded-xl`)와 14px 섞임, 그림자 `shadow-2xl`·`ring-1`·`shadow-[0_24px_60px…]` 섞임 | `FLOATING_SURFACE` + 14px. 임의 그림자 없음 |
| D13 | 창 머리·몸·발을 20개 창이 각자 만든다 | `DialogFrame` |
| D14 | 메뉴가 셋: `ContextMenu`(py-1.5 text-sm), `SortMenu`(30px 12.5 inset), `ActionMenu`(14px + 설명), 드롭다운 넷이 손으로 | `ContextMenu` 하나, 항목 28px/12.5 inset |
| D15 | 빈 상태가 다섯 모양(64px 원, 48px 원, 32px 아이콘, 20px 아이콘, 글만) | `EmptyState panel`(아이콘 24 원 없음) / `row` |
| D16 | 구역 라벨이 11px bold·11px semibold·text-xs uppercase tracking | `meta` 11.5 semibold `--muted`, `uppercase` 없음 |
| D17 | 글자 크기 15가지(9·9.5·10·10.5·11·11.5·12·12.5·13·14·15·xs·sm·base·lg) | 여섯 단계(2.2) |
| D18 | `--faint` 57곳, `text-muted-foreground/50·60·70` 17곳 | `--muted` 하나. 투명도 섞기 없음 |
| D19 | 선택 행이 둘: `bg-primary/10 text-primary font-semibold`(변경·스태시·Actions) vs `bg-(--acc-sel)` | `bg-(--acc-sel)`, 글자 그대로 |
| D20 | `+N −N`이 text-xs·11px·10.5px·10px, 색이 `success/danger` vs `diff-add-fg/diff-del-fg`, 부호 `-` vs `−` | mono `meta` 11.5, diff 색, `−` |
| D21 | 폴더 경로를 둘째 줄로 내리는 목록(`CommitDetail`, `PrDetailPane`)과 한 줄에 붙이는 목록 | 한 줄, 이름 뒤 `meta` `--muted` |
| D22 | 알림이 톤 색으로 바탕을 채운다(`bg-destructive/90`) | 층 3 흰 바탕 + 톤 색 아이콘 |
| D23 | 줄 안 안내가 각자 모양(`MergeActionPanel` `/8`·`/15`, 창 안 `warning/10`·`/20`, `OverlapBadge` `danger/8`·`/25`) | `Notice` `/10` + `/20` |
| D24 | 분할 선택이 여섯(설정 `Segmented`, `WorkSwitcher` 26px, 따라가기 20px, PR 필터 20px, 나란히 22px mono, diff 보기 테두리 묶음, 이미지 CSS) | `Segmented md/sm` |
| D25 | 입력칸 높이 24·28·30·32·38px, 모서리 6·8px, 포커스 `ring-1`·`ring-2`·`border-ring` | `TextInput md` 28 / `search sm` 24, 8px, `ring-2 ring-ring/40` |
| D26 | 탭 색 변형 `info`·`success`가 쓰이지 않음 | 없앰 |
| D27 | 카드 클래스를 네 곳이 베낀다(`GraphPanel:161`, `WorkspaceReview:120`, `SideBySideDiff:39`, `Card`) | `Card`만 |
| D28 | `title=` 162곳 vs `<Tooltip>` 2곳 | `title` 기본, `Tooltip`은 툴바 머리 줄만 |
| D29 | 툴바 워크트리 수 알약(`WorktreeZone:90`)과 툴바 ↑↓ 알약이 사이드바 글자 신호와 다르다 | 글자(`Count`) |
| D30 | 이름표·메뉴 항목의 아이콘 크기가 `size={14}`·`w-3`·`w-3.5` 섞임 | 클래스만, 2.6 표 |
| D31 | `transition-all duration-150`, `transition-opacity duration-300`(환영 화면) | 이름 붙은 움직임과 `transition-colors`만 |
| D32 | 스태시·Actions 두 줄 행의 둘째 줄이 `stash@{n}` 알약·브랜치 알약 | 알약 없이 `meta` 글자, 브랜치는 `RefLabel` |
| D33 | 왼쪽 세로 막대가 네 곳(사이드바 선택 막대 `SelectionBar`, 설정 탐색의 막대, 그래프 WIP 행의 막대, diff 새 줄의 안쪽 막대) | 왼쪽 막대 금지(사용자 규칙). 넷 다 코드에서 뺐고 `--animate-indicator-y`도 지웠다. 선택은 채움 + 굵기, 새 줄은 `--live-faint` 틴트 + 주황 줄 번호(2.9) |
| D34 | 사이드바·머리 줄(`--frame` #e9e9e7)과 본문(`--canvas` #f1f1ef)의 바탕이 달랐다 | 바탕 하나: `--frame`은 `--canvas`의 별칭. 카드 없는 경계에만 1px `--line`. hover·선택 채움은 새 바탕에 맞춰 다시 잡았다(2.5) |
| D35 | 수 표시가 다섯 모양(D1): 사이드바는 글자, 툴바는 채운 알약, 탭은 회색 알약, … | 툴바 버튼과 탭 count는 채운 알약(`rounded-full`)으로 유지하되, 버튼·탭 밖(사이드바 행 등)의 Count는 글자만. 이유: 버튼에 이미 「Push」 글자와 방향 아이콘이 있어서, 숫자 옆에 화살표를 또 붙이면 중복. 단일 source(2.9)의 범위 안에서 시각적 문맥에 따른 표현 변형 |
| D36 | 알림(`Toast`)이 톤 색으로 바탕을 채웠다(`bg-destructive/90`) | 층 3 흰 바탕(`FLOATING_SURFACE`) + 16px 톤 색 아이콘(error는 `--danger` 사용). 글 `text-[12.5px] text-foreground`. 닫기 `Button iconOnly sm ghost`. 강조 예산 원칙에 따라 배경 색 제거 |
| D37 | 창의 발 버튼들이 28px보다 크고 글자도 크다(px-4 py-2 text-sm) | 모든 버튼은 `Button md` 28px / 12.5px 통일. 창 발도 같음. 이전 36px 는 환영·안내 화면만 `lg`(3.1) |
| D38 | 보조 버튼이 둘: 패널 칩 채움 vs 설정 테두리 | 보조 버튼은 칩 채움 하나(`bg-(--chip) text-(--fg2) hover:bg-accent`). 테두리 버튼 없음. 모든 곳에서 일관됨 |
| D39 | 그래프 행의 작성자와 시각이 다른 크기(12px·11px 섞임) | 작성자 `body` 12.5px `--fg2`, 시각·해시 `meta` 11.5px. 일관된 행 높이(`GRAPH_ROW_HEIGHT`) 내에서 계층을 나눔 |

## 5. 컴포넌트 ↔ 파일

| 컴포넌트 | 파일 | 상태 |
|---|---|---|
| `Button`, `IconButton` | `ui/Button.tsx` | 있음 |
| `toolbarButtonClass` | `toolbar/toolbar-button.ts` | 있음 |
| `Count`, `StatusChip`, `RefLabel`, `RepoTile`, `Dot`, `Code` | `ui/marks.tsx`(한 파일, 작은 것들) | 있음 |
| `Row` 규칙 | 컴포넌트 없음. `TreeRowFrame`(사이드바)·각 목록 | 규칙만 |
| `Card`, `PANEL_SURFACE`, `FLOATING_SURFACE` | `ui/Card.tsx`, `ui/layers.ts` | 있음 |
| `PanelHeader`, `PanelSearch`, `SectionLabel` | `ui/PanelHeader.tsx` | 있음 |
| `EmptyState` | `ui/EmptyState.tsx` | 있음 |
| `Notice` | `ui/Notice.tsx` | 있음 |
| `Toast` | `error/ErrorToast.tsx` | 있음 |
| `Dialog`, `DialogFrame`, `ConfirmCommandDialog` | `ui/Dialog.tsx`, `ui/DialogFrame.tsx` | 있음 |
| `AnchoredPanel` | `ui/AnchoredPanel.tsx` | 있음 |
| `ContextMenu` | `ui/ContextMenu.tsx` | 있음 |
| `Tooltip`, `SidebarHoverCard` | `ui/Tooltip.tsx`, `sidebar/SidebarHoverCard.tsx` | 있음 |
| `Tab`, `TabGroup` | `ui/Tabs.tsx` | 있음 |
| `Segmented` | `ui/Segmented.tsx` | 있음 |
| `Switch` | `settings/ui/Switch.tsx` | 있음 |
| `TextInput`, `SearchInput`, `Textarea` | `ui/TextInput.tsx` | 있음 |
| `Select`, `BranchCombobox` | `ui/` | 있음 |
| `Spinner`, `BusyIcon`, `LoadingState`, `SwitchingOverlay` | `ui/` | 있음 |
| `FocusFlash` | `ui/FocusFlash.tsx` | 있음 |
