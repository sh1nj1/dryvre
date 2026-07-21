# 기술 아키텍처

## 설계 목표

서버, 클라이언트와 MCP가 같은 블록 타입과 작은 연산 집합을 공유한다. 세 가지 뷰를 위해 별도 엔티티를 만들지 않고, 권한 캐시·리치텍스트 이중 직렬화·채팅의 이중 온톨로지가 다시 생길 자리를 구조적으로 줄인다.

## 코어 데이터 모델

개념적 스키마는 다음과 같다.

```text
block(
  id, parent_id, path, rank?, body_md, status?,
  author_id, version, created_at, updated_at
)
grant(block_id, subject_id, level)
ref(from_block_id, to_block_id)
op_log(id, actor_id, op, payload, created_at)
subject(id, kind)
subject_inbox(subject_id, block_id)
agent_binding(agent_block_id, subject_id, created_at, updated_at)
agent_run(
  id, agent_block_id, target_block_id, requested_by, status,
  workspace?, codex_session_id?, pid?, started_at?, finished_at?, error_code?, created_at
)
agent_loop(
  task_block_id, agent_block_id, activated_by, trigger_version, state,
  request_block_id?, agent_run_id?, resume_status?, created_at, updated_at
)
agent_trigger_delivery(trigger_block_id, op_sequence, status, error?, created_at, updated_at)
session(id, subject_id, expires_at)
```

- `parent_id`와 `path`가 하나의 트리를 표현한다.
- 루트 블록이 작업 공간의 경계이며 별도의 workspace 테이블을 요구하지 않는다.
- `rank`가 있으면 정본 문서 블록, `null`이면 스트림 블록이다.
- 자식 정렬은 `rank NULLS LAST`, 이후 `created_at` 순이다.
- `block.status`의 허용값은 `todo`, `in_progress`, `blocked`, `done`이다. `null`이면 태스크가 아니다.
- `blocked`는 사람 또는 외부 입력 대기만 표현한다. 실행 실패와 런타임 오류는 `agent_loop.state`와 `agent_run.status`에 기록한다.
- 블록의 표현 종류는 별도 `kind` 컬럼 대신 `body_md`의 Markdown 접두사에서 파생한다.
- `version`으로 동일 블록의 낙관적 동시 편집 충돌을 감지한다.
- `subject_inbox`는 사용자 subject와 Inbox 역할을 맡은 블록을 각각 유일하게 연결한다. 사용자 생성 시 함께 만들고 연결된 동안에는 해당 블록을 삭제하거나 다른 사용자에게 다시 연결할 수 없다. Inbox의 내용은 별도 알림 행이 아니라 그 블록의 자식이다.
- `agent_binding`은 `@agent` 정의 블록과 실행 subject를 연결한다.
- `agent_run`은 Local Codex 프로세스 한 번의 실행 상태를 보관하며 [로컬 Agent와 계층형 Skill 스펙](agent-runtime-spec.md)의 기존 계약을 유지한다.
- `agent_loop`는 작업 활성화부터 계약 검사, 사용자 입력 대기, 실행과 검증까지의 상위 조율 projection이다. `(task_block_id, trigger_version)`은 유일하고 상태는 `checking`, `waiting_input`, `ready`, `running`, `verifying`, `completed`, `failed`로 제한한다. 활성 질문과 실제 도구 실행은 각각 `request_block_id`, `agent_run_id`로 연결한다. `waiting_input`에서는 `resume_status`에 `todo` 또는 `in_progress`를 저장한다.
- `agent-trigger` 블록은 Agent가 구독할 `block_created` 또는 `status_changed` 이벤트, 멘션, actor 종류와 고정 workflow를 선언한다. 서버는 승인된 `op_log`를 이벤트 원본으로 사용하고 `agent_trigger_delivery(trigger_block_id, op_sequence)`로 한 번만 전달한다. 별도 메시지 브로커나 범용 규칙 빌더를 만들지 않는다.
- 런타임 테이블에는 재시도, 중복 실행 방지와 프로세스 제어에 필요한 메타데이터만 둔다. 사용자에게 보이는 계획, 질문, 결과와 검증 근거는 블록에 저장한다.

## 뷰별 투영

### 문서 뷰

현재 범위에서 `rank`가 있는 자식만 재귀 렌더링한다. 스트림 블록에 `rank`를 부여하면 ID, 자식, 참조와 권한을 유지한 채 문서에 나타난다. 다시 `null`로 만들면 스트림으로 돌아간다.

### 스트림 뷰

현재 선택 블록에 연결된 스트림 블록을 `created_at` 순으로 표시한다. 새 메시지는 선택 블록의 자식 tail에 append한다. 답글은 메시지 블록의 자식이며 UI에서는 깊이 1을 우선 보여주고 더 깊은 답글을 접을 수 있다.

