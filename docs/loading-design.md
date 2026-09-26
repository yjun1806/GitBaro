# 불러오는 중 표시

앱에서 「기다리는 중」을 보여 주는 방법은 아래 네 가지뿐이다. 새 화면을 만들 때도 이 중에서 고른다. 모두 `src/components/ui/`와 `src/hooks/useSteadyValue.ts`에 있다.

| 상황 | 쓰는 것 | 모양 |
|---|---|---|
| 칸·창·화면의 내용 전체를 기다린다 | `<LoadingState label? />` | 가운데에 회전 표시(14px) + 글자 한 줄(12px, `--muted`) |
| 목록 안 한 묶음이나 「더 불러오기」를 기다린다 | `<LoadingState layout="row" label? />` | 줄 왼쪽에 회전 표시(12px) + 글자(11.5px) |
| 버튼이 시작한 일이 도는 중이다 | `<BusyIcon busy icon />` 또는 `{busy && <Spinner />}` | 아이콘 자리에 같은 크기 회전 표시 |
| 줄 안에 붙는 작은 「일하는 중」(사이드바 fetch, 상태 줄 git 명령, 결과 줄 「실행 중」) | `<Spinner size="sm" \| "md" />` + `useSteadyFlag`/`useSteadyValue` | 곁 글자 크기에 맞춘 회전 표시 |

영역을 덮어 조작을 막아야 할 때(브랜치 전환)만 `SwitchingOverlay`처럼 `<Spinner size="lg" />`를 반투명 막 위에 둔다.

## 회전 표시(`Spinner`)

- 크기는 셋이다. 곁 글자에 맞춘다.
  - `sm` 12px: 11–12px 글자 곁(사이드바 줄, 칩, 목록 줄 안 상태)
  - `md` 14px(기본): 13–14px 글자 곁, 버튼, 상태 줄, 칸 가운데
  - `lg` 20px: 글자 없이 한 영역을 덮을 때
- 색은 둘레 글자색을 따른다(`currentColor`). 주요 버튼 안이면 버튼 글자색이다. 따로 칠할 때도 토큰만 쓴다(`text-muted-foreground`, CI 실행 중은 `text-warning`). 브랜드 색(`text-primary`)으로 칠하지 않는다.
- 다른 아이콘(`RefreshCw`를 돌리기 등)을 회전 표시로 쓰지 않는다. 새로 고침 버튼도 일하는 동안 아이콘을 `Spinner`로 바꾼다(`BusyIcon`).
- 곁에 글자가 없으면 `label`(i18n)을 준다. 그러면 `role="img"`와 그 이름으로 읽힌다. 곁에 글자가 있으면 주지 않는다(화면 읽기 프로그램에 숨김).
- 「동작 줄이기」에서도 돈다. macOS의 진행 표시처럼, 멈추면 진행 중인지 알 수 없다. 다른 움직임(나타나기, 펼치기)은 `globals.css`에서 흐려지기만으로 줄인다.

## 칸의 「불러오는 중」(`LoadingState`)

- 글자는 무엇을 읽는지 말한다(`diff.loadingDiff`, `history.loadingHistory`, `compare.loading` …). 없으면 `common.loading`.
- `role="status"`라서 화면 읽기 프로그램이 알린다.
- 200ms 기다렸다가 흐린 데서 나타난다(`animate-loading-in`). 금방 끝나는 읽기에는 보이지 않는다.
- 뼈대 줄(skeleton)은 쓰지 않는다. 이 앱의 칸은 대부분 금방 차고, 뼈대가 실제 내용과 모양이 달라 오히려 출렁인다.
- 이미 받은 내용이 있으면 새로 받는 동안 그 내용을 그대로 둔다(`isLoading && !data`일 때만 `LoadingState`). 새로 고침 때마다 칸을 비우지 않는다.

## 버튼이 일하는 중

- `disabled`와 `aria-busy={busy}`를 함께 건다.
- 아이콘이 있는 버튼은 아이콘을 `BusyIcon`으로 바꾼다. 폭이 흔들리지 않는다.
- 아이콘이 없는 버튼은 글자 앞에 `<Spinner />`를 둔다.
- 글자는 그대로 두거나, 진행형 문구가 이미 있으면(`commit.committing`, `clone.cloning`, `merge.merging`, `sync.fetching`) 그것으로 바꾼다. 「Loading」으로 바꾸지 않는다.
- 로컬에서 금방 끝나는 일(스테이징 등)은 표시 없이 `disabled`만 건다.

## 줄 안의 작은 표시와 깜박임

- 여러 번 짧게 켜졌다 꺼지는 표시(워크스페이스의 저장소를 하나씩 fetch 등)는 `useSteadyFlag(busy)`나 `useSteadyValue(value, timing)`로 고르게 한다.
- 기본 박자 `BUSY_TIMING`: 300ms보다 짧은 일은 보이지 않고, 끝난 뒤 800ms 남는다. 이미 보이는 중이면 다음 일로 바로 바뀐다.
- 글자가 바뀌는 표시(상태 줄의 「Fetch 중 → Pull 중」)는 폭을 고정해 옆 요소를 밀지 않는다. git 명령 이름(`fetch`)을 고정폭 글꼴로 그대로 보이지 않고 `activity.op.*` 문구로 보인다.

## 지금 상태(2026-09-26)

바꾸기 전 앱에는 「기다리는 중」 표시가 50곳 있었다. 회전 표시 크기가 여섯 가지(12·14·16·20·24·40px)였고, `RefreshCw`를 돌리는 곳, 깜박이는 글자(`animate-pulse`), 글자만 있는 곳이 섞여 있었다. 49곳을 위 네 가지로 옮겼다.

| 종류 | 곳 |
|---|---|
| 버튼이 일하는 중 | 11 |
| 줄 안 작은 표시 | 8 |
| CI 실행 중 상태 아이콘 | 3 |
| 칸·목록의 「불러오는 중」 | 22 |
| 화면 전체 첫 로딩 | 2 |
| 영역 덮개 | 1 |
| 로그인 창의 큰 회전 표시 | 2 |
| 값 자리의 「확인 중」 글자 | 1 |

그대로 둔 한 곳은 `settings/app/AboutSection.tsx`의 git·gh 경로 칸이다. 값이 들어갈 자리에 「확인 중」 글자를 잠깐 보이는 것이라 회전 표시를 더하지 않았다.
표시 없이 `disabled`만 걸던 병합 계속·중단 버튼(`conflict/MergeConflictBanner.tsx`)에는 `BusyIcon`을 새로 붙였다.
