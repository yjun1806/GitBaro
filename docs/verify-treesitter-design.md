# verify tree-sitter 레이어 설계 (Design)

> **Status**: AUTHORITATIVE for V1 · V7 · V8 · V9 · V17. 구현자는 문자 그대로 따른다.
> **상위 계약**: `docs/verify-contract.md` (§2 공유 타입 · §2.4 레지스트리 · §7-① 정직성 불변식은 **그대로 유효**하며 이 문서가 덮어쓰지 않는다)
> **Source spec**: `docs/local/ai-output-verification-report.md` §4 (V-번호 정의), §7-④(성능 절벽), §7-⑤(언어 파편화)
> **범위**: V1(구조 diff) · V7(재발명, Type-2/3만) · V8(고아 코드) · V9(영향 범위) · V17(불변식, `docs:`/`style:`만)
> **범위 밖 (계속 `Planned`)**: V15 · V16 · V18 · V28 · V36. V7의 Type-4 시맨틱 클론(임베딩 필요)도 **영구 범위 밖**이다.

이 문서는 기존 verify 서브시스템(56파일 · 439 테스트 · clippy clean)에 **추가**하는 레이어를 정의한다. 재설계가 아니다.

---

## 0. 이 설계가 강제하는 5가지 불변식

애매하면 여기로 돌아온다.

1. **인덱스가 없다 = "깨끗함"이 아니다.** 심볼 인덱스가 없거나 부분적이면 V7/V8/V9는 `ScanLimit{MissingArtifact}`로 나가고 finding을 0개 만든다. 상위 계약 §7-① 그대로다.
2. **파싱 실패는 텍스트 diff로 강등된다.** V1이 파스 트리를 신뢰할 수 없으면 기존 텍스트 diff 뷰를 그대로 쓰고 `ScanLimit{ParseFailed}`를 남긴다. **반쪽짜리 구조 뷰는 절대 렌더하지 않는다.** "이 2,800줄은 포맷 변경이니 안 봐도 된다"는 잘못된 판정이 이 기능의 최악의 실패 모드이기 때문이다.
3. **취소는 에러가 아니다.** 인덱싱 취소는 `Err`가 아니라 `state: Cancelled` + `complete: false`로 끝난다. 부분 인덱스는 버리지 않고 보존하되 상태를 정직하게 보고한다.
4. **UI를 블로킹하지 않는다.** 인덱스 빌드 커맨드는 즉시 반환하고 진행 상황은 이벤트로 흐른다. 어떤 커맨드도 전체 인덱싱을 await 하지 않는다.
5. **언어는 TS/TSX/JS/JSX + Rust뿐이다** (§7-⑤). 다른 확장자는 조용히 건너뛰는 게 아니라 **개수를 세어** `ScanLimit{UnsupportedLanguage}`의 `detail`에 넣는다.

---

## 1. 크레이트 선정 — 실측 검증 완료

상위 계약 §5는 "신규 크레이트 0개"였다. **이 문서가 그 결정을 명시적으로 뒤집는다.** tree-sitter 없이 AST를 얻을 방법은 없다. §5의 "구현자가 이 결정을 뒤집으려면 반드시 리포트에 명시하고 `src-tauri/Cargo.toml`을 직접 수정할 것" 조항에 따른 명시적 기록이다.

### 1.1 확정 버전 (throwaway `cargo add` + `cargo check` + 실행 테스트로 검증함)

```toml
tree-sitter = "0.26.11"
tree-sitter-typescript = "0.23.2"
tree-sitter-javascript = "0.25.0"
tree-sitter-rust = "0.24.2"
streaming-iterator = "0.1.9"
```

**검증 방법과 결과** (스크래치 크레이트 + 실제 `src-tauri` 양쪽에서):

| 검증 항목 | 결과 |
|---|---|
| 버전 해석 | 5개 직접 + `tree-sitter-language 0.1.7` 1개 = **신규 패키지 6개**. 기존 `regex`/`cc`/`serde_json`/`memchr`/`indexmap`과 충돌 없음 |
| 실제 `src-tauri`에서 `cargo check` | **통과** (warm target 기준 15.5s) |
| 4개 그래머 로드 + 파싱 | TS(ABI 14) · TSX(ABI 14) · JS(ABI 15) · Rust(ABI 15) 전부 `has_error() == false` |
| `Query` + `QueryCursor::matches` | 통과. `streaming-iterator`의 `StreamingIterator::next` **필수** (0.25+ API 변경) |
| 점 포함 캡처명(`@definition.function`) | 통과 |
| 취소 (`ParseOptions::progress_callback` → `ControlFlow::Break`) | 통과. 취소된 파스는 `None` 반환 |
| `Send`/`Sync` | `Parser: Send`(not Sync) · `Tree: Send` · `Query: Send + Sync` · `Language: Send + Sync` |
| MSRV | tree-sitter 0.26 = **1.77**. 기존 스택보다 낮으므로 제약 아님 |

### 1.2 왜 이 조합인가

- **`tree-sitter-typescript`는 0.23.2가 최신이다.** 0.25가 없다. 그래머 크레이트가 코어 버전과 어긋나 보이는 건 정상이며, 실제 결합은 코어가 아니라 **`tree-sitter-language 0.1.7`** 을 통해 이뤄진다. 4개 그래머 전부 `tree-sitter-language 0.1.x`만 의존하므로 코어 0.26과 자유롭게 조합된다. 이것이 "그래머는 코어와 버전 결합이 심하다"는 통념이 0.24 이후로는 더 이상 사실이 아닌 이유다.
- **캐럿(`"0.26.11"`)으로 두고 `=`로 핀하지 않는다.** `Cargo.lock`이 커밋되어 있으므로 재현성은 락파일이 보장한다. `=` 핀은 보안 패치 수용만 막는다.
- **`streaming-iterator`는 선택이 아니다.** `QueryCursor::matches`가 `StreamingIterator`를 반환하므로 트레이트를 import하지 않으면 컴파일되지 않는다.

### 1.3 감수하는 비용

- **`regex 1.13`이 트리에 들어온다.** tree-sitter 코어가 쿼리 프레디킷(`#match?`)에 쓴다. 상위 계약 §5는 "regex 추가 안 함"이었지만 그건 **우리가 직접 쓰지 않는다**는 뜻이었고, 그 결정은 유효하다. verify 룰 코드에서 `regex`를 직접 쓰는 것은 계속 금지한다.
- **생성 C 소스 26 MB** (typescript 8.3 MB · tsx 8.4 MB · rust 6.2 MB · javascript 2.7 MB). 콜드 빌드 1회 비용이고 그래머 버전을 올릴 때만 재컴파일된다. 증분 빌드에는 영향이 없다.
- **바이너리 크기 증가** 약 10~15 MB (파서 테이블). macOS `.app` 번들에서 수용 가능하다고 판단한다.

### 1.4 추가하지 않는 것

| 크레이트 | 결정 | 근거 |
|---|---|---|
| `rayon` | **추가 안 함** | 인덱싱 병렬화는 `tokio::task::spawn_blocking` 워커 N개 + 공유 작업 큐로 충분하다. 이미 있는 런타임을 쓴다 |
| `walkdir` | **추가 안 함** | 파일 열거는 `git2` 인덱스/트리 순회로 한다 (§2.2). `node_modules`·`target`이 자동으로 빠지는 게 부수효과가 아니라 **핵심 이유**다 |
| `sha2`/`blake3` | **추가 안 함** | 콘텐츠 ID는 `git2::Oid::hash_file`, 인메모리 해시는 손으로 쓴 FNV-1a |
| `bincode`/`rkyv` | **추가 안 함** | 캐시는 `serde_json`. 샤딩(§3.3)으로 쓰기 비용을 잡으므로 바이너리 포맷이 필요할 만큼 커지지 않는다 |
| `tree-sitter-tags` / `-highlight` | **추가 안 함** | 우리가 필요한 추출은 `.scm` 쿼리 + 커서 순회로 충분하고, tags 크레이트는 자체 스키마를 강요한다 |

