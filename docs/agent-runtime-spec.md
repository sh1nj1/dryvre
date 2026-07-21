# 로컬 Agent와 계층형 Skill 스펙

## 문서 상태

- 상태: 해커톤 MVP 구현 완료
- 목표: 해커톤 데모에서 여러 Agent 블록을 정의하고, 블록 트리에서 관리하는 Skill을 골라 Local Codex CLI로 실행한다.
- 구현 기준: 이 문서의 `Phase 0`부터 `Phase 3`까지
- 후속 범위: 원격 실행, 자율 트리거와 Agent 간 자동 위임

## 해커톤 MVP 보안 범위 결정

이번 해커톤에서 AI Agent 기능은 **기능적 수직 슬라이스만** 평가하고 구현한다. 범위는 블록 기반 Agent 정의, 계층형 Skill 컴파일, Local Codex CLI 호출, 실행 상태 전이와 결과 블록 저장이다. 프로덕션 수준의 보안 설계와 보안 강화는 MVP 완료 조건이 아니며 이번 구현에서 다루지 않는다.

특히 real runner가 Dryvre 서버 프로세스의 환경 변수를 상속하므로 `DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY` 같은 값에 접근할 수 있다는 위험을 알려진 제한으로 수용한다. 환경 변수 allowlist/격리, secret broker, prompt injection 방어, 신뢰되지 않은 Skill 검증, 사용자·tenant 격리, 세분화된 실행 권한과 원격 sandbox는 해커톤 이후 범위다.

따라서 real runner는 신뢰할 수 있는 개발자가 관리하는 로컬 단일 사용자 데모 환경에서만 사용한다. 공개 서버, 공유 호스트, 실제 운영 credential이 있는 환경에는 배포하지 않는다. 발표와 일반 기능 검증에는 credential이 필요 없는 `DRYVRE_AGENT_FAKE=true`를 기본으로 사용한다. 이 문서 아래의 workspace 검사, `workspace-write`, 출력 제한 같은 가드레일은 데모의 오작동 범위를 줄이는 기능적 방어선일 뿐 보안 경계나 프로덕션 안전성 보장이 아니다. 보안 리뷰에서 발견된 사항은 후속 작업으로 기록하되 해커톤 MVP의 기능 승인 조건으로 취급하지 않는다.

## 결정 요약

Dryvre는 Agent와 Skill을 새 제품 엔티티로 만들지 않는다. Agent 정의와 Skill 원본은 모두 일반 블록이며, 트리와 `ref`로 구성한다. 실행 중인 프로세스, Codex session ID와 실패 상태처럼 문서가 아닌 일시적 운영 정보만 런타임 테이블에 둔다.

첫 어댑터는 서버 머신에 설치되고 로그인된 `codex`를 다음 형태로 직접 실행한다.

```sh
codex exec --json --sandbox workspace-write --cd <approved-workspace> -
codex exec --json --sandbox workspace-write --cd <approved-workspace> resume <session-id> -
```

프롬프트는 shell 인자가 아니라 stdin으로 전달한다. stdout의 JSONL을 파싱하고 마지막 `agent_message`를 대상 블록 아래의 새 스트림 블록으로 저장한다.

## 제품 모델

### Agent 블록

Agent는 본문 첫 줄이 다음 형식인 일반 블록 하나다.

```md
# @agent product-engineer
```

나머지 본문과 일반 자식 블록은 Agent의 역할과 행동 지침이다. 직접 자식 중 `agent-config` fenced code block 하나만 실행 설정으로 해석한다.

````md
```agent-config
{
  "workspace": "dryvre",
  "model": "gpt-5.6",
  "reasoningEffort": "medium"
}
```
````

MVP 설정 키는 `workspace`, `model`, `reasoningEffort` 세 개뿐이다. 임의 command, 환경 변수와 추가 CLI 인자는 받지 않는다. Agent 블록은 정본 정의이고, 연결된 `subject(kind=agent)`는 작성자 표시와 권한 판정을 위한 실행 identity일 뿐 별도 사용자 개념이 아니다.

