# Dryvre 문서

Dryvre의 장기 제품 원칙과 해커톤 제출 범위를 분리해 관리한다. 구현이나 UI가 아래 규칙과 충돌하면 이 문서를 기준으로 정리한다.

## 문서 지도

- [제품 원칙](product-principles.md): 블록 온톨로지, 세 가지 뷰, 참조와 AI의 의미
- [UI 규칙](ui-rules.md): 레이아웃과 상호작용에 관한 확정 결정
- [블록 편집기 스펙](editor-spec.md): Markdown 편집, 키보드, 저장과 충돌 계약
- [기술 아키텍처](architecture.md): 데이터 모델, 연산 프로토콜, 동기화와 기술 선택
- [개발 DB와 E2E](development-database.md): 로컬 PostgreSQL 초기화, 자동 Testcontainers 모드, CI 테스트
- [해커톤 MVP 범위](hackathon-scope.md): 구현 목표, 데모 흐름, 비범위와 제출 체크리스트
- [OpenAI Build Week](build-week.md): 일정, 트랙, 심사 기준, 제출 요건과 공식 자료

## 우선순위

서로 충돌할 때는 다음 순서로 판단한다.

1. `product-principles.md`의 온톨로지와 단순성 원칙
2. `ui-rules.md`의 확정된 사용자 경험
3. `architecture.md`의 구현 규칙
4. `hackathon-scope.md`의 시간 제약과 비범위

Build Week 안내는 대회 운영 정보이며 제품 설계를 결정하지 않는다.