---

## 2. 성능 절벽 대응 (§7-④) — 실측 기반

### 2.1 실측 처리량

릴리스 빌드, TypeScript 그래머, 단일 스레드: **≈ 9.8 MiB/s** (디버그 빌드는 2.5 MiB/s — 개발 중 체감이 4배 느리다는 것을 미리 알고 있을 것).

| 저장소 규모 | 소스 바이트 | 1스레드 | 4워커 (추정) |
|---|---|---|---|
| GitBaro 자체 (195 파일) | 1.0 MB | 0.1 s | 0.1 s |
| 중형 (5k 파일) | 25 MB | 2.6 s | 0.8 s |
| 대형 (50k 파일) | 250 MB | 26 s | 8 s |

즉 **첫 인덱싱은 대형 저장소에서 10초 단위**이지 분 단위가 아니다 — 단, 아래 3개를 지켰을 때만이다.

### 2.2 파일 열거는 git이 한다

`std::fs::read_dir` 재귀 금지. `git2`로 열거한다:

1. `repo.index()`를 순회해 tracked 경로를 얻는다 (HEAD 트리가 아니라 **인덱스**여야 스테이징된 신규 파일이 잡힌다).
2. `repo.statuses()`로 untracked(`include_untracked=true`, `include_ignored=false`) 경로를 더한다.
3. 확장자로 언어를 판정하고 지원 언어만 남긴다.

`node_modules/` · `target/` · `dist/` 는 `.gitignore`에 있으므로 **자동으로 빠진다.** 이것이 순진한 디렉터리 워크 대비 100배 차이를 만드는 지점이다. 별도 exclude 목록을 손으로 관리하지 않는다.

### 2.3 예산 (`verify/syntax/mod.rs`, T0 소유 — 전 phase 공유)

```rust
/// 파일 하나의 상한. 손으로 쓴 소스는 1 MiB를 넘지 않는다. 넘으면 번들·생성물·미니파이다.
pub const MAX_SOURCE_BYTES: usize = 1024 * 1024;
pub const MAX_INDEXED_FILES: usize = 50_000;
pub const MAX_SYMBOLS_PER_FILE: usize = 2_000;
/// 전체 빌드 벽시계 예산. 초과 시 부분 인덱스로 마감한다 (에러 아님).
pub const MAX_INDEX_MILLIS: u64 = 120_000;
/// V1 비교 한 쪽의 상한.
pub const MAX_STRUCTURAL_BYTES: usize = 2 * 1024 * 1024;
/// 파일 버전 하나의 파싱 상한.
pub const MAX_PARSE_MILLIS: u64 = 2_000;
/// 이 토큰 수 미만의 심볼은 클론 후보가 되지 않는다 (getter/setter 오탐 방지).
pub const MIN_CLONE_TOKENS: u32 = 40;
pub const INDEX_WORKERS_MAX: usize = 4;
pub const PROGRESS_THROTTLE_MILLIS: u64 = 100;
```

예산 초과는 전부 **카운트해서** `ScanLimit{BudgetExceeded}`의 `detail`에 넣는다 (`"3 file(s) over 1 MiB skipped"`).

### 2.4 병렬화

`INDEX_WORKERS_MAX = min(available_parallelism(), 4)`. 4로 캡하는 이유는 UI 응답성이다 — 인덱싱은 백그라운드 작업이고 사용자의 diff 스크롤보다 우선순위가 낮다.

워커 하나당 `Parser` 하나 (`Parser: Send`, `!Sync`). `Query`와 `Language`는 `Send + Sync`이므로 `OnceLock<Query>`로 프로세스당 1회만 컴파일한다 — 쿼리 컴파일은 파싱보다 비싸므로 파일마다 새로 만들면 안 된다.

작업 분배는 `Arc<Mutex<std::vec::IntoIter<IndexTask>>>`에서 각 워커가 하나씩 pop 하는 단순 큐다. 파일 크기 편차가 커서 정적 분할은 나쁘다.

---

## 3. 심볼 인덱스 아키텍처

### 3.1 3층 구조

```
디스크 스냅샷 (.git/gitbaro/symbol-index/)   ← 웜 스타트 전용. 정확성이 여기에 의존하지 않는다
        ↕ 로드/저장
인메모리 RepoIndex (Tauri managed state)      ← 권위. 인터닝된 표현
        ↕ 조회
V7 / V8 / V9 룰
```

**디스크는 캐시일 뿐이고 인메모리가 권위다.** 스냅샷이 깨져 있거나 없으면 전체 재빌드가 유일한 결과이고, 그 외 어떤 동작 차이도 없다.

### 3.2 캐시 위치

`paths::worktree_state_dir(repo)` → `.git/gitbaro/symbol-index/`

**worktree-local이다** (`shared_state_dir` 아님). 인덱스는 "이 체크아웃의 파일 내용"을 기술하고, 링크된 worktree는 다른 브랜치를 보고 있으므로 공유하면 틀린다. `paths.rs`는 T0도 수정하지 않는다 — 기존 함수를 그대로 호출한다.

```
.git/gitbaro/symbol-index/
├── meta.json          # { schemaVersion, toolVersion, queryDigest, fileCount, symbolCount, builtAt, complete }
└── shards/
    ├── 00.json … 3f.json   # 64 샤드. { "files": [FileSymbols, …] }
```

샤드 = `fnv1a32(path) & 0x3F`. 쓰기는 `*.tmp` 작성 후 `fs::rename` (원자적). **더티 샤드만** 다시 쓴다 — 5개 파일이 바뀌면 최대 5개 샤드만 재작성된다.

디스크 쓰기는 **3초 디바운스**한다. 인덱스 갱신이 연속으로 일어날 때(에디터 저장 연타) 매번 직렬화하지 않는다.

### 3.3 캐시 키 — 2단 검증

```rust
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub size: u64,
    pub mtime_ms: i64,
}
```

무효화 절차 (파일 하나당):

1. `fs::metadata` → `FileStamp`. 캐시된 stamp와 **같으면 끝** (파일을 열지 않는다). 50k 파일 stat 비용 ≈ 100 ms.
2. stamp가 다르면 `git2::Oid::hash_file(Blob, abs_path)` → `content_id`. 캐시된 `content_id`와 같으면 **stamp만 갱신하고 재파싱하지 않는다** (`touch`·체크아웃 왕복·줄바꿈 없는 재저장 대응).
3. `content_id`도 다르면 재파싱.
4. 디스크에 없는 경로는 엔트리 삭제. 캐시에 없는 경로는 신규 파싱.

**`mtime` 단독 키를 쓰지 않는 이유**: 같은 밀리초 안에 크기가 같은 다른 내용으로 덮이면 놓친다. 2단 검증이 그 창을 닫는다. **`content_id` 단독을 쓰지 않는 이유**: 50k 파일 전체 읽기가 매 갱신마다 발생한다.

### 3.4 스키마 무효화

`meta.json`의 셋 중 하나라도 어긋나면 **디렉터리 전체를 버리고 전체 재빌드**한다:

