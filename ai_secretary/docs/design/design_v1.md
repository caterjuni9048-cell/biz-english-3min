# design_v1.md — AI 업무 비서 전체 설계 초안 (v0.1.0-draft)

기준: 「AI 업무 비서 V1.0 통합 개발 지침서」(이하 지침). 설계 검증 전.

## 1. 구성 요소
```
[갤럭시 앱 android/]
  collectors: KakaoNotifCollector / SmsReceiver / CallRecordingScanner(+CallLog 대조)
  local_filter: 업무 연락처·채팅방 허용 목록, 제외 목록, 보고방 제외
  room_db: raw_events, attachments, send_queue
  sync_worker(WorkManager): PENDING→SENDING→ACKED / RETRY / FAILED / NEEDS_REVIEW
  ui(Compose): 홈, 접수함, 미처리, 변경, 통화, 원문, 확인필요, 시스템상태, 설정
        │ Tailscale + TLS + 기기 토큰
        ▼
[본부 server/ — Python FastAPI]
  api        : /api/v1/ingest, works, events, events/ack, work-results, health
  storage    : SQLAlchemy + SQLite WAL (PostgreSQL 이전 가능 계층)
  workers    : processing_jobs 임대(lease_until, owner_token) 방식
  stt        : SttAdapter → FasterWhisper / ClovaSpeech / OpenAITranscribe
  ai         : LlmAdapter → Claude(기본) / 교체 가능, JSON Schema 검증
  rules      : 날짜 계산(Asia/Seoul), 단위 규칙, 사전 대조, 원문 인용 검증
  matching   : 기술 중복(source_id, 해시) / 의미 중복(연결 후보)
  reporting  : report_outbox → 앱 푸시, 카카오 나에게 보내기
  integration: event_outbox, consumer_offsets (픽셀사무실용)
  security   : 기기 인증, 권한, 마스킹, 보관기간, 파기
  dashboard  : 노트북 관리 화면 (웹)
```

## 2. 데이터 흐름과 상태
1. 수집 → 폰 Room에 raw_event 저장(source_id = 기기ID + 종류 + 원본 식별자 해시. 재전송해도 같은 값).
2. 전송 → 본부가 커밋한 뒤 ACK {source_id, server_seq}를 돌려준다. ACK를 받아야 ACKED 처리한다.
3. 본부: raw_events INSERT (source_id UNIQUE, 같은 값이 다시 오면 기존 ACK를 재반환) → processing_jobs 생성.
4. 통화: STT → transcripts(원문, 구간 시간) / 보정문은 별도 열에 저장.
5. 분석: 외부 전송 허용 여부 확인 → LLM 추출 → JSON Schema 검증 → 규칙 검증 → extractions 저장.
6. 대조: 후보 업무 검색(거래처, 제품, 납기, 기존 업무번호) → 이벤트 종류 판정(NEW/CHANGE/ADD/CANCEL_REQUEST/RECONFIRM/COMPLETE_REPORT/UNKNOWN). 확신이 없으면 자동으로 합치지 않고 연결 후보로 둔다.
7. 반영: 하나의 트랜잭션 안에서 work_items 갱신 + work_versions 추가 + work_sources 연결 + event_outbox + report_outbox를 함께 저장한다.
8. 보고: report_outbox 처리기가 보고마다 report_id로 한 번만 보낸다. 전송 결과가 불명확하면 UNCERTAIN으로 두고 재전송하지 않는다.

## 3. 업무 값 3층 구조 (R03, R04)
- 원본(raw) → AI값(ai_value, extraction_id) → 확정값(user_value, corrected_by, corrected_at)
- 화면 표시와 보고: 확정값이 있으면 확정값, 없으면 AI값을 쓴다.
- AI 재분석은 확정값이 있는 칸을 쓰지 못한다(DB 계층에서 차단).
- 늦게 도착한 과거 연락: occurred_at이 확정 시각보다 이르면 변경을 적용하지 않고 NEEDS_REVIEW로 둔다.

## 4. 수량 계산 (지침 11장 예시)
- 업무는 '줄(line)' 단위로 관리한다: 기본 27톤 / 추가 1대(+27톤 여부는 제품 규칙이 있을 때만) / 추가분 취소.
- 최종 수량 = 유효한 줄의 합계. 취소는 대상 줄을 지정해야만 적용한다. 대상이 불명확하면 NEEDS_REVIEW.
- '한 대' 같은 차량 단위를 톤으로 바꾸는 것은 product_dictionary에 기준이 있을 때만 한다.

## 5. 학습 (지침 12장)
- 사용자가 수정하면 user_corrections에 기록 → 규칙 후보(learning_rules: status=CANDIDATE) 생성.
- 과거 사례로 회귀 시험을 통과하고 사용자가 승인해야 ACTIVE가 된다. 규칙에는 버전을 매기고 이전 버전으로 되돌릴 수 있다.
- AI가 코드나 규칙을 스스로 배포하는 경로는 만들지 않는다.