사용자 Inbox를 선택한 경우에도 같은 스트림 투영을 사용한다. 에이전트의 질문 또는 승인 요청은 Inbox의 자식 블록이고, 원래 작업 블록을 `ref`한다. 사용자의 답변은 요청 블록의 자식이므로 요청과 응답의 상관관계를 위한 별도 메시지 테이블이 필요하지 않다.

### 보드·리스트 뷰

현재 범위에서 `status`가 있는 블록만 추출해 상태별로 묶는다. 진행률 롤업도 상태가 있는 하위 블록만 계산한다.

## 참조

사람, 에이전트와 블록 선택은 하나의 `@` 피커에서 시작할 수 있다. 블록 선택은 `ref` 한 행을 만든다. 블록 참조는 링크, 태그, AI 컨텍스트이며 대상 블록에는 backlink를 표시한다.

참조에 상속, 활성·비활성, 제외 같은 별도 규칙을 추가하지 않는다. 기본 규칙은 “명시한 참조를 따라간다”이다.

## 권한

권한 수준은 `read`, `write`, `manage` 세 가지다. 현재 블록의 materialized path 접두사에 걸린 grant 중 가장 깊은 항목을 선택해 판정한다. 권한 캐시를 만들지 않는다.

블록 이동 시 서브트리의 path를 다시 쓰는 비용을 감수한다. 이동보다 권한 판정과 서브트리 조회가 훨씬 빈번하다는 트레이드오프다.

## 연산 프로토콜

서버는 화면별 UI 의도가 아니라 다음의 작은 블록 연산만 받는다.

```text
create(parent, after?, body)
move(id, parent, after? | rank?)
edit(id, body)
setStatus(id, status?)
ref(from, to)
unref(from, to)
delete(id)
```

- `create`는 정본 위치 또는 스트림 tail에 블록을 만든다.
- `move` 하나가 부모 변경, 순서 변경과 문서·스트림 간 이동을 담당한다. UI는 안정적인 재정렬을 위해 새 부모의 `after` 형제를 보내고 서버가 정본 `rank`를 다시 계산할 수 있다.
- `edit`는 `body_md`만 변경한다.
- `setStatus(null)`은 블록의 태스크성을 제거한다.
- 승인된 연산과 상태 변경은 같은 트랜잭션에서 처리하고 `op_log`에 append한다.
- 연산 종류가 계속 늘어나면 UI의 별도 개념이 코어 온톨로지로 새고 있는지 점검한다.

`op_log`는 감사, 재생과 향후 실행 취소의 근거다. 별도 이벤트 버스나 큐를 초기 구조에 넣지 않는다.

## 에이전트 실행 루프

승인된 `create`와 `setStatus` 연산은 같은 `op_log`에서 Agent 이벤트로 전달된다. Agent의 직접 자식 `agent-trigger` 블록이 이벤트 종류, 멘션, 상태와 workflow를 선언한다. PM Agent의 stream `block_created` 구독은 요청을 작업 초안으로 만들고, Developer Agent의 `status_changed(toStatus=todo)` 구독은 아래 고정 작업 루프를 시작한다. 상태가 없는 초안, 에이전트가 지정되지 않은 작업과 이미 `agent_loop`에 기록된 `(task_block_id, trigger_version)`은 실행하지 않는다.

실행 순서는 다음과 같다.

1. 작업 블록의 본문, 하위 블록과 명시적 참조에서 완료 계약을 읽는다.
2. 결과물, 완료 조건, 제약과 검증 방법이 충분한지 확인한다.
3. 부족하면 질문 블록 생성과 `todo → blocked`를 같은 트랜잭션에 적용하고 `resume_status=todo`를 기록한다. 질문은 `todo` 전이를 승인한 사용자의 Inbox에 `@사용자`와 작업 `ref`를 포함한다.
4. 충분하면 기대 `version`을 조건으로 `todo → in_progress`를 원자적으로 적용한다. 선점에 실패한 loop는 종료한다.
5. 선점한 Developer Agent는 기존 Local Agent 런타임에 `agent_run`을 만들고 그 ID를 `agent_loop`에 연결한다.
6. 실행 중 사용자 판단이나 외부 변경 승인이 필요하면 요청 생성과 `in_progress → blocked`를 같은 트랜잭션에 적용하고 `resume_status=in_progress`로 답글을 기다린다.
7. 결과물과 검증 근거를 작업의 자식 블록으로 기록하고 검증을 통과한 뒤에만 `in_progress → done`을 적용한다.