- `schemaVersion` — `SCHEMA_VERSION: u32` 상수. 레코드 모양이 바뀌면 T0가 올린다.
- `toolVersion` — `env!("CARGO_PKG_VERSION")`. 릴리스마다 바뀌므로 그래머 크레이트 버전 상승을 자동으로 흡수한다.
- `queryDigest` — `include_str!`한 `.scm` 3개를 이어붙인 문자열의 FNV-1a 64. 추출 규칙 변경이 가장 잦은 드리프트 원인이므로 별도 키로 둔다.

> **알려진 구멍**: 그래머 크레이트만 올리고 앱 버전을 올리지 않으면 stale 인덱스가 남는다. 실무상 릴리스 없이 의존성만 올라간 빌드를 사용자가 쓰는 경로가 없으므로 감수한다. 빌드 스크립트로 그래머 버전을 심는 방식은 명시적으로 **채택하지 않는다** (복잡도 대비 이득 없음).

### 3.5 취소 (`verify/syntax/cancel.rs`, T0 소유)

```rust
/// 인덱싱·구조 비교 양쪽이 공유하는 협조적 취소 신호.
#[derive(Clone, Default)]
pub struct CancelToken(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl CancelToken {
    pub fn new() -> Self;
    pub fn cancel(&self);
    pub fn is_cancelled(&self) -> bool;
}
```

체크 지점 **3곳** (여기가 전부다):

1. 각 파일을 파싱하기 **전** — 정상 경로에서 이걸로 충분하다.
2. `ParseOptions::progress_callback` 안 — 단일 거대 파일이 워커를 붙잡는 경우. `ControlFlow::Break(())`를 반환하면 `parse_with_options`가 `None`을 반환한다 (실측 확인).
3. 샤드 쓰기 루프 앞 — 취소 후에도 이미 파싱한 결과는 저장한다.

취소되면 `complete: false`로 스냅샷을 남기고 `phase: "cancelled"` 이벤트를 마지막으로 emit 한다. **`Err`를 반환하지 않는다.**

빌드가 이미 돌고 있는 상태에서 같은 저장소에 `build_symbol_index`가 다시 오면 **no-op**이고 현재 상태를 반환한다. 다른 저장소면 기존 빌드를 취소하고 새로 시작한다 (활성 저장소는 하나다).

### 3.6 진행 이벤트 (`events.rs`, T0 소유)

기존 `VERIFY_TEST_PROGRESS` 패턴을 그대로 따른다.

```rust
pub const VERIFY_INDEX_PROGRESS: &str = "verify:index-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyIndexProgressEvent {
    pub repo_path: String,
    /// "enumerating" | "parsing" | "writing" | "done" | "cancelled"
    pub phase: String,
    pub files_done: usize,
    pub files_total: usize,
    pub symbols: usize,
    pub running: bool,
}
```

스로틀: 최소 `PROGRESS_THROTTLE_MILLIS`(100 ms) 간격. 단 **첫 이벤트 · 마지막 이벤트 · phase 전환은 항상 emit** 한다. 이벤트 자체가 부하가 되면 안 된다.

### 3.7 인메모리 거주 정책

Tauri managed state:

```rust
/// lib.rs에서 `.manage(SymbolIndexStore::default())`. 활성 저장소 + 직전 저장소만 유지한다.
pub struct SymbolIndexStore(Mutex<VecDeque<(PathBuf, Arc<RwLock<RepoIndex>>)>>);
```

거주 상한 **2개 저장소**, LRU 축출.

> **의도적 관례 이탈**: `CLAUDE.md`는 "각 커맨드가 자기 `git2::Repository`를 열고, 장기 저장 per-repo 워커는 없다"고 한다. 심볼 인덱스는 이 규칙의 **명시적 예외**다 — §7-④가 요구하는 증분 인덱싱은 호출 간 상태 보존 없이는 정의상 불가능하다. `git2::Repository`는 여전히 커맨드마다 새로 연다. 장기 보존하는 것은 인덱스 데이터뿐이고, 그 durability는 디스크 스냅샷이 담당한다.

문자열 인터닝: 인메모리 표현은 `NameId(u32)` + 저장소당 `Vec<String>` 인터너를 쓴다. 50k 파일 × 참조 200개를 `String`으로 들면 헤더만 240 MB다. **디스크·와이어 표현은 평문 문자열**이고 로드 시 인터닝한다. `verify/syntax/model.rs`(T0)가 정의하는 것은 문자열 형태이며, 인터너는 `verify/syntax/index.rs`(T0) 내부 구현이다.

### 3.8 갱신 트리거 — pull 방식

FS 워처(`commands/watch.rs`)에 **연결하지 않는다.** 그 파일은 이번 작업 어느 phase의 소유도 아니고, 워처 이벤트마다 인덱스를 건드리면 저장 연타에 취약하다.

대신 V7/V8/V9 커맨드가 조회 직전에 `refresh_if_stale(repo, ttl)`를 호출한다. TTL **2초** 안에 이미 갱신했으면 stat 조차 하지 않는다. 2초를 넘겼으면 §3.3의 1단계(stat 스윕)만 돌고, 실제 변경된 파일만 재파싱한다.

---

## 4. 심볼 레코드 모양 (`verify/syntax/model.rs`, T0 소유)

전부 `#[serde(rename_all = "camelCase")]`. 이 파일이 정의하는 타입은 T1~T4가 **읽기 전용**으로 취급한다.

```rust
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SyntaxLanguage { TypeScript, Tsx, JavaScript, Jsx, Rust }

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SymbolKind {
    Function, Method, Class, Interface, TypeAlias, Const,
    Struct, Enum, Trait, Impl, Macro,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    /// 1-based, 양 끝 포함.
    pub start_line: u32,
    pub end_line: u32,
    pub start_byte: u32,
    pub end_byte: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SymbolRecord {
    pub name: String,
    pub kind: SymbolKind,
    /// TS/JS의 `export`, Rust의 `pub`/`pub(crate)`.
    pub exported: bool,
    /// 감싸는 class/impl 이름. 최상위면 None.
    pub container: Option<String>,
    pub span: Span,
    /// 본문만의 범위. 시그니처만 바뀐 변경을 구분하는 데 쓴다.
    pub body_span: Option<Span>,
    pub token_count: u32,
    /// 식별자 정규화 토큰 스트림의 winnowed k-gram 지문 (V7). 정렬·중복 제거됨.
    pub fingerprint: Vec<u32>,
    /// 원본 토큰 스트림 해시 (V1: unchanged / moved 판정).
    pub raw_token_hash: u64,
    /// 정규화 토큰 스트림 해시 (V1: rename-only 판정).
    pub norm_token_hash: u64,
    /// 이 심볼 본문 안에서 참조된 식별자 이름 (V9 호출자 역방향 간선). 중복 제거됨.
    pub calls: Vec<String>,
    /// Rust 속성 / TS 데코레이터의 이름. `tauri::command` 같은 진입점 판정에 쓴다 (V8).
    pub attributes: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IdentifierRef {
    pub name: String,
    pub line: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportRecord {
    /// `"@/lib/utils"` · `"crate::verify::types"`.
    pub module: String,
    pub names: Vec<String>,
    pub line: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileSymbols {
    /// 저장소 상대 경로, 슬래시 구분.
    pub path: String,
    pub language: SyntaxLanguage,
    /// 우리가 실제로 파싱한 바이트의 `git2::Oid::hash_file` hex.
    pub content_id: String,
    pub stamp: FileStamp,
    pub symbols: Vec<SymbolRecord>,
    /// 정의 이름이 아닌 모든 식별자 등장. (name, line)으로 중복 제거.
    pub references: Vec<IdentifierRef>,
    pub imports: Vec<ImportRecord>,
    /// ERROR/MISSING 노드 없이 파싱됐는가. false면 references만 쓰고
    /// **클론 후보로는 절대 쓰지 않는다** (토큰 스트림이 쓰레기다).
    pub parse_ok: bool,
}
```