## 6. 개인정보 및 외부 전송 정책 초안 (지침 8장)
| 구분 | 수집 | 외부 AI 전송 |
|---|---|---|
| 등록된 업무 연락처 / 업무 채팅방 | O | 허용(기능 ON일 때) |
| 미등록 번호 / 미등록 방 | 원문 폰·본부에만 저장 | 금지. 사용자가 '업무'로 지정하면 전송 |
| 개인 연락처 / 제외 방 / 보고 방 | X | X |
- 외부로 보낼 때는 업무 처리에 필요한 최소 정보만 보낸다. 전화번호는 마스킹하고 거래처 별칭으로 바꾼다.
- 외부로 보낸 기록(무엇을, 언제, 어느 서비스로)은 audit_log에 남긴다.
- 원본 보존기간 기본값: 미정(사용자 결정). 기간이 지나면 파기하고, 백업본도 같은 기간 뒤 파기한다.
- API 키는 노트북의 보호된 경로(Windows 자격 증명 관리자 등)에 둔다. 폰은 기기 토큰만 Android Keystore에 둔다.
- 법적 확인 필요(미확인): 통신비밀보호법(당사자 녹음 자체는 일반적으로 허용되는 것으로 알려짐), 개인정보보호법상 거래처 담당자 정보 처리, 처리 위탁, 국외 이전(Claude API). 확인 전까지 외부 전송은 OFF.

## 7. 픽셀사무실 연동 창구 (지침 16장)
- 이벤트: schema_version="1.0", event_id(UUID), sequence(단조 증가), event_type, work_id, work_version, occurred_at, recorded_at, category, assignee, review_required, changes, source_ids.
- 받는 쪽: GET /events?after=n으로 가져가고, 처리를 마친 뒤 POST /events/ack로 알린다. 소비자별 offset을 둔다. 최소 한 번 전송을 전제로 하므로 받는 쪽은 event_id로 중복을 걸러야 한다.
- 원문과 개인정보는 이벤트에 넣지 않고 상세 조회 API로만 제공한다.
- 7단계에서 모의 픽셀사무실(mock consumer)로 시험한다.

## 8. 0단계 기술 검증 계획
시험 앱 `probe_app`(운영 앱과 별도, 수집 결과를 화면과 파일로만 보여 줌. 외부 전송 없음)
| 시험 | 방법 | 판정 기준 |
|---|---|---|
| T01 | PC 카톡 켠 상태에서 다른 사람이 테스트 방에 10건 전송 | 폰에서 수집된 건수/10 |
| T02 | 폰에서 해당 방을 연 채로 5건 수신 | 수집 건수 |
| T03 | 500자, 2000자 메시지 | 받은 글자 수 비교 → FULL/PARTIAL |
| T04 | 1초 간격 5건 연속 | 개별 메시지로 분리되는지, 중복되는지 |
| T05 | 사진, 파일, 답장 | 받은 표기 내용 |
| T06 | 일반 SMS, 장문 SMS | 원문과 일치하는지 |
| T07 | MMS, RCS | 수집 여부 |
| T08 | 녹음 폴더를 MediaStore와 SAF로 각각 조회 | 파일 목록, 읽기 성공 여부 |
| T09 | 같은 번호로 2회 연속 통화 | 통화 기록과 파일이 맞게 연결되는지 |
| T10 | 통화 종료 직후 파일 크기를 1초 간격으로 측정 | 크기가 고정되는 시점(저장 완료 판단 기준) |
| T11~T14 | 재부팅, 화면 꺼짐 30분, 강제 종료, 권한 해제 후 수신 | 수집 재개 여부 |
결과는 PASS / FAIL / BLOCKED / NOT_TESTED로 docs/test_results/stage0.md에 기록한다.

## 9. 일정 (추정, 노트북 접속 이후 기준)
| 단계 | 버전 | 예상 작업 시간 | 산출물 |
|---|---|---|---|
| 0 환경·기술 검증 | v0.1.0 | 4~6시간 + 실기기 시험 | 보고서 4종, probe_app, stage0 결과 |
| 1 수집 앱 | v0.2.0 | 8~12시간 | APK, 시험 결과 |
| 2 본부·전송 | v0.3.0 | 8~12시간 | 서버, T15~T19 결과 |
| 3 음성인식 | v0.4.0 | 6~10시간 + 통화 표본 | STT 비교표 |
| 4 AI 분석 | v0.5.0 | 8~12시간 | 추출 정확도 결과 |
| 5 장부·대조 | v0.6.0 | 10~16시간 | T20~T28 결과 |
| 6 보고·화면 | v0.7.0 | 10~14시간 | 앱 화면, 관리 화면 |
| 7 연동 준비 | v0.8.0 | 6~8시간 | 모의 연동 결과 |
| 8 통합·배포 | v0.9→1.0 | 8~12시간 + 24시간 운영 시험 | 최종 검증 보고서 |
위 시간은 작업 규모를 보고 잡은 추정이다. 단계마다 외부 검증 왕복 시간은 포함하지 않았다.