### Skill 블록

Skill은 본문 첫 줄이 다음 형식인 일반 블록이다.

```md
# @skill release-check
```

Skill의 설명과 지침은 Skill 루트의 나머지 본문 및 그 아래 일반 설명 블록으로 작성한다. fenced code 자식은 실행 시 파일로 materialize한다.

````md
```file:scripts/check.sh
#!/usr/bin/env bash
npm test
```
````

컴파일 규칙은 다음과 같다.

1. Skill slug는 소문자 영숫자와 하이픈만 허용한다.
2. Skill 루트 본문과 일반 설명 자식들을 문서 순서대로 합쳐 `SKILL.md` 본문으로 만든다.
3. 생성기가 `name`과 `description` frontmatter를 붙인다. `description`은 Skill 루트에서 첫 번째 비어 있지 않은 설명 문단을 사용한다.
4. `file:<relative-path>` code block은 같은 Skill 디렉터리 아래의 파일이 된다. 절대 경로, `..`, 중복 경로와 symlink는 거부한다.
5. 중첩된 `@skill` 블록은 부모 `SKILL.md` 내용에는 들어가지 않고 별도 Skill로 컴파일된다.
6. 같은 실행에 동일 slug가 두 번 나타나면 조용히 덮어쓰지 않고 검증 오류를 반환한다.

이 규약은 UI 전용 Skill 편집기를 요구하지 않는다. 설명은 기존 Markdown 블록 편집기로, script/reference는 기존 code block으로 편집한다.

### 계층과 선택

- Agent 블록 아래에 둔 Skill subtree는 그 Agent의 로컬 Skill 묶음이다.
- Agent가 다른 Skill 또는 Skill 묶음 루트를 `ref`하면 해당 참조 대상과 그 아래의 모든 Skill을 사용할 수 있다.
- 유효 Skill 집합은 `Agent의 자손 Skill ∪ Agent가 참조한 subtree의 Skill`이다.
- 트리 위치는 소유·분류를, `ref`는 재사용을 표현한다. 별도 Skill 폴더/컬렉션 엔티티는 만들지 않는다.
- 실행 대상 블록의 참조는 AI 작업 컨텍스트이고, Agent 블록의 참조는 Agent가 사용할 Skill이다. 출발 블록의 역할로 의미가 결정된다.

### 실행과 결과 블록

사용자는 대상 블록에서 Agent를 선택하고 요청을 입력한다. 서버는 다음 순서로 프롬프트를 조립한다.

1. Agent 지침
2. 대상 블록, 그 subtree와 명시적 참조 블록
3. 이번 사용자 요청
4. 결과를 간결한 Markdown으로 끝내라는 출력 계약

성공 시 마지막 Agent 메시지는 대상 블록의 `rank: null` 자식으로 저장하며 작성자는 Agent subject다. 실패 시 짧은 오류 블록을 남기되 command, credential, 전체 환경 변수와 원시 stderr는 본문에 넣지 않는다. UI는 실행 중에 JSONL의 안전한 상태만 WebSocket으로 보여주고, 원시 reasoning이나 민감한 도구 입력은 저장하거나 중계하지 않는다.

## 런타임 데이터

블록은 정의와 결과의 정본이지만 실행 자체는 다음의 얇은 projection이 필요하다.

```text
agent_binding(
  agent_block_id PK/FK block,
  subject_id UNIQUE/FK subject,
  created_at, updated_at
)

agent_run(
  id PK,
  agent_block_id FK block,
  target_block_id FK block,
  requested_by FK subject,
  status queued|running|succeeded|failed|cancelled,
  workspace?,
  codex_session_id?,
  pid?,
  started_at?, finished_at?, error_code?
)
```

Agent 이름, 설명, 모델, Skill 목록이나 최종 출력은 이 테이블에 복제하지 않는다. 실행 시작 시 해석한 정의를 사용하고, UI가 현재 정의를 보여줄 때는 항상 블록을 읽는다. 프로세스 핸들과 전체 stdout/stderr는 메모리에서 크기 제한을 두고 관리한다.