### 4.1 각 필드가 어느 V를 먹여 살리는가

| 소비자 | 사용 필드 |
|---|---|
| **V7** 유사도 | `fingerprint` · `token_count` · `kind` · `name` · `parse_ok` |
| **V8** 고아 | `exported` · `attributes` · 전 파일 `references`의 이름 집계 · `imports` |
| **V9** 영향 범위 | `calls` (역인덱스) · `references` (최상위 코드) · `span` (참조 위치 → 감싸는 심볼 역산) |
| **V1** 구조 diff | `raw_token_hash` · `norm_token_hash` · `span` · `body_span` · `kind` · `name` · `container` |
| **V17** 불변식 | V1의 파일 판정 결과만 |

`calls`와 `references`가 둘 다 있는 이유: `references`는 파일 전체(최상위 코드 포함)를 덮고, `calls`는 심볼 단위로 나뉘어 있어 V9가 "어느 함수 안에서 불렸는지"를 스팬 역산 없이 바로 답한다. 스팬 역산만으로도 가능하지만 V9 조회 경로가 저장소 전체 스캔이 되는 것을 막는 게 목적이다.

### 4.2 토큰 스트림과 정규화 (`verify/syntax/tokens.rs`, T0 소유)

트리를 커서로 한 번 순회하며 **리프 토큰만** 수집한다 (tree-sitter는 공백을 노드로 만들지 않으므로 공백·들여쓰기·줄바꿈은 자동으로 사라진다 — 이것이 "포맷 변경 = 토큰 스트림 동일"의 근거다).

```rust
pub struct RawToken {
    /// 그래머의 노드 kind id. 문법 구조의 뼈대.
    pub kind_id: u16,
    /// 토큰 텍스트의 FNV-1a 32.
    pub text_hash: u32,
    pub is_identifier: bool,
    pub is_comment: bool,
    pub is_literal: bool,
    pub byte_range: (u32, u32),
}
```

한 번의 순회에서 세 스트림을 파생한다 (전부 `Vec<u32>`):

| 스트림 | 규칙 | 쓰는 곳 |
|---|---|---|
| `raw` | 주석 포함 · 텍스트 해시 그대로 | V1 `FormattingOnly` 판정 |
| `code` | 주석 토큰 제거 · 나머지 raw와 동일 | V1 `CommentsOnly` 판정 |
| `norm` | 주석 제거 + **식별자 → 단일 센티널 `ID`** + 숫자 리터럴 → `NUM` + 문자열/템플릿 → `STR`. 키워드·연산자·구두점은 텍스트 해시 유지 | V1 `RenameOnly` 판정, V7 지문 |

`norm`이 정확히 **Type-2 클론**의 정의(식별자·리터럴 리네이밍을 제외하면 동일)다. Type-3(작은 삽입·삭제 포함)은 아래 지문의 Jaccard가 흡수한다.

### 4.3 지문 — winnowing (Type-2/3 전용)

1. `norm` 스트림에서 **k = 5** 연속 토큰을 FNV-1a로 롤링 해시 → k-gram 해시열.
2. **w = 4** 창을 밀며 각 창의 최소값을 선택(동률이면 가장 오른쪽). 표준 winnowing.
3. 정렬 + 중복 제거 → `fingerprint: Vec<u32>`. 크기 ≈ 토큰 수 × 0.4.

유사도:

```
jaccard(A, B)     = |F(A) ∩ F(B)| / |F(A) ∪ F(B)|
containment(A, B) = |F(A) ∩ F(B)| / |F(A)|          // A가 B 안에 들어있는가
```

**왜 전체 토큰열을 저장하지 않는가**: 250 MB 저장소 ≈ 2천만 토큰. 토큰열 그대로면 80 MB, 지문이면 32 MB. 그리고 지문이 있으면 후보 검색을 역인덱스로 O(일치 그램)에 할 수 있는데, 전체 토큰열은 쌍별 비교(O(n²))를 강요한다. 5만 심볼에서 O(n²)는 25억 비교다 — 이것이 §7-④의 진짜 절벽이고, 지문이 그 해법이다.

**왜 임베딩이 아닌가**: Type-4 시맨틱 클론은 임베딩이 필요하고, 임베딩은 모델 호출이며, 상위 계약 불변식 2번("LLM 재질의 금지")의 직접 위반이다. Type-4는 **영구히 범위 밖**이며 문서에 그렇게 적는다.

---

## 5. V1 — 구조적 diff

### 5.1 "포맷 변경뿐"을 어떻게 판정하는가

**정답은 파일 단위 토큰 스트림 동일성이다.** 트리 비교가 아니다.

```rust
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileVerdict {
    /// 바이트 동일 (diff가 잡았는데 여기 오면 CRLF 등 개행 차이뿐).
    Identical,
    /// raw 토큰 스트림 동일 → 공백·들여쓰기·줄바꿈·세미콜론 스타일만 바뀜.
    FormattingOnly,
    /// code 스트림 동일, raw 다름 → 주석만 바뀜.
    CommentsOnly,
    /// norm 스트림 동일, code 다름 → 식별자/리터럴 이름만 바뀜.
    RenameOnly,
    /// 위 어느 것도 아님. 심볼 테이블로 무엇이 바뀌었는지 말한다.
    Semantic,
}
```

판정 순서는 위에서 아래로, 첫 매치에서 멈춘다. 각 판정은 **`Vec<u32>` 두 개의 동등 비교**이므로 O(토큰 수)이고 파스 트리를 붙들고 있을 필요가 없다.

이 방식이 옳은 이유: 리포매터(Prettier·rustfmt)는 정의상 토큰 스트림을 보존한다. 따라서 "리포맷뿐"과 "토큰 스트림 동일"은 **동치**다. 트리 편집 거리를 계산해서 근사할 이유가 없다.

### 5.2 두 버전의 노드 매칭

`Semantic`일 때만 수행한다. 일반 트리 diff(difftastic 급)를 구현하지 **않는다** — 심볼 단위 매칭이면 V1이 약속한 것("2,800줄 중 실제로 바뀐 건 이 함수 2개")을 전부 준다.

1. 양쪽 버전에서 심볼을 추출한다 (인덱스와 **동일한** 추출기 — 두 벌 관리 금지).
2. **1차 — 정확 키 매칭**: `(container, kind, name)`.
3. **2차 — 리네임 매칭**: 남은 old × 남은 new를 `kind`가 같은 것끼리, `norm_token_hash` 일치를 먼저, 그다음 `jaccard(fingerprint) ≥ 0.8`을 높은 순으로 1:1 그리디 매칭.
4. 남은 것 → `Added` / `Removed`.
5. 매칭된 쌍마다 심볼 판정:

```rust
pub enum SymbolVerdict {
    Unchanged,      // raw 스트림 동일 + 시작 줄 동일
    Moved,          // raw 스트림 동일 + 시작 줄 다름
    CommentsOnly,   // code 동일
    RenameOnly,     // norm 동일
    SignatureOnly,  // body 토큰 동일, 시그니처 토큰 다름
    Changed,
    Added,
    Removed,
}
```

`SignatureOnly`가 V9에 직접 먹인다 (시그니처가 바뀌었는데 호출부가 안 고쳐졌는가).

### 5.3 파싱 실패 시 강등 — 절대 규칙

