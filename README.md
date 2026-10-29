# Threads 댓글 보조 MCP

Codex에서 내 Threads 계정을 연결하는 고객용 MCP입니다. 서비스 주소는 기본으로 설정되어 있으며, 이용자는 본인 계정으로 로그인하고 권한에 동의합니다. 개발자 앱이나 API 키를 직접 준비하지 않습니다.

[설치 파일 다운로드](https://github.com/hayansnapofficial-cmd/threads-comment-client/releases/latest) · [회원용 가이드북](https://rabbitdevelopment.net/guides/threads-comments)

[서비스 소개](https://mcp.rabbitdevelopment.net/) · [개인정보 처리방침](https://mcp.rabbitdevelopment.net/privacy) · [이용약관](https://mcp.rabbitdevelopment.net/terms) · [데이터 삭제 안내](https://mcp.rabbitdevelopment.net/data-deletion)

## 현재 제공 상태

2026-10-29 기준 설치·계정 연결·재시작 후 연결 유지까지 확인했습니다. 일반 외부 계정 연결에 필요한 Meta 앱 권한 검수는 아직 완료되지 않았습니다. 공용 서비스의 Jev 검수, Apify 유료 수집, 실제 댓글 게시는 비활성 상태입니다. 설치만으로 이 기능이나 Meta 권한이 활성화되지는 않습니다.

## Windows 설치

준비물은 Windows, [Node.js 22.15 이상](https://nodejs.org/en/download), Codex와 [Codex CLI](https://developers.openai.com/codex/cli)입니다. Codex 데스크톱만 설치했다면 PowerShell에서 `codex --version`이 실행되는지 확인합니다. CLI가 없다면 Node.js 설치 후 `npm.cmd install -g @openai/codex`로 설치합니다.

1. 위 **설치 파일 다운로드**를 누릅니다.
2. Releases의 **Assets**에서 `threads-comment-client-windows-0.1.3.zip`을 받습니다. 자동으로 표시되는 `Source code (zip)`은 개발 소스입니다.
3. 받은 ZIP의 **압축을 모두 풀고** 그 폴더의 `install.cmd`를 실행합니다.
4. 설치 완료 메시지를 확인하고 Codex를 완전히 종료한 뒤 다시 엽니다.
5. 새 대화에서 아래 문장을 입력합니다.

> threads-comments MCP로 내 Threads 계정을 연결해 줘. 로그인 화면은 오른쪽에 열어 줘.

열린 화면에서 본인 계정으로 로그인하고 동의를 마친 뒤, 채팅에 **로그인 완료**라고 알려 주세요. Codex가 연결 완료를 확인하고 이 컴퓨터에 연결을 저장합니다. 오른쪽 브라우저를 사용할 수 없는 환경에서는 로그인 링크를 엽니다. MCP 자체가 호스트의 브라우저 화면을 강제로 여는 방식은 아닙니다.

설치 도구는 포함된 패키지의 SHA-256을 확인한 뒤 `%LOCALAPPDATA%/ThreadsCommentMcp/customer-client/0.1.3`에 설치하고 `threads-comments`라는 이름으로 Codex에 등록합니다. 관리자 권한을 요구하지 않으며 Node.js를 자동 설치하지 않습니다. npm 의존성을 받기 위한 인터넷 연결이 필요합니다.

### 수동 설치

Releases에서 `.tgz`를 받아 해당 폴더의 PowerShell에서 실행합니다.

```powershell
npm.cmd install -g .\threads-comment-client-0.1.3.tgz
$clientEntry = Join-Path ((npm.cmd root -g).Trim()) 'threads-comment-client/src/index.mjs'
codex mcp add threads-comments -- (Get-Command node.exe).Source $clientEntry
codex mcp get threads-comments
```

공개 npm 레지스트리에는 아직 게시하지 않았습니다. 위 명령은 다운로드한 패키지를 설치합니다.

기존 이용자도 최신 Windows 설치 ZIP의 `install.cmd`를 실행하거나 새 `.tgz`로 위 수동 설치·등록 과정을 진행한 뒤 Codex를 다시 열면 업데이트됩니다. 0.1.3에는 답글 이력 동기화 도구가 추가되어 총 20개 도구가 등록됩니다.

macOS/Linux는 같은 `.tgz` 파일을 받아 다음과 같이 등록할 수 있습니다. Windows용 자동 설치 도구와 별개이며 현재 실제 로그인 검증 환경은 Windows입니다.

```sh
npm install -g ./threads-comment-client-0.1.3.tgz
codex mcp add threads-comments -- node "$(npm root -g)/threads-comment-client/src/index.mjs"
```

## 사용 예시

- 연결 확인: “threads-comments MCP 연결 상태와 지금 사용할 수 있는 기능을 확인해 줘.”
- 업체 정보: “우리 업체는 ○○이고, 서비스는 ○○, 홈페이지는 ○○야. 업체 정보로 저장해 줘.”
- 계정 변경: “threads-comments 연결을 해제하고 다른 Threads 계정으로 연결해 줘.”
- 기존 답글 확인: “내 Threads 답글 이력을 동기화하고, 진행 상태와 확인하지 못한 원글 수를 알려 줘.”

검색 권한과 서버 기능이 활성화되면 “○○ 관련 최근 글을 찾아 줘”, “이 글에 맞는 답글을 작성하고 검수해 줘”처럼 요청할 수 있습니다. 실제 게시 전에는 대상 글과 정확한 답글 본문을 확인하고 게시를 명시적으로 승인해야 합니다. 초안 작성은 게시 승인이 아닙니다.

공식 Threads 검색을 먼저 사용하며, 실패했다고 Apify 유료 수집으로 자동 전환하지 않습니다. 유료 수집은 운영자가 설정한 한도 안에서 별도 비용 승인을 받아 실행합니다.

## 답글 이력 동기화

0.1.3의 `sync_reply_history`는 연결 계정의 기존 답글과 원글을 읽어 서버의 중복 확인 자료에 반영합니다. 댓글을 작성하거나 유료 Jev·Apify를 호출하지 않습니다. 한 번에 처리할 양을 정해 호출하고 서버에 저장된 체크포인트부터 이어갑니다. 계정 ID나 커서는 이용자가 입력하지 않습니다.

| 입력 | 기본값 | 범위·역할 |
| --- | --- | --- |
| `maxPages` | `2` | 호출당 최대 1~5페이지 |
| `maxParents` | `10` | 호출당 원글 최대 1~25개 |
| `restart` | `false` | `true`이면 첫 페이지부터 새 검증 |
| `retryUnresolved` | `false` | 접근 문제 해결 후 미해결 원글 재조회 |

`scanning`·`resolving` 상태에서는 같은 입력으로 다음 묶음을 진행합니다. `blocked`이면 아직 확인하지 못한 원글이 있으므로 접근 문제를 해결한 뒤 `retryUnresolved: true`로 다시 확인합니다. 클라이언트가 무제한으로 자동 반복하거나 유료 수집으로 전환하지 않습니다.

API 권한 범위에서 조회되는 전체 답글 목록을 연속 두 번 확인하고 미해결 원글이 없어야 `readyForPublication: true`가 됩니다. 각 목록 검증에는 시간 제한이 있으며 완료 상태는 60초 동안 유효합니다. 다른 앱의 동시 변경까지 원자적으로 보장하지 않습니다. 이 값이 참이어도 실제 게시에는 사용자 개별 승인·서버 게시 설정·최신 맥락 검사가 별도로 필요합니다.

응답은 진행 건수·상태·오류 분류를 제공하며 계정 ID·API 커서·답글 본문은 포함하지 않습니다. [기능 검수 가이드](REVIEWER_GUIDE.md)에서 진행 단계와 실패 확인 방법을 볼 수 있습니다.

## 계정 자료 삭제

0.1.2 이상으로 업데이트한 뒤 Codex에 다음과 같이 요청합니다.

> Threads 댓글 보조 서비스의 내 계정 자료를 삭제해 줘. 먼저 연결 계정과 삭제 범위를 보여 줘.

연결된 계정명과 삭제 범위를 확인한 뒤 삭제를 승인하면 `delete_account_data`가 실행됩니다. 이 도구는 서버의 계정 연결·업체 정보·초안·게시 이력·캐시와 모든 기기의 서비스 세션을 삭제합니다. 이미 Threads에 게시한 답글이나 Codex 대화 기록은 삭제하지 않습니다.

완료 응답의 요청별 상태 조회 링크를 보관해 주세요. 상태는 30일 동안 조회할 수 있습니다. 서버 삭제 완료 후 현재 컴퓨터의 해당 연결 정보도 정리하며, 요청 도중 새로 로그인한 세션은 보존합니다. 로컬 정리만 실패한 경우 서버 완료 상태와 조회 링크를 유지해 안내하므로 삭제 요청을 반복할 필요는 없습니다.

`disconnect_threads`는 현재 연결을 해제하는 도구로 전체 자료 삭제와 다릅니다. Meta 설정에서 연결을 해제해도 이 서비스 자료가 자동 삭제되지 않습니다. 도구를 이용할 수 없거나 이미 Meta 연결을 해제했다면 [데이터 삭제 안내](https://mcp.rabbitdevelopment.net/data-deletion)에 따라 지원 메일로 요청해 주세요. 비밀번호나 접근 토큰은 보내지 마세요.

## 자주 막히는 단계

| 증상 | 확인할 것 |
| --- | --- |
| 설치 창에서 Node.js/Codex가 없다고 표시됨 | 준비 프로그램 설치 후 새 터미널을 열고 다시 실행 |
| 설치 후 도구가 보이지 않음 | Codex 완전 종료 후 재실행, `codex mcp get threads-comments` 확인 |
| 로그인 도중 Codex를 재시작함 | “Threads 연결해 줘”로 처음부터 연결 |
| 일반 계정 권한이 거절됨 | Meta 앱 검수 상태를 운영자에게 확인. API 키를 따로 보내지 않음 |
| 게시/유료 기능이 비활성이라고 표시됨 | 현재 제공 상태 확인. 실패한 게시·유료 호출을 반복하지 않음 |

## 연결 정보와 서버

Meta 앱 시크릿·Threads 토큰·Jev/Apify 키는 운영 서버에서 관리합니다. 이 저장소와 설치 패키지에는 포함하지 않습니다. 로컬에는 해당 서비스의 연결 자격증명만 보관합니다.

- Windows: `%LOCALAPPDATA%/threads-comment-client/session.dpapi`, 현재 Windows 사용자에 묶인 DPAPI 암호화와 전용 디렉터리 권한.
- macOS/Linux: `${XDG_STATE_HOME:-~/.local/state}/threads-comment-client/session.json`, 디렉터리 0700·파일 0600. 암호화 파일은 아닙니다.
- 연결 해제는 서버의 세션 해제 성공 후 로컬 정보를 삭제합니다. 비밀번호·토큰은 채팅이나 GitHub Issue에 올리지 마세요.

기본 서비스 주소는 `https://mcp.rabbitdevelopment.net/`입니다. MCP stdio 클라이언트가 운영 서버의 HTTPS API에 연결하며, 원격 MCP 표준 OAuth 서버로 배포하는 구조는 아닙니다.

## 개발

```sh
npm ci
npm test
npm pack
```

테스트는 모의 HTTPS 응답과 격리된 임시 저장소를 사용합니다. 실제 댓글 게시, 유료 API 호출, 운영 계정 변경을 하지 않습니다. 클라이언트에는 데이터베이스가 필요하지 않습니다.

`THREADS_SERVICE_URL`은 별도 호환 서버를 운영하는 개발자용 HTTPS 주소 재정의입니다. 일반 이용자는 설정하지 않습니다. 주소를 변경하기 전 기존 연결을 해제하세요.

서버 운영 소스와 비공개 설정은 이 고객용 저장소에 포함하지 않습니다. 공개 저장소라고 별도 오픈소스 라이선스를 부여한 것은 아니며 패키지의 라이선스 표기는 `UNLICENSED`입니다.