질문에 답이 달리면 원래 요청 블록과 작업 `ref`를 통해 `blocked`를 기록된 `resume_status`로 원자적으로 복귀시킨다. `todo`로 복귀한 작업은 답변을 계약에 반영한 다음 다시 사전 검증하고, `in_progress`로 복귀한 작업은 같은 실행을 재개한다. 상세 상태 및 실패 계약은 [에이전트 작업 루프](agent-loop-spec.md)를 따른다.

## 실시간 동기화와 충돌

- WebSocket 연결은 클라이언트당 하나만 둔다.
- 서버는 HTML이 아니라 승인된 op 또는 변경 알림을 보낸다.
- 클라이언트는 로컬 트리에 변경을 적용하고 필요한 경우 서버 상태를 다시 읽는다.
- 단일 프로세스 간 브로드캐스트는 PostgreSQL `LISTEN/NOTIFY`를 사용한다.
- 클라이언트는 안전한 연산을 낙관적으로 표시하고 거부되면 되돌린다.
- 같은 블록의 동시 편집은 `version`으로 감지하며 CRDT는 도입하지 않는다.

초기에는 애플리케이션 프로세스 하나와 PostgreSQL 하나만 운영한다. 수평 확장이 필요해지면 브로드캐스트 어댑터를 교체하되 지금 Redis, Kafka나 별도 동기화 엔진을 미리 추가하지 않는다.

## AI 경계

AI 요청의 기본 컨텍스트는 다음을 합친다.

1. 현재 선택한 블록
2. 그 블록의 서브트리
3. 그 블록이 명시적으로 참조한 블록

PM Agent는 사용자의 요청을 실행 가능한 작업 블록으로 구체화하고 Developer Agent는 명시적으로 지정된 `todo` 작업을 실행한다. 두 역할 모두 같은 컨텍스트 규칙과 블록 연산을 사용한다. 모델 SDK를 직접 호출하고 계획, 질문, 결과와 검증 근거를 블록으로 저장한다. LangChain류의 범용 조율 프레임워크는 초기 범위에 두지 않는다.

사람은 여러 Agent 블록 중 하나를 직접 골라 Local Codex CLI를 실행할 수 있고, 고정 작업 루프에서는 사용자가 `todo`로 활성화한 작업에 명시된 PM Agent와 Developer Agent만 자동 실행할 수 있다. Agent와 Skill의 정본은 계속 블록과 참조이며, 실행 상태만 얇은 runtime projection으로 분리한다. 임의 Agent 간 자동 위임이나 범용 트리거 빌더는 도입하지 않는다. Local Codex 실행은 [로컬 Agent와 계층형 Skill 스펙](agent-runtime-spec.md), 상태 기반 조율은 [에이전트 작업 루프](agent-loop-spec.md)를 따른다.

## 편집기 경계

편집기는 뷰와 독립된 클라이언트 모듈이며 `body_md`와 `version`만 편집한다. 트리 구조와 상태 변경은 코어 블록 연산으로 위임한다. 키보드, 저장, IME와 충돌 처리의 상세 계약은 [블록 편집기 스펙](editor-spec.md)을 따른다.

## 검색

PostgreSQL FTS를 사용해 현재 트리 경로 안에서 본문을 검색한다. 텍스트, 참조, 상태와 기간 조건을 같은 검색 요청으로 조합한다. 결과는 평평한 별도 인덱스 화면이 아니라 일치한 블록과 필요한 조상을 포함한 트리 투영으로 반환한다.

초기에는 Elasticsearch나 별도 검색 서비스를 사용하지 않는다.

## 기술 선택

- 언어: 서버, 클라이언트, MCP가 공유하는 TypeScript
- 클라이언트: Vite + React SPA
- 서버: Fastify REST API + WebSocket
- 데이터베이스: PostgreSQL + Drizzle
- 에디터: Markdown 정본을 유지하는 최소 에디터
- 인증: PostgreSQL 세션 + 보안 쿠키
- AI: OpenAI SDK 직접 호출 + 사람이 선택해 실행하는 Local Codex CLI
- 외부 도구: Dryvre MCP 서버 하나
- 배포: 애플리케이션 단일 컨테이너 + PostgreSQL

## 명시적으로 선택하지 않은 것

- Next.js: SSR, RSC와 캐시 무효화 경계가 로그인 후 라이브 트리에 불필요함
- CRDT·로컬 퍼스트 동기화 엔진: 권한 기반 부분 복제 계층이 새로운 권한 캐시가 될 위험
- 범용 리치텍스트 문서 모델: Markdown과 내부 문서 모델의 이중 직렬화 위험
- Redis·Kafka·외부 큐: 단일 프로세스 단계에서는 필요하지 않음
- Elasticsearch: PostgreSQL FTS로 초기 검색 범위를 충족