```rust
pub enum StructuralOutcome {
    Compared(FileStructuralDiff),
    Degraded(DegradeReason),
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DegradeReason {
    UnsupportedLanguage,
    /// 어느 한쪽에 ERROR 또는 MISSING 노드가 있다.
    ParseError,
    /// MAX_STRUCTURAL_BYTES 초과.
    TooLarge,
    /// MAX_PARSE_MILLIS 초과 또는 취소.
    ParseTimeout,
    /// 바이너리 · 신규 파일 · 삭제 파일 등 비교 대상이 아님.
    NotComparable,
}
```

- **강등 판정은 엄격하다**: 양쪽 버전 모두 `has_error() == false`여야 비교한다. ERROR 노드 하나라도 있으면 강등이다. 부분 오류 트리에서 뽑은 토큰 스트림은 조용히 틀리고, 그 결과는 "이 2,800줄은 안 봐도 됩니다"라는 **틀린 안심**이다 — 이 기능의 최악 실패 모드다. 정확도를 위해 커버리지를 포기한다.
- 강등되면 프론트는 **기존 텍스트 diff 뷰를 그대로** 쓴다. `degraded != null`이면 구조 뷰 토글 자체를 노출하지 않는다. "반쪽 구조 뷰"는 없다.
- 리포트 매핑:

| `DegradeReason` | `UncheckedReason` |
|---|---|
| `UnsupportedLanguage` | `UnsupportedLanguage` |
| `ParseError` | `ParseFailed` |
| `TooLarge` · `ParseTimeout` | `BudgetExceeded` |
| `NotComparable` | `NotApplicable` |

강등은 **절대 `Finding`을 만들지 않는다.** 파싱 못 한 건 위험 신호가 아니라 미검사다.

### 5.4 V1의 finding — 리뷰 부담을 *줄이는* 룰

```rust
FindingKind::StructuralDiff   // rule_id: "v1.structuralDiff", Info, 기본 ON, layer 0
```

`FileVerdict != Semantic`이거나, `Semantic`이지만 변경 심볼 비율이 낮을 때 emit 한다:

```
message: "148 changed line(s) are formatting only"
message: "2 of 31 symbol(s) changed; 6 moved, 23 unchanged"
detail:  "verdict=semantic · changed=2 moved=6 unchanged=23 added=0 removed=0"
```

**finding이 "좋은 소식"인 유일한 룰이다.** 스펙 §V1이 요구하는 P6(위험 비례 배분)의 물리적 구현 — "기계가 안 봐도 된다는 것을 증명한다". `Info` severity를 절대 넘기지 않는다.

`FileVerdict::Semantic` + 변경 비율이 높으면 emit 하지 않는다 (할 말이 없다). 이 경우에도 `checked`에는 들어간다.

---

## 6. V17 — 불변식 주장 검사 (`docs:`/`style:`만)

```rust
FindingKind::InvariantViolation   // rule_id: "v17.invariantViolation", Warn, 기본 ON, layer 3
```

커밋 타입은 `verify/structural/invariant.rs` 안의 **지역 함수**로 파싱한다. 상위 계약 §6이 `git/commit.rs` 수정을 금지하고 있고 그 금지는 유효하다.

| 커밋 타입 | 동작 |
|---|---|
| `docs` · `style` | 변경된 지원 언어 파일마다 §5 비교. `FileVerdict::Semantic`이면 finding. `FormattingOnly`/`CommentsOnly`/`RenameOnly`는 통과 |
| `refactor` · `perf` | **항상** `ScanLimit{ rule_id: "v17.invariantViolation", reason: NotImplemented, detail: "behaviour invariance for refactor:/perf: requires before/after test runs (V11) — not implemented" }` |
| 그 외 | `ScanLimit{NotApplicable}` |
| 강등된 파일 | `ScanLimit{ParseFailed \| BudgetExceeded \| UnsupportedLanguage}` — finding 아님 |

**정직성 장치**: v17을 `Implemented`로 뒤집지만, `refactor:`/`perf:` 커밋에서는 매번 `NotImplemented` limit을 낸다. 상위 계약 §2.3은 "한 룰이 `checked`와 `unchecked`에 동시에 등장하는 것은 정상"이라고 명시한다. 이 조항이 바로 이런 부분 구현을 정직하게 표현하기 위한 장치다. 이걸 생략하고 v17을 통째로 `Implemented`라고 보고하면 §7-①을 위반한다.

메시지 예:

```
message: "docs: commit changes executable code — 3 symbol(s) differ"
detail:  "src/lib/utils.ts: formatDate changed; parseDate added; toIso removed"
```

---

## 7. V7 — 재발명 탐지 (Type-2/3만)

```rust
FindingKind::ReinventedFunction   // rule_id: "v7.reinventedFunction", Warn, 기본 OFF, layer 2
```

**기본 OFF**인 이유: §7-② "적게 시작". 유사도 임계값은 저장소마다 다르고, 오탐 몇 개면 배지 전체가 무시된다.

### 7.1 알고리즘

1. diff에서 **신규 추가된** 심볼만 뽑는다 (`SymbolVerdict::Added`). 기존 심볼끼리의 중복은 이번 커밋의 책임이 아니다.
2. `token_count < MIN_CLONE_TOKENS(40)`이면 건너뛴다. `parse_ok == false` 파일도 건너뛴다.
3. 인덱스에서 역인덱스 `HashMap<u32, Vec<SymbolId>>`를 만든다 (지문 값 → 그 값을 가진 심볼들). **전체 심볼의 1%를 초과하는 그램은 버린다** — 언어 보일러플레이트라 후보를 폭발시키기만 한다.
4. 신규 심볼의 지문 값들로 후보를 모으고, 교집합 크기 상위 20개만 남긴다.
5. 길이 가지치기: `0.5 ≤ token_count(new)/token_count(cand) ≤ 2.0` 밖은 버린다.
6. 정밀 판정: `jaccard ≥ 0.70` **또는** `containment(new, cand) ≥ 0.85`.
7. 자기 자신 · 같은 파일 · 테스트 파일↔프로덕션 파일 교차는 제외한다.

### 7.2 오탐 억제 (이게 이 룰의 전부다)

- 심볼당 finding **최대 1개** (가장 유사한 것 하나만).
- 파일당 최대 3개, 스캔당 최대 20개. 넘으면 `detail`에 `"+N more"`.
- `kind`가 다르면 비교하지 않는다 (`Function` vs `Struct`).
- 테스트 파일 안의 심볼은 서로만 비교한다 (테스트는 원래 닮았다).
- 인덱스가 없거나 `complete == false`면 룰을 돌리지 않고 `ScanLimit{MissingArtifact}` (`"symbol index is partial (12,043 of 48,912 files)"`).

```
message: "`formatDateString` is 0.86 similar to `formatDate`"
detail:  "src/lib/utils.ts:42 · 61 vs 58 tokens · jaccard 0.86 · containment 0.91"
```

**Type-4는 구현하지 않는다.** 레지스트리 엔트리는 하나뿐이므로 별도 `Planned` 행을 만들 수 없다. 대신 스캔마다 `ScanLimit`을 내지는 않고(노이즈), 이 문서와 설정 화면 설명 문구에 "Type-2/3 (토큰 유사도)만 검사함"을 명시한다. — **이 결정은 §7-①의 경계 사례이며 리뷰가 필요하다** (§11-5 참조).

---

## 8. V8 / V9 — 도달성 (`verify/reach.rs`)

두 룰이 같은 역인덱스를 쓰므로 한 모듈에 둔다.

```rust
FindingKind::OrphanCode    // rule_id: "v8.orphanCode",   Info, 기본 OFF, layer 2
FindingKind::BlastRadius   // rule_id: "v9.blastRadius",  Info, 기본 ON,  layer 2
```

### 8.1 V8 — 고아 코드