세션 재개는 같은 `agent_block_id + workspace`의 가장 최근 성공 session을 사용한다. Codex가 unknown session을 반환하면 한 번만 fresh session으로 재시도한다. MVP에서는 동시에 Agent당 한 run, 서버 전체 두 run까지만 허용하고 나머지는 `409`로 거절한다. 영속 queue는 만들지 않는다.

## 서버 계약

### REST

```text
POST   /api/agent-runs
GET    /api/agent-runs/:id
POST   /api/agent-runs/:id/cancel
GET    /api/agents/:blockId/skills
POST   /api/agents/:blockId/validate
```

실행 요청 예시는 다음과 같다.

```json
{
  "agentBlockId": "uuid",
  "targetBlockId": "uuid",
  "prompt": "이 요구사항을 구현하고 테스트해줘",
  "resume": true
}
```

`POST /api/agent-runs`는 run을 만든 뒤 즉시 `202`를 반환한다. 시작과 취소는 콘텐츠용 7개 block op에 추가하지 않는다. Agent가 만든 결과 블록은 기존 `create` op를 사용하므로 op log와 실시간 동기화 규칙을 그대로 따른다.

### WebSocket

기존 연결에 아래 서버 이벤트만 추가한다.

```ts
type AgentRunEvent =
  | { type: "agent_run_status"; runId: string; status: AgentRunStatus }
  | { type: "agent_run_output"; runId: string; text: string }
  | {
      type: "agent_run_finished";
      runId: string;
      resultBlockId?: string;
      errorCode?: string;
    };
```

`agent_run_output`은 완성된 `agent_message` 텍스트 또는 사용자에게 안전한 진행 라벨만 보낸다. JSONL 전체를 브라우저 계약으로 노출하지 않는다.

## Codex Local 어댑터

### Paperclip에서 재사용할 부분

Paperclip 전체 control plane을 의존성으로 추가하지 않고, MIT 라이선스와 고지 조건을 확인한 뒤 아래의 작은 패턴만 Dryvre 코드로 옮기거나 축약 구현한다.

- `packages/adapters/codex-local/src/server/codex-args.ts`: `exec --json`, stdin, session resume 인자 구성
- `packages/adapters/codex-local/src/server/parse.ts`: `thread.started`, `item.completed`, `turn.completed`, `turn.failed` JSONL 파싱
- `packages/adapters/codex-local/src/server/codex-home.ts`: run별 관리 home에 공유 auth를 symlink하고 정적 config를 복사하는 방식
- `packages/adapter-utils/src/server-utils.ts`: shell을 거치지 않는 spawn, 출력 크기 제한, timeout, 프로세스 그룹 취소
- `packages/adapters/codex-local/src/server/skills.ts`: 선택 Skill을 effective Codex home에 materialize하는 lifecycle

직접 복사한 코드가 생기면 해당 파일 헤더 또는 `NOTICE`에 Paperclip 출처와 라이선스를 남긴다. Paperclip의 회사, issue, heartbeat, budget, remote sandbox와 플러그인 계층은 가져오지 않는다.

### 실행 디렉터리와 인증

`DRYVRE_AGENT_WORKSPACE_ROOTS`에 허용한 실제 경로만 workspace로 등록한다. Agent config의 `workspace`는 서버 설정의 이름을 참조하며 사용자 입력 경로를 직접 받지 않는다. 실행 전 `realpath`가 허용 루트 안인지 다시 검사한다.

Agent별 managed Codex home은 `<data>/agent-runtime/<agent-block-id>/codex-home`에 둔다. 사용자의 실제 Codex home에서 `auth.json`은 symlink하고 정적 config만 복사한다. 매 run마다 선택된 Skill을 이 managed home 아래에 원자적으로 다시 생성하여 사용자 전역 Skill을 수정하지 않는다. 인증 파일 내용, API key와 access token은 로그와 블록에 절대 기록하지 않는다.

