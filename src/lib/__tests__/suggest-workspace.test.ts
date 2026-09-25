import { describe, expect, it } from "vitest";
import { namePrefix, suggestWorkspace } from "@/lib/suggest-workspace";
import { makeRepo } from "./repo-tree-fixtures";

const xamesFamily = [
  makeRepo("xames", "mos"),
  makeRepo("xames-admin", "mos"),
  makeRepo("xames-backend", "mos"),
];

describe("namePrefix", () => {
  it("첫 `-` 앞부분을 소문자로 돌려주고, `-`가 없으면 이름 전체다", () => {
    expect(namePrefix("Xames-App-web")).toBe("xames");
    expect(namePrefix("xames")).toBe("xames");
  });
});

describe("suggestWorkspace", () => {
  it("같은 계정에서 앞부분이 같은 저장소가 3개 이상이면 제안한다", () => {
    const result = suggestWorkspace([...xamesFamily, makeRepo("muxa", "mos")]);

    expect(result).toEqual([
      {
        key: "mos/xames",
        accountKey: "mos",
        name: "xames",
        repoPaths: ["/repos/xames", "/repos/xames-admin", "/repos/xames-backend"],
      },
    ]);
  });

  it("2개뿐이면 제안하지 않는다", () => {
    expect(suggestWorkspace(xamesFamily.slice(0, 2))).toEqual([]);
  });

  it("계정이 다르면 합쳐 세지 않는다", () => {
    const repos = [
      makeRepo("xames", "mos"),
      makeRepo("xames-admin", "mos"),
      makeRepo("xames-fork", "someone"),
    ];

    expect(suggestWorkspace(repos)).toEqual([]);
  });

  it("이미 워크스페이스에 든 저장소는 세지 않는다", () => {
    const result = suggestWorkspace(xamesFamily, {
      workspaces: [{ id: "w1", name: "x", accountKey: "mos", repoPaths: ["/repos/xames"] }],
    });

    expect(result).toEqual([]);
  });

  it("다른 계정 워크스페이스에 적혀 있어 트리에서 빠진 저장소는 다시 센다", () => {
    const result = suggestWorkspace(xamesFamily, {
      workspaces: [{ id: "w1", name: "x", accountKey: "someone", repoPaths: ["/repos/xames"] }],
    });

    expect(result.map((r) => r.repoPaths)).toEqual([
      ["/repos/xames", "/repos/xames-admin", "/repos/xames-backend"],
    ]);
  });

  it("닫은 제안은 다시 내지 않는다", () => {
    expect(suggestWorkspace(xamesFamily, { dismissed: ["mos/xames"] })).toEqual([]);
  });

  it("대소문자가 달라도 같은 앞부분으로 보고, 이름은 처음 나온 표기를 쓴다", () => {
    const repos = [makeRepo("Xames", "mos"), makeRepo("xames-a", "mos"), makeRepo("XAMES-b", "mos")];

    expect(suggestWorkspace(repos)[0]?.name).toBe("Xames");
  });

  it("owner 표기의 대소문자가 달라도 한 계정으로 센다", () => {
    const repos = [
      makeRepo("xames", "Mos"),
      makeRepo("xames-a", "mos"),
      makeRepo("xames-b", null, {
        remotes: [{ name: "origin", url: "git@github.com:MOS/xames-b.git" }],
      }),
    ];

    expect(suggestWorkspace(repos).map((s) => [s.key, s.accountKey])).toEqual([
      ["mos/xames", "mos"],
    ]);
  });

  it("계정을 아직 모르는 저장소는 세지 않아 제안 키가 계정 로딩에 따라 바뀌지 않는다", () => {
    const repos = ["x", "x-a", "x-b"].map((name) => makeRepo(name, null, { accountId: "acc1" }));

    expect(suggestWorkspace(repos, { accounts: [] })).toEqual([]);
    expect(
      suggestWorkspace(repos, { accounts: [{ id: "acc1", username: "yj" }] }).map((s) => s.key),
    ).toEqual(["yj/x"]);
  });
});