후보: 이번 diff에서 **신규 추가된 `exported == true` 심볼**.

제외 규칙 (오탐 억제가 이 룰의 존재 이유):

1. `attributes`에 `tauri::command`가 있으면 제외. (Tauri 커맨드는 `generate_handler!` 매크로와 TS 문자열에서만 참조된다 — 이 저장소에서 최대 오탐원이다.)
2. 배럴 파일(`index.ts` · `mod.rs` · `lib.rs`)의 재수출은 제외.
3. 진입점(`src/main.tsx` · `src-tauri/src/main.rs`)은 제외.
4. 인덱스 전체 `references`에서 이름 등장 횟수가 자기 파일 밖으로 0인 것만 후보로 남긴다.
5. **텍스트 확인 패스**: 남은 후보(보통 0~3개)에 대해서만 저장소 전체 바이트를 대상으로 이름 문자열을 찾는다. 하나라도 나오면 후보에서 제외한다. 문자열 참조·매크로·설정 파일 참조를 잡는 값싼 방어선이다. 후보가 적으므로 비용이 사실상 0이다.

```
message: "exported `parseFooBar` is not referenced anywhere in the index"
detail:  "index covers 48,912 file(s) · name-based resolution · dynamic references are not detected"
```

`detail`에 "name-based · 동적 참조 미탐지"를 **항상** 넣는다. 이 룰은 원리적으로 완전하지 않으며 사용자가 그걸 알아야 한다.

### 8.2 V9 — 영향 범위