해커톤 기본 sandbox는 `workspace-write`로 고정한다. `danger-full-access`와 `--dangerously-bypass-approvals-and-sandbox`는 UI와 API에서 제공하지 않는다. non-interactive 실행에서 승인이 필요한 동작은 실패로 반환하고 사용자가 로컬에서 직접 수행하도록 안내한다.

### 프로세스 수명주기

1. `codex --version`과 인증 가능 여부를 readiness endpoint에서 확인한다.
2. Agent/Skill 블록을 parse하고 모든 경로를 검증한다.
3. managed Codex home과 Skill 파일을 임시 디렉터리에 원자적으로 생성한다.
4. `spawn(command, args, { shell: false, detached: true })`로 실행하고 prompt를 stdin에 쓴 뒤 닫는다.
5. stdout을 줄 단위 JSONL로 파싱하며 총 capture 크기를 제한한다.
6. `thread.started`의 ID를 run에 저장하고 마지막 `agent_message`를 결과 블록으로 만든다.
7. timeout/취소 시 프로세스 그룹에 `SIGTERM`, grace period 후 `SIGKILL`을 보낸다.
8. 서버 재시작 시 `queued/running` run은 `failed/server_restarted`로 정리한다.

## UI 수직 슬라이스

새 전역 관리 화면 대신 기존 트리와 선택 패널을 확장한다.

- `@agent` 블록: 작은 Agent 배지, Run 버튼, 연결된 Skill 수, 마지막 실행 상태
- `@skill` 블록: Skill 배지와 compile validation 상태
- 대상 블록의 AI composer: Agent picker, prompt, Run/Cancel
- 스트림: 사용자 요청, 실행 중 상태, 최종 Agent 결과를 같은 블록 문맥에서 표시
- 오류: Codex 미설치, 로그인 필요, invalid Skill, busy, timeout을 각각 실행 가능한 문구로 표시

Agent 목록은 별도 API 엔티티가 아니라 현재 root에서 `@agent` Markdown prefix를 가진 읽기 가능한 블록을 검색해 만든다.

## 구현 계획

### Phase 0 — 계약과 fixture (반나절)

- Agent/Skill Markdown parser와 compiler를 `packages/shared`에 추가한다.
- 정상 Skill, 중첩 Skill, 중복 slug, 경로 탈출 code block fixture를 작성한다.
- Codex JSONL fixture로 session, final message, usage와 오류 parser 테스트를 만든다.

완료 조건: DB나 실제 Codex 없이 정의와 JSONL parser 테스트가 통과한다.

### Phase 1 — 런타임과 API (1일)

- `agent_binding`, `agent_run` migration과 shared schema를 추가한다.
- Local Codex runner, managed home, timeout/cancel, 동시 실행 제한을 구현한다.
- run REST API와 Agent subject 귀속 결과 block 생성을 구현한다.
- 실제 Codex가 없을 때 쓰는 deterministic fake runner를 환경 플래그로 제공한다.

완료 조건: 실제 runner와 fake runner 모두 prompt → run → 결과 stream block 흐름을 완주한다.

### Phase 2 — 계층형 Skill (반나절)

- Agent 자손 및 `ref` subtree에서 유효 Skill 집합을 계산한다.
- run별 Skill 디렉터리를 원자적으로 materialize하고 stale 파일을 제거한다.
- validate/list API와 UI의 오류 표시를 연결한다.

완료 조건: 공유 Skill subtree 하나를 두 Agent가 참조하고, 각 Agent 실행에서 동일 Skill이 발견된다.

### Phase 3 — 데모 UX와 복구 (1일)

- Agent picker, Run/Cancel, 상태 이벤트와 결과 block 포커스를 구현한다.
- unknown session의 fresh retry, 서버 재시작 복구, 출력 cap과 redaction을 검증한다.
- seed에 Product Engineer, Researcher, QA Agent와 두세 개 Skill을 추가한다.
- `codex doctor`/로그인 안내 및 fake runner 전환을 README에 적는다.

