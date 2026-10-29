# Threads 댓글 보조 MCP 0.1.3 검수 가이드

이 문서는 실제 고객용 MCP의 연결·동기화·삭제 흐름을 확인하는 절차입니다. 절차를 작성했다는 사실이 운영 계정에서 모든 단계가 검증됐다는 뜻은 아닙니다. Meta 권한 검수는 아직 완료되지 않았으며, 공용 Jev 검수·Apify 유료 수집·실제 답글 게시 기능은 비활성 상태입니다.

## 설치와 계정 연결

1. [설치 안내](README.md)에 따라 0.1.3을 설치하고 Codex를 다시 엽니다. 도구 목록에 `sync_reply_history`와 `delete_account_data`를 포함한 20개가 있는지 확인합니다.
2. “Threads 계정을 연결해 줘”라고 요청합니다. `connect_threads`가 반환한 로그인 주소를 열고 본인이 관리할 권한이 있는 계정으로 Meta 공식 화면에서 로그인·동의합니다. 현재 외부 계정은 Meta 권한 승인 상태에 따라 연결이 제한될 수 있습니다.
3. `finish_threads_login` 후 `connection_status`로 연결 계정과 제공 기능을 확인합니다. 비밀번호·토큰·개발자 비밀 키를 대화나 녹화에 넣지 않습니다.
4. 로그인 화면 하단의 서비스 소개·개인정보 처리방침·이용약관·삭제 안내가 로그인 없이 열리는지 확인합니다.

## 기존 답글 동기화

`sync_reply_history`에 다음 입력을 사용합니다. 답글을 게시하는 명령이 아니며 이 기능 자체는 Jev·Apify를 호출하지 않습니다.

```json
{"maxPages":2,"maxParents":10,"restart":false,"retryUnresolved":false}
```

- `status`, 현재 검증의 `pages`, `completedPasses`, `knownReplies`, `seenThisPass`, `resolved`, `unresolved`, `pending`, `errors`를 확인합니다.
- `scanning` 또는 `resolving`이면 같은 입력으로 다음 묶음을 진행합니다. 서버가 계정별 체크포인트를 유지하므로 커서를 복사하거나 계정 ID를 입력하지 않습니다. 한 번의 호출만으로 “전체 이력 완료”라고 판단하지 않습니다.
- `blocked`이면 반환된 오류 분류와 미해결 개수를 확인합니다. API 권한이나 원글 접근 문제를 해결한 뒤 `retryUnresolved: true`로 재시도합니다. 해결하지 못한 원글이 남으면 게시 준비 완료로 처리하지 않습니다.
- `restart: true`는 첫 페이지부터 새로운 검증을 시작합니다. 기존 중복 확인 원장을 임의로 지우는 기능이 아닙니다.
- `readyForPublication: true`와 `validUntil`을 함께 확인합니다. API에 보이는 전체 목록을 연속 두 번 확인하고 미해결 원글이 없어야 합니다. 각 전체 검증은 5분 이내여야 하며 완료 후 준비 상태는 60초간 유효합니다. 외부 앱의 동시 변경에 대한 원자적 스냅샷 보장은 없습니다.
- 반환값에 원문 답글·계정 ID·API 커서가 노출되지 않는지 확인합니다. 화면 기록에는 계정명 등 불필요한 개인 정보를 가립니다.

다음 입력은 네트워크 호출 전에 클라이언트 스키마 검증에서 거절되어야 합니다.

```json
{"maxPages":6}
{"maxParents":26}
{"accountId":"another-account"}
{"after":"caller-cursor"}
```

## 게시와 구분할 것

이력 동기화 완료는 게시 승인이 아닙니다. 실제 게시에는 서버의 게시 활성화, 사용자에게 제시한 대상 글·정확한 답글 본문에 대한 별도 승인, 최신 원글·대화·중복 이력·AI 검수 조건이 모두 필요합니다. 현재 공용 게시 기능이 비활성이므로 이 검수 가이드의 동기화 확인을 게시 성공 증거로 사용하지 않습니다. 불확실한 게시 결과를 새 요청으로 반복하지 않습니다.

## 계정 자료 삭제

삭제 시험은 삭제해도 되는 시험 계정의 자료에 한해 진행합니다. `connection_status`에서 확인한 계정명과 삭제 범위를 이용자에게 보여 준 뒤, 명시적 확인을 받은 경우 `delete_account_data`에 `confirmationUsername`과 해당 삭제 요청의 새 UUID인 `requestId`를 전달합니다.

`completed` 완료 응답과 상태 조회 링크를 확인합니다. 요청 도중 최신 로그인이 생겨 `superseded`가 반환되면 해당 상태를 완료로 바꾸어 설명하지 않습니다. 서비스 자료 삭제는 Threads의 공개 답글이나 Codex 대화 기록을 삭제하지 않으며 Meta의 앱 권한 설정도 별도로 관리합니다. 자세한 범위와 문의 절차는 [데이터 삭제 안내](https://mcp.rabbitdevelopment.net/data-deletion)를 확인합니다.

## 자동 시험 범위

`npm test`는 모의 HTTPS 응답과 격리된 OS 연결 저장소로 입력 검증·정상 응답 전달·세션 관리·실제 MCP 초기화 및 도구 조회를 시험합니다. 서버의 실제 계정 이력과 Meta 권한은 이 시험으로 검증되지 않습니다.

Windows `test/installer.test.ps1`은 설치 명령을 대역으로 시험합니다. `test/installer-smoke.ps1 -PackageDirectory <설치파일폴더>`는 임시 폴더에 실제 패키지를 설치해 MCP 초기화와 20개 도구 조회를 확인하며, 사용자 Codex 등록은 대역으로 처리합니다. 실제 Threads 게시나 유료 제공업체 호출을 하지 않습니다.
