# Dryvre 문서

Dryvre의 장기 제품 원칙과 해커톤 제출 범위를 분리해 관리한다. 구현이나 UI가 아래 규칙과 충돌하면 이 문서를 기준으로 정리한다.

## 문서 지도

- [제품 원칙](product-principles.md): 블록 온톨로지, 세 가지 뷰, 참조와 AI의 의미
- [UI 규칙](ui-rules.md): 레이아웃과 상호작용에 관한 확정 결정
- [블록 편집기 스펙](editor-spec.md): Markdown 편집, 키보드, 저장과 충돌 계약
- [에이전트 작업 루프](agent-loop-spec.md): 작업 정의, 실행 전 검증, 상태 전이와 사용자 Inbox 계약
- [로컬 Agent와 계층형 Skill 스펙](agent-runtime-spec.md): Agent/Skill 블록 규약, Local Codex 실행 계약과 구현 계획
- [기술 아키텍처](architecture.md): 데이터 모델, 연산 프로토콜, 동기화와 기술 선택
- [개발 DB와 E2E](development-database.md): 로컬 PostgreSQL 초기화, 자동 Testcontainers 모드, CI 테스트
- [해커톤 MVP 범위](hackathon-scope.md): 구현 목표, 데모 흐름, 비범위와 제출 체크리스트
- [데모 비디오 시나리오](demo-video-scenario.md): Loop Engineering을 보여주는 3분 미만 장면과 내레이션
- [OpenAI Build Week](build-week.md): 일정, 트랙, 심사 기준, 제출 요건과 공식 자료
- [구현 안함 — Backlog](not-implemented/README.md): 참고할 수 있지만 현재 구현하지 않는 설계 후보

## 우선순위

서로 충돌할 때는 다음 순서로 판단한다.

1. `product-principles.md`의 온톨로지와 단순성 원칙
2. `ui-rules.md`의 확정된 사용자 경험
3. 기능별 스펙의 상세 계약
4. `architecture.md`의 공통 구현 규칙
5. `hackathon-scope.md`의 시간 제약과 비범위

Build Week 안내는 대회 운영 정보이며 제품 설계를 결정하지 않는다.

`not-implemented/`의 문서는 우선순위 판단에 사용하는 활성 스펙이 아니다. 사용자가 명시적으로 승격하기 전까지 참고자료로만 사용한다.