완료 조건: 새 환경에서 문서만 보고 설치 상태를 확인하고 3분 데모를 재현할 수 있다.

### Phase 4 — 해커톤 이후

- Dryvre MCP를 managed Codex config에 안전하게 주입하여 실행 중 추가 block read/write 허용
- `codex app-server` 또는 ACP 기반의 양방향 세션과 richer event
- 원격 sandbox, per-run worktree, 승인 UI, 영속 queue와 비용 정책
- 사람이 승인한 Agent 간 위임과 자동 트리거

## 테스트 전략

- 단위: Markdown parse, Skill compile, 안전한 상대 경로, JSONL chunk 경계, redaction, args
- 통합: fake child process의 성공/실패/timeout/cancel/unknown-session 재시도
- DB: Agent subject 귀속, run 상태 전이, 결과 block과 op log의 같은 transaction
- E2E: 두 Agent가 공유 Skill을 사용하고 각각 결과를 같은 대상 subtree에 남김
- 수동 smoke: 설치된 Local Codex로 workspace-write 실행 후 파일 변경과 결과 block 확인

## 데모 시나리오

1. 트리에서 `Product Engineer`, `QA` Agent 블록과 공용 `Release Check` Skill subtree를 보여준다.
2. 두 Agent가 같은 Skill 루트를 참조하는 것을 backlink로 확인한다.
3. 구현 대상 블록에서 Product Engineer를 선택해 로컬 저장소 수정을 요청한다.
4. 실행 상태가 스트림에 나타나고 Codex 결과가 Agent 작성 블록으로 저장되는 것을 보여준다.
5. 같은 대상에서 QA를 실행해 검증 결과를 새 블록으로 남긴다.
6. 문서/보드/스트림을 전환해 Agent 정의, 작업과 결과가 모두 같은 블록 트리에 남아 있음을 보여준다.

## MVP 비범위

- 프로덕션 보안 강화 전반: child-process 환경 변수 allowlist/격리와 secret broker
- prompt injection 방어, 신뢰되지 않은 Agent/Skill 실행 검증과 공급망 보안
- 사용자·tenant 격리, 세분화된 권한, 원격 sandbox와 공개 배포 hardening
- Agent가 Agent를 자율적으로 생성하거나 무한 호출하는 orchestration loop
- Agent 조직도, manager, budget, heartbeat와 scheduler
- 임의 CLI adapter marketplace
- 브라우저에서 shell command와 환경 변수를 직접 설정하는 기능
- 원격 실행과 다중 서버 queue
- 전체 reasoning/tool payload 영구 저장
- 대화 중 사용자 승인 요청을 되받는 interactive protocol

## 결정이 필요한 후속 항목

Phase 0 시작 전에 제품 결정을 요구하지 않는 기본값은 `workspace-write`, Agent당 동시 실행 1개, session resume 활성화다. 다음은 Phase 4 전까지 미뤄도 된다.

- Agent가 실행 중 Dryvre MCP로 여러 블록을 직접 쓸 수 있게 할지
- repository `.agents/skills`와 Dryvre 관리 Skill이 충돌할 때 우선순위
- session을 Agent별로 유지할지 Agent+대상 블록별로 나눌지
- 공개 배포에서 Local runner를 별도 worker로 분리할지

## 조사 근거

- Dryvre의 현재 AI 경계: `apps/server/src/routes.ts`, `apps/server/src/block-service.ts`
- Dryvre의 block/ref/op 계약: `packages/shared/src/index.ts`, `packages/db/src/schema.ts`
- Paperclip Local Codex 구현: `~/project/github/paperclip/packages/adapters/codex-local/src/server/`
- Paperclip 프로세스 유틸리티: `~/project/github/paperclip/packages/adapter-utils/src/server-utils.ts`
- Codex 공식 문서: [CLI 명령](https://learn.chatgpt.com/docs/developer-commands), [Skills](https://learn.chatgpt.com/docs/build-skills), [비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode)
- 로컬 검증 버전: `codex-cli 0.144.6`
