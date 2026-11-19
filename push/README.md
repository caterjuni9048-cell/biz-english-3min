# 3분 영어 푸시 알림 서버

- 주소: https://bizeng-push.bizeng3min.workers.dev
- 플랫폼: Cloudflare Workers, 무료 요금제
  - 스크립트 이름: `bizeng-push`
  - 저장소: KV `bizeng-push`
- 실행 주기: 1분마다(cron `* * * * *`), 한국 시간 기준
  - 앱이 정한 알림 시각, 매시간 알림, 요일, 다시 알림이 맞으면 Web Push를 보낸다.

## 받는 요청
| 요청 | 하는 일 |
|---|---|
| `GET /vapid` | 공개키를 돌려준다. 앱이 알림을 구독할 때 쓴다. |
| `POST /sub {id, sub, cfg}` | 푸시 주소와 알림 설정을 저장한다. |
| `POST /done {id, count, all}` | 한 판을 끝냈다고 기록한다. 그 뒤로는 다시 알림을 보내지 않는다. |
| `POST /test {id}` | 시험 알림을 바로 보낸다. |
| `POST /unsub {id}` | 등록을 지운다. |

## 비밀값
- VAPID 개인키는 Cloudflare의 비밀 변수 `VAPID_PRIVATE_JWK`에만 있다. 저장소에는 없다.
- 개인키를 잃어버리면 새 키를 만들어 다시 배포하면 된다.
  - 이때 앱에서 "알림 다시 연결"을 한 번 눌러야 한다.

## 다시 배포 (Cloudflare API)
1. `PUT /accounts/{계정}/workers/scripts/bizeng-push`
   - multipart로 보낸다: `metadata`와 `worker.js`
   - `metadata`에 넣을 바인딩:
     - `KV`: kv_namespace
     - `VAPID_PUBLIC`: plain_text
     - `VAPID_PRIVATE_JWK`: secret_text
2. `PUT /accounts/{계정}/workers/scripts/bizeng-push/schedules`
   - 본문: `[{"cron":"* * * * *"}]`