커맨드가 반환하는 구조체 (diff 사이드바용):

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlastRadiusEntry {
    pub symbol: String,
    pub file: String,
    pub kind: SymbolKind,
    /// V1의 `SymbolVerdict::SignatureOnly` 또는 시그니처 토큰이 바뀐 `Changed`.
    pub signature_changed: bool,
    /// 최대 50개.
    pub callers: Vec<CallSite>,
    pub caller_count: usize,
    /// 이번 diff에 포함되지 않은 파일에 있는 호출자 수.
    pub untouched_caller_count: usize,
    pub resolution: CallerResolution,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CallSite {
    pub file: String,
    pub line: u32,
    /// 호출을 감싸는 심볼 이름. 최상위 코드면 None.
    pub symbol: Option<String>,
    pub touched_in_diff: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CallerResolution {
    /// 인덱스 전체에서 이 이름의 정의가 1개뿐 → 이름 매칭이 정확하다.
    NameUnique,
    /// 정의가 여러 개 → 호출자 목록에 무관한 동명 심볼이 섞일 수 있다.
    NameAmbiguous { definitions: usize },
}
```

finding은 **`signature_changed && untouched_caller_count > 0`일 때만** 낸다:

```
message: "`fetchUser` signature changed · 12 caller(s), 9 in files this change does not touch"
detail:  "name-based resolution (unique) · src/api/queries.ts:88, src/stores/repository.ts:41, +7 more"
```

`NameAmbiguous`면 message에 `"(name is ambiguous: 3 definitions)"`를 덧붙인다. §7-⑧의 정신("오귀속은 무귀속보다 나쁘다")을 타입 검사 없는 이름 매칭에 그대로 적용한다.

**기본 ON인 이유**: Info이고, 시그니처가 바뀌고 안 고친 호출부가 있을 때만 뜨므로 노이즈가 구조적으로 낮다. 그리고 스펙 §7-③이 지목한 "GUI의 존재 이유"(읽는 행위 자체의 개선)의 대표 기능이다.

---

## 9. 커맨드 · 이벤트 · 레지스트리 델타

### 9.1 신규 커맨드 (`commands/syntax.rs`, T5 소유)

```rust
/// 백그라운드 빌드를 시작하고 **즉시** 반환한다. 진행은 이벤트로.
#[tauri::command]
pub async fn build_symbol_index(
    repo_path: String,
    app_handle: tauri::AppHandle,
    store: tauri::State<'_, SymbolIndexStore>,
) -> Result<SymbolIndexStatus, AppError>;

#[tauri::command]
pub async fn cancel_symbol_index(
    repo_path: String,
    store: tauri::State<'_, SymbolIndexStore>,
) -> Result<SymbolIndexStatus, AppError>;

#[tauri::command]
pub async fn get_symbol_index_status(
    repo_path: String,
    store: tauri::State<'_, SymbolIndexStore>,
) -> Result<SymbolIndexStatus, AppError>;

/// V1 — 파일 하나의 구조 비교. 강등되면 `degraded`가 채워지고 프론트는 텍스트 diff로 간다.
#[tauri::command]
pub async fn get_structural_diff(
    repo_path: String,
    oid: Option<String>,
    path: String,
    staged: bool,
) -> Result<StructuralFileDiff, AppError>;

/// V9 — diff 사이드바용 구조화 데이터.
#[tauri::command]
pub async fn get_blast_radius(
    repo_path: String,
    oid: Option<String>,
    store: tauri::State<'_, SymbolIndexStore>,
) -> Result<Vec<BlastRadiusEntry>, AppError>;

/// V1 · V7 · V8 · V9 · V17 findings를 한 리포트로.
#[tauri::command]
pub async fn verify_syntax(
    repo_path: String,
    oid: Option<String>,
    staged: bool,
    store: tauri::State<'_, SymbolIndexStore>,
) -> Result<VerificationReport, AppError>;
```

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SymbolIndexStatus {
    pub state: IndexState,      // idle | building | ready | cancelled | failed
    pub files_indexed: usize,
    pub files_total: usize,
    pub symbols: usize,
    pub complete: bool,
    pub built_at: Option<i64>,  // epoch millis
    pub skipped_by_language: Vec<(String, usize)>,   // 확장자 → 개수
    pub skipped_by_budget: usize,
}
```

`oid`를 받는 커맨드는 전부 기존 `validate_commit_oid()`로 먼저 검증한다 (상위 계약 §6, 옵션 인젝션 방어). `path`도 저장소 루트 밖으로 나가지 않는지 검증한다.

모든 `git2` 호출은 `spawn_blocking` 안. 파싱도 CPU 바운드이므로 `spawn_blocking`.

### 9.2 리포트 합성 — 이중 계상 방지

`verify_working_tree`가 정적 룰 리포트를, `verify_syntax`가 구문 룰 리포트를 각각 만들면 한 룰이 양쪽에서 다른 판정을 받아 `unchecked` 회계가 어긋난다.

**해법**: `verify/rules/mod.rs`를 T5가 소폭 리팩터한다.

```rust
/// 레지스트리 채우기 없이 원시 결과만 낸다.
pub fn collect_diff_rules(ctx: &DiffContext, config: &RuleConfig) -> RuleOutcome;

/// 기존 시그니처 유지 — collect + fill + new 로 재구현된다.
pub fn run_diff_rules(ctx: &DiffContext, config: &RuleConfig) -> VerificationReport;
```

구문 룰도 같은 모양으로 `collect_syntax_rules(...) -> RuleOutcome`을 낸다. 커맨드는 두 `RuleOutcome`을 합치고 **`fill_registry_coverage`를 한 번만** 호출한 뒤 `VerificationReport::new`로 마감한다. 기존 테스트는 `run_diff_rules`의 동작이 그대로이므로 전부 통과한다.

### 9.3 `types.rs` / `registry.rs` 델타

새 `FindingKind` **5개**. 전부 기존 명명 규칙(`<v번호>.<변종lowerCamel>`)을 그대로 만족하므로 **레지스트리 id는 하나도 바뀌지 않는다.**

| 신규 variant | rule_id (기존 그대로) | severity | 기본 | layer |
|---|---|---|---|---|
| `StructuralDiff` | `v1.structuralDiff` | `Info` | ON | 0 |
| `ReinventedFunction` | `v7.reinventedFunction` | `Warn` | OFF | 2 |
| `OrphanCode` | `v8.orphanCode` | `Info` | OFF | 2 |
| `BlastRadius` | `v9.blastRadius` | `Info` | ON | 2 |
| `InvariantViolation` | `v17.invariantViolation` | `Warn` | ON | 3 |

**불변식**: `FindingKind`가 존재한다 ⟺ 레지스트리 행이 `Implemented`다. 기존 테스트 `every_finding_kind_has_a_registry_entry`와 `implemented_entries_match_the_kind_list`가 이걸 강제한다. **두 테스트를 절대 약화시키지 않는다.** 따라서 variant 추가와 행 뒤집기는 **반드시 같은 커밋**에 들어간다.

프론트 `src/types/verify.ts`의 `FindingKind` 유니온에 5개 문자열을 추가하고 `verify.rule.<ruleId>.title/description` i18n 키를 채우는 것은 **프론트 phase의 일**이다. 이 작업 범위 밖이며 인계 항목이다.

---

## 10. 모듈 레이아웃 · 소유권 표

### 10.1 레이아웃

```
src-tauri/src/verify/
├── syntax/                     # 파싱 프리미티브 — T0 이후 읽기 전용
│   ├── mod.rs                  # 모듈 선언 + 예산 상수 + 재수출
│   ├── lang.rs                 # 확장자 → SyntaxLanguage, Language/Query 핸들 (OnceLock)
│   ├── tokens.rs               # RawToken 순회 · raw/code/norm 스트림 · winnowing 지문
│   ├── extract.rs              # .scm 쿼리 실행 → FileSymbols
│   ├── model.rs                # §4의 레코드 타입 전부
│   ├── index.rs                # RepoIndex 인메모리 컨테이너 + 인터너 + 조회 API
│   ├── cancel.rs               # CancelToken
│   └── queries/
│       ├── typescript.scm      # TS와 TSX가 공유
│       ├── javascript.scm      # JS와 JSX가 공유
│       └── rust.scm
├── symbol_index/               # 인덱스 획득·영속 — T1
│   ├── mod.rs                  # 빌드 드라이버 · 워커 풀 · 진행 이벤트
│   ├── build.rs                # 열거 · 무효화 · 재파싱
│   ├── cache.rs                # 샤드 스냅샷 load/save · meta · 스키마 무효화
│   └── store.rs                # SymbolIndexStore (Tauri managed state, LRU 2)
├── structural/                 # V1 + V17 — T2
│   ├── mod.rs                  # compare() 진입점 · 강등 판정
│   ├── pair.rs                 # 심볼 매칭 (정확 키 → 리네임 → 지문)
│   ├── verdict.rs              # FileVerdict / SymbolVerdict 계산
│   └── invariant.rs            # V17 커밋 타입 파싱 + 판정
├── reinvent.rs                 # V7 — T3
└── reach.rs                    # V8 + V9 — T4

src-tauri/src/commands/
└── syntax.rs                   # 신규 커맨드 전부 — T5
```

파일이 400줄을 넘을 것 같으면 **같은 phase 소유자가** 하위 디렉터리로 쪼갠다. 사전 승인이며 소유 phase는 유지된다 (상위 계약 §1과 동일 규칙).

### 10.2 소유권 표

**실행 순서: T0 → (T1 · T2 · T3 · T4 완전 병렬) → T5.**

| Phase | 단독 소유 파일 | 담당 |
|---|---|---|
| **T0 — Scaffold** (단독 실행) | `Cargo.toml`, `verify/syntax/**` 전체, `verify/mod.rs`(모듈 선언 2줄), `events.rs`(진행 이벤트), `verify/types.rs`(**앵커 주석만** + `VerificationReport::merge`), `registry.rs`(**앵커 주석만**) | — |
| **T1 — Index** | `verify/symbol_index/**` | 인프라 |
| **T2 — Structural** | `verify/structural/**` | V1 · V17 |
| **T3 — Reinvention** | `verify/reinvent.rs` | V7 |
| **T4 — Reachability** | `verify/reach.rs` | V8 · V9 |
| **T5 — Land** (단독 실행) | `commands/syntax.rs`, `commands/mod.rs`, `commands/verify.rs`, `verify/rules/mod.rs`(§9.2 리팩터), `lib.rs` | 통합 |

**교차 phase 의존**: T2·T3·T4는 서로를 import하지 않고, **T1도 import하지 않는다.** 셋 다 `verify/syntax/index.rs`의 `RepoIndex` 조회 API에만 의존하고, T0가 그 API를 픽스처로 만들 수 있게 구현해 둔다. 이것이 T1의 진행과 무관하게 T2~T4가 병렬로 갈 수 있는 이유다. 조합은 전부 T5에서 일어난다.

**기존 파일 수정 금지**: `git/**` 전부, `verify/paths.rs`, `verify/digest.rs`, `verify/config.rs`, `verify/rules/**`(T5의 §9.2 리팩터만 예외), `verify/{deps,session,review,evidence,hygiene}/**`, `src/**`(프론트엔드 전체), i18n JSON, `package.json`.

### 10.3 공유 파일 편집 프로토콜 — 앵커

`types.rs`와 `registry.rs`는 T2·T3·T4가 **각자 딱 4곳**을 건드려야 한다 (variant · `rule_id()` arm · `ALL_KINDS` 원소 · `planned(...)` → `implemented(...)` 한 줄). 병렬 편집 충돌을 구조적으로 없애기 위해 **T0가 미리 앵커 주석을 심는다.**

`types.rs`의 `FindingKind` enum 안:

```rust
    // ── V1: structural diff ──────────────────────────────────────────────
    // T2 inserts `StructuralDiff` on the line below.
    // ── V7 / V8 / V9: codebase context ───────────────────────────────────
    // T3 inserts `ReinventedFunction`; T4 inserts `OrphanCode`, `BlastRadius`.
    // ── V17: invariant assertions ────────────────────────────────────────
    // T2 inserts `InvariantViolation` on the line below.
```

동일한 앵커 3세트를 `rule_id()`의 `match` 블록과 `registry.rs`의 `ALL_KINDS` 배열에도 심는다. 각 phase는 **자기 앵커 바로 아래에만** 삽입한다. 앵커가 서로 다른 줄에 있으므로 hunk가 겹치지 않는다.

레지스트리 행 뒤집기는 해당 `planned(...)` **한 줄을 통째로 교체**하는 편집이며, 다섯 줄이 서로 떨어져 있으므로 역시 겹치지 않는다.

충돌이 발생하면 **land 순서는 T2 → T3 → T4**이고, 뒤 phase가 앞 phase 위로 rebase 한다.

**앵커 주석은 T0가 심고 지우지 않는다.** 다음 룰이 추가될 때 같은 프로토콜이 재사용된다.

---

## 11. 테스트 요구사항

전부 `#[cfg(test)] mod tests`. **hermetic**: 네트워크 없음, 실제 저장소는 `tempdir` 안에서 직접 만든 것만.

| Phase | 최소 테스트 |
|---|---|
| **T0** | 4개 그래머 로드 + `has_error()==false` 파싱 / 확장자→언어 매핑(대소문자·`.d.ts`·미지원 확장자) / `raw`·`code`·`norm` 스트림이 각각 공백·주석·식별자에 대해 올바르게 불변 또는 가변 / winnowing 결정성(같은 입력 → 같은 지문) + 알려진 벡터 / 지문 Jaccard가 Type-2 쌍에서 1.0, 무관 쌍에서 <0.2 / `CancelToken` 협조 취소 / TS·TSX·JS·Rust 각각에서 심볼 추출(이름·kind·export·container·attributes) / **`#[tauri::command]`이 `function_item`의 자식이 아니라 형제 `attribute_item`이라는 사실**에 대한 회귀 테스트 |
| **T1** | 스탬프 일치 → 재파싱 0회(파싱 카운터로 검증) / 스탬프 불일치 + content_id 일치 → 재파싱 0회 / content_id 불일치 → 재파싱 1회 / 삭제된 파일 → 엔트리 제거 / 샤드 왕복(save → load → 동일) / 스키마 버전 불일치 → 캐시 폐기 / 취소 시 `complete=false` + `Err` 아님 / `MAX_SOURCE_BYTES` 초과 파일이 `skipped_by_budget`에 계상 / 미지원 확장자가 `skipped_by_language`에 확장자별로 계상 |
| **T2** | 재들여쓰기 → `FormattingOnly` / 주석만 변경 → `CommentsOnly` / 변수명 일괄 변경 → `RenameOnly` / 한 함수 본문 변경 → `Semantic` + 그 심볼만 `Changed` / 함수 위치 이동 → `Moved` / 시그니처만 변경 → `SignatureOnly` / **깨진 소스 → `Degraded(ParseError)` 이며 finding 0개** / 미지원 언어 → `Degraded(UnsupportedLanguage)` / `docs:` + 코드 변경 → V17 finding / `refactor:` → **항상** `NotImplemented` limit / 강등 파일은 V17 finding을 만들지 않는다 |
| **T3** | 식별자만 다른 동일 함수 → jaccard 1.0 finding / 무관한 두 함수 → finding 없음 / `MIN_CLONE_TOKENS` 미만 → finding 없음 / 인덱스 부재 → `MissingArtifact` limit + finding 0개 / 심볼당 finding 1개 상한 / 테스트↔프로덕션 교차 제외 |
| **T4** | 참조 없는 신규 export → `OrphanCode` / 다른 파일이 import → finding 없음 / `#[tauri::command]` → 제외 / 문자열 리터럴로만 참조 → 텍스트 확인 패스가 제외 / 시그니처 변경 + 미수정 호출자 → `BlastRadius` finding / 호출자 전부 diff 안 → finding 없음 / 동명 정의 2개 → `NameAmbiguous` |
| **T5** | 두 `RuleOutcome` 합성 후 리포트가 **레지스트리 전체를 덮는다** / 한 룰이 `checked`와 `unchecked`에 동시에 등장하는 케이스(v17 `docs:`+`refactor:` 혼합)가 정상 처리 / `run_diff_rules`의 기존 439개 테스트 전부 통과 |
| **전 phase 공통** | 리포트를 만드는 모든 지점마다 §2.3 불변식(`unchecked == limits의 정렬·중복제거 rule_id 집합`, 레지스트리 완전 피복) 검증 테스트 1개 |

성능 회귀 테스트는 **넣지 않는다** (CI 머신 편차로 flaky해진다). 대신 T1이 `SymbolIndexStatus`에 `files_indexed`/`symbols`를 노출하므로 수동 확인이 가능하다.

---

## 12. 알려진 취약점 — 구현자가 알고 시작할 것

이 설계에서 가장 약한 5곳. 발견하면 리포트에 적을 것.

1. **`parse_ok`가 조용히 커버리지를 갉아먹는다.** V1 강등을 "ERROR 노드 하나라도 있으면"으로 엄격히 잡았기 때문에, 최신 TS 문법(데코레이터·`using` 선언·`satisfies` 조합)을 그래머 0.23.2가 못 따라가면 해당 파일이 통째로 텍스트 diff로 강등된다. **사용자에게는 기능이 "가끔 안 되는" 것처럼 보인다.** `SymbolIndexStatus`에 `parse_failed` 카운트를 노출해 이 비율을 관측 가능하게 만드는 것이 최소 방어다. 비율이 5%를 넘으면 그래머 업그레이드가 아니라 이 설계의 엄격도를 재검토해야 한다.

2. **V8의 이름 기반 도달성은 원리적으로 불완전하다.** 동적 import, 문자열 키 디스패치, 매크로 생성 호출, 재수출 체인, 라이브러리의 public API — 전부 오탐이다. 제외 규칙 5개와 텍스트 확인 패스로 실무 오탐의 대부분을 막지만 **완전성은 얻을 수 없다.** 기본 OFF로 두는 이유이고, 켰을 때 노이즈가 심하면 배지 전체가 무시된다는 §7-② 위험이 그대로 적용된다.

3. **V7의 임계값(0.70 / 0.85)에 근거가 없다.** 클론 탐지 문헌의 관행값이지 이 저장소에서 튜닝한 값이 아니다. TypeScript React 컴포넌트는 구조적으로 서로 닮아서 임계값이 낮으면 오탐 공장이 되고, 높으면 실제 재발명을 놓친다. **첫 릴리스의 실제 목적은 탐지가 아니라 "이 저장소에서 임계값이 얼마여야 하는가"의 데이터 수집**이다 (§7-② Milestone 1의 논리와 동일). 임계값을 상수로 두되 이름을 붙여 한곳에 모으고, 튜닝 전에는 기본 OFF를 유지한다.

4. **인메모리 인덱스는 `CLAUDE.md`의 "장기 상태 없음" 원칙을 깬다.** 저장소 2개 × 대형(250 MB 소스) 기준 인메모리 사용량은 지문 32 MB + 참조 40 MB + 메타 ≈ **저장소당 100 MB 안팎**으로 추정되며, **실측하지 않았다.** LRU 2개가 상한이지만 두 대형 저장소를 동시에 열면 200 MB가 상주한다. `SymbolIndexStatus`에 추정 바이트를 노출하고, T1이 실측 후 상한(1개로 줄일지)을 재결정해야 한다.

5. **V7의 "Type-4 미구현"이 `unchecked`에 나타나지 않는다.** 레지스트리 엔트리는 `v7.reinventedFunction` 하나뿐이라 "Type-2/3는 했고 Type-4는 안 했다"를 기계적으로 표현할 자리가 없다. v17이 `refactor:`에서 `NotImplemented` limit을 내는 것과 같은 장치를 v7에는 적용하지 않기로 했는데(매 스캔마다 뜨면 노이즈), **이것은 §7-①의 정직성 원칙과 편의 사이의 타협이며 이 문서에서 가장 논쟁적인 결정이다.** 대안은 (a) 레지스트리에 `v7.semanticClone`을 별도 `Planned` 행으로 추가 — 정직하지만 영원히 `unchecked`에 남아 목록을 오염시킨다, (b) 설정 화면 설명 문구로만 고지 — 현재 선택. **T3 착수 전에 이 선택을 재확인할 것.**

---

## 13. 인계 항목 (이 작업 범위 밖)

- `src/types/verify.ts`: `FindingKind` 유니온에 5개 문자열 추가.
- `src/api/verify.ts`: §9.1 커맨드 6개의 `invoke()` 래퍼.
- `src/i18n/locales/{en,ko}.json`: `verify.rule.v{1,7,8,9,17}.*.title/description` + `verify.index.*` 진행 문구.
- 구조 diff 뷰: 기존 `view-mode.ts` 전환 패턴(`bd2f678` · `e1c7333`의 마크다운 문서 뷰)을 그대로 재사용한다. `degraded != null`이면 **토글을 노출하지 않는다.**
- 인덱스 진행 UI: `verify:index-progress` 구독. 첫 인덱싱 중에도 앱은 완전히 사용 가능해야 하며, 진행 표시는 상태바 수준으로 조용해야 한다.
