"""One-release cleanup of explicitly reviewed branches; never tags or main."""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

REPO = "NAMEWTA/dsh-plugin-herdr"
VERSION = "1.0.1-alpha.1"
RELEASE_BRANCH = "release/1.0.1-alpha.1"
PINNED = {
    "feat/herdr-navigation-studio": "f701900f948c72c762c9c327119f231c76a58204",
    "feat/pane-inspector-cli-bridge": "55c4455525193f650ea81a652ac77fd199626a80",
    "fix/filesystem-root-path-filter": "a2f369e8d2843164e9b35dd62e681e5057c047a2",
    "fix/panel-no-request-contracts": "b0142e70cb5e8c89541913abe7d01f7534170bc8",
    "refactor/modular-workbench": "75bc74c4c635c4b6e481416b2a33227a69281a05",
    "release/consolidate-1.0.1-alpha.1": "f701900f948c72c762c9c327119f231c76a58204",
}


def plan(branches, release_head):
    if not re.fullmatch(r"[0-9a-f]{40}", release_head):
        raise ValueError("Invalid reviewed release head")
    allowed = {**PINNED, RELEASE_BRANCH: release_head}
    unknown = set(branches) - set(allowed) - {"main"}
    if unknown:
        raise ValueError("Unreviewed branches appeared: " + ", ".join(sorted(unknown)))
    result = []
    for name, sha in allowed.items():
        if name not in branches:
            continue  # Successful prior deletion is idempotent.
        if branches[name] != sha:
            raise ValueError("Branch moved; review before deletion: " + name)
        result.append((name, sha))
    return result


def check():
    head = "a" * 40
    branches = {"main": "b" * 40, **PINNED, RELEASE_BRANCH: head}
    assert len(plan(branches, head)) == 7
    assert all(name != "main" for name, _ in plan(branches, head))
    assert plan({"main": "b" * 40}, head) == []
    for changed in [{**branches, "new-work": head}, {**branches, RELEASE_BRANCH: "c" * 40},
                    {**branches, "fix/filesystem-root-path-filter": "c" * 40}]:
        try:
            plan(changed, head)
        except ValueError:
            continue
        raise AssertionError("Unsafe cleanup plan accepted")
    print("Cleanup preflight tests passed: main exclusion, allowlist, SHA leases, idempotence")


def execute():
    assert os.environ.get("GITHUB_REPOSITORY") == REPO
    assert os.environ.get("GITHUB_REF") == "refs/heads/main"
    assert os.environ.get("GITHUB_EVENT_NAME") == "push"
    main = os.environ["GITHUB_SHA"]
    token = os.environ["GH_TOKEN"]

    def api(path, method="GET"):
        request = urllib.request.Request("https://api.github.com/repos/" + REPO + "/" + path,
            method=method, headers={"Authorization": "Bearer " + token,
                "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
        with urllib.request.urlopen(request, timeout=60) as response:
            return None if response.status == 204 else json.load(response)

    def branches():
        result = {}
        for page in range(1, 101):
            items = api(f"branches?per_page=100&page={page}")
            for item in items:
                if item["name"] != "main" and item.get("protected"):
                    raise ValueError("Protected branch will not be deleted: " + item["name"])
                result[item["name"]] = item["commit"]["sha"]
            if len(items) < 100:
                return result
        raise ValueError("Branch pagination limit exceeded")

    release = api("releases/tags/v" + VERSION)
    assert not release["draft"] and release["prerelease"] and release["target_commitish"] == main
    pr = api("pulls/28")
    assert pr["merged"] and pr["merge_commit_sha"] == main and pr["base"]["ref"] == "main"
    assert pr["head"]["ref"] == RELEASE_BRANCH and pr["head"]["repo"]["full_name"] == REPO
    head = pr["head"]["sha"]
    assert head in [p["sha"] for p in api("git/commits/" + main)["parents"]], "Merge must preserve ancestry"
    current = branches()
    assert current["main"] == main, "Main moved; stop cleanup"
    pending = plan(current, head)
    # Check every candidate before deleting any ref. The reviewed source history stays reachable.
    for name, sha in pending:
        comparison = api("compare/" + sha + "..." + main)
        assert comparison["status"] in ("ahead", "identical")
        assert comparison["merge_base_commit"]["sha"] == sha, "Unmerged history: " + name
    for name, sha in pending:
        assert api("git/ref/heads/main")["object"]["sha"] == main
        path = "heads/" + urllib.parse.quote(name, safe="/")
        assert api("git/ref/" + path)["object"]["sha"] == sha, "Branch moved: " + name
        api("git/refs/" + path, "DELETE")
        print("Deleted merged branch:", name, sha)
    remaining = branches()
    assert remaining == {"main": main}, "New branches appeared; manual review required"
    print(json.dumps({"main": main, "deleted": [n for n, _ in pending], "remaining": ["main"]}, indent=2))


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        check()
    elif sys.argv[1:] == ["--execute"]:
        execute()
    else:
        raise SystemExit("Use --check, or --execute in the authorized main release job")
