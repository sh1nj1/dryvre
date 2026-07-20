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
session(id, subject_id, expires_at)
```

- `parent_id`와 `path`가 하나의 트리를 표현한다.
- 루트 블록이 작업 공간의 경계이며 별도의 workspace 테이블을 요구하지 않는다.
- `rank`가 있으면 정본 문서 블록, `null`이면 스트림 블록이다.
- 자식 정렬은 `rank NULLS LAST`, 이후 `created_at` 순이다.
- `status`가 `null`이면 태스크가 아니다.
- 블록의 표현 종류는 별도 `kind` 컬럼 대신 `body_md`의 Markdown 접두사에서 파생한다.
- `version`으로 동일 블록의 낙관적 동시 편집 충돌을 감지한다.

## 뷰별 투영

### 문서 뷰

현재 범위에서 `rank`가 있는 자식만 재귀 렌더링한다. 스트림 블록에 `rank`를 부여하면 ID, 자식, 참조와 권한을 유지한 채 문서에 나타난다. 다시 `null`로 만들면 스트림으로 돌아간다.

### 스트림 뷰

현재 선택 블록에 연결된 스트림 블록을 `created_at` 순으로 표시한다. 새 메시지는 선택 블록의 자식 tail에 append한다. 답글은 메시지 블록의 자식이며 UI에서는 깊이 1을 우선 보여주고 더 깊은 답글을 접을 수 있다.

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
move(id, parent, rank?)
edit(id, body)
setStatus(id, status?)
ref(from, to)
unref(from, to)
delete(id)
```

- `create`는 정본 위치 또는 스트림 tail에 블록을 만든다.
- `move` 하나가 부모 변경, 순서 변경과 문서·스트림 간 이동을 담당한다.
- `edit`는 `body_md`만 변경한다.
- `setStatus(null)`은 블록의 태스크성을 제거한다.
- 승인된 연산과 상태 변경은 같은 트랜잭션에서 처리하고 `op_log`에 append한다.
- 연산 종류가 계속 늘어나면 UI의 별도 개념이 코어 온톨로지로 새고 있는지 점검한다.

`op_log`는 감사, 재생과 향후 실행 취소의 근거다. 별도 이벤트 버스나 큐를 초기 구조에 넣지 않는다.

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

모델 SDK를 직접 호출하고 출력은 현재 블록 아래의 새 블록으로 저장한다. LangChain류의 범용 조율 프레임워크나 에이전트 응답 전략 계층을 초기 범위에 두지 않는다.

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
- AI: OpenAI SDK 직접 호출
- 외부 도구: Dryvre MCP 서버 하나
- 배포: 애플리케이션 단일 컨테이너 + PostgreSQL

## 명시적으로 선택하지 않은 것

- Next.js: SSR, RSC와 캐시 무효화 경계가 로그인 후 라이브 트리에 불필요함
- CRDT·로컬 퍼스트 동기화 엔진: 권한 기반 부분 복제 계층이 새로운 권한 캐시가 될 위험
- 범용 리치텍스트 문서 모델: Markdown과 내부 문서 모델의 이중 직렬화 위험
- Redis·Kafka·외부 큐: 단일 프로세스 단계에서는 필요하지 않음
- Elasticsearch: PostgreSQL FTS로 초기 검색 범위를 충족
