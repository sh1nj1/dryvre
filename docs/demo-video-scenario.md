# 데모 비디오 시나리오

## 목표

3분 안에 Dryvre가 문서·태스크·대화·AI를 한 블록 트리로 통합할 뿐 아니라, 사람이 승인 경계를 정하고 에이전트가 작업을 검증하며 끝까지 닫는 Loop Engineering 제품임을 보여준다.

핵심 문장은 다음 두 개다.

> Everything is a block: context, work, conversation, and AI output.

> Agents do not guess past a blocker. They ask in your Inbox, resume with your answer, and finish with evidence.

## 언어와 자막

- 최종 영상의 음성 내레이션은 모두 영어로 녹음한다.
- 자막은 영어로 제공하고 아래 장면표의 내레이션 원문과 동일하게 맞춘다.
- 제품 UI, seed 콘텐츠, 사용자가 입력하는 프롬프트, Inbox 질문, 승인 답글과 에이전트 결과도 모두 영어로 표시한다.
- 최종 영상 프레임과 오디오에는 한국어를 포함하지 않는다. 이 제작 문서만 한국어로 유지할 수 있다.
- 무음으로 재생해도 전체 흐름을 이해할 수 있도록 모든 음성 문장에 자막을 표시한다.

## 사전 준비

- `Launch Dryvre` 블록과 제품 요구사항을 seed 데이터로 준비한다.
- 사용자의 Inbox 블록과 PM Agent, Developer Agent subject를 준비한다.
- PM Agent가 만들 작업은 나머지 계약은 상세하지만 사용자만 결정할 수 있는 완료 조건 하나가 `TBD`로 남도록 한다. 예: 공개 데모 URL을 실제로 공개해도 되는지 승인이 정해지지 않았다.
- Developer Agent의 실행 결과와 검증은 데모 환경에서 20초 안에 끝나도록 결정론적인 fixture 또는 안정적인 도구 경로를 사용한다.
- 네트워크나 모델 호출이 실패해도 같은 상태 전이를 재현할 수 있는 fallback을 준비하되 영상에서는 실제 제품 UI만 보여준다.

## 2분 50초 장면 구성

| 시간 | 화면과 조작 | 영어 내레이션 및 자막 원문 |
| --- | --- | --- |
| 0:00–0:15 | 완성된 보드를 잠깐 보여준 뒤 문서 뷰의 `Launch Dryvre` 블록으로 이동한다. | “Dryvre brings documents, work, conversations, and AI output into one block tree.” |
| 0:15–0:35 | 출시 요구사항 아래 스트림을 열고 `@PM Agent, turn this into an executable launch task`라고 요청한다. | “First, the PM Agent turns scattered context into an executable contract.” |
| 0:35–0:55 | PM Agent가 결과물, 완료 조건, 제약, 검증 방법과 `@Developer Agent`가 포함된 자식 블록을 작성한다. 상태는 아직 없다. | “The AI creates an editable block in the same tree, not a separate ticket.” |
| 0:55–1:08 | 사용자가 작업을 검토하고 `todo`로 바꾼다. 보드에 같은 ID의 카드가 나타난다. | “Moving it to To do is the human's explicit approval to execute.” |
| 1:08–1:25 | Developer Agent가 사전 검증한다. 공개 승인 조건이 빠져 있어 카드가 `todo`에서 `blocked`로 이동하고 왼쪽 Inbox에 새 요청 표시가 나타난다. | “The Developer Agent checks the completion contract first. A missing decision moves the task to Blocked instead of being guessed away.” |
| 1:25–1:45 | Inbox를 열어 원래 작업이 참조된 질문을 확인한다. 사용자가 답글로 공개를 승인한다. | “Blocking questions and approval requests arrive in one personal Inbox stream.” |
| 1:45–2:05 | 작업 화면으로 돌아오면 같은 카드가 `blocked → todo → in_progress`로 전이되고 Developer Agent가 실행 로그와 결과 블록을 추가한다. | “With the answer provided, the task returns to To do, passes validation, and the agent claims it as In progress.” |
| 2:05–2:25 | 검증 체크가 성공하고 결과·증거 자식 블록이 보인 뒤 카드가 `done`으로 이동한다. | “Only verified work, recorded with evidence, can move to Done.” |
| 2:25–2:42 | 문서, 보드, 스트림을 빠르게 전환하며 작업 ID, 상태, Inbox 질문의 backlink와 결과 블록이 유지됨을 보여준다. | “Plans, execution, questions, and results never need copying or syncing. They are the same blocks from the start.” |
| 2:42–2:50 | 제품명과 핵심 문장을 보여준다. | “Humans set intent. Agents close the loop.” |

## 데모에서 보여야 하는 상태

1. PM Agent가 만든 작업은 처음에는 상태가 없다.
2. 사용자가 직접 `todo`로 전환한다.
3. 완료 조건이 부족하면 `todo`에서 `blocked`로 이동한다.
4. Inbox 요청은 사용자를 멘션하고 원래 작업을 참조한다.
5. 사용자 답글 뒤 같은 작업이 `todo`로 복귀한 다음 `in_progress`로 선점된다.
6. 결과와 검증 근거가 같은 작업 아래에 생성된다.
7. 검증 성공 후 같은 작업이 `done`이 된다.
8. 뷰를 바꿔도 블록 ID와 상태가 유지된다.

## 촬영 원칙

- 화면에 보이는 각 상태 전이를 내레이션보다 먼저 또는 동시에 보여준다.
- 에이전트의 긴 사고 과정은 노출하지 않는다. 계약 검사, 질문, 실행, 검증의 관찰 가능한 결과만 보여준다.
- 입력 대기와 모델 지연은 편집해 줄이되 서로 다른 실행을 하나처럼 이어 붙이지 않는다.
- Inbox를 일반 알림함처럼 채우지 않는다. 데모에는 진행을 막는 요청 하나만 둔다.
- `done` 장면에서 결과 블록과 검증 성공을 함께 보여준다.
- 영어 자막이 UI의 핵심 상태나 클릭 대상을 가리지 않도록 화면 하단 안전 영역에 배치한다.
- 전체 러닝타임은 2분 50초를 목표로 하여 제출 제한 전에 10초 여유를 둔다.
